from datetime import date

import pytest
from sqlalchemy import Column, MetaData, Table, create_engine, event, text
from sqlalchemy.dialects import mysql

from app.db.base import Base
from app.db.models.news_chunk import news_chunks
from app.jobs.data_rebuild import PUBLIC_DATA_TABLES, _schema, copy_public_data, public_data_manifest


@pytest.fixture
def databases(tmp_path):
    engines = [create_engine(f"sqlite:///{tmp_path / (name + '.sqlite')}")
               for name in ("source", "target")]
    for engine in engines:
        Base.metadata.create_all(engine)
        news_chunks.create(engine)
    yield engines
    for engine in engines:
        engine.dispose()


def seed(engine):
    articles = [
        {"article_id": "c1", "source": "鉅亨網", "url": "https://news.cnyes.com/news/id/1", "title": "Real news"},
        {"article_id": "c2", "source": "CNYES", "url": None, "title": "Legacy news"},
        {"article_id": "l1", "source": "ltn", "url": "https://ltn.com.tw/news/1", "title": "Other source"},
        {"article_id": "sim_war_fixture", "source": "cnyes", "url": "https://news.cnyes.com/news/id/2", "title": "Fixture"},
        {"article_id": "marked", "source": "cnyes", "url": "https://news.cnyes.com/news/id/3", "title": "【模擬測試・非真實新聞】Example"},
        {"article_id": "spoof", "source": "unknown", "url": "https://news.cnyes.com.evil.invalid/news/1", "title": "Wrong domain"},
    ]
    with engine.begin() as connection:
        connection.execute(Base.metadata.tables["stock_info"].insert(), {"symbol": "2330", "name": "TSMC"})
        connection.execute(Base.metadata.tables["market_daily_prices"].insert(),
                           {"date": date(2026, 10, 1), "symbol": "2330", "close": 100})
        connection.execute(Base.metadata.tables["news_articles"].insert(), articles)
        for article in articles:
            article_id = article["article_id"]
            connection.execute(news_chunks.insert(), {"chunk_id": "chunk_" + article_id,
                "article_id": article_id, "chunk_index": 0, "content_hash": "hash", "revision": "rev",
                "index_fingerprint": "fp", "index_version": "v1", "char_start": 0, "char_end": 4})
            connection.execute(Base.metadata.tables["news_event_analyses"].insert(), {
                "article_id": article_id, "input_hash": "in", "config_hash": "config", "status": "ok"})
            connection.execute(Base.metadata.tables["news_event_impacts"].insert(), {
                "article_id": article_id, "event_key": "E1", "target_type": "stock", "target_id": "2330",
                "direction": "positive", "importance": "high", "basis": "direct", "reason": "text", "evidence": "[]"})
            connection.execute(Base.metadata.tables["news_event_topics"].insert(), {
                "article_id": article_id, "event_key": "E1", "topic": "ai"})


def test_copy_filters_sources_and_simulation_with_all_dependents_and_verifies_counts(databases):
    source, target = databases
    seed(source)
    with source.begin() as connection:
        connection.execute(Base.metadata.tables["users"].insert(), {"email": "source@example.com"})
    with target.begin() as connection:
        connection.execute(Base.metadata.tables["users"].insert(), {"email": "target@example.com"})
    report = copy_public_data(source, target, batch_size=1)
    assert report["status"] == "verified"
    assert set(report["tables"]) == set(PUBLIC_DATA_TABLES)
    assert len(PUBLIC_DATA_TABLES) == 17
    for name in ("news_articles", "news_chunks", "news_event_analyses", "news_event_impacts", "news_event_topics"):
        assert report["tables"][name]["rows"] == 2
    assert report["tables"] == public_data_manifest(target, batch_size=2)["tables"]
    assert report["tables"] == public_data_manifest(source, batch_size=3)["tables"]
    with target.connect() as connection:
        assert list(connection.execute(text("SELECT article_id FROM news_articles ORDER BY article_id")).scalars()) == ["c1", "c2"]
        assert list(connection.execute(text("SELECT email FROM users")).scalars()) == ["target@example.com"]
        assert connection.execute(text("SELECT count(*) FROM llm_responses")).scalar_one() == 0


