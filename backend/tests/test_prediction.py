import asyncio
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import text

from app.features.analysis.prediction import (
    StrategyConfig,
    build_chart_payload,
    build_prediction_prompt,
    compute_momentum_meanreversion_curve,
    compute_weighted_regression,
    next_trading_days,
)
from app.core.config import Settings
from app.features.analysis import repository
from app.features.analysis.service import AnalysisService
from app.clients.llm import _thinking_extra_body
from app.db.models.daily_price import DailyPrice
from app.db.models.news_article import NewsArticle


def test_weighted_regression_and_curve_keep_bobs_shapes():
    closes = [100.0, 101.5, 100.5, 103.0, 104.0]
    history, slope, intercept = compute_weighted_regression(closes)

    assert len(history) == len(closes)
    assert slope > 0
    assert round(intercept + slope * 4, 2) == history[-1]
    assert len(compute_momentum_meanreversion_curve(closes, 7)) == 7


def test_prediction_configuration_controls_prompt_and_chart_horizon():
    strategy = StrategyConfig(name="test", horizon_days=7, news_limit=3)
    prompt = build_prediction_prompt("2330", "台積電", "trend", ["headline"], strategy)
    records = [{"date": f"2026-09-{day:02d}", "close": float(100 + day)} for day in range(1, 6)]
    prediction = {"regression_history": compute_weighted_regression([r["close"] for r in records])[0],
                  "change_pct_total": 5.0}
    chart = build_chart_payload(records, prediction, strategy)

    assert "未來 7 個交易日" in prompt
    assert len(chart["future_dates"]) == 7
    assert len(chart["ai_future"]) == 7


def test_next_trading_days_skips_weekends():
    assert next_trading_days("2026-09-11", 3) == ["2026-09-14", "2026-09-15", "2026-09-16"]


def test_bob_h200_environment_names_feed_shared_settings(monkeypatch):
    monkeypatch.setenv("H200_API_KEY", "test-h200-key")
    monkeypatch.setenv("H200_BASE_URL", "https://h200.test/v1")
    monkeypatch.setenv("H200_MODEL", "google/gemma-test")
    monkeypatch.setenv("LLM_ENABLE_THINKING", "false")
    settings = Settings(_env_file=None)

    assert settings.LLM_API_KEY == "test-h200-key"
    assert settings.LLM_BASE_URL == "https://h200.test/v1"
    assert settings.LLM_MODEL == "google/gemma-test"
    assert _thinking_extra_body(settings.LLM_MODEL, settings.LLM_ENABLE_THINKING) == {
        "chat_template_kwargs": {"enable_thinking": False}
    }


def test_analysis_and_stream_llm_environment_groups_are_independent(monkeypatch):
    monkeypatch.setenv("ANALYSIS_LLM_API_KEY", "analysis-key")
    monkeypatch.setenv("ANALYSIS_LLM_BASE_URL", "https://analysis.test/v1")
    monkeypatch.setenv("ANALYSIS_LLM_MODEL", "analysis-model")
    monkeypatch.setenv("STREAM_LLM_API_KEY", "stream-key")
    monkeypatch.setenv("STREAM_LLM_BASE_URL", "https://stream.test/v1")
    monkeypatch.setenv("STREAM_LLM_MODEL", "stream-model")

    settings = Settings(_env_file=None)

    assert (settings.LLM_API_KEY, settings.LLM_BASE_URL, settings.LLM_MODEL) == (
        "analysis-key", "https://analysis.test/v1", "analysis-model")
    assert settings.stream_llm_overrides == {
        "LLM_API_KEY": "stream-key", "LLM_BASE_URL": "https://stream.test/v1",
        "LLM_MODEL": "stream-model",
    }


def test_service_uses_backend_price_rows_for_bobs_response(monkeypatch, settings):
    class FakeLlm:
        model_name = "test-model"

        def require_enabled(self):
            return None

        async def generate(self, **kwargs):
            return SimpleNamespace(payload={
                "direction": "up", "change_pct_total": 3.0,
                "confidence": 4, "summary": "測試預測。",
            })

    rows = [SimpleNamespace(date=date(2026, 9, day), close=Decimal(str(100 + day)))
            for day in range(1, 6)]
    monkeypatch.setattr(repository, "trend_inputs",
                        lambda *args, **kwargs: (date(2026, 9, 5), rows, ["headline"]))
    service = AnalysisService(db=None, settings=settings, http=None, llm=FakeLlm(), rag=object())
    result = asyncio.run(service.generate_trend_prediction("2330"))

    assert result["stock_id"] == "2330"
    assert result["ai_direction"] == "up"
    assert len(result["future_dates"]) == settings.TREND_PREDICTION_HORIZON_DAYS


def test_analysis_digest_reads_existing_snapshot(db_session):
    db_session.execute(text("CREATE TABLE analysis_digests (stock_id TEXT, as_of_date TEXT, period TEXT, "
                            "analyst_json TEXT, news_json TEXT, technical_json TEXT, digest_json TEXT)"))
    db_session.execute(text("INSERT INTO analysis_digests VALUES "
                            "('2330', '2026-09-05', 'week', '[1, 2]', '[3]', '{\"ma20\": 100}', "
                            "'{\"overall\": \"up\"}')"))
    db_session.commit()

    result = repository.analysis_digest(db_session, symbol="2330", as_of_date=date(2026, 9, 5), period="week")

    assert result["digest"] == {"overall": "up"}
    assert result["technical"] == {"ma20": 100}
    assert result["analyst_count"] == 2 and result["news_count"] == 1


def test_trend_inputs_reads_backend_price_and_news_tables(db_session):
    db_session.add_all([
        DailyPrice(symbol="2330", date=date(2026, 9, 4), close=Decimal("104")),
        DailyPrice(symbol="2330", date=date(2026, 9, 5), close=Decimal("105")),
        NewsArticle(article_id="a1", stock_id="2330", title="headline",
                    pub_time="2026-09-05T09:00:00+08:00"),
    ])
    db_session.commit()

    latest, prices, titles = repository.trend_inputs(
        db_session, symbol="2330", history_days=60, news_window_days=30, news_limit=20,
    )

    assert latest == date(2026, 9, 5)
    assert [row.close for row in prices] == [Decimal("104.00"), Decimal("105.00")]
    assert titles == ["headline"]
