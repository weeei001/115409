"""Current, quote-grounded event metadata for news vector payloads."""
import json

from app.features.news.impact import article_hash
from app.features.news.sentiment import source_quote_span
from .chunking import article_chunks


IMPACT_PAYLOAD_KEYS = (
    "analysis_status", "analysis_input_hash", "analysis_config_hash", "impact_scopes",
    "impact_company_ids", "impact_industry_ids", "impact_directions", "impact_importance",
    "impact_topics", "impact_context",
)


def current_analysis(article, analysis, expected_config_hash: str):
    return (analysis is not None and analysis.status == "success"
            and analysis.input_hash == article_hash(article)
            and analysis.config_hash == expected_config_hash)


def current_chunk_ids(article, settings) -> set[str]:
    return {chunk["chunk_id"] for chunk in article_chunks(
        vars(article), index_version=settings.NEWS_INDEX_VERSION,
        max_chars=settings.NEWS_CHUNK_MAX_CHARS,
        overlap_chars=settings.NEWS_CHUNK_OVERLAP_CHARS,
        embedding_model=settings.EMBED_MODEL)}


def impact_payload(chunk: dict, analysis, impacts: list) -> dict:
    empty = dict(analysis_status="pending", analysis_input_hash="", analysis_config_hash="",
                 impact_scopes=[], impact_company_ids=[], impact_industry_ids=[],
                 impact_directions=[], impact_importance=[], impact_topics=[], impact_context=[])
    if analysis is None:
        return empty
    events = {event["key"]: event for event in json.loads(analysis.events_json or "[]")}
    selected = []
    for impact in impacts:
        quotes = json.loads(impact.evidence or "[]")
        matched_quotes, spans = [], []
        for item in quotes:
            if not isinstance(item, dict) or item.get("field") not in {"title", "content"} or not item.get("quote"):
                continue
            raw = (chunk.get("title") or "") if item["field"] == "title" else (chunk.get("content_chunk") or "")
            span = source_quote_span(raw, item["quote"])
            if span is not None:
                matched_quotes.append(raw[span[0]:span[1]])
                offset = 0 if item["field"] == "title" else (chunk.get("char_start") or 0)
                spans.append({"field": item["field"], "start": offset + span[0], "end": offset + span[1]})
        if not matched_quotes:
            continue
        event = events.get(impact.event_key)
        if event is None:
            continue
        selected.append({"event": event["summary"], "statement_type": event.get("statement_type"),
                         "speaker": event.get("speaker"), "target_type": impact.target_type,
                         "target_id": impact.target_id, "direction": impact.direction,
                         "importance": impact.importance, "basis": impact.basis,
                         "reason": impact.reason, "topics": event.get("topics", []),
                         "quotes": matched_quotes, "quote_spans": spans})
    return dict(analysis_status="success", analysis_input_hash=analysis.input_hash,
                analysis_config_hash=analysis.config_hash,
                impact_scopes=sorted({item["target_type"] for item in selected}),
                impact_company_ids=sorted({item["target_id"] for item in selected if item["target_type"] == "company"}),
                impact_industry_ids=sorted({item["target_id"] for item in selected if item["target_type"] == "industry"}),
                impact_directions=sorted({item["direction"] for item in selected}),
                impact_importance=sorted({item["importance"] for item in selected}),
                impact_topics=sorted({topic for item in selected for topic in item["topics"]}),
                impact_context=selected)
