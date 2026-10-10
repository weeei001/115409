import pytest
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.dialects.mysql import dialect
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateTable

from app.db.models.stock_info import StockInfo
from app.jobs.schema import initialize_schema, main, schema_metadata


def test_fresh_schema_includes_chunks_and_preserves_existing_rows():
    engine = create_engine("sqlite://")
    try:
        metadata = schema_metadata()
        assert set(metadata.tables) == {
            "users", "password_reset_tokens", "favorite_stocks", "simulated_orders", "stock_info", "llm_responses",
            "ai_brief_lessons", "chat_conversations", "chat_messages", "chat_message_feedback", "chat_validation_runs",
            "paper_accounts", "paper_orders", "paper_reviews", "paper_cash_movements",
            "notification_preferences", "push_devices", "notifications", "notification_deliveries",
            "market_benchmark_prices", "market_daily_prices", "market_technical_indicators",
            "market_institutional_trades", "market_financial_statement_rows", "market_monthly_revenues",
            "market_stock_valuations", "market_dividend_results", "market_margin_trades",
            "market_foreign_shareholdings", "market_holding_share_levels", "news_articles",
            "news_chunks", "news_event_analyses", "news_event_impacts", "news_article_versions",
            "news_source_selections", "news_source_decisions",
            "admin_accounts", "admin_job_controls", "admin_job_runs", "admin_audit_logs",
        }
        assert "news_chunks" in metadata.tables
        assert {"news_article_versions", "news_source_selections", "news_source_decisions"} <= set(metadata.tables)
        assert set(initialize_schema(engine)) == set(metadata.tables)
        with Session(engine) as db, db.begin():
            db.add(StockInfo(symbol="2330", name="TSMC"))
        assert initialize_schema(engine) == []
        assert set(inspect(engine).get_table_names()) == set(metadata.tables)
        with Session(engine) as db:
            assert db.scalar(select(StockInfo.name)) == "TSMC"
        for table in metadata.tables.values():
            ddl = str(CreateTable(table).compile(dialect=dialect()))
            assert "CHARSET=utf8mb4" in ddl
            assert "ENGINE=InnoDB" in ddl
        assert "LONGTEXT" in str(CreateTable(metadata.tables["news_article_versions"]).compile(dialect=dialect()))
        assert "DATETIME(6)" in str(CreateTable(metadata.tables["news_article_versions"]).compile(dialect=dialect()))
    finally:
        engine.dispose()


@pytest.mark.parametrize("arguments, code", [(["--help"], 0), (["--reset"], 2)])
def test_help_and_invalid_flags_never_connect(monkeypatch, arguments, code):
    def forbidden(*args):
        raise AssertionError("Must not connect")
    monkeypatch.setattr("app.db.engine.make_engine", forbidden)
    with pytest.raises(SystemExit) as result:
        main(arguments)
    assert result.value.code == code


def test_explicit_catalog_sync_uses_fetched_directory(monkeypatch):
    from app.jobs.market.stock_info import SUPPORTED_SYMBOLS

    engine = create_engine("sqlite://")
    monkeypatch.setattr("app.db.engine.make_engine", lambda settings: engine)
    monkeypatch.setattr(engine, "dispose", lambda: None)
    calls = []
    def refresh():
        calls.append(True)
        return {symbol: {"name": "TSMC" if symbol == "2330" else symbol,
                         "industry_name": "Semiconductors"}
                for symbol in (*SUPPORTED_SYMBOLS, "2618")}
    monkeypatch.setattr("app.features.market.company_catalog.refresh_catalog", refresh)
    assert main([]) == 0
    assert not calls
    assert main(["--sync-catalog"]) == 0
    assert calls == [True]
    with Session(engine) as db:
        assert db.get(StockInfo, "2330").industry == "Semiconductors"
        assert set(db.scalars(select(StockInfo.symbol))) == set(SUPPORTED_SYMBOLS)
    monkeypatch.setattr("app.features.market.company_catalog.refresh_catalog", lambda: {})
    with pytest.raises(ValueError, match="catalog"):
        main(["--sync-catalog"])
    with Session(engine) as db:
        assert db.get(StockInfo, "2330").name == "TSMC"
