"""Conservative checks for explicit numeric observations, not semantic entailment."""
from __future__ import annotations

import json
import re
from decimal import Decimal

from .schemas import SourceChunk

NUMBER = r"[+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
METRICS = {
    "close": r"(?:收盤價?|股價)",
    "eps": r"(?:EPS|每股盈餘)",
    "chg_pct": r"(?:漲跌幅|報酬率)",
    "foreign_net": r"(?:外資買賣超|外資淨買賣超)",
}


def _number(value) -> Decimal:
    return Decimal(str(value).replace(",", "").replace("−", "-"))


def _evidence_numbers(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from _evidence_numbers(item)
    elif isinstance(value, list):
        for item in value:
            yield from _evidence_numbers(item)
    elif isinstance(value, str):
        yield from (_number(token) for token in re.findall(NUMBER, value))
    elif type(value) in {int, Decimal}:
        yield _number(value)


def _records(payload: dict, field: str):
    columns = payload.get("columns", [])
    if field in columns and "date" in columns:
        for row in payload.get("rows", []):
            if len(row) == len(columns):
                yield row[columns.index(field)], row[columns.index("date")]
    for item in payload.get("items", []):
        if isinstance(item, dict) and item.get("field") == field:
            yield item.get("value"), item.get("date")


def _claim_pattern(label: str) -> str:
    return label + r"\s*(?:為|是|達|約|[:：=])?\s*(" + NUMBER + r")\s*(股|張|元|[%％])?"


def _claim_value(match: re.Match, field: str) -> Decimal:
    value = _number(match.group(1))
    return value * 1000 if field == "foreign_net" and match.group(2) == "張" else value


def _local_context(prose: str, position: int) -> tuple[str | None, str | None]:
    # Carry an explicit subject/date across comma-separated metrics, but use
    # the nearest preceding qualifier when a later claim changes it.
    prefix = re.split(r"[。！？；;\n]", prose[:position])[-1]
    dates = re.findall(r"\d{4}-\d{2}-\d{2}", prefix)
    symbols = re.findall(r"(?:股票|代碼|（|\()\s*(\d{4,6})(?!\d)", prefix)
    return dates[-1] if dates else None, symbols[-1] if symbols else None


def numeric_claims_supported(paragraph: str, sources: list[SourceChunk]) -> bool:
    """Reject explicit contradictions; unrecognized prose remains unverified.

    Matches only supported metric syntax. It deliberately does not synthesize
    derived values or treat another field's equal number as metric evidence.
    """
    prose = re.sub(r"\[S\d+\]", "", paragraph)
    structured = []
    evidence_numbers = set()
    for source in sources:
        try:
            payload = json.loads(source.content, parse_float=Decimal)
        except (ValueError, TypeError):
            evidence_numbers.update(_evidence_numbers(source.content))
            continue
        # JSON commas separate values; only prose commas can group thousands.
        evidence_numbers.update(_evidence_numbers(payload))
        if isinstance(payload, dict) and source.category in {"market_technical", "fundamental", "institutional"}:
            structured.append((source, payload))

    for field, label in METRICS.items():
        for match in re.finditer(_claim_pattern(label), prose, re.I):
            value = _claim_value(match, field)
            claim_date, claim_symbol = _local_context(prose, match.start())
            if field == "foreign_net" and match.group(2) not in {"股", "張"}:
                # A bare amount cannot establish whether shares or lots were meant.
                return False
            candidates = [(source, raw, day) for source, payload in structured
                          for raw, day in _records(payload, field) if raw is not None]
            if candidates:
                if not any(_number(raw) == value
                           and (claim_date is None or day == claim_date)
                           and (claim_symbol is None or source.stock_id == claim_symbol)
                           for source, raw, day in candidates):
                    return False
            elif not any(_claim_value(news_match, field) == value
                         and (field != "foreign_net" or news_match.group(2) in {"股", "張"})
                         for source in sources if source.category == "news"
                         for news_match in re.finditer(_claim_pattern(label), source.content, re.I)):
                return False

    # A signed percentage must at least occur in the cited evidence, never in
    # an unrelated source. This is a necessary condition, not full verification.
    for token in re.findall(r"(" + NUMBER + r")\s*[%％]", prose):
        if _number(token) not in evidence_numbers:
            return False
    return True
