import asyncio
from datetime import date
import json

import pytest
from sqlalchemy import create_engine, insert, select, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateTable

from app.core.errors import AppError
from app.db.models.news_article import NewsArticle
from app.jobs.ingestion import cli, repository
from app.db.models.news_chunk import chunk_metadata
from app.features.retrieval.chunking import article_chunks, embedding_text, split_spans, split_text
from app.jobs.ingestion.service import chunk_news, vectorize_news


@pytest.fixture
def ingestion_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with engine.begin() as connection:
        connection.execute(CreateTable(NewsArticle.__table__))
    chunk_metadata.create_all(engine)
    yield engine, sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


def _article(identifier, *, content="article body", stock_id="2330",
             pub_time="2026-07-13T12:00:00+08:00", tags="2330,2317"):
    return {"article_id": identifier, "stock_id": stock_id, "source": "cnyes", "source_group": "cnyes",
            "pub_time": pub_time, "title": f"Article {identifier}", "url": f"https://news.test/{identifier}",
            "tags": tags, "content": content}


def _seed(session_factory, articles):
    with session_factory() as db:
        db.execute(insert(NewsArticle), articles)
        db.commit()


def _stored(session_factory):
    with session_factory() as db:
        return [dict(row) for row in db.execute(select(repository.news_chunks).order_by(
            repository.news_chunks.c.article_id, repository.news_chunks.c.chunk_index)).mappings()]


@pytest.mark.parametrize("text", ["", " \n\t ", "x" * 2401,
    "\u53f0\u7a4d\u96fb\u71df\u6536\u6210\u9577\u3002" * 150, "First sentence.\n\nSecond sentence! Third?"])
def test_spans_are_exact_bounded_and_cover_nonwhitespace(text):
    spans = split_spans(text)
    assert all(0 <= start < end <= len(text) and end - start <= 800 for start, end in spans)
    covered = {index for start, end in spans for index in range(start, end)}
    assert all(index in covered for index, char in enumerate(text) if not char.isspace())
    assert split_text(text) == [text[start:end] for start, end in spans]


def test_sentence_overlap_keeps_punctuation_and_short_article_whole():
    text = "A" * 70 + ". " + "B" * 20 + ". " + "C" * 70 + "."
    spans = split_spans(text, 100, 30)
    assert text[spans[0][0]:spans[0][1]].endswith("B" * 20 + ".")
    assert text[spans[1][0]:spans[1][1]].startswith("B" * 20)
    assert spans[1][0] < spans[0][1]
    assert split_text("First. Second!") == ["First. Second!"]


def test_revision_includes_metadata_model_and_configuration():
    article = _article("a" * 64, content="x" * 900)
    original = article_chunks(article)
    assert len(original) == 2 and all(len(chunk["chunk_id"]) <= 80 for chunk in original)
    assert original == article_chunks(article)
    assert original[0]["stock_ids"] == ["2317", "2330"]
    assert original[0]["token_count"] is None
    assert embedding_text(original[0]) == article["title"] + "\n" + original[0]["content_chunk"]
    for changed in [
        article_chunks({**article, "title": "Corrected title"}),
        article_chunks({**article, "content": "revised"}),
        article_chunks(article, max_chars=500),
        article_chunks(article, embedding_model="other-model"),
        article_chunks(article, index_version="next-version"),
    ]:
        assert changed[0]["revision"] != original[0]["revision"]
        assert changed[0]["chunk_id"] != original[0]["chunk_id"]
    assert list(chunk_metadata.tables) == ["news_chunks"]


def test_chunking_replaces_changed_revision_and_resumes(ingestion_db):
    _, factory = ingestion_db
    _seed(factory, [_article("a"), _article("b", content="x" * 900), _article("c", content="")])
    first = chunk_news(factory, page_size=1)
    assert (first.read, first.written, first.chunks, first.skipped) == (3, 2, 3, 1)
    before = _stored(factory)
    assert chunk_news(factory, page_size=1).written == 0
    with factory() as db:
        db.execute(update(NewsArticle).where(NewsArticle.article_id == "b").values(content="corrected"))
        db.commit()
    changed = chunk_news(factory)
    assert changed.written == 1 and len(_stored(factory)) == 2
    assert not set(row["chunk_id"] for row in before if row["article_id"] == "b").intersection(
        row["chunk_id"] for row in _stored(factory))
    assert json.loads(_stored(factory)[0]["stock_ids"]) == ["2317", "2330"]


