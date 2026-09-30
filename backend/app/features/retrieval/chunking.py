"""Shared citation chunking for ingestion and request-time version checks."""
import hashlib
import json
import re

from app.core.config import news_index_fingerprint


CHUNK_SIZE = 800
CHUNK_OVERLAP = 120
DEFAULT_INDEX_VERSION = "news-v1"
DEFAULT_EMBED_MODEL = "nvidia/nemotron-3-embed-1b"


def article_stock_ids(article: dict) -> list[str]:
    values = [article.get("stock_id")]
    extra = article.get("stock_ids") or []
    if isinstance(extra, str):
        try:
            extra = json.loads(extra)
        except ValueError:
            extra = extra.split(",")
    if isinstance(extra, list):
        values.extend(extra)
    tags = article.get("tags") or ""
    values.extend(tags.split(",") if isinstance(tags, str) else tags)
    return sorted({str(value).strip() for value in values
                   if value is not None and re.fullmatch(r"\d{4,6}", str(value).strip())})


def embedding_text(chunk: dict) -> str:
    title = (chunk.get("title") or "").strip()
    return f"{title}\n{chunk['content_chunk']}" if title else chunk["content_chunk"]


def split_spans(text: str, max_chars: int = CHUNK_SIZE,
                overlap_chars: int = CHUNK_OVERLAP) -> list[tuple[int, int]]:
    if max_chars < 1 or not 0 <= overlap_chars < max_chars:
        raise ValueError("Require max_chars > overlap_chars >= 0")
    boundaries = [0, *(match.end() for match in re.finditer(
        r'[\u3002\uff01\uff1f!?]+[\u300d\u300f\u201d"]*|\.(?=\s|$)|\n+', text))]
    if boundaries[-1] != len(text):
        boundaries.append(len(text))
    units = []
    for start, end in zip(boundaries, boundaries[1:]):
        # Oversized individual sentences must split; every character remains traceable.
        units.extend((pos, min(pos + max_chars, end)) for pos in range(start, end, max_chars))
    spans, first = [], 0
    while first < len(units):
        last = first + 1
        while last < len(units) and units[last][1] - units[first][0] <= max_chars:
            last += 1
        start, end = units[first][0], units[last - 1][1]
        while start < end and text[start].isspace():
            start += 1
        while end > start and text[end - 1].isspace():
            end -= 1
        if start < end:
            spans.append((start, end))
        following = last
        while following > first + 1 and units[last - 1][1] - units[following - 1][0] <= overlap_chars:
            following -= 1
        # Keep whole trailing sentences only when the next new unit also fits.
        while following < last and last < len(units) and units[last][1] - units[following][0] > max_chars:
            following += 1
        first = following if last < len(units) else last
    return spans


def split_text(text: str, max_chars: int = CHUNK_SIZE,
               overlap_chars: int = CHUNK_OVERLAP) -> list[str]:
    return [text[start:end] for start, end in split_spans(text, max_chars, overlap_chars)]


def article_chunks(article: dict, *, index_version: str = DEFAULT_INDEX_VERSION,
                   max_chars: int = CHUNK_SIZE, overlap_chars: int = CHUNK_OVERLAP,
                   embedding_model: str = DEFAULT_EMBED_MODEL) -> list[dict]:
    if not index_version or len(index_version) > 80:
        raise ValueError("index_version must contain 1 to 80 characters")
    content = article.get("content") or ""
    metadata = {key: article.get(key) for key in (
        "article_id", "stock_id", "source", "pub_time", "title", "url", "tags")}
    metadata["stock_ids"] = article_stock_ids(article)
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    fingerprint = news_index_fingerprint(index_version=index_version, model=embedding_model,
                                         max_chars=max_chars, overlap_chars=overlap_chars)
    revision = hashlib.sha256(json.dumps({**metadata, "content_hash": content_hash,
        "index_fingerprint": fingerprint}, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    return [{**metadata, "chunk_id": hashlib.sha256(
                f"{article['article_id']}:{revision}:{index}".encode()).hexdigest(),
             "chunk_index": index, "content_hash": content_hash, "revision": revision,
             "index_version": index_version, "index_fingerprint": fingerprint,
             "char_start": start, "char_end": end,
             "token_count": None, "content_chunk": content[start:end]}
            for index, (start, end) in enumerate(split_spans(content, max_chars, overlap_chars))]
