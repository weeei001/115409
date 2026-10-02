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
from urllib.parse import quote, urlsplit

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.clients.llm import LlmClient
from app.core.errors import AppError, NotFound, ServiceUnavailable
from app.features.market.company_catalog import load_catalog
from app.features.news.sentiment import extract_candidate_stocks
from app.features.retrieval.common import (STOCK_KEYWORDS, STOCK_OPTIONS, get_source_name,
                                            normalize_source_url, source_provenance)
from app.features.retrieval.service import RetrievalService

from .claims import numeric_claims_supported
from .comparison_context import collect_comparison_source
from .dashboard import build_dashboard
from .knowledge import collect_knowledge_sources, reference_source
from .stock_context import collect_stock_sources

from .prompts import (ANSWER_PROMPT, answer_system_prompt, INTENT_SYSTEM_PROMPT,
                      INSUFFICIENT_EVIDENCE_ANSWER, INVESTMENT_DISCLAIMER, NON_FINANCE_ANSWER,
                      NO_NEWS_MESSAGE, TIME_FALLBACK_WARNING)
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


def _is_insufficient_only(raw_text: str) -> bool:
    without_citations = re.sub(r"\s*\[S[1-9][0-9]*\]", "", raw_text).strip()
    return without_citations == INSUFFICIENT_EVIDENCE_ANSWER


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
    elif re.search(r"最近|近期|近一個月|近1個月", query):
        start, end = now - timedelta(days=30), now
    elif re.search(r"近三個月|近3個月|近一季", query):
        start, end = now - timedelta(days=90), now
    elif re.search(r"近半年|近六個月", query):
        start, end = now - timedelta(days=180), now
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


def _tokens(metadata: dict) -> dict:
    return {"input": metadata.get("prompt_tokens"), "output": metadata.get("completion_tokens"),
            "thinking": metadata.get("thinking_tokens")}


class CitationValidationError(ServiceUnavailable):
    pass