def test_empty_revision_preserves_old_chunks_and_fails(ingestion_db):
    _, factory = ingestion_db
    _seed(factory, [_article("a")])
    chunk_news(factory)
    before = _stored(factory)
    with factory() as db:
        db.execute(update(NewsArticle).values(content=""))
        db.commit()
    result = chunk_news(factory)
    assert result.failed == 1 and result.errors == ["a: empty_content_preserved_previous_revision"]
    assert _stored(factory) == before


def test_replace_transaction_rolls_back_and_resume_works(ingestion_db, monkeypatch):
    _, factory = ingestion_db
    _seed(factory, [_article("a")])
    chunk_news(factory)
    before = _stored(factory)
    with factory() as db:
        db.execute(update(NewsArticle).values(content="changed"))
        db.commit()
    original = repository.insert_article_chunks

    def fail(db, chunks):
        original(db, chunks)
        raise RuntimeError("private SQL statement")
    monkeypatch.setattr(repository, "insert_article_chunks", fail)
    report = chunk_news(factory)
    assert report.failed == 1 and report.errors == ["a: RuntimeError"]
    assert _stored(factory) == before
    monkeypatch.setattr(repository, "insert_article_chunks", original)
    assert chunk_news(factory).written == 1


def test_chunk_scope_includes_secondary_company_and_exact_timezone(ingestion_db):
    _, factory = ingestion_db
    _seed(factory, [_article("a", pub_time="2026-07-12T17:00:00Z"),
                    _article("b", pub_time="2026-07-13T16:00:00Z"),
                    _article("c", tags="12317", stock_id="2454")])
    result = chunk_news(factory, symbols=["2317"], start=date(2026, 7, 13), end=date(2026, 7, 13))
    assert result.read == 3 and result.written == 1 and result.skipped == 2
    assert _stored(factory)[0]["article_id"] == "a"


def test_chunk_dry_run_respects_limit_and_keeps_database_empty(ingestion_db):
    _, factory = ingestion_db
    _seed(factory, [_article(str(index), content="x" * 900) for index in range(8)])
    result = chunk_news(factory, page_size=2, limit=3, dry_run=True)
    assert result.read == result.planned == 3 and result.chunks == 6
    assert result.written == 0 and _stored(factory) == []


class FakeWriter:
    def __init__(self, existing=(), fail_attempts=0, accept_timeout=False):
        self.existing = set(existing)
        self.fail_attempts = fail_attempts
        self.accept_timeout = accept_timeout
        self.embedding_calls = []
        self.written = []
        self.deleted = []
        self.collection_options = []

    async def require_collection(self, *, create=False):
        self.collection_options.append(create)

    async def existing_chunk_ids(self, ids):
        return self.existing.intersection(ids)

    async def embed_documents(self, texts):
        self.embedding_calls.append(texts)
        if len(self.embedding_calls) <= self.fail_attempts:
            raise RuntimeError("private upstream credentials")
        return [[0.1, 0.2] for _ in texts]

    async def upsert_chunks(self, chunks, vectors):
        assert len(chunks) == len(vectors)
        self.written.extend(chunks)
        self.existing.update(chunk["chunk_id"] for chunk in chunks)
        if self.accept_timeout:
            self.accept_timeout = False
            raise RuntimeError("lost acknowledgement")
        return len(chunks)

    async def delete_stale_article_chunks(self, article_id, index_version, ids):
        assert set(ids).issubset(self.existing)
        self.deleted.append((article_id, index_version, ids))


def test_vectorization_completes_whole_article_before_cleanup_and_resumes(ingestion_db):
    _, factory = ingestion_db
    _seed(factory, [_article("a", content="x" * 1700), _article("b", pub_time="unknown")])
    chunk_news(factory)
    ids = [row["chunk_id"] for row in _stored(factory) if row["article_id"] == "a"]
    writer = FakeWriter(existing=ids[:1], accept_timeout=True)
    report = asyncio.run(vectorize_news(factory, writer, page_size=1, retry_delay=0))
    assert (report.read, report.written, report.skipped, report.failed, report.retries) == (2, 2, 1, 1, 1)
    assert all(len(batch) == 1 and batch[0].startswith("Article a\n") for batch in writer.embedding_calls)
    assert writer.deleted == [("a", "news-v2", ids)]
    resumed = asyncio.run(vectorize_news(factory, writer, page_size=1, retry_delay=0))
    assert resumed.written == 0 and resumed.skipped == 3 and resumed.failed == 1


