import pytest
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.models.audit import AuditLog
from app.db.models.technical_indicator import TechnicalIndicator
from app.jobs.schema_adjust import main, migrate_schema


@pytest.fixture
def legacy_engine():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE audit_logs RENAME TO admin_audit_logs"))
        connection.execute(text("ALTER TABLE chat_message_feedback ADD COLUMN conversation_id VARCHAR(36)"))
        connection.execute(text("ALTER TABLE chat_message_feedback ADD COLUMN user_id INTEGER"))
        connection.execute(text("CREATE INDEX idx_chat_feedback_conversation ON chat_message_feedback(conversation_id)"))
        connection.execute(text("ALTER TABLE paper_reviews ADD COLUMN user_id INTEGER"))
        connection.execute(text("CREATE INDEX ix_paper_reviews_user_id ON paper_reviews(user_id)"))
        connection.execute(text("ALTER TABLE market_technical_indicators ADD COLUMN macd_signal DECIMAL(10,4)"))
        connection.execute(text("ALTER TABLE news_event_impacts ADD COLUMN topics VARCHAR(250) NOT NULL DEFAULT ','"))
        connection.execute(text("DROP TABLE news_event_topics"))
        for name, column in (("idx_source", "source"), ("idx_stock_id", "stock_id"), ("idx_pub_time", "pub_time")):
            connection.execute(text(f"CREATE INDEX {name} ON news_articles({column})"))
        connection.execute(text("INSERT INTO users(id,email,is_active) VALUES(1,'one@example.test',1)"))
        connection.execute(text("INSERT INTO admin_audit_logs(id,actor_id,actor_email,action,target,status,created_at) "
                                "VALUES(7,1,'old@example.test','stock.add','2330','succeeded','2026-01-01')"))
        connection.execute(text("INSERT INTO chat_conversations(id,user_id,title,updated_at) "
                                "VALUES('c',1,'title','2026-01-01')"))
        connection.execute(text("INSERT INTO chat_messages(id,conversation_id,turn_id,position,role,content,timestamp,extra) "
                                "VALUES('m','c','t',0,'assistant','answer','2026-01-01','{}')"))
        connection.execute(text("INSERT INTO chat_message_feedback(message_id,rating,created_at,updated_at,conversation_id,user_id) "
                                "VALUES('m','helpful','2026-01-01','2026-01-01','c',1)"))
        connection.execute(text("INSERT INTO paper_orders(id,user_id,client_request_id,symbol,side,status,filled_quantity,fee,tax,"
                                "fee_rate,tax_rate,created_at,reason,observation,review_after_days) "
                                "VALUES('o',1,'req','2330','buy','filled',1,0,0,0,0,'2026-01-01','','',20)"))
        connection.execute(text("INSERT INTO paper_reviews(id,order_id,user_id,status,due_date) "
                                "VALUES('r','o',1,'due','2026-02-01')"))
        connection.execute(text("INSERT INTO market_technical_indicators(date,symbol,macd_dea,macd_signal) "
                                "VALUES('2026-01-01','2330',NULL,1.25)"))
        connection.execute(text("INSERT INTO news_articles(article_id,content_kind) VALUES('a','full')"))
        connection.execute(text("INSERT INTO news_event_analyses(article_id,input_hash,config_hash,status,events_json) "
                                "VALUES('a','i','c','succeeded','[]')"))
        for target in ('2330', '2317'):
            connection.execute(text("INSERT INTO news_event_impacts(article_id,event_key,target_type,target_id,direction,"
                                    "importance,basis,reason,evidence,topics) "
                                    "VALUES('a','e1','company',:target,'positive','high','direct','reason','[]',',earnings,ai,')"),
                               {"target": target})
    yield engine
    engine.dispose()


def test_migration_preserves_history_and_relations_and_is_repeatable(legacy_engine):
    report = migrate_schema(legacy_engine)
    assert report["audit_renamed"] is True
    assert report["topics_added"] == 2
    assert set(report["indexes_removed"]) == {"idx_source", "idx_stock_id", "idx_pub_time"}
    with legacy_engine.connect() as connection:
        assert connection.execute(text("SELECT id,actor_email FROM audit_logs")).one() == (7, 'old@example.test')
        assert connection.execute(text("SELECT message_id,rating FROM chat_message_feedback")).one() == ('m', 'helpful')
        assert connection.execute(text("SELECT id,order_id FROM paper_reviews")).one() == ('r', 'o')
        assert connection.scalar(text("SELECT COUNT(*) FROM news_event_impacts")) == 2
        assert set(connection.scalars(text("SELECT topic FROM news_event_topics"))) == {'earnings', 'ai'}
        for name, old in (("chat_message_feedback", "user_id"), ("chat_message_feedback", "conversation_id"),
                          ("paper_reviews", "user_id"), ("news_event_impacts", "topics"),
                          ("market_technical_indicators", "macd_signal")):
            assert old not in {column["name"] for column in inspect(connection).get_columns(name)}
    with Session(legacy_engine) as db:
        row = db.scalar(select(TechnicalIndicator))
        assert row.macd_dea == row.macd_signal == 1.25
        db.add(AuditLog(actor_id=1, action='auth.login', target='password', status='succeeded'))
        db.commit()
        assert db.scalar(select(AuditLog.id).order_by(AuditLog.id.desc())) > 7
    assert migrate_schema(legacy_engine) == {
        "audit_renamed": False, "topics_added": 0, "columns_removed": [], "indexes_removed": [],
    }


@pytest.mark.parametrize('query', [
    "UPDATE chat_message_feedback SET user_id=2",
    "UPDATE chat_message_feedback SET conversation_id='other'",
    "UPDATE paper_reviews SET user_id=2",
    "UPDATE market_technical_indicators SET macd_dea=2",
])
def test_conflicting_data_stops_before_ddl(legacy_engine, query):
    with legacy_engine.begin() as connection:
        connection.execute(text(query))
    with pytest.raises(ValueError, match='disagree'):
        migrate_schema(legacy_engine)
    assert 'admin_audit_logs' in inspect(legacy_engine).get_table_names()
    assert 'audit_logs' not in inspect(legacy_engine).get_table_names()


def test_new_empty_audit_table_does_not_hide_old_history(legacy_engine):
    with legacy_engine.begin() as connection:
        connection.execute(text("CREATE TABLE audit_logs(id INTEGER PRIMARY KEY)"))
    migrate_schema(legacy_engine)
    with legacy_engine.connect() as connection:
        assert connection.scalar(text('SELECT COUNT(*) FROM audit_logs')) == 1


def test_two_populated_audit_tables_are_not_merged_silently(legacy_engine):
    with legacy_engine.begin() as connection:
        connection.execute(text("CREATE TABLE audit_logs(id INTEGER PRIMARY KEY)"))
        connection.execute(text("INSERT INTO audit_logs VALUES(1)"))
    with pytest.raises(ValueError, match='Both audit'):
        migrate_schema(legacy_engine)


def test_help_does_not_open_database(monkeypatch):
    monkeypatch.setattr('app.db.engine.make_engine', lambda *args: pytest.fail('Help opened database'))
    with pytest.raises(SystemExit) as error:
        main(['--help'])
    assert error.value.code == 0