def _checked_answer(raw_text: str, metadata: dict, sources: list[SourceChunk], warning: str = "") -> str:
    if metadata.get("truncated") or metadata.get("finish_reason") != "stop":
        raise ServiceUnavailable("模型回答未完整生成，請稍後重試。")
    answer = raw_text.strip()
    if not answer:
        raise ServiceUnavailable("模型服務未回傳有效內容，請稍後重試")
    if _is_insufficient_only(answer):
        return INSUFFICIENT_EVIDENCE_ANSWER + warning

    # Normalize citation typography only; every resulting ID is still checked below.
    answer = re.sub(
        r"\[\s*[sS]\d+(?:\s*[,，、]\s*[sS]\d+)*\s*\]|［\s*[sS]\d+(?:\s*[,，、]\s*[sS]\d+)*\s*］|【\s*[sS]\d+(?:\s*[,，、]\s*[sS]\d+)*\s*】",
        lambda match: "".join(f"[{token.upper()}]" for token in re.findall(r"[sS]\d+", match.group())),
        answer,
    )
    # ponytail: structural checks cannot prove entailment; add semantic evaluation when needed.
    citation_pattern = r"\[S[1-9][0-9]*\]"
    cited = list(dict.fromkeys(re.findall(citation_pattern, answer)))
    available = {f"[{source.citation_id}]": source for source in sources if source.content.strip()}
    remainder = re.sub(citation_pattern, "", answer)
    if (not cited or any(citation not in available for citation in cited)
            or re.search(r"[\[\]［］]|【\s*[sS]\d|[a-z][a-z0-9+.-]*://|www\.|<\s*/?[a-z]",
                         remainder, re.IGNORECASE)
            or "【引用來源】" in answer):
        raise CitationValidationError("回答的引用資料不足或格式無法核對，請稍後重試。")

    headings = {"【綜合摘要】", "【市場情緒】", "【關鍵事件】", "【投資提示】",
                "【重點】", "【技術解讀】", "【資料限制】"}
    prose = "\n".join("" if line.strip().lstrip("# ").strip("*_ ") in headings else line
                      for line in answer.splitlines())
    paragraphs = re.split(r"\n\s*\n|\n(?=\s*(?:[-*•·]|\d+[.)])\s)", prose)
    list_marker = re.compile(r"\s*(?:[-*•·]|\d+[.)])\s")
    for index, paragraph in enumerate(paragraphs):
        stripped = paragraph.strip()
        next_paragraph = next((candidate.strip() for candidate in paragraphs[index + 1:] if candidate.strip()), "")
        compact = stripped.strip("*_ ")
        is_structural_list_intro = (compact.endswith(("：", ":")) and bool(list_marker.match(next_paragraph)))
        if (stripped and stripped not in {INSUFFICIENT_EVIDENCE_ANSWER, "非投資建議。"}
                and not is_structural_list_intro
                and not re.search(citation_pattern, paragraph)):
            raise CitationValidationError("回答的引用資料不足或格式無法核對，請稍後重試。")

    for paragraph in paragraphs:
        paragraph_sources = [available[citation] for citation in re.findall(citation_pattern, paragraph)
                             if citation in available]
        if paragraph_sources and not numeric_claims_supported(paragraph, paragraph_sources):
            raise CitationValidationError("回答的數值與所引用資料無法核對，請稍後重試。")

    references = []
    for citation in cited:
        source = available[citation]
        title = re.sub(r"https?://\S+", "", " ".join(source.title.split()), flags=re.IGNORECASE)
        reference = f"- {citation} {title or source.source_name or source.citation_id}"
        if source.article_id:
            reference += f"：/news/{quote(source.article_id, safe='')}"
        else:
            try:
                url = urlsplit(source.url)
                if (url.scheme in {"http", "https"} and url.hostname and not url.username and not url.password
                        and not re.search(r"[\s<>]", source.url)):
                    reference += f"：{source.url}"
            except ValueError:
                pass
        references.append(reference)
    if warning:
        answer += "\n\n【資料限制】\n" + warning.strip()
    return answer + "\n\n【引用來源】\n" + "\n".join(references)


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
        try:
            intent = Intent.model_validate(result.payload) if result.payload else Intent(
                is_finance="NO" not in result.raw_text.upper())
        except ValidationError:
            intent = Intent(is_finance="NO" not in result.raw_text.upper())
        response = AskResponse(answer="", detected_stocks=[], time_range=None, sources=[],
                               tokens={"input": 0, "output": 0, "thinking": None}, duration_ms=0,
                               current_time=now.strftime("%Y年%m月%d日 %H:%M"))
        needs = set(intent.data_needs or ["news"])
        if not intent.is_finance and "help" not in needs:
            response.answer = NON_FINANCE_ANSWER
            yield response, "", ""
            return

        query = (intent.standalone_query or request.query).strip() if history else request.query
        if _is_recommendation(request.query) or _is_recommendation(query):
            needs.update({"market", "news"})
        forward_outlook = _is_forward_outlook(query)
        if forward_outlook:
            needs.update({"market", "news"})
        catalog = load_catalog()
        known_symbols = set(catalog) | set(STOCK_OPTIONS)
        symbols = list(dict.fromkeys(symbol for symbol in intent.stocks if symbol in known_symbols))
        if request.stock_id:
            if request.stock_id not in known_symbols:
                response.answer = "目前沒有這檔上市櫃公司的新聞資料。"
                yield response, "", ""
                return
            symbols = [request.stock_id]
        elif not symbols:
            supported = [symbol for symbol, words in STOCK_KEYWORDS.items()
                         if any(word.casefold() in query.casefold() for word in words)]
            listed = extract_candidate_stocks(None, None, query, None, catalog) if catalog else []
            symbols = list(dict.fromkeys([*supported, *listed]))
        response.detected_stocks = symbols
        response.actions = [ChatAction(label=f"{STOCK_OPTIONS[symbol]}個股分析", path=f"/stock/{symbol}")
                            for symbol in symbols if symbol in STOCK_OPTIONS]
        if len(symbols) > 1 or "help" in needs:
            response.actions.append(ChatAction(label="多股比較", path="/compare"))
        if "help" in needs:
            response.actions.extend([ChatAction(label="股票總覽", path="/"),
                                     ChatAction(label="模擬下單", path="/order")])
        response.actions.extend(ChatFollowUp(label=question.strip(), query=question.strip())
                                for question in dict.fromkeys(intent.suggested_questions) if question.strip())
        market_symbols = [symbol for symbol in symbols if symbol in STOCK_OPTIONS]
        if ("market" in needs and not market_symbols and not symbols
                and re.search(r"台股|大盤|加權指數|櫃買|央行|利率|通膨|關稅|匯率|Fed|聯準會", query, re.I)):
            needs.add("news")
        if "market" in needs and not market_symbols and "news" in needs:
            needs.remove("market")
        if "market" in needs and not market_symbols:
            response.answer = ("想分析或比較哪幾檔股票？目前可查詢：" +
                               "、".join(f"{name}（{code}）" for code, name in STOCK_OPTIONS.items()) + "。")
            yield response, "", ""
            return

        time_from, time_to = _intent_time_range(intent, query, now)
        if time_to:
            time_to = min(datetime.fromisoformat(time_to), now).strftime("%Y-%m-%d %H:%M:%S")
        if time_from and datetime.fromisoformat(time_from) > now:
            time_from = None
        if time_from or time_to:
            response.time_range = {"from": time_from, "to": time_to}
        warning = ""
        unavailable = []
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
                        in_time_range=hit.get("_in_time_range", True), **source_provenance(payload)))
                if found.time_from or found.time_to:
                    response.time_range = {"from": found.time_from, "to": found.time_to}
                warning = TIME_FALLBACK_WARNING if found.fallback_mode else ""
            except AppError as exc:
                if exc.status_code not in {404, 503, 504}:
                    raise
                news_error = exc
                unavailable.append("未找到符合問題的新聞。" if exc.status_code == 404 else "新聞服務暫時無法使用。")

        if "market" in needs:
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
            query, include_help="help" in needs, include_knowledge=bool(needs & {"market", "knowledge"})))
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
            star = "★ " if item.category == "news" and item.in_time_range else ""
            impact_context = ("\n事件影響判讀（AI 推論；須以原文核對，不等於股價預測）："
                              + json.dumps(item.impact_context, ensure_ascii=False)) if item.impact_context else ""
            if item.shared_facts:
                impact_context += "\n共同事實（相同 fact_id 非獨立佐證）：" + json.dumps(item.shared_facts, ensure_ascii=False)
            if item.source_relationships:
                impact_context += "\n來源與目標關係（industry_context 為產業背景，非該公司已發生事實）：" + json.dumps(item.source_relationships, ensure_ascii=False)
            context_parts.append(f"[{star}片段{number}] [{item.citation_id}] 標題：{item.title}\n"
                                 f"類別：{item.category} | 股票：{item.stock_id}\n"
                                 f"來源：{item.source_name} | 時間：{item.pub_time or '參考定義／無發布時間'}\n"
                                 f"內容：{item.content}{impact_context}\n連結：{item.url}")
        response.dashboard = build_dashboard(
            response.sources, symbols, query, [] if forward_outlook else intent.display_focus
        )
        time_focus = ""
        if response.time_range:
            time_focus = f"Requested time range: {json.dumps(response.time_range, ensure_ascii=False)}"
        if "market" in needs:
            time_focus += ("\nMarket data are dated daily observations, not live prices. Compare using the supplied "
                           "common window; without an explicit range the price comparison uses the last 30 calendar "
                           "days. Individual technical timelines contain at most 40 observations. State actual dates.")
        if forward_outlook:
            time_focus += ("\nThis is a future direction question. Distinguish observations from predictions. "
                           "Abstain when the evidence cannot support a direction; source availability alone "
                           "does not establish predictive evidence.")
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
            response.answer = _checked_answer(raw_text, metadata, response.sources, warning)
        except CitationValidationError:
            # Retry once from the same evidence; never publish or attach citations to rejected prose.
            yield "回答未通過核對，正在依據來源重新產生…"
            result = await self.llm.text(
                system_prompt=answer_system_prompt(request.answer_detail) + (
                    "\nThe previous attempt failed citation validation. Write a fresh concise answer from "
                    "the supplied evidence. Use no headings, links or reference list. Every paragraph "
                    "and bullet, including uncertainty and limitations, must end with a supporting "
                     "[S1] style citation from the supplied sources. Use [S1][S2] for multiple sources. "
                     "If the evidence cannot answer the question, use the exact insufficient-evidence reply. "
                ),
                prompt=prompt,
            )
            yield "正在重新核對回答的引用與數值…"
            try:
                response.answer = _checked_answer(result.raw_text, result.metadata, response.sources, warning)
            except CitationValidationError:
                if not _is_forward_outlook(request.query):
                    raise
                response.answer = INSUFFICIENT_EVIDENCE_ANSWER + warning
            metadata = {key: (metadata.get(key) or 0) + (result.metadata.get(key) or 0)
                        if metadata.get(key) is not None or result.metadata.get(key) is not None else None
                        for key in ("prompt_tokens", "completion_tokens", "thinking_tokens")}
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
