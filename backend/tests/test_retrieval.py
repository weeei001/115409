import asyncio
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import AppError, ServiceUnavailable, UpstreamTimeout, install_error_handlers
from app.db.models.news_article import NewsArticle
from app.features.retrieval.common import TAIPEI
from app.features.retrieval.repository import articles_for_hits
from app.features.retrieval.router import get_service, router
from app.features.retrieval.schemas import RetrievalRequest
from app.features.retrieval.service import RetrievalService


def hit(identifier, title="Company earnings", timestamp="2024-01-31 12:00:00", *, stock="2330", score=0.8, content="company results"):
    return {"id": identifier, "score": score, "payload": {
        "chunk_id": identifier, "title": title, "pub_time": timestamp,
        "stock_id": stock, "page_content": content, "source": "cnyes", "url": f"https://news.test/{identifier}"}}


class FakeVector:
    def __init__(self, handler=lambda vector, kwargs: [], count=1, error=None):
        self.handler, self.count_value, self.error = handler, count, error
        self.calls, self.prompts, self.count_calls = [], [], []

    def require_enabled(self):
        if self.error:
            raise self.error

    async def embed_query(self, text):
        self.prompts.append(text)
        return [float(len(self.prompts))]

    async def query(self, vector, **kwargs):
        self.calls.append((vector, kwargs))
        return self.handler(vector, kwargs)

    async def count(self, **kwargs):
        self.count_calls.append(kwargs)
        return self.count_value


def service(vector):
    return RetrievalService(http=None, settings=None, vector=vector, stock_options={"2330": "台積電", "2317": "鴻海"})


def test_analyze_three_routes_dedupe_noise_and_taipei_future_guard():
    general = [hit("earnings"), hit("duplicate", "Company earnings 123"),
               hit("noise", "台股收盤 加權指數跌 500 點"),
               hit("future", "Future release", "2024-01-31T16:00:00Z"),
               hit("missing", "Missing date", "bad")]
    guidance = [hit("guidance-copy"), hit("guidance", "Company guidance", "2024-01-31T15:59:59Z")]
    for item in (general[0], general[1], guidance[0]):
        item["payload"]["article_id"] = "earnings-article"
    market = [hit("market", "聯準會升息導致台股下跌", stock="tw_stock"),
              hit("quote", "盤中速報 台股上漲", stock="tw_stock"),
              hit("other-company", "Other company earnings", stock="tw_stock")]
    vector = FakeVector(lambda embedding, kwargs: {1.0: general, 2.0: guidance, 3.0: market}[embedding[0]])
    response = asyncio.run(service(vector).analyze(RetrievalRequest(symbols=["2330", "unknown"], as_of="2024-01-31 23:59:59")))
    assert [(item.id, item.kind) for item in response.news_sources] == [
        ("earnings", "general"), ("guidance", "general"), ("market", "market")]
    assert [item.retrieval_branch for item in response.news_sources] == ["general", "guidance", "market"]
    assert response.news_sources[1].timestamp == "2024-01-31T15:59:59Z"
    assert response.news_sources[0].publisher == "鉅亨網"
    assert not response.no_recent_news
    assert [args["symbols"] for _, args in vector.calls] == [["2330"], ["2330"], None]
    assert all(args["end"].utcoffset() == timedelta(hours=8) for _, args in vector.calls)
    assert "台積電" not in vector.prompts[2]


def test_related_news_retrieves_without_source_stock_filter_and_hydrates_article(db_session, settings, monkeypatch):
    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: {})
    db_session.add(NewsArticle(article_id="article", title="TSMC earnings", content="Revenue grew",
                               pub_time="2024-01-31 12:00:00", url="https://news.test/article"))
    db_session.commit()
    candidate = hit("chunk", "TSMC earnings", stock="9999")
    candidate["payload"].update(article_id="article", url="https://news.test/article")
    vector = FakeVector(lambda embedding, kwargs: [candidate])
    result = asyncio.run(RetrievalService(http=None, settings=settings, vector=vector,
        stock_options={"2330": "TSMC"}).related_news(db_session, symbol="2330",
        as_of="2024-01-31 23:59:59", limit=5))
    assert vector.calls[0][1]["symbols"] is None
    assert result["total"] == 1 and result["items"][0].article_id == "article"


