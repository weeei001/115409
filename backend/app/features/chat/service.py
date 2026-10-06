from __future__ import annotations

import asyncio
import calendar
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
from app.core.errors import AppError, NotFound, ServiceUnavailable
from app.features.market.company_catalog import load_catalog
from app.features.market.repository import stock_names
from app.features.news.sentiment import extract_candidate_stocks
from app.features.retrieval.common import get_source_name, normalize_source_url, source_provenance
from app.features.retrieval.service import RetrievalService

from .answer_validation import AnswerValidationError, CitationValidationError, TruncatedAnswerError, _checked_answer
from .comparison_context import MAX_COMPARISON_STOCKS, collect_comparison_source
from .dashboard import build_dashboard
from .knowledge import collect_knowledge_sources, reference_source
from .stock_context import collect_stock_sources
from .personal_context import personal_scopes, read_personal_context, paper_draft

from .prompts import (ANSWER_PROMPT, answer_system_prompt, failed_claim_guidance, recovery_system_prompt,
                      INTENT_SYSTEM_PROMPT, INSUFFICIENT_EVIDENCE_ANSWER, INVESTMENT_DISCLAIMER, NON_FINANCE_ANSWER,
                      NO_NEWS_MESSAGE)
from .schemas import (AskRequest, AskResponse, ChatAction, ChatFollowUp, Intent, SourceChunk)


def _is_recommendation(query: str) -> bool:
    return bool(re.search(
        r"推薦|推荐|買哪|买哪|哪.{0,12}[買买]|"
        r"(?:該|该|應該|应该|適合|适合|值得|能不能|可不可以).{0,6}[買买賣卖]|"
        r"[買买賣卖](?:進|进|出)?(?:嗎|吗)|值得.{0,8}投資|"
        r"\brecommend\w*\b|\b(?:should I|which\b.{0,40})\s+(?:buy|sell)\b",
        query, re.IGNORECASE))


def _is_forward_outlook(query: str) -> bool:
    has_future = re.search(r"下[週周]|明天|明日|未來|未来|後市|接下來|後續", query)
    has_direction = re.search(r"漲|跌|上漲|下跌|走勢|行情|表現|看多|看空", query)
    asks_direction = re.search(r"會不會|是否|能否|可能", query) and has_direction
    return bool((has_future and has_direction) or asks_direction)


def taipei_now() -> datetime:
    return datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)


def extract_time_filter(query: str, now: datetime | None = None) -> tuple[str | None, str | None]:
    now = now or taipei_now()
    start = end = None
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if re.search(r"今[天日]", query):
        start, end = midnight, now
    elif re.search(r"昨[天日]", query):
        start, end = midnight - timedelta(days=1), midnight - timedelta(seconds=1)
    elif re.search(r"這[週周]|本[週周]", query):
        start, end = midnight - timedelta(days=now.weekday()), now
    elif re.search(r"上[週周]", query):
        end = midnight - timedelta(days=now.weekday()) - timedelta(seconds=1)
        start = (end - timedelta(days=6)).replace(hour=0, minute=0, second=0)
    elif re.search(r"這個月|本月", query):
        start, end = midnight.replace(day=1), now
    elif "上個月" in query:
        end = midnight.replace(day=1) - timedelta(seconds=1)
        start = end.replace(day=1, hour=0, minute=0, second=0)
    # 較長的「近 N 期間」要先比對，否則「最近三個月」會被泛用的「最近」吃成 30 天。
    elif re.search(r"近三個月|近3個月|近一季", query):
        start, end = now - timedelta(days=90), now
    elif re.search(r"近半年|近六個月|近6個月", query):
        start, end = now - timedelta(days=180), now
    elif re.search(r"近一年|近1年|近十二個月|近12個月", query):
        start, end = now - timedelta(days=365), now
    elif re.search(r"最近|近期|近一個月|近1個月", query):
        start, end = now - timedelta(days=30), now
    elif match := re.search(r"(\d{4})年", query):
        year = int(match.group(1))
        if not 1 <= year <= 9999:
            return None, None
        first_month, last_month = 1, 12
        quarter = re.search(r"第?([一二三四1-4])季|Q([1-4])", query)
        if quarter:
            token = quarter.group(1) or quarter.group(2)
            number = "一二三四".index(token) + 1 if token in "一二三四" else int(token)
            first_month, last_month = (number - 1) * 3 + 1, number * 3
        elif "上半年" in query:
            last_month = 6
        elif "下半年" in query:
            first_month = 7
        start = datetime(year, first_month, 1)
        end = datetime(year, last_month, calendar.monthrange(year, last_month)[1], 23, 59, 59)
    if start is None:
        return None, None
    return start.strftime("%Y-%m-%d %H:%M:%S"), end.strftime("%Y-%m-%d %H:%M:%S")


