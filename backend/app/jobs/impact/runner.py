"""Bounded, restartable article-level event impact analysis."""
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
from app.features.news.impact import (ImpactOutput, PROMPT_VERSION, SYSTEM_PROMPT, TOPICS, article_hash,
                                      config_hash, validate_output)
from app.features.news.sentiment import TAIPEI_TZ, clean_text, extract_candidate_stocks
from app.jobs.sentiment.rules import estimate_token_count
from app.jobs.sentiment.runner import _error_code, calculate_cost


MAX_INPUT_TOKENS = 8000
RETRY_DELAY = timedelta(hours=1)


def _content_window(content: str) -> str:
    low, high = 0, len(content)
    while low < high:
        middle = (low + high + 1) // 2
        if estimate_token_count(content[:middle]) <= 4500:
            low = middle
        else:
            high = middle - 1
    return content[:low]


class ImpactBatchRunner:
    def __init__(self, *, db_session, settings, catalog, http=None, llm=None,
                 limit=100, max_cost_usd=0.50, execute=False, work_dir: Path):
        self.db = db_session
        # Local validation must see the raw JSON so a malformed target or quote can be retried.
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
        selected = []
        for article in rows:
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
            if self.spent + self.reserved > self.budget:
                self.stopped_reason = "budget_exhausted"
                if attempt == 1:
                    return
                break
            start = perf_counter()
            result, error = None, None
            self.counts["api_calls"] += 1
            try:
                result = await self.llm.generate(system_prompt=SYSTEM_PROMPT,
                                                 payload=payload, schema=ImpactOutput)
            except AppError as exc:
                error = _error_code(exc)
            usage = {"input_tokens": None, "output_tokens": None}
            if result:
                for key, source in (("input_tokens", "prompt_tokens"), ("output_tokens", "completion_tokens")):
                    value = result.metadata.get(source)
                    usage[key] = value if type(value) is int and value >= 0 else None
            cost = calculate_cost(usage["input_tokens"], usage["output_tokens"], self.settings)
            self.spent += cost if cost is not None else self.reserved
            self.known_cost += cost or Decimal(0)
            usage["estimated_cost_usd"] = float(cost) if cost is not None else None
            last_usage = usage
            feedback = None
            if not error:
                if result.metadata.get("truncated"):
                    error = "truncated_output"
                else:
                    try:
                        output = validate_output(result.payload, article=article, catalog=self.catalog)
                    except ValueError as exc:
                        feedback = ("; ".join(item["msg"] for item in exc.errors(include_input=False))
                                    if hasattr(exc, "errors") else str(exc))[:250]
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
            payload["validation_feedback"] = feedback or "Return only valid targets and exact quotes from title/content."
        self._save(article, input_hash, "failed", error_code=last_error, usage=last_usage)
        self.counts["failed"] += 1
        self.consecutive_failures += 1
        if last_error in {"auth_error_401", "model_not_found", "client_uninitialized"}:
            self.stopped_reason = last_error
        elif self.consecutive_failures >= 3:
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
                "budget_spent_usd": round(float(self.spent), 6), "stopped_reason": self.stopped_reason}
