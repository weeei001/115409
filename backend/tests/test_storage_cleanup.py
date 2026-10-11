import json

import pytest
from sqlalchemy import create_engine, inspect, text

from app.jobs.storage_cleanup import cleanup_storage, main


@pytest.fixture
def storage_engine():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE simulated_orders (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE llm_responses (id INTEGER PRIMARY KEY, "
                                "normalized_json TEXT, response_json TEXT, raw_llm_text TEXT)"))
    yield engine
    engine.dispose()


def insert_response(engine, normalized, response):
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO llm_responses "
                                "(normalized_json, response_json, raw_llm_text) "
                                "VALUES (:normalized, :response, 'original raw text')"),
                           {"normalized": normalized, "response": response})


def read_rows(engine):
    with engine.connect() as connection:
        return connection.execute(text("SELECT * FROM llm_responses ORDER BY id")).all()


def test_exact_duplicates_preserve_metadata_and_original_responses(storage_engine):
    brief = {"summary": "example", "evidence": [1, 2]}
    insert_response(storage_engine, json.dumps({"payload": brief, "valid": True, "errors": []}),
                    json.dumps({"brief": brief, "other": "keep"}))
    insert_response(storage_engine, json.dumps({"payload": {"limitations": ["unavailable"]},
                                               "fallback": True}),
                    json.dumps({"limitations": ["unavailable"]}))
    before = read_rows(storage_engine)
    report = cleanup_storage(storage_engine)
    assert report["compact_candidates"] == 2
    assert read_rows(storage_engine) == before
    assert inspect(storage_engine).has_table("simulated_orders")
    report = cleanup_storage(storage_engine, apply=True)
    assert report["compacted_rows"] == 2
    assert report["legacy_table_dropped"]
    after = read_rows(storage_engine)
    assert len(after) == len(before)
    assert json.loads(after[0].normalized_json) == {"valid": True, "errors": []}
    assert json.loads(after[1].normalized_json) == {"fallback": True}
    for old, new in zip(before, after):
        assert old.response_json == new.response_json
        assert old.raw_llm_text == new.raw_llm_text
    assert cleanup_storage(storage_engine, apply=True)["compacted_rows"] == 0
    assert read_rows(storage_engine) == after


@pytest.mark.parametrize("normalized,response", [
    ('{"payload": {"x": 1}}', '{"brief": {"x": 2}}'),
    ('invalid', '{}'), ('{}', 'invalid'), ('null', '{}'),
    ('{"payload": null}', '{}'), ('{"meta": 1}', '{}'),
    ('{"payload": {"limitations": [], "extra": 1}}', '{"limitations": []}'),
    ('{"payload": {"limitations": []}}', '{"brief": {"summary": "present"}, "limitations": []}'),
])
def test_unproven_duplicates_are_unchanged(storage_engine, normalized, response):
    insert_response(storage_engine, normalized, response)
    before = read_rows(storage_engine)
    assert cleanup_storage(storage_engine, apply=True)["compacted_rows"] == 0
    assert read_rows(storage_engine) == before


def test_populated_legacy_table_refuses_before_mutations(storage_engine):
    insert_response(storage_engine, '{"payload": {}}', '{"brief": {}}')
    with storage_engine.begin() as connection:
        connection.execute(text("INSERT INTO simulated_orders VALUES (1)"))
    before = read_rows(storage_engine)
    with pytest.raises(RuntimeError, match="contains rows"):
        cleanup_storage(storage_engine, apply=True)
    assert read_rows(storage_engine) == before
    assert inspect(storage_engine).has_table("simulated_orders")


def test_incoming_foreign_key_refuses(storage_engine):
    with storage_engine.begin() as connection:
        connection.execute(text("CREATE TABLE dependent (order_id INTEGER REFERENCES simulated_orders(id))"))
    with pytest.raises(RuntimeError, match="incoming foreign keys"):
        cleanup_storage(storage_engine, apply=True)
    assert inspect(storage_engine).has_table("simulated_orders")


def test_help_never_builds_engine(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("help must not construct an engine")
    monkeypatch.setattr("app.db.engine.make_engine", forbidden)
    with pytest.raises(SystemExit) as exc:
        main(["--help"])
    assert exc.value.code == 0