def test_article_hydration_preserves_ranking_id_precedence_and_url_fallback(db_session):
    db_session.add_all([
        NewsArticle(article_id="first", title="First", url="https://news.test/first"),
        NewsArticle(article_id="second", title="Second", url="https://news.test/second"),
    ])
    db_session.commit()
    hits = [{"payload": payload} for payload in (
        {"article_id": "missing", "url": "https://news.test/missing"},
        {"article_id": "second", "url": "https://news.test/first"},
        {"article_id": "outdated", "url": "https://news.test/first"},
        {"url": "https://news.test/second"},
        {},
    )]
    assert [article.article_id for article in articles_for_hits(db_session, hits)] == ["second", "first"]
    # No usable identifiers must not turn into an unfiltered article query.
    assert articles_for_hits(None, [{"payload": {}}]) == []


def test_analyze_only_general_expands_to_bounded_double_window():
    end = datetime(2024, 1, 31, tzinfo=TAIPEI)

    def handler(embedding, kwargs):
        if embedding == [1.0] and kwargs["start"] == end - timedelta(days=20):
            return [hit("old", timestamp="2024-01-15"), hit("too-old", "Oldest", "2024-01-01"),
                    hit("future", "Future", "2024-01-31 00:00:01")]
        return []

    vector = FakeVector(handler)
    response = asyncio.run(service(vector).analyze(RetrievalRequest(symbols=["2330"], as_of="2024-01-31", lookback_days=10)))
    assert [item.id for item in response.news_sources] == ["old"]
    assert response.no_recent_news
    assert [args["start"] for _, args in vector.calls] == [end - timedelta(days=10), end - timedelta(days=20),
                                                         end - timedelta(days=10), end - timedelta(days=10)]
    assert all(args["end"] == end for _, args in vector.calls)


@pytest.mark.parametrize("days,events,expected_days,expected_limit", [(999, 999, 120, 200), (0, 0, 1, 40)])
def test_analyze_clamps_legacy_numeric_inputs_and_empty_is_success(days, events, expected_days, expected_limit):
    vector = FakeVector()
    response = asyncio.run(service(vector).analyze(RetrievalRequest(symbols=["2330"], as_of="2024-01-31", lookback_days=days, max_events=events)))
    assert response.model_dump() == {"news_sources": [], "no_recent_news": True}
    assert (vector.calls[0][1]["end"] - vector.calls[0][1]["start"]).days == expected_days
    assert all(args["limit"] == expected_limit for _, args in vector.calls)


@pytest.mark.parametrize("retrieval_request", [RetrievalRequest(symbols=[]), RetrievalRequest(symbols=["unknown"]),
                                    RetrievalRequest(symbols=["2330"], as_of="not-a-date")])
def test_analyze_invalid_business_input_fails_before_external_calls(retrieval_request):
    vector = FakeVector()
    with pytest.raises(AppError) as error:
        asyncio.run(service(vector).analyze(retrieval_request))
    assert error.value.status_code == 400
    assert not vector.calls and not vector.prompts


def test_collect_compatible_shape_end_of_day_strict_window_and_fallback():
    def handler(embedding, kwargs):
        if embedding == [1.0] and (kwargs["end"] - kwargs["start"]).days == 20:
            return [hit("old", timestamp="2024-01-15")]
        if embedding == [2.0]:
            return [hit("latest", "Guidance latest", "2024-01-31 23:59:59.500000")]
        return []

    result = asyncio.run(service(FakeVector(handler)).collect(symbol="2330", lookback_days=10, as_of=date(2024, 1, 31), enforce_window=True))
    assert [item["id"] for item in result.news_sources] == ["latest"]
    assert result.news_sources[0]["timestamp"] == "2024-01-31 23:59:59.500000"
    assert result.fallback_mode and result.status == "degraded" and result.reason == "no_recent_news"


@pytest.mark.parametrize("error,reason", [(ServiceUnavailable({"code": "retrieval_disabled", "message": "disabled"}), "retrieval_disabled"),
                                       (UpstreamTimeout("private address must not leak"), "timeout")])
def test_collect_exposes_disabled_and_timeout_without_raw_error(error, reason):
    result = asyncio.run(service(FakeVector(error=error)).collect(symbol="2330"))
    assert result.news_sources == [] and result.fallback_mode
    assert result.status == "unavailable" and result.reason == reason


