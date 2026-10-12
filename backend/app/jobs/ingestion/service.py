"""Bounded, resumable chunk and vector jobs with explicit write boundaries."""
from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass, field
from datetime import date
from itertools import groupby
from typing import Any

from app.core.errors import AppError
from app.core.config import news_index_fingerprint
from app.features.news.eligibility import contains_simulation
from app.features.retrieval.common import parse_timestamp
from . import repository
from app.features.retrieval.chunking import (
    CHUNK_OVERLAP, CHUNK_SIZE, DEFAULT_EMBED_MODEL, DEFAULT_INDEX_VERSION,
    article_chunks, article_stock_ids, embedding_text,
)


@dataclass
class IngestionReport:
    job: str
    dry_run: bool = False
    read: int = 0  # Source articles inspected in either stage.
    written: int = 0  # Committed articles for chunking; confirmed new points for vectorization.
    chunks: int = 0
    planned: int = 0
    skipped: int = 0
    failed: int = 0
    retries: int = 0
    errors: list[str] = field(default_factory=list)
    failure_reasons: dict[str, int] = field(default_factory=dict)

    def fail(self, identifier: str, reason: str, count: int = 1):
        self.failed += count
        code = indexing_failure_code(reason)
        self.failure_reasons[code] = self.failure_reasons.get(code, 0) + count
        # ponytail: retain 20 diagnostic samples; use a job log for full bulk diagnostics.
        if len(self.errors) < 20:
            self.errors.append(f"{identifier}: {reason}")

    def as_dict(self):
        return asdict(self)


def indexing_failure_code(reason: str) -> str:
    """Map controlled worker messages to public codes, never exception content."""
    if reason in {
        "index_configuration_changed_use_new_index_version",
        "Select an explicit index version and a new collection for v1 ingestion",
        "News indexing requires EMBED_TRUNCATE=NONE to preserve evidence",
        "Qdrant collection does not exist; use --create-collection explicitly",
        "Qdrant collection must have one unnamed dense Cosine vector",
        "Collection contains a different model or indexing configuration; use a new collection",
        "Embedding dimension does not match the existing Qdrant collection",
    }:
        return "indexing_configuration"
    if reason in {"invalid_pub_time", "empty_content", "empty_content_preserved_previous_revision",
                  "Embedding input is empty or exceeds the safe token bound"}:
        return "indexing_content"
    if reason in {"OperationalError", "ProgrammingError", "IntegrityError", "DBAPIError", "SQLAlchemyError"}:
        return "indexing_storage"
    if reason in {"Article vector publication is incomplete", "Vector database operation was not confirmed completed",
                  "Replacement article is incomplete; old vectors were retained"}:
        return "indexing_incomplete"
    if reason in {"ServiceUnavailable", "Vector database request failed", "Vector database timed out",
                  "Embedding service unavailable", "Embedding service timed out", "Invalid embedding response",
                  "Invalid vector database scroll response", "Invalid vector database count response"}:
        return "indexing_service"
    return "worker_exception"


def failure_reason(exc: Exception) -> str:
    return exc.detail if isinstance(exc, AppError) and isinstance(exc.detail, str) else type(exc).__name__


def _validate_options(page_size: int, limit: int | None, start: date | None, end: date | None):
    if not 1 <= page_size <= 1000:
        raise ValueError("page_size must be between 1 and 1000")
    if limit is not None and limit < 1:
        raise ValueError("limit must be positive")
    if start and end and start > end:
        raise ValueError("start must be on or before end")


def _read_page(session_factory, query, **kwargs):
    with session_factory() as db:
        return query(db, **kwargs)


def _write_checkpoint(session_factory, operation, *args, **kwargs):
    with session_factory() as db:
        operation(db, *args, **kwargs)
        db.commit()


def _in_scope(row: dict, start: date | None, end: date | None, symbols: list[str] = ()) -> bool:
    if not row.get("_source_eligible", True):
        return False
    if contains_simulation(row):
        return False
    if symbols and not set(symbols).intersection(article_stock_ids(row)):
        return False
    if start is None and end is None:
        return True
    timestamp = parse_timestamp(row.get("pub_time"))
    return timestamp is not None and (start is None or timestamp.date() >= start) and (end is None or timestamp.date() <= end)


