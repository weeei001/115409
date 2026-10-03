import pytest
from sqlalchemy import create_engine, inspect, text

from app.jobs.admin_migrate import main, migrate_admin_runs


def test_migration_preserves_history_and_is_idempotent():
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE admin_job_runs (id INTEGER PRIMARY KEY, job_name VARCHAR(80))"))
            connection.execute(text("INSERT INTO admin_job_runs VALUES (1, 'text-brief')"))
        assert migrate_admin_runs(engine) == {"columns_added": ["symbol"]}
        assert migrate_admin_runs(engine) == {"columns_added": []}
        with engine.connect() as connection:
            assert connection.execute(text("SELECT id, job_name, symbol FROM admin_job_runs")).one() == (1, "text-brief", None)
        assert next(c for c in inspect(engine).get_columns("admin_job_runs") if c["name"] == "symbol")["nullable"]
    finally:
        engine.dispose()


def test_help_does_not_open_database(monkeypatch):
    monkeypatch.setattr("app.db.engine.make_engine", lambda *args: pytest.fail("Help opened the database"))
    with pytest.raises(SystemExit) as exc:
        main(["--help"])
    assert exc.value.code == 0
