"""Unified usage records follow real pipelines, retries, and cache boundaries."""
import asyncio
import json

import httpx
import pytest
from sqlalchemy import select

from app.clients.llm import LlmResult
from app.core.errors import AppError
from app.db.models.ai_usage import AiUsageLog
from app.db.models.news_article import NewsArticle
from app.db.models.stock_info import StockInfo
from app.features.chat.schemas import AskRequest
from app.features.chat.service import ChatService
from app.jobs.impact.runner import ImpactBatchRunner
from test_analysis_service import FakeLlm, run_service, seed_prices
from test_chat import FakeRetrieval, MODEL_ANSWER, plan_payload
from test_llm_chat import completion, configured, stream_frame
from test_news_impact import CATALOG, output


def records(db, feature):
    return list(db.scalars(select(AiUsageLog).where(AiUsageLog.feature == feature)
                          .order_by(AiUsageLog.created_at, AiUsageLog.id)))


@pytest.mark.parametrize("stream", [False, True])
def test_chat_groups_planning_and_answer_but_separates_turns(settings, chat_session_factory, db_session, stream):
    def provider(request):
        body = json.loads(request.content)
        planning = "response_format" in body
        text = json.dumps(plan_payload({"stocks": ["2330"], "data_needs": ["news"]})) if planning else MODEL_ANSWER
        usage = {"prompt_tokens": 11 if planning else 50, "completion_tokens": 3 if planning else 12}
        result = completion(text)
        result["usage"] = {**usage, "total_tokens": sum(usage.values())}
        if body.get("stream"):
            first = stream_frame(text).replace(b'"delta": {', b'"delta": {"role": "assistant", ')
            return httpx.Response(200, content=first + stream_frame(finish="stop")
                                  + stream_frame(usage=result["usage"]) + b"data: [DONE]\n\n",
                                  headers={"Content-Type": "text/event-stream"})
        return httpx.Response(200, json=result)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
            service = ChatService(http=http, settings=configured(settings), retrieval=FakeRetrieval(),
                                  session_factory=chat_session_factory)
            for _ in range(2):
                response = await service.ask(AskRequest(query="台積電營收", stream=stream))
                assert response.answer == MODEL_ANSWER

    asyncio.run(run())
    rows = records(db_session, "chat")
    assert len(rows) == 4
    grouped = {}
    for row in rows:
        grouped.setdefault(row.request_id, []).append((row.input_tokens, row.output_tokens))
        assert row.status == "completed"
    assert len(grouped) == 2
    assert all(sorted(values) == [(11, 3), (50, 12)] for values in grouped.values())


def test_analysis_records_each_retry_and_skips_cached_results(db_session, settings):
    db_session.add(StockInfo(symbol="2330", name="TSMC"))
    db_session.commit()
    seed_prices(db_session)

    class RetryLlm(FakeLlm):
        async def generate(self, **kwargs):
            result = await super().generate(**kwargs)
            result.metadata.update(prompt_tokens=100 * self.calls, completion_tokens=10)
            if self.calls == 1:
                result.payload.clear()
            return result

    llm = RetryLlm()
    first = run_service(db_session, settings, llm)
    assert first.brief is not None and llm.calls == 2
    rows = records(db_session, "analysis")
    assert sorted((row.input_tokens, row.output_tokens) for row in rows) == [(100, 10), (200, 10)]
    assert len({row.request_id for row in rows}) == 1
    original_ids = {row.id for row in rows}
    assert run_service(db_session, settings, llm).cached
    assert {row.id for row in records(db_session, "analysis")} == original_ids
    run_service(db_session, settings, llm, force_refresh=True)
    rows = records(db_session, "analysis")
    assert len(rows) == 3 and len({row.request_id for row in rows}) == 2


def test_news_retries_and_reruns_preserve_individual_unknown_and_failed_calls(db_session, settings, tmp_path):
    article = NewsArticle(article_id="usage-news", title="升息新聞", content="央行宣布升息一碼")
    db_session.add(article)
    db_session.commit()

    class NewsLlm:
        model_name = "test-news-model"
        calls = 0

        async def generate(self, **kwargs):
            self.calls += 1
            if self.calls == 3:
                raise AppError("Upstream unavailable", status_code=504)
            return LlmResult({} if self.calls == 1 else output(), "{}",
                             {"prompt_tokens": 100, "completion_tokens": 20} if self.calls == 1 else {})

    llm = NewsLlm()
    runner = ImpactBatchRunner(db_session=db_session, settings=settings, catalog=CATALOG,
                               llm=llm, execute=True, work_dir=tmp_path)
    asyncio.run(runner._process(article, "first-hash"))
    first = records(db_session, "news_impact")
    assert len(first) == 2 and len({row.request_id for row in first}) == 1
    assert {(row.input_tokens, row.output_tokens) for row in first} == {(100, 20), (None, None)}
    asyncio.run(runner._process(article, "second-hash"))
    rows = records(db_session, "news_impact")
    assert len(rows) == 3 and len({row.request_id for row in rows}) == 2
    failed = [row for row in rows if row.status == "failed"]
    assert len(failed) == 1
    assert failed[0].input_tokens is None and failed[0].output_tokens is None