def chunk_news(session_factory, *, symbols: list[str] = (), start: date | None = None,
               end: date | None = None, limit: int | None = None, page_size: int = 50,
               dry_run: bool = False, index_version: str = DEFAULT_INDEX_VERSION,
               max_chars: int = CHUNK_SIZE, overlap_chars: int = CHUNK_OVERLAP,
               embedding_model: str = DEFAULT_EMBED_MODEL, sources: list[str] = (),
               full_scan: bool = False) -> IngestionReport:
    _validate_options(page_size, limit, start, end)
    # Validate configuration even when the source table is empty.
    article_chunks({"article_id": ""}, index_version=index_version, max_chars=max_chars,
                   overlap_chars=overlap_chars, embedding_model=embedding_model)
    fingerprint = news_index_fingerprint(index_version=index_version, model=embedding_model,
        max_chars=max_chars, overlap_chars=overlap_chars)
    report = IngestionReport("chunk-news", dry_run=dry_run)
    after = ""
    while limit is None or report.read < limit:
        size = min(page_size, limit - report.read) if limit is not None else page_size
        page = _read_page(session_factory, repository.pending_articles, after=after, page_size=size,
                          symbols=symbols, start=start, end=end, index_version=index_version, sources=sources,
                          fingerprint=None if full_scan else fingerprint)
        if not page:
            break
        if full_scan and not dry_run:
            _write_checkpoint(session_factory, repository.clear_chunk_checkpoint, index_version,
                              [article["article_id"] for article in page])
        for article in page:
            report.read += 1
            after = article["article_id"]
            if not _in_scope(article, start, end, symbols):
                report.skipped += 1
                continue
            chunks = article_chunks(article, index_version=index_version, max_chars=max_chars,
                                    overlap_chars=overlap_chars, embedding_model=embedding_model)
            if not chunks:
                if article.get("_stored_revision"):
                    report.fail(after, "empty_content_preserved_previous_revision")
                else:
                    report.skipped += 1
                    if not dry_run:
                        _write_checkpoint(session_factory, repository.mark_chunked, article, index_version,
                                          fingerprint, chunk_count=0)
                continue
            if (article.get("_stored_revision") == chunks[0]["revision"]
                    and article["_stored_count"] == len(chunks)):
                report.skipped += 1
                if not dry_run:
                    _write_checkpoint(session_factory, repository.mark_chunked, article, index_version,
                                      fingerprint, chunk_count=len(chunks))
                continue
            if (article.get("_stored_fingerprint")
                    and article["_stored_fingerprint"] != chunks[0]["index_fingerprint"]):
                report.fail(after, "index_configuration_changed_use_new_index_version")
                continue
            report.planned += 1
            report.chunks += len(chunks)
            if dry_run:
                continue
            with session_factory() as db:
                try:
                    repository.insert_article_chunks(db, chunks)
                    repository.mark_chunked(db, article, index_version, fingerprint, chunk_count=len(chunks))
                    db.commit()
                except Exception as exc:
                    db.rollback()
                    report.fail(after, failure_reason(exc))
                else:
                    report.written += 1
    return report