def test_vector_failure_never_removes_prior_revision(ingestion_db):
    _, factory = ingestion_db
    _seed(factory, [_article("a", content="x" * 1700)])
    chunk_news(factory)
    writer = FakeWriter(fail_attempts=3)
    report = asyncio.run(vectorize_news(factory, writer, retry_delay=0))
    assert report.failed == 3 and report.retries == 2
    assert writer.deleted == [] and "private" not in str(report.as_dict())


def test_vector_unconfirmed_upsert_never_removes_prior_revision(ingestion_db):
    _, factory = ingestion_db
    _seed(factory, [_article("a")])
    chunk_news(factory)

    class IncompleteWriter(FakeWriter):
        async def upsert_chunks(self, chunks, vectors):
            return len(chunks)
    writer = IncompleteWriter()
    report = asyncio.run(vectorize_news(factory, writer, retry_delay=0))
    assert report.failed == 1 and writer.deleted == []


def test_vector_version_isolation_and_dry_run_no_external_calls(ingestion_db):
    _, factory = ingestion_db
    _seed(factory, [_article("a")])
    chunk_news(factory, index_version="version-one")
    chunk_news(factory, index_version="version-two")
    result = asyncio.run(vectorize_news(factory, object(), dry_run=True, index_version="version-two"))
    assert result.read == result.planned == 1 and result.written == 0
    assert len(_stored(factory)) == 2


def test_cli_dry_run_and_chunk_failure_stops_combined_job(ingestion_db, settings, monkeypatch, capsys):
    engine, factory = ingestion_db
    _seed(factory, [_article("a")])
    configured = settings.model_copy(update={"NEWS_INDEX_VERSION": "news-v2", "QDRANT_COLLECTION": "news_chunks_v2"})
    monkeypatch.setattr(cli, "get_settings", lambda: configured)
    monkeypatch.setattr(cli, "make_engine", lambda _: engine)
    monkeypatch.setattr(engine, "dispose", lambda: None)
    assert cli.main("chunk-news", ["--dry-run"]) == 0
    assert '"planned": 1' in capsys.readouterr().out
    assert _stored(factory) == []

    def fail(db, chunks):
        raise RuntimeError("private SQL")
    async def forbidden(*args, **kwargs):
        raise AssertionError("Vectorization must not run after chunk failure")
    monkeypatch.setattr(repository, "insert_article_chunks", fail)
    monkeypatch.setattr(cli, "vectorize_news", forbidden)
    assert cli.main("news-ingest", []) == 1
    output = capsys.readouterr().out
    assert '"failed": 1' in output and "private SQL" not in output


@pytest.mark.parametrize("args", [["--limit", "0"], ["--batch-size", "0"],
    ["--start", "2026-07-14", "--end", "2026-07-13"], ["--symbols", ","],
    ["--create-collection"], ["--index-version", ""]])
def test_cli_rejects_invalid_arguments_before_loading_settings(args, monkeypatch):
    def forbidden():
        raise AssertionError("Settings must not be loaded")
    monkeypatch.setattr(cli, "get_settings", forbidden)
    with pytest.raises(SystemExit) as error:
        cli.main("chunk-news", args)
    assert error.value.code == 2


def test_cli_refuses_legacy_target_before_connecting(settings, monkeypatch):
    monkeypatch.setattr(cli, "get_settings", lambda: settings.model_copy(update={
        "NEWS_INDEX_VERSION": "", "QDRANT_COLLECTION": "news_chunks"}))
    monkeypatch.setattr(cli, "make_engine", lambda _: pytest.fail("Must not connect"))
    with pytest.raises(SystemExit) as error:
        cli.main("news-ingest", [])
    assert error.value.code == 2


def test_collection_failure_reports_only_controlled_error(ingestion_db):
    _, factory = ingestion_db

    class Writer:
        async def require_collection(self, *, create=False):
            raise AppError("Collection missing; use --create-collection explicitly", 503)
    report = asyncio.run(vectorize_news(factory, Writer(), retry_delay=0))
    assert report.failed == 1
    assert report.errors == ["collection: Collection missing; use --create-collection explicitly"]