def _intent_time_range(intent: Intent, query: str, now: datetime) -> tuple[str | None, str | None]:
    if intent.time_from or intent.time_to:
        try:
            values = [datetime.fromisoformat(value) if value else None for value in (intent.time_from, intent.time_to)]
            values = [value.astimezone(timezone(timedelta(hours=8))).replace(tzinfo=None)
                      if value is not None and value.tzinfo else value for value in values]
            if values[0] is None or values[1] is None or values[0] <= values[1]:
                return tuple(value.strftime("%Y-%m-%d %H:%M:%S") if value else None for value in values)
        except ValueError:
            pass
    return extract_time_filter(query, now)


def _token_usage(metadata: dict) -> dict:
    reasoning = metadata.get("reasoning_tokens")
    return {"prompt_tokens": metadata.get("prompt_tokens"),
            "completion_tokens": metadata.get("completion_tokens"),
            "reasoning_tokens": reasoning if reasoning is not None else metadata.get("thinking_tokens")}


def _tokens(metadata: dict) -> dict:
    usage = _token_usage(metadata)
    return {"input": usage["prompt_tokens"], "output": usage["completion_tokens"],
            "thinking": usage["reasoning_tokens"]}


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
        self.retrieval = retrieval if retrieval is not None else RetrievalService(
            http, settings, session_factory=session_factory)
        if llm is not None:
            self.llm = llm
        else:
            stream_llm = settings.stream_llm_overrides
            self.llm = LlmClient(settings.model_copy(update={
                **stream_llm,
                "LLM_MODEL": settings.CHAT_LLM_MODEL.strip() or stream_llm["LLM_MODEL"],
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
                               tokens={"input": 0, "output": 0, "thinking": None}, duration_ms=0,
                               current_time=now.strftime("%Y年%m月%d日 %H:%M"))
        needs = set(intent.data_needs or ["news"])
        scopes = personal_scopes(request.query, needs)
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
        if _is_recommendation(request.query) or _is_recommendation(query):
            needs.update({"market", "news"})
        forward_outlook = _is_forward_outlook(query)
        if forward_outlook:
            needs.update({"market", "news"})
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
        response.actions.extend(ChatFollowUp(label=question.strip(), query=question.strip())
                                for question in dict.fromkeys(intent.suggested_questions) if question.strip())
        draft = paper_draft(request.query, symbols, request)
        if draft:
            response.actions.append(draft)
            response.sources.append(reference_source("模擬單草稿", "已準備可編輯草稿，尚未下單或成交。使用者必須確認金額、股數、理由與觀察期間，再由系統驗證資金和庫存。", category="help"))
        market_symbols = [symbol for symbol in symbols if symbol in stock_options]
        if "market" in needs and len(market_symbols) > MAX_COMPARISON_STOCKS:
            response.answer = f"單次最多比較 {MAX_COMPARISON_STOCKS} 檔股票，請縮小本次比較範圍。"
            yield response, "", ""
            return
        if ("market" in needs and not market_symbols and not symbols
                and re.search(r"台股|大盤|加權指數|櫃買|央行|利率|通膨|關稅|匯率|Fed|聯準會", query, re.I)):
            needs.add("news")
        if "market" in needs and not symbols and "news" in needs:
            needs.remove("market")
        if "market" in needs and not symbols:
            response.answer = ("想分析或比較哪幾檔股票？目前可查詢：" +
                               "、".join(f"{name}（{code}）" for code, name in stock_options.items()) + "。"
                               if stock_options else "目前股票服務名單為空，無法查詢行情與基本面。")
            yield response, "", ""
            return

        time_from, time_to = _intent_time_range(intent, query, now)
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
            response.sources, symbols, query, [] if forward_outlook else intent.display_focus
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
        if forward_outlook:
            time_focus += ("\n這是未來走勢問題，請區分已觀測事實與預測。證據不足以支持方向時，"
                           "應明確說明無法判定；有資料來源不代表足以預測走勢。")
        time_focus += "\n本輪介面呈現的資料面板：" + json.dumps(
            [block.model_dump(include={"kind", "title", "description", "source_ids"})
             for block in response.dashboard.blocks] if response.dashboard else [], ensure_ascii=False)
        prompt = ANSWER_PROMPT.format(current_time=response.current_time, time_focus=time_focus + warning,
                                      context="\n\n---\n\n".join(context_parts), query=request.query,
                                      resolved_query=query, history=json.dumps(history, ensure_ascii=False))
        yield response, prompt, warning

    async def _validate_response(self, raw_text, metadata, response, request, prompt, warning):
        async with aclosing(self._validation_steps(raw_text, metadata, response, request, prompt, warning)) as steps:
            async for _ in steps:
                pass

    async def _validation_steps(self, raw_text, metadata, response, request, prompt, warning):
        yield "正在核對回答的引用與數值…"
        try:
            response.answer = _checked_answer(raw_text, metadata, response.sources, warning,
                                              company_catalog=response._company_catalog)
        except AnswerValidationError as exc:
            # Retry once from the same evidence; never publish or attach citations to rejected prose.
            truncated = isinstance(exc, TruncatedAnswerError)
            yield ("回答超過長度限制，正在精簡後重新產生…" if truncated
                   else "回答未通過核對，正在依據來源重新產生…")
            logging.getLogger(__name__).info("Chat answer recovery: reason=%s finish=%s sources=%d",
                                             exc.reason, metadata.get("finish_reason"), len(response.sources))
            result = await self.llm.text(
                system_prompt=(recovery_system_prompt(request.answer_detail, exc.reason)
                               + failed_claim_guidance(getattr(exc, "claim", ""))),
                prompt=prompt,
            )
            yield "正在重新核對回答的引用與數值…"
            try:
                response.answer = _checked_answer(result.raw_text, result.metadata, response.sources, warning,
                                                  company_catalog=response._company_catalog)
            except AnswerValidationError as retry_exc:
                # Keep final rejection observable without logging private prose or evidence.
                finish = result.metadata.get("finish_reason")
                finish = finish if finish in ("stop", "length", "content_filter", None) else "unknown"
                logging.getLogger(__name__).warning(
                    "Chat answer validation failed: reason=%s attempt=2 finish=%s sources=%d",
                    retry_exc.reason, finish, len(response.sources))
                if not isinstance(retry_exc, CitationValidationError) or not _is_forward_outlook(request.query):
                    raise
                response.answer = INSUFFICIENT_EVIDENCE_ANSWER + warning
            first_usage, retry_usage = _token_usage(metadata), _token_usage(result.metadata)
            metadata = {key: (first_usage[key] or 0) + (retry_usage[key] or 0)
                        if first_usage[key] is not None or retry_usage[key] is not None else None
                        for key in first_usage}
        if _is_recommendation(request.query) and not response.answer.endswith(INVESTMENT_DISCLAIMER):
            response.answer += "\n\n" + INVESTMENT_DISCLAIMER
        response.tokens = _tokens(metadata)

    async def ask(self, request: AskRequest) -> AskResponse:
        self.require_enabled()
        response, prompt, warning = await self._prepare(request)
        if not prompt:
            return response
        started = perf_counter()
        result = await self.llm.text(system_prompt=answer_system_prompt(request.answer_detail), prompt=prompt)
        await self._validate_response(result.raw_text, result.metadata, response, request, prompt, warning)
        response.duration_ms = int((perf_counter() - started) * 1000)
        return response

    async def stream_events(self, request: AskRequest):
        try:
            async with aclosing(self._prepare_steps(request)) as steps:
                async for step in steps:
                    if isinstance(step, str):
                        yield {"type": "status", "content": step}
                    else:
                        response, prompt, warning = step
            if response.dashboard:
                yield {"type": "dashboard", "dashboard": response.dashboard.model_dump(mode="json"),
                       "actions": [action.model_dump(mode="json") for action in response.actions]}
            if not prompt:
                yield {"type": "text", "content": response.answer}
            else:
                yield {"type": "status", "content": "正在依據資料產生回答…"}
                started = perf_counter()
                metadata = {}
                parts = []
                async with aclosing(self.llm.stream_text(
                    system_prompt=answer_system_prompt(request.answer_detail), prompt=prompt,
                )) as stream:
                    async for chunk in stream:
                        metadata.update(chunk.metadata)
                        if chunk.text:
                            parts.append(chunk.text)
                async with aclosing(self._validation_steps(
                    "".join(parts), metadata, response, request, prompt, warning,
                )) as steps:
                    async for status in steps:
                        yield {"type": "status", "content": status}
                response.duration_ms = int((perf_counter() - started) * 1000)
                # Buffer until validation so rejected or truncated text never reaches the consumer.
                yield {"type": "text", "content": response.answer}
            yield {"type": "done", **response.model_dump(mode="json")}
        except AppError as exc:
            detail = exc.detail
            message = detail.get("message", "服務暫時無法回應，請稍後重試") if isinstance(detail, dict) else str(detail)
            yield {"type": "error", "message": message}
        except Exception as exc:
            logging.getLogger(__name__).error("Chat stream failed: %s", type(exc).__name__)
            yield {"type": "error", "message": "服務暫時無法回應，請稍後重試"}
