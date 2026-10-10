from datetime import date
from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.db.models.daily_price import DailyPrice
from app.jobs.research import digest_core as core, backtest_digest_eval as evaluation
from app.jobs.research.build_analysis_digests import anchor_dates


def test_research_prices_use_backend_storage_and_point_in_time_window(monkeypatch, db_session):
    db_session.add_all([
        DailyPrice(symbol="2330", date=date(2024, 1, 2), close=100),
        DailyPrice(symbol="2330", date=date(2024, 1, 3), close=105),
        DailyPrice(symbol="2330", date=date(2024, 1, 4), close=None),
        DailyPrice(symbol="2330", date=date(2024, 1, 5), close=0),
        DailyPrice(symbol="2330", date=date(2024, 1, 8), close=110),
        DailyPrice(symbol="2317", date=date(2024, 1, 3), close=200),
    ])
    db_session.commit()
    disposed = []
    engine = SimpleNamespace(dispose=lambda: disposed.append(True))
    monkeypatch.setattr(core, "get_settings", lambda: None)
    monkeypatch.setattr(core, "make_engine", lambda settings: engine)
    monkeypatch.setattr(core, "make_session_factory", lambda engine: lambda: db_session)
    rows = core.read_price_rows("2330", date(2024, 1, 1), date(2024, 1, 5))
    assert rows == [("2024-01-02", 100.0), ("2024-01-03", 105.0)]
    assert evaluation.actual_from_rows(rows, "2024-01-02", 1) == 5.0
    assert disposed == [True]


def test_research_retrieval_uses_shared_index_and_taipei_cutoff(monkeypatch):
    settings = Settings(_env_file=None)
    calls = []

    class Vector:
        def __init__(self, http, supplied):
            assert supplied is settings

        async def embed_query(self, query):
            return [1.0]

        async def query(self, vector, **kwargs):
            calls.append(kwargs)
            def point(title, timestamp, source="cnyes"):
                return {"payload": {"title": title, "pub_time": timestamp,
                                    "source": source, "page_content": "content"}}
            return [point("analyst", "2024-01-03T15:59:59Z", "moneydj"),
                    point("news", "2024-01-03"), point("news", "2024-01-03"),
                    point("future", "2024-01-03T16:00:00Z"),
                    point("old", "2023-12-01"), point("undated", "invalid")]

    monkeypatch.setattr(core, "VectorClient", Vector)
    analyst, news = core.fetch_pit_articles(settings, None, "2330", "2024-01-03", window_days=2)
    assert [item["title"] for item in analyst] == ["analyst"]
    assert [item["title"] for item in news] == ["news"]
    assert analyst[0]["content"] == "content"
    assert calls[0]["symbols"] == ["2330"]
    assert calls[0]["start"].isoformat() == "2024-01-01T00:00:00+08:00"
    assert calls[0]["end"].isoformat() == "2024-01-03T23:59:59.999999+08:00"


def test_research_model_uses_backend_endpoint_and_proxy_policy(monkeypatch):
    settings = Settings(_env_file=None, LLM_API_KEY="test", LLM_MODEL="model",
                        LLM_BASE_URL="https://model.example/v1")
    monkeypatch.setattr(core, "get_settings", lambda: settings)
    captured = {}
    monkeypatch.setattr(core, "OpenAI", lambda **kwargs: captured.update(kwargs) or SimpleNamespace())
    client, model = core.make_h200_client()
    try:
        assert model == "model"
        assert captured["base_url"] == "https://model.example/v1"
        assert captured["max_retries"] == 0
        assert captured["http_client"]._trust_env is False
    finally:
        captured["http_client"].close()


def test_calendar_and_technical_helpers():
    assert anchor_dates(date(2024, 2, 28), date(2024, 3, 1), "day") == [
        date(2024, 2, 28), date(2024, 2, 29), date(2024, 3, 1)]
    assert anchor_dates(date(2024, 2, 1), date(2024, 3, 1), "month") == [date(2024, 2, 29)]
    assert core.compute_technical([]) == {"available": False}
    assert core.compute_technical([100, 105])["change_pct"] == 5.0


@pytest.mark.parametrize("value", ["NaN", "Infinity", "true"])
def test_prediction_rejects_nonfinite_and_boolean_values(value):
    with pytest.raises(ValueError):
        evaluation.parse_prediction_json('{"change_pct": ' + value + '}')


def test_metrics_exclude_unpaired_predictions():
    decisions = [{"as_of": "2024-01-01", "arm": "A", "skipped_reason": None,
                  "n_digests_used": 0}]
    result = evaluation.compute_metrics(decisions, arm_names=("A", "L"))
    assert result["coverage"]["n_valid_as_of"] == 0
    assert result["arms"]["L"]["hit_rate"] is None
    assert not result["verdict"]["passed"]
