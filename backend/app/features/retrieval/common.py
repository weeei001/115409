import re
from datetime import datetime, timedelta, timezone
from typing import Any


TAIPEI = timezone(timedelta(hours=8))
STOCK_OPTIONS = {
    "2330": "台積電", "2317": "鴻海", "2454": "聯發科",
    "2881": "富邦金", "2408": "南亞科", "2615": "萬海",
}
STOCK_KEYWORDS = {
    "2330": ["台積電", "TSMC", "2330"],
    "2317": ["鴻海", "富士康", "2317"],
    "2454": ["聯發科", "MediaTek", "2454"],
    "2881": ["富邦金", "富邦", "2881"],
    "2408": ["南亞科", "南亞科技", "Nanya", "2408"],
    "2615": ["萬海", "2615"],
}
CMONEY_SOURCES = {
    "tpshouse", "cmoney", "newsyoudeservetoknow", "lewis", "coneyresearcher",
    "cmoneyaicurator", "josh", "money", "nico", "cmoneyairesearcher",
    "ruanmuhhwa", "star", "captain", "firebro", "bubuypope", "wealthonebro",
    "emily", "yolandawu", "alansays", "jiahongxlinying", "ugly", "sharon",
    "laochien", "edwin", "jacklai", "ericlu", "stockmantalk", "crawler_csv",
    "p", "so2ym6jh",
}
SOURCE_NAME_MAP = {
    "cnyes": "鉅亨網", "ltn": "自由時報", "moneydj": "MoneyDJ",
    "udn": "聯合新聞網", "chinatimes": "中時新聞網", "yahoo": "Yahoo 財經",
}

_MARKDOWN_URL_RE = re.compile(r"^\[[^]\r\n]*\]\(\s*(https?://[^)\s]+)\s*\)$", re.IGNORECASE)


def normalize_source_url(value: Any) -> str:
    """Accept legacy Markdown links but keep the canonical source URL plain."""
    if not isinstance(value, str):
        return ""
    value = value.strip()
    match = _MARKDOWN_URL_RE.fullmatch(value)
    return match.group(1) if match else value


def get_source_name(source_raw: str) -> str:
    source = str(source_raw or "")
    if source in SOURCE_NAME_MAP:
        return SOURCE_NAME_MAP[source]
    return "CMoney 財經社群" if source in CMONEY_SOURCES or source.isdigit() else source


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, (str, datetime)):
        return None
    try:
        timestamp = value if isinstance(value, datetime) else datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        return timestamp.replace(tzinfo=TAIPEI) if timestamp.tzinfo is None else timestamp.astimezone(TAIPEI)
    except ValueError:
        return None


def article_identity(payload: dict) -> str:
    return str(payload.get("article_id") or payload.get("url") or
               f"{payload.get('title', '')}:{payload.get('pub_time', '')}")


def source_provenance(payload: dict) -> dict:
    return {key: payload[key] for key in (
        "article_id", "chunk_id", "chunk_index", "char_start", "char_end",
        "content_hash", "revision", "index_version", "embedding_model", "stock_ids",
        "analysis_status", "analysis_input_hash", "analysis_config_hash", "impact_scopes", "impact_company_ids",
        "impact_industry_ids", "impact_directions", "impact_importance", "impact_topics",
        "impact_context",
    ) if payload.get(key) is not None}
