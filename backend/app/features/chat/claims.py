"""Conservative validation of recognized numeric observations against cited facts.

This is not semantic entailment. Recognized observations retain their metric,
subject, date and unit. Unrecognized percentage wording requires a cited typed
percentage observation with matching context, but its meaning remains unverified.
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, replace
from datetime import datetime
from zoneinfo import ZoneInfo
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from app.features.market.company_catalog import company_aliases
from .proposals import BOUNDARY, FOREIGN_CURRENCY, NUMBER, decimal_number, guarantees_outcome, parse_proposals
from .schemas import SourceChunk

DATE = r"\d{4}-\d{2}-\d{2}"
COMPARISON_METRICS = {
    "interval_return_pct": r"(?:區間|期間|同期(?:間)?)(?:價格|股價)?(?:報酬率|漲跌幅|漲幅|跌幅|上漲|下跌)",
    "annualized_volatility_pct": r"年化波動(?:率|度)",
    "max_drawdown_pct": r"最大回撤(?:率)?",
}
PORTFOLIO_AMOUNTS = {
    "available_cash": r"可用(?:資金|現金)", "cash": r"現金(?:餘額)?", "equity": "總資產",
    "holdings_value": r"(?:整體|全部|總)?持股市值", "total_pnl": r"(?:總)?投資損益",
    "initial_cash": r"(?:初始|模擬)本金", "net_contributions": "累計投入",
    "total_deposits": "累計入金", "total_withdrawals": "累計取回",
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
    "vol_vs_ma5_pct": r"(?:(?:成交量|量能)\s*(?:相對|較|比)\s*(?:五|5)\s*日均量\s*(?:的)?\s*(?:增減|增加|減少|放大|萎縮)|量能增減)",
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
    "first_common_close": r"(?:共同)?(?:起始|期初)收盤價?",
    "last_common_close": r"(?:共同)?期末收盤價?",
    "close": r"(?:收盤價?|股價)", "eps": r"(?:EPS|每股盈餘)",
    "revenue_monthly": r"(?:單月)?營收",
    "chg_pct": r"(?:(?:當日|單日|日)報酬率|漲跌幅|漲幅|跌幅|上漲|下跌)",
    "return_pct": r"報酬率",
    "allocation_pct": r"(?:占比|比例|比重)",
    "foreign_net": r"(?:外資買賣超|外資淨買賣超)",
    "average_cost": r"平均(?:持股)?成本",
    "reserved_quantity": r"(?:已)?委託賣出(?:股數)?|保留股數",
    "available_quantity": r"可用股數|可賣(?:出)?股數",
    "quantity": r"持有(?:股數)?|持股(?:股數|數量)?",
    "favorites_count": r"收藏(?:清單|股票)?(?:檔數|了)?",
    "positions_count": r"持股檔數",
    "stop_loss_pct": r"停損(?:幅度|跌幅|比例)?",
    "take_profit_pct": r"停利(?:幅度|漲幅|比例)?",
    "target_return_pct": r"(?:目標|預期)報酬率",
}
UNITS = {field: "%" for field in (*COMPARISON_METRICS, *STRUCTURED_PERCENTAGES, *GROWTH_METRICS,
                                 *GROWTH_LABELS, *PORTFOLIO_RATIOS, *ANCHOR_PERCENTAGES,
                                 "chg_pct", "return_pct", "allocation_pct")}
UNITS.update({field: "TWD" for field in (*PORTFOLIO_AMOUNTS, "close", "first_common_close", "last_common_close", "eps", "revenue_monthly")})
UNITS.update({field: "shares" for field in ("foreign_net", "quantity", "reserved_quantity", "available_quantity")})
UNITS.update({"average_cost": "TWD", "favorites_count": "count", "positions_count": "count"})
UNITS.update({field: "%" for field in ("stop_loss_pct", "take_profit_pct", "target_return_pct")})
LABELS = "|".join(f"(?P<{field}>{label})" for field, label in METRICS.items())
QUALIFIER = r"(?:(?:目前|現在|大約|約|為|是|達|有|共有|總共|共|剩餘|剩下|剩|尚有|仍有|合計|[:=])\s*)*"
CLAIM = re.compile(
    rf"(?:{LABELS})\s*(?P<alias>\([^()\d]{{1,40}}\))?\s*{QUALIFIER}[(]?\s*"
    rf"(?P<currency_prefix>{FOREIGN_CURRENCY}|NT\$|TWD|NTD|[$€￥])?\s*"
    rf"(?P<number>{NUMBER})\s*(?P<unit>{FOREIGN_CURRENCY}|新台幣|台幣|TWD|NTD|億元|萬元|千元|元|億|萬|千|股|張|檔|支|倍|%)?", re.I)
PERCENT = re.compile(rf"(?P<number>{NUMBER})\s*%")
INLINE_QUANTITY = re.compile(rf"(?:持有|持股)\s*(?P<symbol>\d{{4,6}})\s*(?:共|的|有)\s*(?P<number>{NUMBER})\s*(?P<unit>股|張)")


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


TAIPEI = ZoneInfo("Asia/Taipei")


def _taipei_day(value: str) -> str:
    """Snapshots are stamped in UTC; answers date them by the Taipei calendar day."""
    moment = datetime.fromisoformat(value)
    return (moment.astimezone(TAIPEI) if moment.tzinfo else moment).date().isoformat()


def _number(raw) -> Decimal:
    return decimal_number(raw)


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\[S\d+\]", "", text, flags=re.I)
    text = re.sub(r"[*_`]", "", text)
    for label in METRICS.values():
        text = re.sub(rf"(?P<label>{label})\s*\(\s*(?:{label})\s*\)",
                      lambda m: m["label"], text, flags=re.I)
    text = re.sub(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日",
                  lambda m: f"{m[1]}-{int(m[2]):02}-{int(m[3]):02}", text)
    text = re.sub(r"(\d{4})-(\d{2}-\d{2})(\s*(?:至|到|[~～])\s*)(\d{1,2})\s*月\s*(\d{1,2})\s*日",
                  lambda m: f"{m[1]}-{m[2]}{m[3]}{m[1]}-{int(m[4]):02}-{int(m[5]):02}", text)
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
    return (max(_subjects(prefix, aliases), default=(0, 0, None), key=lambda item: item[:2])[2], dates)


def _subjects(prefix: str, aliases: dict[str, str]):
    """Stock mentions in a sentence prefix as (start, length, symbol)."""
    without_dates = re.sub(DATE, " " * 10, prefix)
    without_dates = re.sub(r"\d{4}-\d{2}", " " * 7, without_dates)
    # Period labels are not ticker symbols. Full observation dates remain
    # checked above; quarter/year labels are not expanded into assumed dates.
    without_dates = re.sub(r"\d{4}\s*(?:Q[1-4]|年(?:\d{1,2}月|第?[一二三四1-4]季)?)",
                           lambda m: " " * len(m[0]), without_dates, flags=re.I)
    # Previous numeric observations are not stock identifiers.
    def mask_observation(match):
        if match["favorites_count"] and not match["unit"] and "檔數" not in match["favorites_count"]:
            return (" " * (match.start("number") - match.start()) + match["number"]
                    + " " * (match.end() - match.end("number")))
        return " " * len(match[0])
    without_dates = CLAIM.sub(mask_observation, without_dates)
    subjects = [(m.start(), len(m[1]), m[1]) for m in re.finditer(
        r"(?<![\d.])(\d{4,6})(?![\d.]|\s*(?:元|萬|張|股(?!價)|%))", without_dates)]
    for alias, symbol in aliases.items():
        subjects.extend((m.start(), len(alias), symbol) for m in re.finditer(re.escape(alias), without_dates, re.I))
    return subjects


def _claims(text: str, aliases: dict[str, str]):
    """Observations in position order; "A 與 B 分別 x、y" pairs values with stocks in order."""
    claims = sorted(_listed_claims(text, aliases), key=lambda claim: claim.start)
    for marker in re.finditer("分別", text):
        sentence_start = max(text.rfind(mark, 0, marker.start()) for mark in "。!?;\n") + 1
        boundary = BOUNDARY.search(text, marker.end())
        clause_end = boundary.start() if boundary else len(text)
        listed = list(dict.fromkeys(symbol for *_, symbol in sorted(
            _subjects(text[sentence_start:marker.start()], aliases))))
        indexes = [index for index, claim in enumerate(claims)
                   if marker.end() <= claim.start < clause_end and claim.symbol is not None]
        if len(listed) >= 2 and len(indexes) == len(listed):
            for index, symbol in zip(indexes, listed):
                claims[index] = replace(claims[index], symbol=symbol)
    yield from claims


def _listed_claims(text: str, aliases: dict[str, str]):
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
        unit = match["unit"] or match["currency_prefix"]
        if unit and unit.isascii():
            unit = unit.upper()
        if metric == "favorites_count" and not unit and "檔數" not in label:
            # Bare numbers in favorite lists identify stocks, not a count.
            continue
        if metric == "quantity" and unit in {"檔", "支"}:
            metric = "positions_count"
        if metric == "quantity" and not unit and re.match(r"\s*(?:共|的|有)", text[match.end():]):
            continue
        # Explicit units must agree; an absent share unit is ambiguous.
        normalized_unit = {"元": "TWD", "萬元": "TWD", "億元": "TWD",
                           "千元": "TWD", "萬": "TWD", "億": "TWD", "千": "TWD",
                           "台幣": "TWD", "新台幣": "TWD", "TWD": "TWD", "NTD": "TWD", "NT$": "TWD",
                           "股": "shares", "張": "shares", "檔": "count", "支": "count", "%": "%"}.get(unit, unit)
        if match["currency_prefix"] and match["currency_prefix"].upper() not in {"TWD", "NTD", "NT$"}:
            normalized_unit = match["currency_prefix"]
        if match["alias"] and not re.fullmatch(METRICS[metric], match["alias"][1:-1].strip(), re.I):
            normalized_unit = "invalid metric alias"
        if unit in {"萬元", "萬"}:
            value *= 10000
        elif unit in {"億元", "億"}:
            value *= 100000000
        elif unit in {"千元", "千"}:
            value *= 1000
        elif unit == "張":
            value *= 1000
        decline = label.endswith("下跌") or (label.endswith("跌幅") and not label.endswith("漲跌幅"))
        if (decline or (metric == "vol_vs_ma5_pct" and label.endswith(("減少", "萎縮")))) and value > 0:
            value = -value
        elif label.endswith("上漲") and value < 0:
            normalized_unit = "invalid direction"
        symbol, dates = _context(text, match.start(), aliases)
        if metric == "chg_pct" and len(dates) >= 2:
            prefix = re.split(r"[。!?;\n]", text[:match.start()])[-1]
            ranges = re.findall(rf"({DATE})\s*(?:至|到|[~～])\s*({DATE})", prefix)
            explicitly_daily = label.startswith(("當日", "單日", "日報酬")) or re.search(r"(?:當日|單日|每日|每天)", prefix)
            if ranges and ranges[-1] == dates[-2:] and not explicitly_daily:
                metric = "interval_return_pct"
        account_metric = (metric in {*PORTFOLIO_AMOUNTS, *PORTFOLIO_RATIOS, "favorites_count", "positions_count"}
                          and metric not in {"holdings_value", "holdings_allocation_pct"})
        account_metric = account_metric or (metric in {"holdings_value", "holdings_allocation_pct"}
                                            and label.startswith(("整體", "全部", "總")))
        if account_metric:
            symbol = None
            # A date attached to an earlier stock observation does not date
            # subsequent account totals. Explicit account dates still apply.
            prior = [item for item in CLAIM.finditer(text[:match.start()]) if any(
                item[field] is not None for field in ("close", "first_common_close", "last_common_close", "average_cost", "quantity", "foreign_net"))]
            if prior:
                dates = tuple(re.findall(DATE, text[prior[-1].end():match.start()]))
        occupied.append(match.span())
        if metric in PORTFOLIO_AMOUNTS:
            amounts.append((match.end(), metric))
        yield Claim(metric, value, normalized_unit or ("" if metric == "foreign_net" else UNITS[metric]),
                    symbol, dates, *match.span(), period_at(match.start()))
    for match in INLINE_QUANTITY.finditer(text):
        value = _number(match["number"]) * (1000 if match["unit"] == "張" else 1)
        occupied.append(match.span())
        yield Claim("quantity", value, "shares", match["symbol"], (), *match.span())
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
                personal_metrics = {*PORTFOLIO_AMOUNTS, *PORTFOLIO_RATIOS, "allocation_pct", "average_cost",
                                    "quantity", "available_quantity", "reserved_quantity", "favorites_count", "positions_count"}
                if claim.metric and claim.metric not in personal_metrics and claim.unit == UNITS[claim.metric]:
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
                for metric, endpoint in (("first_common_close", "common_start_date"),
                                         ("last_common_close", "common_end_date")):
                    add(metric, stock.get(metric), stock.get("symbol", ""), payload.get(endpoint), periods=periods)
        elif source.category == "personal":
            portfolio = payload.get("portfolio", {})
            snapshot_day = _taipei_day(portfolio["as_of"]) if portfolio.get("as_of") else None
            if portfolio.get("initialized") is True:
                for metric in (*PORTFOLIO_AMOUNTS, *PORTFOLIO_RATIOS):
                    add(metric, portfolio.get(metric), day=snapshot_day)
                add("positions_count", len(portfolio.get("positions", [])), day=snapshot_day)
            if "favorites" in payload:
                add("favorites_count", len(payload["favorites"]), day=snapshot_day)
            for position in portfolio.get("positions", []):
                if position.get("market_date"):
                    add("close", position.get("market_price"), position["symbol"], position["market_date"])
                add("holdings_allocation_pct", position.get("allocation_pct"), position["symbol"], snapshot_day)
                add("holdings_value", position.get("market_value"), position["symbol"], snapshot_day)
                add("average_cost", position.get("average_cost"), position["symbol"], snapshot_day)
                for metric in ("quantity", "reserved_quantity"):
                    add(metric, position.get(metric), position["symbol"], snapshot_day)
                if position.get("quantity") is not None:
                    add("available_quantity", _number(position["quantity"]) - _number(position.get("reserved_quantity", 0)),
                        position["symbol"], snapshot_day)
            for review in portfolio.get("reviews", []):
                add("close", review.get("closing_price"), review["symbol"], review.get("due_date"))
                add("chg_pct", review.get("price_return_pct"), review["symbol"], review.get("due_date"))
    return facts, literals


def _matches(claim: Claim, fact: Fact) -> bool:
    if claim.metric == "return_pct":
        allowed_metrics = {"return_pct", "interval_return_pct", "chg_pct"}
    elif claim.metric == "allocation_pct":
        allowed_metrics = set(PORTFOLIO_RATIOS)
    elif claim.metric == "close":
        allowed_metrics = {"close", "first_common_close", "last_common_close"}
        if fact.metric in {"first_common_close", "last_common_close"}:
            if not claim.dates or claim.dates[-1] != fact.day:
                return False
    else:
        allowed_metrics = {claim.metric}
    if claim.metric is not None and fact.metric not in allowed_metrics:
        return False
    if claim.metric in {"holdings_allocation_pct", "holdings_value"} and not claim.symbol and fact.symbol:
        return False
    if claim.unit != fact.unit or (claim.symbol and claim.symbol != fact.symbol):
        return False
    if claim.period and fact.period and claim.period != fact.period:
        return False
    if claim.dates:
        if fact.periods:
            if len(claim.dates) == 1 and fact.day:
                if fact.day != claim.dates[-1]:
                    return False
            elif not any((claim.dates[-2:] == period if len(claim.dates) >= 2 else claim.dates[-1] == period[1])
                         for period in fact.periods):
                return False
        elif fact.day != claim.dates[-1]:
            return False
    if claim.value == fact.value:
        return True
    precision = max(0, -claim.value.as_tuple().exponent)
    if fact.rounded and precision >= 2:
        try:
            return fact.value.quantize(Decimal(1).scaleb(-precision), rounding=ROUND_HALF_UP) == claim.value
        except InvalidOperation:
            return False
    return False


def numeric_claims_supported(paragraph: str, sources: list[SourceChunk], company_catalog=None, *, context: str = "",
                             continuation: str = "") -> bool:
    """Reject recognized contradictions; unknown prose remains unverified."""
    return unsupported_numeric_claim(paragraph, sources, company_catalog,
                                     context=context, continuation=continuation) is None


def unsupported_numeric_claim(paragraph: str, sources: list[SourceChunk], company_catalog=None, *, context: str = "",
                              continuation: str = "") -> str | None:
    """The sentence holding the first rejected number, "" if evidence cannot be read, None if supported."""
    aliases = {alias: symbol for symbol, company in (company_catalog or {}).items()
               for alias in company_aliases(symbol, company)}
    try:
        prefix = _normalize(context)
        text = prefix + _normalize(paragraph)
        full_text = text + _normalize(continuation)
        proposals = parse_proposals(full_text, aliases)
        facts, literals = _evidence(sources, aliases)
        for claim in _claims(text, aliases):
            if claim.end <= len(prefix):
                continue
            sentence = (re.split(r"[。!?;\n]", full_text[:claim.end])[-1]
                        + re.split(r"[。!?;\n]", full_text[claim.end:])[0])
            if claim.unit == "%" and guarantees_outcome(sentence):
                return sentence.strip()
            if not claim.unit.startswith("invalid") and any(
                    proposal.start < claim.end <= proposal.end for proposal in proposals):
                continue
            local = re.split(r"[。!?;\n,，]", text[:claim.end])[-1]
            if claim.unit == "%" and re.search(
                    r"保證|一定|必定|必然|預期|預測|未來|下(?:個月|週|周|月)|明(?:天|日|年)", local):
                return sentence.strip()
            if any(_matches(claim, fact) for fact in facts):
                continue
            if claim.metric is None and claim.value in literals:
                continue
            return sentence.strip()
        return None
    except (ValueError, TypeError, KeyError, AttributeError, InvalidOperation):
        return ""