def test_question_empty_range_never_falls_back_to_older_news():
    vector = FakeVector(lambda embedding, kwargs: [hit("old", timestamp="2023-12-31"),
        hit("future", "Future", "2024-02-01"), hit("bad", "Unknown", "unknown")])
    with pytest.raises(AppError) as error:
        asyncio.run(service(vector).search_question("earnings", ["2330"], "2024-01-01", "2024-01-31 23:59:59"))
    assert error.value.status_code == 404
    assert len(vector.calls) == 1
    assert vector.calls[0][1]["start"] == datetime(2024, 1, 1, tzinfo=TAIPEI)
    assert vector.calls[0][1]["end"] == datetime(2024, 1, 31, 23, 59, 59, tzinfo=TAIPEI)


def test_question_multistock_balanced_relevance_time_order_and_deduplication():
    def handler(embedding, kwargs):
        stock = kwargs["symbols"][0]
        if kwargs["start"]:
            return [hit(stock + "new", timestamp="2024-01-30", score=0.8, stock=stock),
                    *[hit(stock + chr(65 + i), timestamp="2024-01-20", score=0.5, stock=stock) for i in range(6)]]
        return [hit(stock + "old", timestamp="2022-01-01", score=0.99, stock=stock),
                hit(stock + "new", timestamp="2024-01-30", score=0.8, stock=stock)]

    vector = FakeVector(handler)
    response = asyncio.run(service(vector).search_question("compare", ["2330", "2317"], "2024-01-01", "2024-01-31"))
    assert len(response.hits) == 10
    assert [item["payload"]["stock_id"] for item in response.hits] == ["2330"] * 5 + ["2317"] * 5
    assert response.hits[0]["id"] == "2330new" and response.hits[5]["id"] == "2317new"
    assert len({item["id"] for item in response.hits}) == 10
    assert all(args["limit"] == 20 for _, args in vector.calls if args["start"])


def test_question_no_dates_still_excludes_future_and_bad_ranges_fail_early():
    vector = FakeVector(lambda embedding, kwargs: [
        hit("past", timestamp=(kwargs["end"] - timedelta(days=1)).isoformat()),
        hit("old", timestamp=(kwargs["end"] - timedelta(days=31)).isoformat()),
        hit("future", "Future", "2999-01-01")])
    response = asyncio.run(service(vector).search_question("earnings", []))
    assert [item["id"] for item in response.hits] == ["past"]
    assert datetime.fromisoformat(response.time_to) - datetime.fromisoformat(response.time_from) == timedelta(days=30)
    assert vector.calls[0][1]["start"] is not None
    with pytest.raises(AppError) as error:
        asyncio.run(service(vector).search_question("earnings", [], "2024-02-01", "2024-01-01"))
    assert error.value.status_code == 400
    with pytest.raises(AppError) as error:
        asyncio.run(service(FakeVector()).search_question("missing", []))
    assert error.value.status_code == 404


def test_analyze_http_request_response_contract():
    app = FastAPI()
    app.include_router(router)
    install_error_handlers(app)
    app.dependency_overrides[get_service] = lambda: service(FakeVector())
    with TestClient(app) as client:
        response = client.post("/api/analyze", json={"symbols": ["2330"], "as_of": None})
        assert response.status_code == 200 and response.json() == {"news_sources": [], "no_recent_news": True}
        assert client.post("/api/analyze", json={"symbols": []}).status_code == 400
        assert client.post("/api/analyze", json={}).status_code == 422
        assert client.post("/api/analyze", json={"symbols": ["2330"], "lookback_days": None}).status_code == 422


def test_catalog_drives_retrieval_and_empty_options_do_not_fall_back(monkeypatch):
    catalog = {"1101": {"name": "台泥"}, "1303": {"name": "南亞"}}
    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: catalog)
    retrieval = RetrievalService(None, None, FakeVector())
    assert retrieval.stock_options == {"1101": "台泥", "1303": "南亞"}
    response = asyncio.run(retrieval.analyze(RetrievalRequest(symbols=["1101", "1303"], as_of="2024-01-31")))
    assert not response.news_sources
    empty = RetrievalService(None, None, FakeVector(), stock_options={})
    assert empty.stock_options == {}
    with pytest.raises(AppError):
        empty._stock_descriptor("1101")
    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: {})
    assert RetrievalService(None, None, FakeVector()).stock_options == {}
