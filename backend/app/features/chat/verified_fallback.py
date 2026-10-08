"""Render a small, dated source summary without reusing any rejected model prose."""
from __future__ import annotations

import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation

from .answer_validation import AnswerValidationError, _checked_answer
from .claims import _taipei_day
from .schemas import SourceChunk


VERIFIED_FALLBACK_NOTICE = "這次分析未能完成核對。以下是本輪可核對的資料摘要，尚未形成投資結論。"
MAX_FALLBACK_FACTS = 4


def _money(raw, *, positive=False) -> str:
    if isinstance(raw, bool) or not isinstance(raw, (str, int, Decimal)):
        raise ValueError("Invalid amount")
    value = Decimal(raw)
    if not value.is_finite() or value < 0 or (positive and value == 0):
        raise ValueError("Invalid amount")
    return format(value, "f")


def _dated_candidates(source: SourceChunk):
    """Only server-created account and market fields are eligible, never news or AI summaries."""
    if source.category not in {"personal", "market_technical"}:
        return []
    payload = json.loads(source.content, parse_float=Decimal)
    if not isinstance(payload, dict):
        return []
    if source.category == "personal":
        portfolio = payload.get("portfolio")
        if not isinstance(portfolio, dict) or portfolio.get("initialized") is not True or not portfolio.get("as_of"):
            return []
        day = _taipei_day(portfolio["as_of"])
        lines = []
        if portfolio.get("available_cash") is not None:
            money = _money(portfolio["available_cash"])
            lines.append((("account", day, "available_cash"), Decimal(money),
                          f"{day} 模擬帳戶：可用資金 {money} 元。"))
        positions = portfolio.get("positions")
        if isinstance(positions, list) and all(
            isinstance(item, dict) and re.fullmatch(r"\d{4,6}", str(item.get("symbol", "")))
            and type(item.get("quantity")) is int and item["quantity"] > 0 for item in positions
        ) and len({item["symbol"] for item in positions}) == len(positions):
            lines.append((("account", day, "positions_count"), Decimal(len(positions)),
                          f"{day} 模擬帳戶：持股檔數 {len(positions)} 檔。"))
        return lines

    if not re.fullmatch(r"\d{4,6}", source.stock_id):
        return []
    columns = payload.get("columns", [])
    if not isinstance(columns, list) or len(columns) != len(set(columns)) or not {"date", "close"} <= set(columns):
        return []
    rows = []
    for row in payload.get("rows", []):
        if not isinstance(row, list) or len(row) != len(columns):
            raise ValueError("Invalid market row")
        record = dict(zip(columns, row))
        day = record["date"]
        if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
            raise ValueError("Invalid observation date")
        if record["close"] is not None:
            rows.append((day, _money(record["close"], positive=True)))
    if not rows:
        return []
    latest = max(day for day, _ in rows)
    prices = {Decimal(price) for day, price in rows if day == latest}
    if len(prices) != 1:
        return []  # 同日來源自身矛盾時，不能任選一個價格作為安全摘要。
    value = prices.pop()
    return [((source.stock_id, latest, "close"), value,
             f"{latest} 股票 {source.stock_id} 收盤價 {format(value, 'f')} 元。")]


def verified_facts_fallback(sources: list[SourceChunk], warning: str = "", *, company_catalog=None,
                            require_portfolio=False) -> str | None:
    entries = []
    values = {}
    for source in sources:
        if not re.fullmatch(r"S[1-9][0-9]*", source.citation_id):
            continue
        try:
            candidates = _dated_candidates(source)
        except (ValueError, TypeError, KeyError, InvalidOperation, OverflowError):
            continue
        for key, value, candidate in candidates:
            line = f"- {candidate}[{source.citation_id}]"
            try:
                _checked_answer(line, {"finish_reason": "stop"}, [source], company_catalog=company_catalog)
            except (AnswerValidationError, ValueError, TypeError, KeyError, InvalidOperation):
                continue
            entries.append((key, line))
            values.setdefault(key, set()).add(value)
    # 先掃完本輪來源再限制項數；後面的矛盾資料不能被顯示上限藏掉。
    lines = []
    seen = set()
    for key, line in entries:
        if len(values[key]) == 1 and key not in seen:
            lines.append(line)
            seen.add(key)
        if len(lines) == MAX_FALLBACK_FACTS:
            break
    if not lines:
        return None
    try:
        checked = _checked_answer("\n\n".join(lines), {"finish_reason": "stop"}, sources, warning,
                                  company_catalog=company_catalog, require_portfolio=require_portfolio)
    except (AnswerValidationError, ValueError, TypeError, KeyError, InvalidOperation):
        return None
    # 這段固定文字描述回覆狀態，不含模型的結論、交易建議或被截斷的區塊。
    return VERIFIED_FALLBACK_NOTICE + "\n\n" + checked
