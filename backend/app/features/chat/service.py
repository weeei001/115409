from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncGenerator
from contextlib import aclosing
from datetime import datetime, timedelta, timezone
from time import perf_counter

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.clients.llm import LlmClient
from app.core.errors import AppError, NotFound, ServiceUnavailable, UpstreamTimeout
from app.features.market.company_catalog import load_catalog
from app.features.market.repository import stock_names
from app.features.news.sentiment import extract_candidate_stocks
from app.features.retrieval.common import get_source_name, normalize_source_url, source_provenance
from app.features.retrieval.service import RetrievalService

from .audit import ChatAudit
from .comparison_context import MAX_COMPARISON_STOCKS, collect_comparison_source
from .dashboard import build_dashboard
from .knowledge import collect_knowledge_sources, reference_source
from .stock_context import collect_stock_sources
from .personal_context import read_personal_context, paper_draft, paper_draft_offers

from .prompts import (ANSWER_PROMPT, answer_system_prompt, INTENT_SYSTEM_PROMPT,
                      INSUFFICIENT_EVIDENCE_ANSWER, NON_FINANCE_ANSWER, NO_NEWS_MESSAGE)
from .schemas import (AskRequest, AskResponse, ChatAction, ChatFollowUp, Intent, SourceChunk)


def taipei_now() -> datetime:
    return datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)


def _intent_time_range(intent: Intent) -> tuple[str | None, str | None]:
    if intent.time_from or intent.time_to:
        try:
            values = [datetime.fromisoformat(value) if value else None for value in (intent.time_from, intent.time_to)]
            values = [value.astimezone(timezone(timedelta(hours=8))).replace(tzinfo=None)
                      if value is not None and value.tzinfo else value for value in values]
            if values[0] is None or values[1] is None or values[0] <= values[1]:
                return tuple(value.strftime("%Y-%m-%d %H:%M:%S") if value else None for value in values)
        except ValueError:
            pass
    return None, None


def _token_usage(metadata: dict) -> dict:
    reasoning = metadata.get("reasoning_tokens")
    return {"prompt_tokens": metadata.get("prompt_tokens"),
            "completion_tokens": metadata.get("completion_tokens"),
            "reasoning_tokens": reasoning if reasoning is not None else metadata.get("thinking_tokens")}


def _tokens(metadata: dict) -> dict:
    usage = _token_usage(metadata)
    return {"input": usage["prompt_tokens"], "output": usage["completion_tokens"],
            "thinking": usage["reasoning_tokens"]}


def _add_usage(response: AskResponse, metadata: dict) -> None:
    # 只累加上游已回報的用量；皆未回報的欄位保留未知，不自行估算成零。
    incoming = _tokens(metadata)
    response.tokens = {
        key: (response.tokens.get(key) or 0) + (value or 0)
        if response.tokens.get(key) is not None or value is not None else None
        for key, value in incoming.items()
    }


REQUEST_TIMEOUT_MESSAGE = "本次回答已超過時間上限，請縮小問題後再試。"


def _remaining_seconds(deadline: float) -> float:
    remaining = deadline - asyncio.get_running_loop().time()
    if remaining <= 0:
        raise TimeoutError(REQUEST_TIMEOUT_MESSAGE)
    return remaining


async def _next_before_deadline(steps, deadline: float):
    # timeout 綁定目前 Task，不能跨公開 yield；不同 anext 可能由不同 Task 消費。
    _remaining_seconds(deadline)
    async with asyncio.timeout_at(deadline):
        step = await anext(steps)
    _remaining_seconds(deadline)
    return step


def _conversation_history(request: AskRequest) -> list[dict[str, str]]:
    history = []
    for turn in request.history:
        content = turn.content
        if turn.role == "assistant":
            content = re.sub(r"\[S[1-9][0-9]*\]", "", content.split("【引用來源】", 1)[0])
        if content.strip():
            history.append({"role": turn.role, "content": content.strip()})
    return history


