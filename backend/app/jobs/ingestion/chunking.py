"""Compatibility imports for existing offline scripts; API code uses retrieval."""
from app.features.retrieval.chunking import (
    CHUNK_OVERLAP, CHUNK_SIZE, DEFAULT_EMBED_MODEL, DEFAULT_INDEX_VERSION,
    article_chunks, article_stock_ids, embedding_text, split_spans, split_text,
)
