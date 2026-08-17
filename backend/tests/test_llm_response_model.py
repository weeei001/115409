from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from crud.llm_response import create_llm_response, get_cached_llm_response
from database import Base
from models.llm_response import (
    LLM_RESPONSE_KIND_PROJECTION,
    LLM_RESPONSE_KIND_TEXT_BRIEF,
    LlmResponse,
)


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _fields(**overrides):
    fields = {
        "symbol": "2330",
        "as_of_date": date(2024, 1, 2),
        "kind": LLM_RESPONSE_KIND_TEXT_BRIEF,
        "config_hash": "a" * 64,
        "config_json": "{}",
    }
    fields.update(overrides)
    return fields


def test_llm_response_table_works_with_sqlite():
    db = _session()
    try:
        row = create_llm_response(db, **_fields(response_json='{"cached": false}'))

        assert row.id == 1
        assert row.is_fallback is False
        assert db.query(LlmResponse).one().symbol == "2330"
    finally:
        db.close()


def test_cache_lookup_returns_the_newest_non_fallback_row_for_that_kind():
    db = _session()
    try:
        create_llm_response(db, **_fields(response_json='{"n": 1}'))
        create_llm_response(db, **_fields(response_json='{"n": 2}'))
        # 同一個 key 但屬於另一條產線，不該被文字簡報的快取撈到
        create_llm_response(
            db,
            **_fields(kind=LLM_RESPONSE_KIND_PROJECTION, response_json='{"n": 3}'),
        )
        # fallback 是失敗結果，不該被重播
        create_llm_response(db, **_fields(is_fallback=True, response_json='{"n": 4}'))

        row = get_cached_llm_response(
            db,
            symbol="2330",
            as_of_date=date(2024, 1, 2),
            kind=LLM_RESPONSE_KIND_TEXT_BRIEF,
            config_hash="a" * 64,
        )

        assert row is not None
        assert row.response_json == '{"n": 2}'
    finally:
        db.close()


def test_cache_lookup_misses_when_the_config_hash_changed():
    db = _session()
    try:
        create_llm_response(db, **_fields(response_json='{"n": 1}'))

        assert (
            get_cached_llm_response(
                db,
                symbol="2330",
                as_of_date=date(2024, 1, 2),
                kind=LLM_RESPONSE_KIND_TEXT_BRIEF,
                config_hash="b" * 64,
            )
            is None
        )
    finally:
        db.close()