class ChatService:
    def __init__(self, *, http, settings, retrieval=None, intent_llm=None, llm=None, session_factory=None):
        configuration = settings if settings is not None else getattr(llm, "settings", None)
        self.request_timeout_seconds = getattr(configuration, "CHAT_REQUEST_TIMEOUT_SECONDS", 60)
        self.retrieval = retrieval if retrieval is not None else RetrievalService(
            http, settings, session_factory=session_factory)
        if llm is not None:
            self.llm = llm
        else:
            self.llm = LlmClient(settings.model_copy(update={
                "LLM_MAX_TOKENS": settings.CHAT_LLM_MAX_TOKENS,
                "LLM_TIMEOUT_SECONDS": settings.CHAT_LLM_TIMEOUT_SECONDS,
                "LLM_MAX_RETRIES": settings.CHAT_LLM_MAX_RETRIES,
            }), http)
        self.intent_llm = intent_llm if intent_llm is not None else self.llm
        self.session_factory = session_factory

    def require_enabled(self) -> None:
        # News configuration is checked only when news is actually requested.
        self.intent_llm.require_enabled()
        self.llm.require_enabled()

    def _stock_options(self) -> dict[str, str]:
        if self.session_factory is None:
            raise ServiceUnavailable("股票服務名單暫時無法讀取")
        with self.session_factory() as db:
            return stock_names(db)

    def _market_sources(self, symbols, as_of, start_date):
        if self.session_factory is None:
            raise ServiceUnavailable("行情資料暫時無法讀取")
        # The worker owns its session, including when the SSE consumer disconnects.
        with self.session_factory() as db:
            sources = collect_stock_sources(db, symbols, as_of, start_date=start_date)
            if len(symbols) > 1:
                comparison = collect_comparison_source(db, symbols, start_date or as_of - timedelta(days=30), as_of)
                if comparison:
                    sources.append(comparison)
            return sources

    async def _prepare(self, request: AskRequest) -> tuple[AskResponse, str, str]:
        async with aclosing(self._prepare_steps(request)) as steps:
            async for step in steps:
                if not isinstance(step, str):
                    return step
        raise RuntimeError("Chat preparation did not produce a result")

    async def _prepare_steps(self, request: AskRequest) -> AsyncGenerator[str | tuple[AskResponse, str, str], None]:
        """Yield progress before each awaited stage, followed by the prepared response."""
        yield "正在理解問題與對話脈絡…"
        now = taipei_now().replace(microsecond=0)
        history = _conversation_history(request)
        result = await self.intent_llm.generate(
            system_prompt=INTENT_SYSTEM_PROMPT,
            payload={"query": request.query, "history": history,
                     "current_time": now.strftime("%Y-%m-%d %H:%M:%S")},
            schema=Intent,
        )
        completed = not result.metadata.get("truncated") and result.metadata.get("finish_reason") in {None, "stop"}
        fallback = Intent(is_finance=not (completed and result.raw_text.strip().upper() == "NO"))
        try:
            intent = Intent.model_validate(result.payload) if completed and result.payload else fallback
        except ValidationError:
            intent = fallback
        response = AskResponse(answer="", detected_stocks=[], time_range=None, sources=[],
                               tokens=_tokens(result.metadata), duration_ms=0,
                               current_time=now.strftime("%Y年%m月%d日 %H:%M"))
        needs = set(intent.data_needs)
        scopes = needs & {"favorites", "portfolio"}
        # 由伺服器決定帳戶模式，不由回答的引用或「假設」標籤決定是否需要快照。
        response._requires_portfolio = "portfolio" in scopes
        personal_symbols = []
        personal_analysis_note = ""
        if scopes:
            if request._user_id is None:
                response.answer = "登入後即可讓 AI 讀取你的收藏與模擬持股；目前尚未讀取任何個人資料。"
                yield response, "", ""
                return
            try:
                personal_symbols, personal_source = await asyncio.to_thread(
                    read_personal_context, self.session_factory, request._user_id, scopes, query=request.query)
                response.sources.append(personal_source)
            except (SQLAlchemyError, ServiceUnavailable):
                response.answer = "目前無法讀取你的個人資料，請稍後再試。"
                yield response, "", ""
                return
        if not intent.is_finance and "help" not in needs and not scopes:
            response.answer = NON_FINANCE_ANSWER
            yield response, "", ""
            return

        query = (intent.standalone_query or request.query).strip() if history else request.query
        stock_options_available = True
        try:
            stock_options = await asyncio.to_thread(self._stock_options)
        except (SQLAlchemyError, ServiceUnavailable):
            if needs & {"market", "news"}:
                response.answer = "目前無法讀取股票服務名單，請稍後再試。"
                yield response, "", ""
                return
            stock_options = {}
            stock_options_available = False
        catalog = load_catalog()
        catalog = {**catalog, **{symbol: {**catalog.get(symbol, {}), "name": name}
                               for symbol, name in stock_options.items()}}
        response._company_catalog = catalog
        known_symbols = set(catalog)
        symbols = list(dict.fromkeys(symbol for symbol in intent.stocks if symbol in known_symbols))
        if request.stock_id:
            if request.stock_id not in known_symbols:
                response.answer = "目前沒有這檔上市櫃公司的新聞資料。"
                yield response, "", ""
                return
            symbols = [request.stock_id]
        elif not symbols:
            supported = [symbol for symbol in re.findall(
                r"(?<![A-Za-z0-9])\d{4,6}(?![A-Za-z0-9]|年|[/.-]\d)", query)
                         if symbol in known_symbols]
            listed = extract_candidate_stocks(None, None, query, None, catalog) if catalog else []
            symbols = list(dict.fromkeys([*supported, *listed]))
        if scopes and not symbols:
            symbols = personal_symbols
            if len(personal_source.stock_ids) > len(symbols) and needs & {"market", "news"}:
                analysis_kinds = "與".join(label for kind, label in (("market", "行情"), ("news", "新聞"))
                                          if kind in needs)
                personal_analysis_note = (
                    f"收藏與模擬持股合計 {len(personal_source.stock_ids)} 檔（重複股票只計一次）；"
                    f"本輪依收藏順序、再接續模擬持股，僅取前 {len(symbols)} 檔分析{analysis_kinds}："
                    + "、".join(symbols)
                    + "。其餘股票尚未比較；可在下一題指定股票代碼。")
        if scopes and not symbols:
            needs.discard("market")
            needs.discard("news")
        response.detected_stocks = symbols
        response.actions = [ChatAction(label=f"{stock_options[symbol]}個股分析", path=f"/stock/{symbol}")
                            for symbol in symbols if symbol in stock_options]
        if len(symbols) > 1 or "help" in needs:
            response.actions.append(ChatAction(label="多股比較", path="/compare"))
        if "help" in needs:
            response.actions.extend([ChatAction(label="股票總覽", path="/"),
                                     ChatAction(label="模擬下單", path="/order")])
        questions = [question.strip() for question in dict.fromkeys(intent.suggested_questions) if question.strip()]
        if scopes and not questions:
            if "portfolio" in scopes:
                questions.append("請先檢查我的模擬投資可用資金與未成交委託，說明一項需要注意的資金配置問題。")
                questions.append("請檢查我的模擬持股是否過度集中，先討論一項調整方向及採用條件。")
            if "favorites" in scopes:
                questions.append("請從我的收藏股票中選出本輪資料足夠的最多三檔比較，說明選取依據與待確認事項。")
        response.actions.extend(ChatFollowUp(label=question, query=question) for question in questions)
        supported_symbols = [symbol for symbol in symbols if symbol in stock_options]
        draft = paper_draft(intent.paper_order, supported_symbols, request)
        drafts = [draft] if draft else paper_draft_offers(intent.paper_order, supported_symbols, request)
        if drafts:
            response.actions.extend(drafts)
            response.sources.append(reference_source("模擬單草稿", "是否需要建立模擬單？對話會先詢問是否建立，再由使用者編輯金額或股數、理由與觀察重點，查看摘要並確認送出。尚未建立委託或成交；送出時仍由系統驗證資金和庫存。", category="help"))
        market_symbols = [symbol for symbol in symbols if symbol in stock_options]
        if "market" in needs and len(market_symbols) > MAX_COMPARISON_STOCKS:
            response.answer = f"單次最多比較 {MAX_COMPARISON_STOCKS} 檔股票，請縮小本次比較範圍。"
            yield response, "", ""
            return
        if "market" in needs and not symbols and "news" in needs:
            needs.remove("market")
        if "market" in needs and not symbols:
            response.answer = ("想分析或比較哪幾檔股票？目前可查詢：" +
                               "、".join(f"{name}（{code}）" for code, name in stock_options.items()) + "。"
                               if stock_options else "目前股票服務名單為空，無法查詢行情與基本面。")
            yield response, "", ""
            return

        time_from, time_to = _intent_time_range(intent)
        if time_to:
            time_to = min(datetime.fromisoformat(time_to), now).strftime("%Y-%m-%d %H:%M:%S")
        if time_from and datetime.fromisoformat(time_from) > now:
            time_from = None
        user_time_range = bool(time_from or time_to)
        if user_time_range:
            response.time_range = {"from": time_from, "to": time_to}
        warning = ""
        unavailable = (["股票服務名單暫時無法讀取，無法確認可查詢的股票範圍。"]
                       if not stock_options_available and "help" in needs else [])
        if personal_analysis_note:
            unavailable.append(personal_analysis_note)
        if "market" in needs:
            unsupported = [symbol for symbol in symbols if symbol not in market_symbols]
            if unsupported:
                unavailable.append("以下股票不支援行情與基本面查詢：" + "、".join(unsupported) + "；不能據此完成全體比較。")
        news_error = None
        if "news" in needs:
            yield "正在搜尋相關新聞與來源…"
            try:
                news_end = datetime.fromisoformat(time_to) if time_to else now
                news_start = time_from or (news_end - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
                found = await self.retrieval.search_question(query, symbols=symbols,
                    time_from=news_start, time_to=news_end.strftime("%Y-%m-%d %H:%M:%S"))
                if not found.hits:
                    raise NotFound(NO_NEWS_MESSAGE)
                for hit in found.hits:
                    payload = hit.get("payload") or {}
                    source = payload.get("source") or ""
                    response.sources.append(SourceChunk(
                        title=payload.get("title", ""), source=source,
                        source_name=get_source_name(source), pub_time=payload.get("pub_time", ""),
                        url=normalize_source_url(payload.get("url", "")), stock_id=payload.get("stock_id", ""),
                        content=payload.get("page_content", ""), score=round(hit.get("score") or 0, 4),
                        **source_provenance(payload)))
                if found.time_from or found.time_to:
                    response.time_range = {"from": found.time_from, "to": found.time_to}
            except AppError as exc:
                if exc.status_code not in {404, 503, 504}:
                    raise
                news_error = exc
                unavailable.append("未找到符合問題的新聞。" if exc.status_code == 404 else "新聞服務暫時無法使用。")

        if "market" in needs and market_symbols:
            yield "正在讀取行情、技術指標與基本面資料…"
            as_of = datetime.fromisoformat(time_to).date() if time_to else now.date()
            start_date = datetime.fromisoformat(time_from).date() if time_from else None
            # Stored rows have day precision, so an intraday historical cutoff uses the previous day.
            if time_to:
                cutoff = datetime.fromisoformat(time_to)
                if cutoff < now and cutoff.time() != datetime.max.time().replace(microsecond=0):
                    as_of -= timedelta(days=1)
                    unavailable.append("歷史截止時間包含日內時刻；日資料保守取前一天，無法還原盤中行情。")
            if start_date and start_date > as_of:
                unavailable.append("指定區間內沒有可採用的完整日資料。")
            else:
                try:
                    market_sources = await asyncio.to_thread(self._market_sources, market_symbols, as_of, start_date)
                    response.sources.extend(market_sources)
                    missing = [symbol for symbol in market_symbols if not any(
                        source.stock_id == symbol and source.category == "market_technical" for source in market_sources)]
                    if missing:
                        unavailable.append("以下股票缺少指定區間的價量資料：" + "、".join(missing) + "；不能據此完成全體比較。")
                except (SQLAlchemyError, ServiceUnavailable) as exc:
                    logging.getLogger(__name__).warning("Chat market source unavailable: %s", type(exc).__name__)
                    unavailable.append("行情、技術指標、法人與基本面資料暫時無法讀取。")

        if any(source.source_state and source.source_state.get("limitation") for source in response.sources):
            unavailable.append("新聞首次公開時間及完整修訂歷史未核實；不能宣稱精確還原當時可得資訊。")
        response.sources.extend(collect_knowledge_sources(
            query, stock_options=stock_options if stock_options_available else None, include_help="help" in needs,
            include_knowledge=bool(needs & {"market", "knowledge"})))
        if news_error and needs == {"news"}:
            raise news_error
        if unavailable:
            response.sources.append(reference_source("本次資料取得限制", " ".join(unavailable), category="availability"))
            warning += "\n\n" + " ".join(unavailable)
        if not response.sources:
            response.answer = INSUFFICIENT_EVIDENCE_ANSWER
            yield response, "", ""
            return

        context_parts = []
        for number, item in enumerate(response.sources, 1):
            item.citation_id = f"S{number}"
            impact_context = ("\n事件影響判讀（AI 推論；須以原文核對，不等於股價預測）："
                              + json.dumps(item.impact_context, ensure_ascii=False)) if item.impact_context else ""
            if item.shared_facts:
                impact_context += "\n共同事實（相同 fact_id 非獨立佐證）：" + json.dumps(item.shared_facts, ensure_ascii=False)
            if item.source_relationships:
                impact_context += "\n來源與目標關係（industry_context 為產業背景，非該公司已發生事實）：" + json.dumps(item.source_relationships, ensure_ascii=False)
            context_parts.append(f"[片段{number}] [{item.citation_id}] 標題：{item.title}\n"
                                 f"類別：{item.category} | 股票：{item.stock_id}\n"
                                 f"來源：{item.source_name} | 時間：{item.pub_time or '參考定義／無發布時間'}\n"
                                 f"內容：{item.content}{impact_context}\n連結：{item.url}")
        response.dashboard = build_dashboard(
            response.sources, symbols, query, [] if intent.forward_outlook else intent.display_focus
        )
        if personal_analysis_note and response.dashboard:
            response.dashboard.blocks[0].description += "\n" + personal_analysis_note
        time_focus = ""
        if response.time_range:
            label = "使用者指定期間" if user_time_range else "新聞檢索期間（使用者未指定，預設最近 30 天）"
            time_focus = f"{label}：{json.dumps(response.time_range, ensure_ascii=False)}"
        if "market" in needs:
            time_focus += ("\n行情資料為附日期的每日觀測，並非即時報價。請使用提供的共同期間比較；"
                           "未指定期間時，價格比較採最近 30 個日曆日。各股技術指標時序最多包含 "
                           "40 筆觀測，回答時請列明實際日期。")
        if intent.forward_outlook:
            time_focus += ("\n這是未來走勢問題，請區分已觀測事實與預測。證據不足以支持方向時，"
                           "應明確說明無法判定；有資料來源不代表足以預測走勢。")
        time_focus += "\n本輪介面呈現的資料面板：" + json.dumps(
            [block.model_dump(include={"kind", "title", "description", "source_ids"})
             for block in response.dashboard.blocks] if response.dashboard else [], ensure_ascii=False)
        prompt = ANSWER_PROMPT.format(current_time=response.current_time, time_focus=time_focus + warning,
                                      context="\n\n---\n\n".join(context_parts), query=request.query,
                                      resolved_query=query, history=json.dumps(history, ensure_ascii=False))
        yield response, prompt, warning

    def _publish_answer(self, raw_text, metadata, response, *, audit):
        """直接回傳模型文字，不檢核內容或重新生成。"""
        _add_usage(response, metadata)
        response.answer = raw_text
        audit.update_usage(response)
        audit.bypassed()

    async def ask(self, request: AskRequest) -> AskResponse:
        started = perf_counter()
        deadline = asyncio.get_running_loop().time() + self.request_timeout_seconds
        audit = ChatAudit(request, llm=self.llm, timeout_seconds=self.request_timeout_seconds)
        try:
            self.require_enabled()
            async with asyncio.timeout_at(deadline):
                response, prompt, warning = await self._prepare(request)
                audit.prepared(response)
                if prompt:
                    _remaining_seconds(deadline)
                    audit.start_attempt("initial", self.llm)
                    result = await self.llm.text(system_prompt=answer_system_prompt(request.answer_detail), prompt=prompt)
                    audit.complete_attempt(result.raw_text, result.metadata)
                    self._publish_answer(result.raw_text, result.metadata, response, audit=audit)
                else:
                    audit.outcome = "direct"
                _remaining_seconds(deadline)
            response.duration_ms = int((perf_counter() - started) * 1000)
            audit.publish(response, completed=True)
            return response
        except TimeoutError as exc:
            audit.failed(exc)
            raise UpstreamTimeout(REQUEST_TIMEOUT_MESSAGE) from exc
        except Exception as exc:
            audit.failed(exc)
            raise
        finally:
            await audit.persist(self.session_factory)

    async def stream_events(self, request: AskRequest):
        started = perf_counter()
        deadline = asyncio.get_running_loop().time() + self.request_timeout_seconds
        audit = ChatAudit(request, llm=self.llm, timeout_seconds=self.request_timeout_seconds)
        try:
            async with aclosing(self._prepare_steps(request)) as steps:
                while True:
                    try:
                        step = await _next_before_deadline(steps, deadline)
                    except StopAsyncIteration:
                        break
                    if isinstance(step, str):
                        yield {"type": "status", "content": step}
                    else:
                        response, prompt, warning = step
                        audit.prepared(response)
            if response.dashboard:
                yield {"type": "dashboard", "dashboard": response.dashboard.model_dump(mode="json"),
                       "actions": [action.model_dump(mode="json") for action in response.actions]}
            if prompt:
                yield {"type": "status", "content": "正在依據資料產生回答…"}
                metadata = {}
                parts = []
                audit.start_attempt("initial", self.llm)
                async with aclosing(self.llm.stream_text(
                    system_prompt=answer_system_prompt(request.answer_detail), prompt=prompt,
                )) as stream:
                    _remaining_seconds(deadline)
                    async with asyncio.timeout_at(deadline):
                        async for chunk in stream:
                            metadata.update(chunk.metadata)
                            audit.metadata(chunk.metadata)
                            if chunk.text:
                                parts.append(chunk.text)
                                audit.append_text(chunk.text)
                audit.complete_attempt("", metadata)
                self._publish_answer("".join(parts), metadata, response, audit=audit)
            else:
                audit.outcome = "direct"
            _remaining_seconds(deadline)
            response.duration_ms = int((perf_counter() - started) * 1000)
            # 維持只送出一次完整文字，連線錯誤仍照原流程處理。
            audit.publish(response)
            yield {"type": "text", "content": response.answer}
            audit.data["publication_completed"] = True
            yield {"type": "done", **response.model_dump(mode="json")}
        except TimeoutError as exc:
            audit.failed(exc)
            yield {"type": "error", "message": REQUEST_TIMEOUT_MESSAGE}
        except AppError as exc:
            audit.failed(exc)
            detail = exc.detail
            message = detail.get("message", "服務暫時無法回應，請稍後重試") if isinstance(detail, dict) else str(detail)
            yield {"type": "error", "message": message}
        except Exception as exc:
            audit.failed(exc)
            logging.getLogger(__name__).error("Chat stream failed: %s", type(exc).__name__)
            yield {"type": "error", "message": "服務暫時無法回應，請稍後重試"}
        finally:
            await audit.persist(self.session_factory)
