"""Bounded, resumable chunk and vector jobs with explicit write boundaries."""
from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass, field
from datetime import date
from itertools import groupby
from typing import Any

from app.core.errors import AppError
from app.features.retrieval.common import parse_timestamp
from . import repository
from .chunking import (CHUNK_OVERLAP, CHUNK_SIZE, DEFAULT_EMBED_MODEL, DEFAULT_INDEX_VERSION,
                       article_chunks, article_stock_ids, embedding_text)


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

    def fail(self, identifier: str, reason: str, count: int = 1):
        self.failed += count
        # ponytail: retain 20 diagnostic samples; use a job log for full bulk diagnostics.
        if len(self.errors) < 20:
            self.errors.append(f"{identifier}: {reason}")

    def as_dict(self):
        return asdict(self)


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


def _in_scope(row: dict, start: date | None, end: date | None, symbols: list[str] = ()) -> bool:
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
               embedding_model: str = DEFAULT_EMBED_MODEL) -> IngestionReport:
    _validate_options(page_size, limit, start, end)
    # Validate configuration even when the source table is empty.
    article_chunks({"article_id": ""}, index_version=index_version, max_chars=max_chars,
                   overlap_chars=overlap_chars, embedding_model=embedding_model)
    report = IngestionReport("chunk-news", dry_run=dry_run)
    after = ""
    while limit is None or report.read < limit:
        size = min(page_size, limit - report.read) if limit is not None else page_size
        page = _read_page(session_factory, repository.pending_articles, after=after, page_size=size,
                          symbols=symbols, start=start, end=end, index_version=index_version)
        if not page:
            break
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
                continue
            if article.get("_stored_revision") == chunks[0]["revision"]:
                report.skipped += 1
                continue
            report.planned += 1
            report.chunks += len(chunks)
            if dry_run:
                continue
            with session_factory() as db:
                try:
                    repository.insert_article_chunks(db, chunks)
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
                         retry_delay: float = 5, index_version: str = DEFAULT_INDEX_VERSION) -> IngestionReport:
    _validate_options(page_size, limit, start, end)
    if retry_delay < 0:
        raise ValueError("retry_delay must not be negative")
    if not index_version:
        raise ValueError("A nonempty index_version is required")
    report = IngestionReport("vectorize-news", dry_run=dry_run)
    if not dry_run:
        try:
            await writer.require_collection(create=create_collection)
        except Exception as exc:
            report.fail("collection", failure_reason(exc))
            return report
    after = ""
    while limit is None or report.read < limit:
        size = min(page_size, limit - report.read) if limit is not None else page_size
        page = await asyncio.to_thread(_read_page, session_factory, repository.chunk_page,
            after=after, page_size=size, symbols=symbols, start=start, end=end, index_version=index_version)
        if not page:
            break
        for article_id, grouped in groupby(page, key=lambda chunk: chunk["article_id"]):
            chunks = list(grouped)
            after = article_id
            report.read += 1
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
            if dry_run:
                continue
            ids = [chunk["chunk_id"] for chunk in chunks]
            initial_existing = None
            for attempt in range(3):
                try:
                    existing = await writer.existing_chunk_ids(ids)
                    if initial_existing is None:
                        initial_existing = existing
                    pending = [chunk for chunk in chunks if chunk["chunk_id"] not in existing]
                    for offset in range(0, len(pending), page_size):
                        batch = pending[offset:offset + page_size]
                        vectors = await writer.embed_documents([embedding_text(chunk) for chunk in batch])
                        await writer.upsert_chunks(batch, vectors)
                    confirmed = await writer.existing_chunk_ids(ids)
                    if not set(ids).issubset(confirmed):
                        raise AppError("Article vector publication is incomplete", 503)
                    await writer.delete_stale_article_chunks(article_id, index_version, ids)
                    written = len(ids) - len(initial_existing)
                    report.skipped += len(initial_existing)
                    report.written += written
                    report.chunks += written
                    break
                except Exception as exc:
                    if attempt == 2:
                        report.fail(article_id, failure_reason(exc), len(chunks))
                    else:
                        report.retries += 1
                        await asyncio.sleep(retry_delay * (attempt + 1))
    return report

