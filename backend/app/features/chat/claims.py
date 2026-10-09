"""Conservative validation of recognized numeric observations against cited facts.

This is not semantic entailment. Recognized observations retain their metric,
subject, date and unit. Unknown percentages require an exact, local quotation
from educational references; an unrelated equal number is never evidence.
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
from .proposals import (BOUNDARY, EXTENT_IDIOM, FOREIGN_CURRENCY, NUMBER, decimal_number, guarantees_outcome,
                        parse_proposals)
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
NEWS_PERCENTAGES = {
    "roe_pct": r"(?:股東權益報酬率|ROE)",
    "ai_revenue_share_pct": r"AI\s*(?:相關)?\s*營收(?:占比|比例|比重)",
    "foreign_ownership_pct": r"外資持股(?:比例|占比|比重)",
    "revenue_quarterly_qoq_pct": r"(?:單季|季度)?營收\s*(?:將|可望)?\s*季增(?:率)?",
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
    **NEWS_PERCENTAGES,
    **GROWTH_METRICS,
    "close_pos_in_1y_pct": r"(?:接近)?一年高點(?:位置)?",
    **{field: label + r"(?:率)?" for field, label in GROWTH_LABELS.items()},
    **{field: label + r"(?:配置)?(?:比例|占比|比重|占(?:總資產)?)" for field, label in PORTFOLIO_RATIOS.items()},
    **PORTFOLIO_AMOUNTS,
    "first_common_close": r"(?:共同)?(?:起始|期初)收盤價?",
    "last_common_close": r"(?:共同)?期末收盤價?",
    "close": r"(?:收盤價?|股價|價格)", "eps": r"(?:EPS|每股盈餘)",
    "per": r"(?:本益比|PER|P/E)", "pbr": r"(?:股價淨值比|PBR|P/B)",
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
UNITS = {field: "%" for field in (*COMPARISON_METRICS, *STRUCTURED_PERCENTAGES, *NEWS_PERCENTAGES, *GROWTH_METRICS,
                                 *GROWTH_LABELS, *PORTFOLIO_RATIOS, *ANCHOR_PERCENTAGES,
                                 "chg_pct", "return_pct", "allocation_pct")}
UNITS.update({field: "TWD" for field in (*PORTFOLIO_AMOUNTS, "close", "first_common_close", "last_common_close", "eps", "revenue_monthly")})
UNITS.update({field: "shares" for field in ("foreign_net", "quantity", "reserved_quantity", "available_quantity")})
UNITS.update({"average_cost": "TWD", "favorites_count": "count", "positions_count": "count"})
UNITS.update({"per": "multiple", "pbr": "multiple"})
UNITS.update({field: "%" for field in ("stop_loss_pct", "take_profit_pct", "target_return_pct")})
LABELS = "|".join(f"(?P<{field}>{label})" for field, label in METRICS.items())
QUALIFIER = r"(?:(?:目前|現在|大約|約|為|是|高達|低至|達到|僅|達|有|共有|總共|共|剩餘|剩下|剩|尚有|仍有|合計|[:=])\s*)*"
CLAIM = re.compile(
    rf"(?:{LABELS})\s*(?P<alias>\([^()\d]+\))?\s*{QUALIFIER}[(]?\s*"
    rf"(?P<currency_prefix>{FOREIGN_CURRENCY}|NT\$|TWD|NTD|[$€￥])?\s*"
    rf"(?P<number>{NUMBER})\s*(?P<unit>{FOREIGN_CURRENCY}|新台幣|台幣|TWD|NTD|億元|萬元|千元|元|億|萬|千|股|張|檔|支|倍|%)?", re.I)
PERCENT = re.compile(rf"(?P<number>{NUMBER})\s*%")
# A move over several sessions is an interval return, never one day's change.
COUNT = r"(?:\d+|[一二兩三四五六七八九十半]+)"
MULTI_DAY = (rf"近\s*{COUNT}\s*(?:個)?(?:交易)?(?:日|天|週|周|月|季|年)|過去\s*{COUNT}|"
             r"今年以來|年初(?:至今|以來)|本(?:月|週|周|季)以來|累計|累積|區間|期間|這段期間|一段時間")
# 股數、檔數與比例保持精確；帳戶金額僅容許明示「約」的大單位概述。
ACCOUNT_METRICS = {*PORTFOLIO_AMOUNTS, *PORTFOLIO_RATIOS, "allocation_pct", "average_cost", "quantity",
                   "available_quantity", "reserved_quantity", "favorites_count", "positions_count",
                   "stop_loss_pct", "take_profit_pct", "target_return_pct"}
FORECAST = r"預期|預估|預測|未來|下(?:個月|週|周|月|季)|明(?:天|日|年)"
# Who said a forecast; required before a cited news forecast may carry a percentage.
ATTRIBUTION = (r"法說會?|公司|管理層|經營層|董事長|總經理|執行長|財務長|法人|外資|投信|券商|分析師|研究機構|"
               r"機構|報導|新聞|媒體|市場|官方|政府|央行|聯準會|指出|表示|認為|根據|依據|據")
REPORT_ATTRIBUTION = {"報導", "新聞", "媒體"}
ATTRIBUTION_VERBS = {"指出", "表示", "認為", "根據", "依據", "據"}
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
    quote: str = ""


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
    # Smallest step the written number can express ("2,518.7 億" -> 1e7); None means exact only.
    quantum: Decimal | None = None
    approximate_amount: bool = False


@dataclass(frozen=True)
class NumericClaimIssue:
    sentence: str
    reason: str


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
    for field in {*PORTFOLIO_AMOUNTS, *PORTFOLIO_RATIOS}:
        # A model may repeat the exact JSON field beside its Chinese label.
        # Only an identical metric alias is formatting, never a different field.
        text = re.sub(rf"(?P<label>{METRICS[field]})\s+`?{field}`?\b",
                      lambda match: match["label"], text)
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
    symbol = max(_subjects(prefix, aliases), default=(0, 0, None), key=lambda item: item[:2])[2]
    if symbol is None and re.match(r"\s*(?:且|並且|並|同時)", prefix):
        # A conjunction after a semicolon continues the preceding subject,
        # but not its observation dates or periods.
        sentence = re.split(r"[。!?\n]", text[:position])[-1]
        if ";" in sentence:
            symbol = max(_subjects(sentence.rsplit(";", 1)[0], aliases),
                         default=(0, 0, None), key=lambda item: item[:2])[2]
    return symbol, dates


def _postposed_subject(text: str, position: int, aliases: dict[str, str]):
    """Bind a metric to its explicit adjacent subject in '88.53% 的友達'."""
    suffix = text[position:]
    connector = re.match(r"\s*的\s*", suffix)
    if not connector:
        return None
    subjects = _subjects(suffix[connector.end():], aliases)
    adjacent = [(length, symbol) for start, length, symbol in subjects if start == 0]
    return max(adjacent, default=(0, None))[1]


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
            metrics = {claims[index].metric for index in indexes if claims[index].metric is not None}
            if not metrics:
                labels = [(field, match.end() - match.start()) for field, label in METRICS.items()
                          if (match := re.search(rf"(?:{label})\s*(?:則)?\s*$",
                                                text[sentence_start:marker.start()], re.I))]
                longest = max((length for _, length in labels), default=0)
                # Prefer the explicit interval label over its generic return
                # suffix; equal-length ambiguities still receive no exemption.
                metrics = {field for field, length in labels if length == longest}
            shared_metric = next(iter(metrics)) if len(metrics) == 1 else None
            for index, symbol in zip(indexes, listed):
                # 「A 與 B 分別漲 x%、y%」已明示共用指標，第二個數字不是任意百分比。
                claims[index] = replace(claims[index], symbol=symbol,
                                        metric=claims[index].metric or shared_metric)
    yield from claims


def _listed_claims(text: str, aliases: dict[str, str]):
    occupied = []
    amounts = []
    growth_subjects = []

    def period_at(position):
        prefix = re.split(r"[。!?;\n]", text[:position])[-1]
        periods = re.findall(r"\d{4}(?:\s*Q[1-4]|-\d{2}(?!-\d{2}))", prefix, re.I)
        if periods:
            return re.sub(r"\s", "", periods[-1]).upper()
        quarters = re.findall(r"第?([一二三四1-4])季", prefix)
        if quarters:
            quarter = quarters[-1]
            return "Q" + (quarter if quarter.isdigit() else str("一二三四".index(quarter) + 1))
        months = re.findall(r"(?<!\d)(1[0-2]|0?[1-9])\s*月", prefix)
        if months:
            return f"--{int(months[-1]):02}"
        years = re.findall(r"(\d{4})\s*年", prefix)
        return years[-1] if years else None

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
                           "股": "shares", "張": "shares", "檔": "count", "支": "count",
                           "倍": "multiple", "%": "%"}.get(unit, unit)
        if match["currency_prefix"] and match["currency_prefix"].upper() not in {"TWD", "NTD", "NT$"}:
            normalized_unit = match["currency_prefix"]
        if unit in {"千", "萬", "億"} and re.match(rf"\s*(?:{FOREIGN_CURRENCY})", text[match.end():], re.I):
            normalized_unit = "invalid currency"
        alias = match["alias"][1:-1].strip() if match["alias"] else ""
        # Parenthetical prose can explain a metric without renaming it. Do not
        # erase a conflicting label, negation or condition: those need repair,
        # not a claim that the following number is contradicted by evidence.
        if alias and not re.fullmatch(METRICS[metric], alias, re.I) and not re.fullmatch(r"[A-Za-z]{2,6}", alias):
            # A prose redefinition still renames the observation ("actually
            # the opening price"). Inspect its named label, not every metric
            # substring: "measures share-price fluctuations" is explanation.
            named_alias = re.split(r"(?:實際(?:上)?(?:是|為)?|亦即|也就是|即|稱(?:為|作)?|代表|指(?:的是)?|等於)", alias)[-1].strip()
            conflicting_alias = any(re.fullmatch(pattern, named_alias, re.I)
                                    for field, pattern in METRICS.items() if field != metric)
            conflicting_alias = conflicting_alias or bool(re.fullmatch(
                r"(?:開盤|最高|最低|成交均)價|成交量|成交金額", named_alias))
            semantic_scope = re.search(r"不|無|未|非|否|若|假設|假如|如果|除非|僅限|只有|才|可能|預期", alias)
            if conflicting_alias or semantic_scope:
                normalized_unit = "invalid metric alias"
        scale = {"萬元": 10000, "萬": 10000, "億元": 100000000, "億": 100000000,
                 "千元": 1000, "千": 1000, "張": 1000}.get(unit, 1)
        value *= scale
        quantum = Decimal(1).scaleb(min(0, _number(match["number"]).as_tuple().exponent)) * scale
        decline = label.endswith("下跌") or (label.endswith("跌幅") and not label.endswith("漲跌幅"))
        if (decline or (metric == "vol_vs_ma5_pct" and label.endswith(("減少", "萎縮")))) and value > 0:
            value = -value
        elif label.endswith("上漲") and value < 0:
            normalized_unit = "invalid direction"
        symbol, dates = _context(text, match.start(), aliases)
        symbol = _postposed_subject(text, match.end(), aliases) or symbol
        trailing_date = re.match(rf"\s*\(\s*({DATE})\s*\)", text[match.end():])
        if trailing_date:
            dates += (trailing_date[1],)
        if metric == "chg_pct" and len(dates) >= 2:
            prefix = re.split(r"[。!?;\n]", text[:match.start()])[-1]
            ranges = re.findall(rf"({DATE})\s*(?:至|到|[~～])\s*({DATE})", prefix)
            explicitly_daily = label.startswith(("當日", "單日", "日報酬")) or re.search(r"(?:當日|單日|每日|每天)", prefix)
            if ranges and ranges[-1] == dates[-2:] and not explicitly_daily:
                metric = "interval_return_pct"
            elif not explicitly_daily:
                # "10-06 收盤…，較 10-03 的…上漲 3.33%": the compared date is the base, not the observation.
                baselines = re.findall(rf"(?:較|比|相較於?|相比於?)\s*({DATE})", prefix)
                if baselines and dates[-1] == baselines[-1]:
                    dates = tuple(day for day in dates if day not in baselines) or dates
        if metric == "chg_pct" and not label.startswith(("當日", "單日", "日報酬")):
            clause = re.split(r"[。!?;\n,，]", text[:match.start()])[-1]
            if re.search(MULTI_DAY, clause) and not re.search(r"當日|單日|每日|每天|今日|昨日", clause):
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
                    symbol, dates, *match.span(), period_at(match.start()), quantum,
                    metric in PORTFOLIO_AMOUNTS and unit in {"千", "千元", "萬", "萬元", "億", "億元"}
                    and "約" in text[match.start():match.start("number")])
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
        if metric is None and growth_subjects:
            end, field = growth_subjects[-1]
            bridge = text[end:match.start()]
            if "qoq_pct" in GROWTH_FIELDS[field] and re.fullmatch(
                    r"\s*,?\s*(?:較|比)前一季(?:大幅|小幅)?(?:成長|增加)\s*", bridge):
                metric = f"{field}_qoq_pct"
        yield Claim(metric, _number(match["number"]), "%", symbol, dates, *match.span(), period_at(match.start()))


def _reference_texts(payload):
    if isinstance(payload, dict):
        for value in payload.values():
            yield from _reference_texts(value)
    elif isinstance(payload, list):
        for value in payload:
            yield from _reference_texts(value)
    elif isinstance(payload, str):
        yield _normalize(payload)


def _evidence(sources, aliases):
    facts = []
    examples = []

    def add(metric, raw, symbol="", day=None, periods=(), rounded=False, period=None):
        if metric in UNITS and raw is not None:
            facts.append(Fact(metric, _number(raw), UNITS[metric], symbol, day, periods, rounded, source.citation_id, period))

    for source in sources:
        try:
            payload = json.loads(source.content, parse_float=Decimal)
        except (ValueError, TypeError):
            payload = source.content
        if source.category in {"knowledge", "help"}:
            examples.extend(_reference_texts(payload))
        if source.category == "news":
            news_text = _normalize(source.content)
            for claim in _claims(news_text, aliases):
                personal_metrics = {*PORTFOLIO_AMOUNTS, *PORTFOLIO_RATIOS, "allocation_pct", "average_cost",
                                    "quantity", "available_quantity", "reserved_quantity", "favorites_count", "positions_count"}
                symbols = {symbol for symbol in (source.stock_id, *source.stock_ids) if symbol}
                symbol = claim.symbol or (next(iter(symbols)) if len(symbols) == 1 else "")
                if claim.metric and claim.metric not in personal_metrics and claim.unit == UNITS[claim.metric]:
                    quote = (re.split(r"[。!?;\n]", news_text[:claim.end])[-1]
                             + re.split(r"[。!?;\n]", news_text[claim.end:])[0])
                    facts.append(Fact(claim.metric, claim.value, claim.unit,
                                      symbol,
                                      claim.dates[-1] if claim.dates else None,
                                      source_id=source.citation_id, period=claim.period, quote=quote))
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
    return facts, examples


def _matches(claim: Claim, fact: Fact) -> bool:
    # 未辨識語意的 2% 不能借用漲跌幅、殖利率等其他指標的同值。
    if claim.metric is None:
        return False
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
    if fact.metric not in allowed_metrics:
        return False
    if claim.metric in {"holdings_allocation_pct", "holdings_value"} and not claim.symbol and fact.symbol:
        return False
    if claim.unit != fact.unit or (claim.symbol and claim.symbol != fact.symbol):
        return False
    if claim.period:
        if claim.period == fact.period:
            pass
        elif claim.period.startswith("--"):
            month = (fact.period[-2:] if fact.period and re.fullmatch(r"\d{4}-\d{2}", fact.period)
                     else fact.day[5:7] if fact.day else None)
            if month != claim.period[2:]:
                return False
        elif re.fullmatch(r"Q[1-4]", claim.period):
            if not fact.period or not fact.period.endswith(claim.period):
                return False
        elif claim.period != fact.period:
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
    if fact.rounded:
        if precision < 2:
            return False
        try:
            return fact.value.quantize(Decimal(1).scaleb(-precision), rounding=ROUND_HALF_UP) == claim.value
        except InvalidOperation:
            return False
    if claim.quantum is None:
        return False
    account_amount = (claim.approximate_amount and claim.metric in PORTFOLIO_AMOUNTS
                      and fact.metric == claim.metric)
    # 概述只改顯示精度，不改帳戶原值；計畫額度仍由 plan_supported 以原值驗算。
    if ACCOUNT_METRICS & {claim.metric, fact.metric} and not account_amount:
        return False
    if not account_amount and claim.unit == "TWD" and abs(claim.value - fact.value) > abs(fact.value) / 100:
        return False
    # An undated whole percent could match one of many daily observations.
    if fact.metric in {"chg_pct", "vol_vs_ma5_pct"} and not claim.dates and claim.quantum > Decimal("0.1"):
        return False
    try:
        steps = (fact.value / claim.quantum).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return False
    return steps * claim.quantum == claim.value


def _quoted_example(claim: Claim, text: str, examples: list[str]) -> bool:
    if claim.metric is not None or claim.symbol or claim.dates or claim.period:
        return False
    before = BOUNDARY.split(text[:claim.start])[-1]
    after = BOUNDARY.split(text[claim.end:])[0]
    clause = (before + text[claim.start:claim.end] + after).strip()
    # 教學定義保留完整局部文字與單位；JSON 裡某個裸數字不代表相同概念。
    return bool(clause) and any(clause == part.strip()
                                for example in examples for part in BOUNDARY.split(example))


def numeric_claims_supported(paragraph: str, sources: list[SourceChunk], company_catalog=None, *, context: str = "",
                             continuation: str = "") -> bool:
    """Reject recognized contradictions; unknown prose remains unverified."""
    return unsupported_numeric_claim(paragraph, sources, company_catalog,
                                     context=context, continuation=continuation) is None


def unsupported_numeric_claim(paragraph: str, sources: list[SourceChunk], company_catalog=None, *, context: str = "",
                              continuation: str = "") -> str | None:
    """The sentence holding the first rejected number, "" if evidence cannot be read, None if supported."""
    issue = numeric_claim_issue(paragraph, sources, company_catalog, context=context, continuation=continuation)
    return issue.sentence if issue else None


def numeric_claim_issue(paragraph: str, sources: list[SourceChunk], company_catalog=None, *, context: str = "",
                        continuation: str = "") -> NumericClaimIssue | None:
    """Keep parse failures distinct from contradicted or missing evidence; all require repair."""
    aliases = {alias: symbol for symbol, company in (company_catalog or {}).items()
               for alias in company_aliases(symbol, company)}
    try:
        prefix = _normalize(context)
        text = prefix + _normalize(paragraph)
        full_text = text + _normalize(continuation)
        proposals = parse_proposals(full_text, aliases)
        facts, examples = _evidence(sources, aliases)
        news_ids = {source.citation_id for source in sources if source.category == "news"}
        for claim in _claims(text, aliases):
            if claim.end <= len(prefix):
                continue
            sentence = (re.split(r"[。!?;\n]", full_text[:claim.end])[-1]
                        + re.split(r"[。!?;\n]", full_text[claim.end:])[0])
            if claim.unit == "%" and guarantees_outcome(sentence):
                return NumericClaimIssue(sentence.strip(), "unsupported")
            if not claim.unit.startswith("invalid") and any(
                    proposal.start < claim.end <= proposal.end for proposal in proposals):
                continue
            local = re.sub(EXTENT_IDIOM, "", re.split(r"[。!?;\n,，]", text[:claim.end])[-1])
            matched = [fact for fact in facts if _matches(claim, fact)]
            # 新聞也必須逐項比對。不可在欄位、日期、方向或單位不符後，降級成數字搜尋放行。
            news_matches = [fact for fact in matched if fact.source_id in news_ids]
            if claim.unit == "%" and re.search(r"保證|一定|必定|必然", local):
                return NumericClaimIssue(sentence.strip(), "unsupported")
            if claim.unit == "%" and re.search(FORECAST, local):
                attribution = set(re.findall(ATTRIBUTION, sentence))
                speakers = attribution - REPORT_ATTRIBUTION - ATTRIBUTION_VERBS
                # 指定發話者必須屬於該數字的原句，不能借另一段的「外資」替公司預測背書。
                attributed = any(all(speaker in fact.quote for speaker in speakers)
                                 for fact in news_matches) if speakers else (
                                     bool(news_matches) and bool(attribution & REPORT_ATTRIBUTION))
                if not attributed:
                    return NumericClaimIssue(sentence.strip(), "unsupported")
            if matched:
                continue
            if _quoted_example(claim, text, examples):
                continue
            reason = "unparsed" if claim.metric is None or claim.unit == "invalid metric alias" else "unsupported"
            if claim.metric is not None and any(
                    _matches(replace(claim, value=fact.value), fact) for fact in facts):
                reason = "contradicted"
            return NumericClaimIssue(sentence.strip(), reason)
        return None
    except (ValueError, TypeError, KeyError, AttributeError, InvalidOperation):
        return NumericClaimIssue("", "invalid_evidence")
