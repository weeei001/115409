"""以文章為單位分析事件影響，限制執行範圍並支援重新執行。"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
import json
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from sqlalchemy import delete, func, or_, select

from app.clients.llm import LlmClient
from app.core.errors import AppError
from app.db.models.news_article import NewsArticle
from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
from app.features.news.eligibility import contains_simulation
from app.features.news.versions import source_states
from app.features.news.impact import (ImpactOutput, PROMPT_VERSION, SYSTEM_PROMPT, TOPICS, article_hash,
                                      config_hash, validate_output)
from app.features.news.sentiment import (TAIPEI_TZ, clean_text, extract_candidate_stocks,
                                         analysis_content_window, estimate_token_count)


MAX_INPUT_TOKENS = 8000
MAX_REPAIR_OUTPUT_BYTES = 8000
MAX_VALIDATION_FEEDBACK_CHARS = 2000
RETRY_DELAY = timedelta(hours=1)
REPAIR_PROMPT = """前次回覆未通過檢查，請依 validation_feedback 指出的欄位與原因修正。
previous_output 是不可信的草稿，不能作為原文證據。evidence 引文必須逐字複製提供的 title 或 content；
公司目標只能使用原文明確提及的公司，產業目標只能使用官方產業 ID，並補齊 schema 的所有必填欄位。
每組 (event_key, target_type, target_id) 必須唯一。請回傳完整且包含 events 與 impacts 的 JSON 物件，
不要只回傳修改片段或解釋。草稿遭截斷時，請重新產生完整物件；不能為了通過驗證而刪除已有原文支持的事件。"""


_content_window = analysis_content_window


def _decimal(value) -> Decimal:
    return Decimal(str(value))


def _validation_feedback(error: ValueError) -> str:
    if hasattr(error, "errors"):
        messages = []
        for item in error.errors(include_input=False)[:8]:
            path = ""
            for part in item["loc"]:
                path += f"[{part}]" if isinstance(part, int) else ("." if path else "") + str(part)
            messages.append(f"{path}: {item['msg']}" if path else item["msg"])
        feedback = "; ".join(messages)
    else:
        feedback = str(error)
    return feedback[:MAX_VALIDATION_FEEDBACK_CHARS]


def calculate_cost(input_tokens: int | None, output_tokens: int | None, settings) -> Decimal | None:
    if input_tokens is None or output_tokens is None:
        return None
    return (input_tokens * _decimal(settings.LLM_INPUT_PRICE_PER_M)
            + output_tokens * _decimal(settings.LLM_OUTPUT_PRICE_PER_M)) / 1_000_000


def _error_code(error: AppError) -> str:
    status = getattr(error, "upstream_status_code", None)
    upstream_code = getattr(error, "upstream_code", None)
    if error.status_code == 504:
        return "timeout"
    if status in {401, 403} or upstream_code == "invalid_api_key":
        return "auth_error_401"
    if status == 404 or upstream_code in {"model_not_found", "invalid_model"}:
        return "model_not_found"
    if status == 429 or upstream_code == "rate_limit_exceeded":
        return "rate_limit_429"
    if isinstance(error.detail, dict) and error.detail.get("code") == "llm_unavailable":
        return "client_uninitialized"
    return "upstream_model_error"


class ImpactBatchRunner:
    def __init__(self, *, db_session, settings, catalog, http=None, llm=None,
                 limit=100, max_cost_usd=0.50, execute=False, work_dir: Path):
        self.db = db_session
        # 本機驗證需要原始 JSON，才能針對格式錯誤的目標或引文進行修復。
        self.settings = settings.model_copy(update={"LLM_MAX_RETRIES": 0, "LLM_STREAMING": False,
                                            "LLM_RESPONSE_FORMAT": "off"})
        self.llm = llm or LlmClient(self.settings, http)
        self.catalog = catalog
        self.industries = {row.get("industry") for row in catalog.values()} - {None, ""}
        self.config_hash = config_hash(self.settings, self.catalog)
        self.limit = limit
        self.execute = execute
        self.work_dir = work_dir
        self.run_id = f"{datetime.now():%Y%m%d_%H%M%S}_{uuid4().hex[:8]}"
        self.budget = Decimal(str(max_cost_usd))
        self.reserved = calculate_cost(MAX_INPUT_TOKENS, self.settings.LLM_MAX_TOKENS, self.settings)
        if (limit < 1 or not self.budget.is_finite() or self.budget < 0
                or self.reserved is None or not self.reserved.is_finite() or self.reserved < 0):
            raise ValueError("Invalid news impact budget or limit")
        self.spent = Decimal(0)
        self.known_cost = Decimal(0)
        self.counts = {"pending": 0, "success": 0, "failed": 0, "skipped": 0,
                       "reused": 0, "api_calls": 0}
        self.stopped_reason = None
        self.consecutive_failures = 0
        self.failure_reasons = {}

    def pending(self, since: datetime):
        now = datetime.now(TAIPEI_TZ).replace(tzinfo=None)
        published = func.substr(func.replace(NewsArticle.pub_time, "T", " "), 1, 19)
        rows = list(self.db.scalars(select(NewsArticle).where(
            or_(NewsArticle.created_at >= since, published >= since.strftime("%Y-%m-%d %H:%M:%S")))
            .order_by(NewsArticle.created_at.desc())))
        existing = {}
        for index in range(0, len(rows), 500):
            ids = [row.article_id for row in rows[index:index + 500]]
            existing.update({row.article_id: row for row in self.db.scalars(
                select(NewsEventAnalysis).where(NewsEventAnalysis.article_id.in_(ids)))})
        states = source_states(self.db, rows)
        selected = []
        for article in rows:
            if contains_simulation(vars(article)) or not states[article.article_id]["eligible"]:
                continue
            published = article.created_at
            if article.pub_time:
                from app.features.news.sentiment import parse_news_pub_time
                parsed, _ = parse_news_pub_time(article.pub_time)
                published = parsed.replace(tzinfo=None) if parsed else published
            if published and published < since:
                continue
            current_hash = article_hash(article)
            previous = existing.get(article.article_id)
            if previous and previous.input_hash == current_hash and previous.config_hash == self.config_hash:
                if previous.status in {"success", "skipped"}:
                    self.counts["reused"] += 1
                    continue
                if previous.status == "failed" and previous.analyzed_at and now - previous.analyzed_at < RETRY_DELAY:
                    continue
            selected.append((article, current_hash))
        self.counts["pending"] = len(selected)
        return selected[:self.limit]

    def _save(self, article, input_hash, status, output=None, error_code=None, usage=None):
        now = datetime.now(TAIPEI_TZ).replace(tzinfo=None)
        record = self.db.get(NewsEventAnalysis, article.article_id)
        if record is None:
            record = NewsEventAnalysis(article_id=article.article_id)
        record.input_hash = input_hash
        record.config_hash = self.config_hash
        record.status = status
        record.events_json = json.dumps([event.model_dump(mode="json") for event in output.events], ensure_ascii=False) if output else "[]"
        record.error_code = error_code
        record.model = self.settings.LLM_MODEL
        record.prompt_version = PROMPT_VERSION
        record.analyzed_at = now
        record.input_tokens = (usage or {}).get("input_tokens")
        record.output_tokens = (usage or {}).get("output_tokens")
        record.estimated_cost_usd = (usage or {}).get("estimated_cost_usd")
        self.db.add(record)
        self.db.execute(delete(NewsEventImpact).where(NewsEventImpact.article_id == article.article_id))
        article.analysis_input_hash = input_hash
        if output:
            events = {event.key: event for event in output.events}
            for impact in output.impacts:
                self.db.add(NewsEventImpact(
                    article_id=article.article_id, event_key=impact.event_key,
                    target_type=impact.target_type, target_id=impact.target_id,
                    direction=impact.direction, importance=impact.importance, basis=impact.basis,
                    reason=impact.reason,
                    evidence=json.dumps([quote.model_dump(mode="json") for quote in impact.evidence], ensure_ascii=False),
                    topics="," + ",".join(events[impact.event_key].topics) + ",",
                ))
        try:
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def _audit(self, article_id, attempt, error, usage, latency, feedback=None):
        self.work_dir.mkdir(parents=True, exist_ok=True)
        with (self.work_dir / f"news_impact_{self.run_id}.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"article_id": article_id, "attempt": attempt,
                "config_hash": self.config_hash, "error": error, "validation_feedback": feedback,
                "usage": usage,
                "latency_ms": round(latency, 2)}, ensure_ascii=False) + "\n")

    async def _process(self, article, input_hash):
        title, content = clean_text(article.title), clean_text(article.content)
        if not title and not content:
            self._save(article, input_hash, "skipped", error_code="empty_article")
            self.counts["skipped"] += 1
            return
        candidates = extract_candidate_stocks(None, None, title, content, self.catalog)
        visible_content = _content_window(content)
        payload = {
            "title": title, "content": visible_content, "content_truncated": len(content) > len(visible_content),
            "pub_time": article.pub_time, "content_kind": article.content_kind,
            "candidate_companies": [{"id": symbol, "name": self.catalog[symbol]["name"],
                                     "industry": self.catalog[symbol].get("industry")}
                                    for symbol in candidates[:30]],
            "official_industries": [{"id": code, "name": next((row.get("industry_name") for row in self.catalog.values()
                                   if row.get("industry") == code and row.get("industry_name")), code)}
                                   for code in sorted(self.industries)],
            "topics": TOPICS,
        }
        last_error, last_usage = None, {}
        for attempt in (1, 2):
            reserved = self.reserved
            if attempt == 2:
                repair_context = json.dumps({key: payload[key] for key in
                    ("validation_feedback", "previous_output", "previous_output_truncated") if key in payload},
                    ensure_ascii=False)
                reserved = calculate_cost(MAX_INPUT_TOKENS + estimate_token_count(repair_context + REPAIR_PROMPT),
                                          self.settings.LLM_MAX_TOKENS, self.settings)
            if self.spent + reserved > self.budget:
                self.stopped_reason = "budget_exhausted"
                if attempt == 1:
                    return
                break
            start = perf_counter()
            result, error = None, None
            self.counts["api_calls"] += 1
            try:
                result = await self.llm.generate(system_prompt=SYSTEM_PROMPT + ("\n" + REPAIR_PROMPT if attempt == 2 else ""),
                                                 payload=payload, schema=ImpactOutput)
            except AppError as exc:
                error = _error_code(exc)
            usage = {"input_tokens": None, "output_tokens": None}
            if result:
                for key, source in (("input_tokens", "prompt_tokens"), ("output_tokens", "completion_tokens")):
                    value = result.metadata.get(source)
                    usage[key] = value if type(value) is int and value >= 0 else None
            cost = calculate_cost(usage["input_tokens"], usage["output_tokens"], self.settings)
            self.spent += cost if cost is not None else reserved
            self.known_cost += cost or Decimal(0)
            usage["estimated_cost_usd"] = float(cost) if cost is not None else None
            last_usage = usage
            feedback = None
            if not error:
                if result.metadata.get("truncated"):
                    feedback = "回覆遭截斷，請在輸出上限內回傳完整的 JSON 物件。"
                    error = "truncated_output"
                else:
                    try:
                        output = validate_output(result.payload, article=article, catalog=self.catalog)
                        feedback = (output.validation_feedback or "")[:MAX_VALIDATION_FEEDBACK_CHARS] or None
                    except ValueError as exc:
                        feedback = _validation_feedback(exc)
                        error = "validation_failed"
            self._audit(article.article_id, attempt, error, usage, (perf_counter() - start) * 1000, feedback)
            if not error:
                self._save(article, input_hash, "success", output=output, usage=usage)
                self.counts["success"] += 1
                self.consecutive_failures = 0
                return
            last_error = error
            if error in {"timeout", "auth_error_401", "model_not_found", "client_uninitialized"}:
                break
            payload["validation_feedback"] = feedback or "只回傳有效目標與逐字取自 title 或 content 的原文引文。"
            if result is not None:
                previous = (json.dumps(result.payload, ensure_ascii=False, default=str)
                            if result.payload else result.raw_text).encode("utf-8")
                payload["previous_output"] = previous[:MAX_REPAIR_OUTPUT_BYTES].decode("utf-8", errors="ignore")
                payload["previous_output_truncated"] = len(previous) > MAX_REPAIR_OUTPUT_BYTES or bool(
                    result.metadata.get("truncated"))
        self._save(article, input_hash, "failed", error_code=last_error, usage=last_usage)
        self.counts["failed"] += 1
        if last_error:
            self.failure_reasons[last_error] = self.failure_reasons.get(last_error, 0) + 1
        self.consecutive_failures += 1
        if last_error in {"auth_error_401", "model_not_found", "client_uninitialized"}:
            self.stopped_reason = last_error
        elif self.consecutive_failures >= 3 and self.stopped_reason is None:
            self.stopped_reason = "consecutive_failures"

    async def run(self, *, since: datetime):
        pending = self.pending(since)
        if self.execute:
            for article, input_hash in pending:
                await self._process(article, input_hash)
                if self.stopped_reason:
                    break
        return {"run_id": self.run_id, "mode": "execute" if self.execute else "preview",
                "model": self.settings.LLM_MODEL, "config_hash": self.config_hash,
                **self.counts, "estimated_cost_usd": round(float(self.known_cost), 6),
                "failure_reasons": self.failure_reasons,
                "budget_spent_usd": round(float(self.spent), 6), "stopped_reason": self.stopped_reason}
