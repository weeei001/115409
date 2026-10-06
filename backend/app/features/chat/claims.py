"""Conservative validation of recognized numeric observations against cited facts.

This is not semantic entailment. Recognized observations retain their metric,
subject, date and unit. Unrecognized percentage wording requires a cited typed
percentage observation with matching context, but its meaning remains unverified.
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from app.features.market.company_catalog import company_aliases
from .schemas import SourceChunk

NUMBER = r"[+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
DATE = r"\d{4}-\d{2}-\d{2}"
COMPARISON_METRICS = {
    "interval_return_pct": r"(?:區間|期間|同期(?:間)?)(?:價格)?報酬率",
    "annualized_volatility_pct": r"年化波動(?:率|度)",
    "max_drawdown_pct": r"最大回撤(?:率)?",
}
PORTFOLIO_AMOUNTS = {
    "available_cash": "可用資金", "cash": "現金餘額", "equity": "總資產",
    "holdings_value": "持股市值", "total_pnl": "投資損益",
}
PORTFOLIO_RATIOS = {
    "available_cash_allocation_pct": "可用資金",
    "reserved_cash_allocation_pct": r"(?:委託)?保留資金",
    "cash_allocation_pct": "現金", "holdings_allocation_pct": r"(?:整體)?持股",
}
STRUCTURED_PERCENTAGES = {
    "gross_margin_pct": r"(?:單季)?毛利率",
    "operating_margin_pct": r"(?:單季)?營業利益率",
    "dividend_yield": r"(?:現金)?殖利率",
    "vol_vs_ma5_pct": r"(?:成交量(?:相對|較)(?:五|5)日均量(?:的)?(?:增減|增加|減少)|量能增減)",
}
ANCHOR_PERCENTAGES = ("close_pos_in_1y_pct", "vs_ma60_pct", "vs_ma240_pct")
GROWTH_FIELDS = {"eps": ("yoy_pct", "qoq_pct"), "revenue_monthly": ("yoy_pct", "mom_pct")}
GROWTH_LABELS = {"yoy_pct": "年增", "qoq_pct": "季增", "mom_pct": "月增"}
GROWTH_METRICS = {
    f"{field}_{change}": label + r"\s*" + GROWTH_LABELS[change] + r"(?:率)?"
    for field, label in {"eps": r"(?:EPS|每股盈餘)", "revenue_monthly": r"(?:單月)?營收"}.items()
    for change in GROWTH_FIELDS[field]
}
METRICS = {
    **COMPARISON_METRICS,
    **STRUCTURED_PERCENTAGES,
    **GROWTH_METRICS,
    **{field: label + r"(?:率)?" for field, label in GROWTH_LABELS.items()},
    **{field: label + r"(?:配置)?(?:比例|占比|比重|占(?:總資產)?)" for field, label in PORTFOLIO_RATIOS.items()},
    **PORTFOLIO_AMOUNTS,
    "close": r"(?:收盤價?|股價)", "eps": r"(?:EPS|每股盈餘)",
    "revenue_monthly": r"(?:單月)?營收",
    "chg_pct": r"(?:(?:當日|單日|日)報酬率|漲跌幅|漲幅|跌幅|上漲|下跌)",
    "return_pct": r"報酬率",
    "allocation_pct": r"(?:占比|比例|比重)",
    "foreign_net": r"(?:外資買賣超|外資淨買賣超)",
}
UNITS = {field: "%" for field in (*COMPARISON_METRICS, *STRUCTURED_PERCENTAGES, *GROWTH_METRICS,
                                 *GROWTH_LABELS, *PORTFOLIO_RATIOS, *ANCHOR_PERCENTAGES,
                                 "chg_pct", "return_pct", "allocation_pct")}
UNITS.update({field: "TWD" for field in (*PORTFOLIO_AMOUNTS, "close", "eps", "revenue_monthly")})
UNITS["foreign_net"] = "shares"
LABELS = "|".join(f"(?P<{field}>{label})" for field, label in METRICS.items())
CLAIM = re.compile(
    rf"(?:{LABELS})\s*(?P<alias>\([^()\d]{{1,40}}\))?\s*(?:為|是|達|約|[:=])?\s*[(]?\s*"
    rf"(?P<number>{NUMBER})\s*(?P<unit>美元|美金|USD|港元|港幣|HKD|億元|萬元|元|股|張|倍|%)?", re.I)
PERCENT = re.compile(rf"(?P<number>{NUMBER})\s*%")


@dataclass(frozen=True)
class Fact:
    metric: str
    value: Decimal
    unit: str
    symbol: str = ""
    day: str | None = None
    periods: tuple[tuple[str | None, str | None], ...] = ()
    rounded: bool = False
    source_id: str = ""
    period: str | None = None


@dataclass(frozen=True)
class Claim:
    metric: str | None
    value: Decimal
    unit: str
    symbol: str | None
    dates: tuple[str, ...]
    start: int
    end: int
    period: str | None = None
    lots: Decimal | None = None  # value as written in 張 (1,000 shares), possibly rounded


def _number(raw) -> Decimal:
    if isinstance(raw, bool):
        raise ValueError("Boolean is not a numeric observation")
    value = Decimal(str(raw).replace(",", "").replace("−", "-"))
    if not value.is_finite():
        raise ValueError("Nonfinite numeric observation")
    return value


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\[S\d+\]", "", text, flags=re.I)
    text = re.sub(r"[*_`]", "", text)
    for label in METRICS.values():
        text = re.sub(rf"(?P<label>{label})\s*\(\s*(?:{label})\s*\)",
                      lambda m: m["label"], text, flags=re.I)
    text = re.sub(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日",
                  lambda m: f"{m[1]}-{int(m[2]):02}-{int(m[3]):02}", text)
    text = re.sub(r"(\d{4})\s*年?\s*第?\s*([一二三四1-4])\s*季",
                  lambda m: f"{m[1]}Q{m[2] if m[2].isdigit() else '一二三四'.index(m[2]) + 1}", text)
    text = re.sub(r"(\d{4})\s*年\s*(\d{1,2})\s*月",
                  lambda m: f"{m[1]}-{int(m[2]):02}", text)
    text = re.sub(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})",
                  lambda m: f"{m[1]}-{int(m[2]):02}-{int(m[3]):02}", text)
    return re.sub(r"(\d{4})-(\d{2}-\d{2})(\s*(?:至|到|[~～])\s*)(\d{2}-\d{2})(?!\d)",
                  lambda m: f"{m[1]}-{m[2]}{m[3]}{m[1]}-{m[4]}", text)


def _context(text: str, position: int, aliases: dict[str, str]):
    prefix = re.split(r"[。!?;\n]", text[:position])[-1]
    dates = tuple(re.findall(DATE, prefix))
    without_dates = re.sub(DATE, " " * 10, prefix)
    without_dates = re.sub(r"\d{4}-\d{2}", " " * 7, without_dates)
    # Period labels are not ticker symbols. Full observation dates remain
    # checked above; quarter/year labels are not expanded into assumed dates.
    without_dates = re.sub(r"\d{4}\s*(?:Q[1-4]|年(?:\d{1,2}月|第?[一二三四1-4]季)?)",
                           lambda m: " " * len(m[0]), without_dates, flags=re.I)
    # Previous numeric observations are not stock identifiers.
    without_dates = CLAIM.sub(lambda m: " " * len(m[0]), without_dates)
    subjects = [(m.start(), len(m[1]), m[1]) for m in re.finditer(
        r"(?<![\d.])(\d{4,6})(?![\d.]|\s*(?:元|萬|張|股(?!價)|%))", without_dates)]
    for alias, symbol in aliases.items():
        subjects.extend((m.start(), len(alias), symbol) for m in re.finditer(re.escape(alias), without_dates, re.I))
    return (max(subjects, default=(0, 0, None), key=lambda item: item[:2])[2], dates)


def _claims(text: str, aliases: dict[str, str]):
    occupied = []
    amounts = []
    growth_subjects = []

    def period_at(position):
        prefix = re.split(r"[。!?;\n]", text[:position])[-1]
        periods = re.findall(r"\d{4}(?:\s*Q[1-4]|-\d{2}(?!-\d{2}))", prefix, re.I)
        return re.sub(r"\s", "", periods[-1]).upper() if periods else None

    for match in CLAIM.finditer(text):
        metric = next(field for field in METRICS if match[field] is not None)
        label = match[metric]
        if metric in GROWTH_LABELS and growth_subjects:
            end, subject = growth_subjects[-1]
            if metric in GROWTH_FIELDS[subject] and not re.search(r"[。!?;\n]", text[end:match.start()]):
                metric = f"{subject}_{metric}"
        if metric in GROWTH_FIELDS:
            growth_subjects.append((match.end(), metric))
        elif metric in GROWTH_METRICS:
            growth_subjects.append((match.end(), next(field for field in GROWTH_FIELDS if metric.startswith(field + "_"))))
        if metric in PORTFOLIO_AMOUNTS and match["unit"] == "%" and text[:match.start()].endswith("占"):
            # An elliptical allocation ("cash ... accounts for X% of equity")
            # is handled below using the preceding monetary observation.
            continue
        value = _number(match["number"])
        unit = match["unit"]
        lots = value if unit == "張" else None
        # Explicit units must agree; an absent share unit is ambiguous.
        normalized_unit = {"元": "TWD", "萬元": "TWD", "億元": "TWD",
                           "股": "shares", "張": "shares", "%": "%"}.get(unit, unit)
        if match["alias"] and not re.fullmatch(METRICS[metric], match["alias"][1:-1].strip(), re.I):
            normalized_unit = "invalid metric alias"
        if unit == "萬元":
            value *= 10000
        elif unit == "億元":
            value *= 100000000
        elif unit == "張":
            value *= 1000
        if (label in {"下跌", "跌幅"} or (metric == "vol_vs_ma5_pct" and label.endswith("減少"))) and value > 0:
            value = -value
        elif label == "上漲" and value < 0:
            normalized_unit = "invalid direction"
        symbol, dates = _context(text, match.start(), aliases)
        occupied.append(match.span())
        if metric in PORTFOLIO_AMOUNTS:
            amounts.append((match.end(), metric))
        yield Claim(metric, value, normalized_unit or ("" if metric == "foreign_net" else UNITS[metric]),
                    symbol, dates, *match.span(), period_at(match.start()), lots)
    for match in PERCENT.finditer(text):
        if any(start <= match.start() < end for start, end in occupied):
            continue
        symbol, dates = _context(text, match.start(), aliases)
        preceding = [(end, field) for end, field in amounts if end <= match.start()]
        metric = None
        if preceding:
            end, field = preceding[-1]
            if re.fullmatch(r"\s*,?\s*占(?:總資產)?\s*(?:為|約)?\s*", text[end:match.start()]):
                metric = {"available_cash": "available_cash_allocation_pct", "cash": "cash_allocation_pct",
                          "holdings_value": "holdings_allocation_pct"}.get(field)
        yield Claim(metric, _number(match["number"]), "%", symbol, dates, *match.span(), period_at(match.start()))


def _literal_numbers(payload):
    if isinstance(payload, dict):
        for value in payload.values():
            yield from _literal_numbers(value)
    elif isinstance(payload, list):
        for value in payload:
            yield from _literal_numbers(value)
    elif isinstance(payload, str):
        for token in re.findall(NUMBER, payload):
            yield _number(token)
    elif type(payload) in {int, Decimal}:
        yield _number(payload)


def _evidence(sources, aliases):
    facts = []
    literals = set()

    def add(metric, raw, symbol="", day=None, periods=(), rounded=False, period=None):
        if metric in UNITS and raw is not None:
            facts.append(Fact(metric, _number(raw), UNITS[metric], symbol, day, periods, rounded, source.citation_id, period))

    for source in sources:
        try:
            payload = json.loads(source.content, parse_float=Decimal)
        except (ValueError, TypeError):
            payload = source.content
        if source.category in {"news", "knowledge", "help"}:
            # Literal fallback is restricted to unstructured references, never
            # dates, prices or share counts from structured market/account data.
            literals.update(_literal_numbers(payload))
        if source.category == "news":
            for claim in _claims(_normalize(source.content), aliases):
                if claim.metric and claim.unit == UNITS[claim.metric]:
                    facts.append(Fact(claim.metric, claim.value, claim.unit,
                                      claim.symbol or source.stock_id,
                                      claim.dates[-1] if claim.dates else None,
                                      source_id=source.citation_id))
        if source.category in {"market_technical", "fundamental", "institutional"}:
            if not isinstance(payload, dict):
                raise ValueError("Invalid structured source")
            columns = payload.get("columns", [])
            for row in payload.get("rows", []):
                if not isinstance(row, list) or len(row) != len(columns):
                    raise ValueError("Invalid market row")
                record = dict(zip(columns, row))
                for metric in UNITS:
                    add(metric, record.get(metric), source.stock_id, record.get("date"))
            for item in payload.get("items", []):
                add(item.get("field"), item.get("value"), source.stock_id, item.get("date"), period=item.get("period"))
                for change in GROWTH_FIELDS.get(item.get("field"), ()):
                    add(f"{item['field']}_{change}", item.get(change), source.stock_id,
                        item.get("date"), period=item.get("period"))
            for item in payload.get("long_term_anchor", []):
                if item.get("field") in ANCHOR_PERCENTAGES:
                    add(item["field"], item.get("value"), source.stock_id, item.get("date"))
        elif source.category == "comparison":
            periods = tuple((payload.get(f"{kind}_start_date"), payload.get(f"{kind}_end_date"))
                            for kind in ("requested", "common"))
            for stock in payload.get("stocks", []):
                for metric in COMPARISON_METRICS:
                    add(metric, stock.get(metric), stock.get("symbol", ""), periods=periods, rounded=True)
        elif source.category == "personal":
            portfolio = payload.get("portfolio", {})
            snapshot_day = datetime.fromisoformat(portfolio["as_of"]).date().isoformat() if portfolio.get("as_of") else None
            if portfolio.get("initialized") is True:
                for metric in (*PORTFOLIO_AMOUNTS, *PORTFOLIO_RATIOS):
                    add(metric, portfolio.get(metric), day=snapshot_day)
            for position in portfolio.get("positions", []):
                if position.get("market_date"):
                    add("close", position.get("market_price"), position["symbol"], position["market_date"])
                add("holdings_allocation_pct", position.get("allocation_pct"), position["symbol"], snapshot_day)
            for review in portfolio.get("reviews", []):
                add("close", review.get("closing_price"), review["symbol"], review.get("due_date"))
                add("chg_pct", review.get("price_return_pct"), review["symbol"], review.get("due_date"))
    return facts, literals


def _matches(claim: Claim, fact: Fact) -> bool:
    if claim.metric == "return_pct":
        allowed_metrics = {"return_pct", "interval_return_pct", "chg_pct"}
    elif claim.metric == "allocation_pct":
        allowed_metrics = set(PORTFOLIO_RATIOS)
    else:
        allowed_metrics = {claim.metric}
    if claim.metric is not None and fact.metric not in allowed_metrics:
        return False
    if claim.metric == "holdings_allocation_pct" and not claim.symbol and fact.symbol:
        return False
    if claim.unit != fact.unit or (claim.symbol and claim.symbol != fact.symbol):
        return False
    if claim.period and fact.period and claim.period != fact.period:
        return False
    if claim.dates:
        if fact.periods:
            if not any((claim.dates[-2:] == period if len(claim.dates) >= 2 else claim.dates[-1] == period[1])
                       for period in fact.periods):
                return False
        elif fact.day != claim.dates[-1]:
            return False
    if claim.value == fact.value:
        return True
    if claim.lots is not None:
        # Share sources are converted to 張 for display and rounded at the precision written.
        lot_precision = max(0, -claim.lots.as_tuple().exponent)
        try:
            return (fact.value / 1000).quantize(Decimal(1).scaleb(-lot_precision), rounding=ROUND_HALF_UP) == claim.lots
        except InvalidOperation:
            return False
    precision = max(0, -claim.value.as_tuple().exponent)
    if fact.rounded and precision >= 2:
        try:
            return fact.value.quantize(Decimal(1).scaleb(-precision), rounding=ROUND_HALF_UP) == claim.value
        except InvalidOperation:
            return False
    return False


def _allocation_proposal(text: str, claim: Claim) -> bool:
    """Only exempt a local, explicitly proposed allocation percentage.

    A recommendation elsewhere in the paragraph cannot exempt an observation.
    This checks the proposal's syntax/range, not suitability or total budgets.
    """
    if claim.unit != "%" or claim.metric not in {None, *PORTFOLIO_RATIOS} or not 0 <= claim.value <= 100:
        return False
    prefix = re.split(r"[。!?;,，\n]", text[:claim.end])[-1]
    return bool(re.fullmatch(
        rf"\s*(?:[-•]\s*)?(?:建議|可考慮|可以考慮|假設)"
        rf"(?:先)?(?:將(?:可用資金|現金|持股)(?:占比|比例|比重)(?:調整|提高|降低)至|"
        rf"(?:投入|保留)(?:可用資金|現金)(?:的)?)\s*{NUMBER}\s*%", prefix))


def _cites_paper_portfolio(sources: list[SourceChunk]) -> bool:
    """Allocation proposals are a paper-trading feature; they need the cited paper-portfolio snapshot."""
    for source in sources:
        if source.category != "personal":
            continue
        try:
            if isinstance(json.loads(source.content).get("portfolio"), dict):
                return True
        except (ValueError, AttributeError):
            continue
    return False


def numeric_claims_supported(paragraph: str, sources: list[SourceChunk], company_catalog=None, *, context: str = "") -> bool:
    """Reject recognized contradictions; unknown prose remains unverified."""
    aliases = {alias: symbol for symbol, company in (company_catalog or {}).items()
               for alias in company_aliases(symbol, company)}
    try:
        prefix = _normalize(context)
        text = prefix + _normalize(paragraph)
        facts, literals = _evidence(sources, aliases)
        paper_portfolio = _cites_paper_portfolio(sources)
        for claim in _claims(text, aliases):
            if claim.end <= len(prefix):
                continue
            if paper_portfolio and _allocation_proposal(text, claim):
                continue
            if any(_matches(claim, fact) for fact in facts):
                continue
            if claim.metric is None and claim.value in literals:
                continue
            return False
        return True
    except (ValueError, TypeError, KeyError, AttributeError, InvalidOperation):
        return False
