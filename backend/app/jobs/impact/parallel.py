"""Threaded impact analysis with isolated sessions and an unlimited cost budget."""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from queue import Empty, Queue
from threading import Event, Lock

from app.core.http import make_http_client
from app.db.models.news_article import NewsArticle
from app.features.news.eligibility import contains_simulation
from app.features.news.impact import article_hash
from app.features.news.versions import source_states
from .runner import ImpactBatchRunner


_FATAL_ERRORS = {"auth_error_401", "model_not_found", "client_uninitialized"}


def run_parallel_impact(*, session_factory, settings, catalog, work_dir, since,
                        limit=100000, workers=4, progress=None, source: str | None = None):
    """Execute unique pending articles; callers must authorize unlimited spending.

    Progress callbacks are serialized and receive independent summary snapshots.
    Unexpected errors stop dispatch and propagate after in-flight work has joined.
    """
    if type(workers) is not int or not 1 <= workers <= 32:
        raise ValueError("workers must be an integer from 1 to 32")
    if type(limit) is not int or limit < 1:
        raise ValueError("limit must be a positive integer")
    options = dict(settings=settings, catalog=catalog, work_dir=work_dir,
                   limit=limit, max_cost_usd=None, execute=True)
    with session_factory() as db:
        selector = ImpactBatchRunner(db_session=db, **options)
        selector.limit = 2**63 - 1
        article_ids = list(dict.fromkeys(article.article_id for article, _ in selector.pending(since)
                                        if source is None or article.source == source))[:limit]
        summary = {"run_id": selector.run_id, "mode": "execute", "model": settings.LLM_MODEL,
                   "config_hash": selector.config_hash, **selector.counts,
                   "workers": workers, "source": source, "worker_run_ids": [],
                   "selected": len(article_ids), "completed": 0,
                   "estimated_cost_usd": 0.0, "budget_spent_usd": 0.0,
                   "failure_reasons": {}, "stopped_reason": None}
    if progress is not None:
        progress(deepcopy(summary))
    queue = Queue()
    for article_id in article_ids:
        queue.put(article_id)
    lock, stopped = Lock(), Event()
    consecutive_failures = 0
    known_cost, spent = selector.known_cost, selector.spent

    async def worker():
        nonlocal consecutive_failures, known_cost, spent
        with session_factory() as db:
            async with make_http_client(settings) as http:
                runner = ImpactBatchRunner(db_session=db, http=http, **options)
                with lock:
                    summary["worker_run_ids"].append(runner.run_id)
                while True:
                    with lock:
                        if stopped.is_set():
                            return
                        try:
                            article_id = queue.get_nowait()
                        except Empty:
                            return
                    before = dict(runner.counts)
                    previous_reasons = dict(runner.failure_reasons)
                    previous_cost, previous_spent = runner.known_cost, runner.spent
                    runner.consecutive_failures = 0
                    runner.stopped_reason = None
                    db.expire_all()
                    article = db.get(NewsArticle, article_id)
                    if (article is None or (source is not None and article.source != source)
                            or contains_simulation(vars(article))
                            or not source_states(db, [article])[article_id]["eligible"]):
                        runner.counts["skipped"] += 1
                        db.rollback()
                    else:
                        await runner._process(article, article_hash(article))
                    with lock:
                        for name in ("success", "failed", "skipped", "api_calls"):
                            summary[name] += runner.counts[name] - before[name]
                        for reason, count in runner.failure_reasons.items():
                            delta = count - previous_reasons.get(reason, 0)
                            if delta:
                                summary["failure_reasons"][reason] = summary["failure_reasons"].get(reason, 0) + delta
                        known_cost += runner.known_cost - previous_cost
                        spent += runner.spent - previous_spent
                        summary["estimated_cost_usd"] = round(float(known_cost), 6)
                        summary["budget_spent_usd"] = round(float(spent), 6)
                        summary["completed"] += 1
                        if runner.counts["failed"] > before["failed"]:
                            consecutive_failures += 1
                        else:
                            consecutive_failures = 0
                        if runner.stopped_reason in _FATAL_ERRORS:
                            summary["stopped_reason"] = runner.stopped_reason
                            stopped.set()
                        elif consecutive_failures >= 3:
                            summary["stopped_reason"] = summary["stopped_reason"] or "consecutive_failures"
                            stopped.set()
                        if progress is not None:
                            progress(deepcopy(summary))

    def run_worker():
        try:
            asyncio.run(worker())
        except BaseException:
            stopped.set()
            raise

    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="news-impact") as pool:
        futures = [pool.submit(run_worker) for _ in range(min(workers, len(article_ids)))]
        # The executor context joins every worker even when a result raises.
        for future in futures:
            future.result()
    return summary