def test_all_real_sources_option_still_excludes_simulation(databases):
    source, target = databases
    seed(source)
    report = copy_public_data(source, target, cnyes_only=False, tables=["news_articles"])
    assert report["tables"]["news_articles"]["rows"] == 4


@pytest.mark.parametrize("tables", [["users"], ["llm_responses"], ["market_fake"], ["stock_info", "users"], [], "stock_info"])
def test_allowlist_cannot_be_expanded_by_callers(databases, tables):
    with pytest.raises(ValueError):
        copy_public_data(*databases, tables=tables)


def test_subset_does_not_require_unrelated_news_schema(databases):
    source, target = databases
    seed(source)
    news_chunks.drop(source)
    report = copy_public_data(source, target, tables=["market_daily_prices", "stock_info"])
    assert list(report["tables"]) == ["stock_info", "market_daily_prices"]


@pytest.mark.parametrize("problem", ["missing", "different", "nonempty"])
def test_preflight_rejects_invalid_target_before_any_copy(databases, problem):
    source, target = databases
    seed(source)
    with target.begin() as connection:
        if problem == "missing":
            connection.execute(text("DROP TABLE market_daily_prices"))
        elif problem == "different":
            connection.execute(text("ALTER TABLE market_daily_prices ADD COLUMN extra TEXT"))
        else:
            connection.execute(Base.metadata.tables["market_daily_prices"].insert(),
                               {"date": date(2026, 9, 1), "symbol": "2330", "close": 99})
    with pytest.raises(ValueError, match={"missing": "Missing public tables", "different": "schema mismatch",
                                        "nonempty": "must be empty"}[problem]):
        copy_public_data(source, target, tables=["stock_info", "market_daily_prices"])
    with target.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM stock_info")).scalar_one() == 0


def test_later_insert_failure_rolls_back_earlier_tables(databases):
    source, target = databases
    seed(source)

    @event.listens_for(target, "before_cursor_execute")
    def fail(connection, cursor, statement, parameters, context, many):
        if statement.startswith("INSERT INTO market_daily_prices"):
            raise RuntimeError("Injected insert failure")

    with pytest.raises(RuntimeError, match="Injected insert"):
        copy_public_data(source, target, tables=["stock_info", "market_daily_prices"])
    with target.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM stock_info")).scalar_one() == 0


def test_readback_checksum_failure_rolls_back_copy(databases):
    source, target = databases
    seed(source)
    with target.begin() as connection:
        connection.execute(text("CREATE TRIGGER rewrite_stock AFTER INSERT ON stock_info "
                                "BEGIN UPDATE stock_info SET name = 'changed' WHERE symbol = NEW.symbol; END"))
    with pytest.raises(ValueError, match="verification failed: stock_info"):
        copy_public_data(source, target, tables=["stock_info"])
    with target.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM stock_info")).scalar_one() == 0


def test_rejects_source_as_target(databases):
    source, target = databases
    with pytest.raises(ValueError, match="different databases"):
        copy_public_data(source, source, tables=["stock_info"])


@pytest.mark.parametrize("old,new", [
    (mysql.DATETIME(), mysql.DATETIME(fsp=6)),
    (mysql.ENUM("draft", "live"), mysql.ENUM("draft", "live", "archived")),
    (mysql.INTEGER(unsigned=True), mysql.INTEGER(unsigned=False)),
])
def test_mysql_schema_differences_are_not_silently_coerced(old, new):
    source = Table("sample", MetaData(), Column("value", old, primary_key=True))
    target = Table("sample", MetaData(), Column("value", new, primary_key=True))
    assert _schema(source) != _schema(target)


def test_streaming_options_do_not_leak_to_target_inserts(databases):
    source, target = databases
    seed(source)
    inserts = []

    @event.listens_for(target, "before_cursor_execute")
    def inspect_options(connection, cursor, statement, parameters, context, many):
        if statement.startswith("INSERT"):
            inserts.append(True)
            assert not context.execution_options.get("stream_results")
            assert not connection.get_execution_options().get("stream_results")

    copy_public_data(source, target, tables=["stock_info", "market_daily_prices"])
    assert len(inserts) == 2