async def vectorize_news(session_factory, writer: Any, *, symbols: list[str] = (),
                         start: date | None = None, end: date | None = None,
                         limit: int | None = None, page_size: int = 50,
                         dry_run: bool = False, create_collection: bool = False,
                         retry_delay: float = 5, index_version: str = DEFAULT_INDEX_VERSION,
                         cleanup_stale: bool = True, sources: list[str] = (),
                         full_scan: bool = False, target_key: str | None = None) -> IngestionReport:
    _validate_options(page_size, limit, start, end)
    if retry_delay < 0:
        raise ValueError("retry_delay must not be negative")
    if not index_version:
        raise ValueError("A nonempty index_version is required")
    report = IngestionReport("vectorize-news", dry_run=dry_run)
    # Custom writers without a durable destination identity keep the safe full
    # scan behavior. Production writers always supply a destination key.
    target_key = target_key or getattr(writer, "index_target_key", None)
    if not dry_run:
        try:
            await writer.require_collection(create=create_collection)
            if target_key and getattr(writer, "_missing", False):
                _write_checkpoint(session_factory, repository.clear_publication,
                                  target_key, index_version, None)
        except Exception as exc:
            report.fail("collection", failure_reason(exc))
            return report
    after = ""
    while limit is None or report.read < limit:
        size = min(page_size, limit - report.read) if limit is not None else page_size
        page = await asyncio.to_thread(_read_page, session_factory, repository.chunk_page,
            after=after, page_size=size, symbols=symbols, start=start, end=end, index_version=index_version,
            sources=sources, target_key=None if full_scan else target_key)
        if not page:
            break
        if target_key and full_scan and not dry_run:
            # A failed audit must remain pending even if it had a checkpoint.
            _write_checkpoint(session_factory, repository.clear_publication, target_key, index_version,
                              list({chunk["article_id"] for chunk in page}))
        articles = []
        for article_id, grouped in groupby(page, key=lambda chunk: chunk["article_id"]):
            chunks = list(grouped)
            report.read += 1
            after = article_id
            if parse_timestamp(chunks[0].get("pub_time")) is None:
                report.fail(article_id, "invalid_pub_time", len(chunks))
                continue
            if not _in_scope(chunks[0], start, end, symbols):
                report.skipped += len(chunks)
                continue
            if any(not (chunk.get("content_chunk") or "").strip() for chunk in chunks):
                report.fail(article_id, "empty_content", len(chunks))
                continue
            report.planned += len(chunks)
            articles.append((article_id, chunks))
        if dry_run or not articles:
            continue

        initial_existing = {}
        completed = set()
        for attempt in range(3):
            try:
                remaining = [(article_id, chunks) for article_id, chunks in articles if article_id not in completed]
                all_ids = [chunk["chunk_id"] for _, chunks in remaining for chunk in chunks]
                existing_ids = await writer.existing_chunk_ids(all_ids)
                states = []
                for article_id, chunks in remaining:
                    ids = [chunk["chunk_id"] for chunk in chunks]
                    existing = existing_ids.intersection(ids)
                    initial_existing.setdefault(article_id, existing)
                    states.append((article_id, chunks, ids, existing))
                pending = [chunk for _, chunks, _, existing in states
                           for chunk in chunks if chunk["chunk_id"] not in existing]
                batches = [pending[offset:offset + page_size]
                           for offset in range(0, len(pending), page_size)]
                for offset in range(0, len(batches), 4):
                    window = batches[offset:offset + 4]
                    embeddings = await asyncio.gather(*(
                        writer.embed_documents([embedding_text(chunk) for chunk in batch])
                        for batch in window
                    ))
                    for batch, vectors in zip(window, embeddings):
                        await writer.upsert_chunks(batch, vectors)
                confirmed_ids = await writer.existing_chunk_ids(all_ids)
                for article_id, _, ids, _ in states:
                    if not set(ids).issubset(confirmed_ids):
                        raise AppError("Article vector publication is incomplete", 503)
                for article_id, chunks, ids, _ in states:
                    if cleanup_stale:
                        await writer.delete_stale_article_chunks(article_id, index_version, ids)
                        if target_key:
                            _write_checkpoint(session_factory, repository.mark_published, target_key, chunks[0])
                    completed.add(article_id)
                    skipped = len(initial_existing[article_id])
                    written = len(ids) - skipped
                    report.skipped += skipped
                    report.written += written
                    report.chunks += written
                break
            except Exception as exc:
                if attempt == 2:
                    unfinished = [(article_id, chunks) for article_id, chunks in articles if article_id not in completed]
                    report.fail(unfinished[0][0], failure_reason(exc), sum(len(items) for _, items in unfinished))
                else:
                    report.retries += 1
                    await asyncio.sleep(retry_delay * (attempt + 1))
    return report

