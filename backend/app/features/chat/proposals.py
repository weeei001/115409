"""Parse explicit plans and condition thresholds separately from observations."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from decimal import Decimal

NUMBER = r"[+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
UNIT = r"億元|萬元|千元|元|億|萬|千|%|張|股"
FOREIGN_CURRENCY = r"美元|美金|USD|港元|港幣|HKD|日圓|日元|JPY|歐元|EUR|人民幣|CNY|RMB"
UNIT = FOREIGN_CURRENCY + "|" + UNIT
VALUE = re.compile(
    rf"(?P<currency_prefix>{FOREIGN_CURRENCY}|NT\$|TWD|NTD|[$€￥])?\s*"
    rf"(?P<low>{NUMBER})\s*(?P<low_unit>{UNIT})?"
    rf"(?:\s*(?:至|到|[~～–-])\s*(?P<high>{NUMBER})\s*(?P<high_unit>{UNIT})?)?", re.I
)
BOUNDARY = re.compile(r"[。!?;\n]|(?<!\d)[,，]|[,，](?!\d)")
INTRO = re.compile(r"\s*(?:(?:[-•·]|\d+[.)])\s*)?"
                   r"(?:我的建議是|建議(?:你)?|你可以(?:考慮)?|可以(?:考慮)?|可考慮|可(?!用)|不妨"
                   r"|每次|每批|首批|第[一二三1-3]批|分批)\s*")
CONDITION = re.compile(r"\s*(?:若|如果|假設|假如)\s*")
MODIFIER = r"(?:(?:先|再|並|另|另外|然後|接著|其中|其餘|每檔|各檔|單一|分批|暫時|至少|最多|約|大約|的|\s|[、：:])*)"
FUNDS = r"(?:可用資金|可用現金|模擬資金|投資預算|賣出所得|現金|資金|總資產|持股)"
ACTION = r"(?:投入|分配|配置|保留|買入|買進|加碼)"
# Hypothetical price moves that trigger a plan. Plain rises/falls need an
# explicit condition word; the others read as thresholds when an action follows.
TRIGGER_CONDITION = r"(?:若|如果|假設|假如|萬一|一旦|當)"
STANDALONE_TRIGGER = r"(?:回檔|回落|拉回|跌破|漲破|突破|(?:漲|跌)幅?(?:超過|逾))"
TRIGGER = rf"(?:{STANDALONE_TRIGGER}|(?:漲|跌)幅?達到?|下跌|上漲|下修|反彈|漲|跌)"
TRIGGER_ACTION = (r"\s*(?:以上|以內|左右|附近)?\s*(?:時|的話|之後|後|再|就|則|即|便)?.{0,10}?"
                  r"(?:停損|停利|出場|進場|買進|買入|布局|佈局|加碼|減碼|賣出|獲利了結|分批|評估|觀察|考慮|暫停)")
RISK = r"(?:停損|停利|目標報酬率?)(?:點|幅度|跌幅|漲幅|比例|線)?"
SETTER = r"(?:可|可以|建議|宜|不妨|先)?(?:設定?|抓|訂|定|控制|放)?(?:在|為|於|至|到)?"
OBSERVED = r"目前|現在|已|實際|現況|截至|近|過去|累計|今日|今天|昨日|昨天|本週|上週|本月|上月|今年|去年"


def decimal_number(raw):
    if isinstance(raw, bool):
        raise ValueError("Boolean is not a numeric value")
    value = Decimal(str(raw).replace(",", "").replace("−", "-"))
    if not value.is_finite():
        raise ValueError("Nonfinite numeric value")
    return value


# 「一定程度」「一定比例」 describe extent, not a guarantee.
EXTENT_IDIOM = r"一定(?:程度|比例|幅度|範圍|水準|期間|時間|的)"


def guarantees_outcome(text):
    text = re.sub(EXTENT_IDIOM, "", text)
    text = re.sub(r"(?:不|未|無法|不能|並非)(?:會|能)?(?:保證|一定|必定|必然)(?:一定|必定|必然)?", "", text)
    return bool(re.search(r"保證|一定|必定|必然", text))


@dataclass(frozen=True)
class Proposal:
    start: int
    end: int
    low: Decimal
    high: Decimal
    unit: str
    kind: str
    action: str = ""
    symbol: str = ""
    base: str = "available_cash"
    multiplier: int = 1
    parent: int | None = None
    component: str = ""


def _clauses(text):
    start = 0
    for boundary in BOUNDARY.finditer(text):
        yield start, text[start:boundary.start()], boundary[0]
        start = boundary.end()
    yield start, text[start:], ""


def _without_subject(text, aliases):
    for alias in sorted(aliases, key=len, reverse=True):
        text = re.sub(re.escape(alias), "", text, flags=re.I)
    return re.sub(r"(?<!\d)\d{4,6}(?!\d)", "", text)


def _subject(before, after, aliases):
    def candidates(text):
        found = [(match.start(), len(match[0]), match[0])
                 for match in re.finditer(r"(?<!\d)\d{4,6}(?!\d)", text)]
        for alias, symbol in aliases.items():
            found.extend((match.start(), len(alias), symbol)
                         for match in re.finditer(re.escape(alias), text, flags=re.I))
        return found
    preceding = candidates(before)
    if preceding:
        return max(preceding, key=lambda item: item[:2])[2]
    following = candidates(after)
    return min(following, key=lambda item: (item[0], -item[1]))[2] if following else ""


def _threshold(before, after, aliases):
    """Stop settings and hypothetical move triggers stated without a leading suggestion."""
    introduction = INTRO.match(before)
    prefix = before[introduction.end():] if introduction else before
    prefix = _without_subject(re.sub(r"^\s*(?:[-•·]|\d+[.)])\s*", "", prefix), aliases).strip()
    # 「目前」也可能修飾當下的建議；只有完整的可設定句型才豁免，不能把現況字詞直接刪掉。
    if re.fullmatch(rf"(?:目前|現在){MODIFIER}{RISK}{MODIFIER}"
                    rf"(?:可(?:以)?|建議|宜|不妨)(?:設定?|抓|訂|定|控制|放)"
                    rf"(?:在|為|於|至|到)?{MODIFIER}", prefix):
        return "risk", ""
    if re.search(r"\d", prefix) or re.search(OBSERVED, prefix):
        return None
    if re.fullmatch(rf"{MODIFIER}(?:設定)?{RISK}{MODIFIER}{SETTER}{MODIFIER}", prefix):
        return "risk", ""
    condition = re.match(rf"[^%]{{0,8}}?{TRIGGER_CONDITION}", prefix)
    trigger = re.fullmatch(rf"{MODIFIER}在?{MODIFIER}(?:股價|收盤價?)?{MODIFIER}(?P<verb>{TRIGGER}){MODIFIER}",
                           prefix[condition.end():] if condition else prefix)
    if trigger and (condition or (re.fullmatch(STANDALONE_TRIGGER, trigger["verb"])
                                  and re.match(TRIGGER_ACTION, after))):
        return "condition", "move"
    return None


def _role(before, after, aliases, *, continued=False, allow_target=False):
    """Require a local action/threshold; a suggestion elsewhere grants no exemption."""
    condition = CONDITION.match(before)
    if condition:
        subject = _without_subject(before[condition.end():], aliases).strip()
        if re.fullmatch(r"(?:股價|收盤價?|報酬率|下跌|上漲|跌幅|漲幅)"
                        r"(?:為|是|達|跌至|漲至|跌到|漲到|約)?\s*", subject):
            action = "price" if subject.startswith(("股價", "收盤")) else "rate" if subject.startswith("報酬率") else "change"
            return "condition", action
    threshold = _threshold(before, after, aliases)
    if threshold:
        return threshold
    if condition:
        # 假設的買賣仍占用方案的資金或庫存；只沿用局部操作句型，不授權假設帳戶現況。
        before = before[condition.end():]
        continued = True
        allow_target = False
    introduction = INTRO.match(before)
    if not introduction and not continued:
        return None
    prefix = before[introduction.end():] if introduction else before
    prefix = re.sub(r"^\s*(?:[-•·]|\d+[.)])\s*", "", prefix)
    prefix = _without_subject(prefix, aliases).strip()
    if re.search(r"目前|現在|已經|實際|現況|截至", prefix):
        return None
    # A numeric stock qualifier may be before or after the action.
    prefix = re.sub(r"股票|標的|單一持股", "", prefix)
    suffix = _without_subject(after, aliases).strip()
    if re.fullmatch(rf"{MODIFIER}(?:設定)?(?:停損(?:跌幅|幅度)?|停利(?:幅度)?|目標報酬率){MODIFIER}", prefix):
        return "risk", ""
    if re.fullmatch(rf"{MODIFIER}(?:將|把)?(?:停損|停利|目標報酬率)(?:設定|設|控制|調整)(?:在|為|至|到){MODIFIER}", prefix):
        return "risk", ""
    if re.fullmatch(rf"{MODIFIER}設定{MODIFIER}", prefix) and re.match(r"(?:的)?(?:停損|停利)", suffix):
        return "risk", ""
    if re.fullmatch(rf"{MODIFIER}(?:將|把)?{FUNDS}(?:配置)?(?:占比|比例|比重)"
                    rf"(?:(?:調整|提高|降低)(?:至|到)|控制在)?{MODIFIER}", prefix):
        if introduction or allow_target or re.search(r"調整|提高|降低|控制", prefix):
            return "target", ""
        return None
    if re.fullmatch(rf"{MODIFIER}(?:賣出|賣掉|減碼){MODIFIER}", prefix):
        return "sale", "sell"
    if re.fullmatch(rf"{MODIFIER}(?:(?:買入|買進){MODIFIER})?{ACTION}(?:{FUNDS})?{MODIFIER}", prefix):
        if not re.search(FUNDS, prefix + suffix) and not re.match(r"(?:買|給|用於|投入|配置)", suffix):
            # Monetary plans have their unit as the object; percentage plans
            # must additionally identify what is being allocated.
            return "amount", "reserve" if "保留" in prefix else "invest"
        return "allocation", "reserve" if "保留" in prefix else "invest"
    if re.fullmatch(rf"{MODIFIER}(?:將|把)(?:{FUNDS})?{MODIFIER}", prefix) and re.match(
            rf"(?:的)?(?:{FUNDS})?(?:分批)?{ACTION}", suffix):
        return "allocation", "reserve" if "保留" in suffix else "invest"
    return None


def parse_proposals(text, aliases=None):
    aliases = aliases or {}
    proposals = []
    carry = False
    header = False
    previous_boundary = ""
    parent = None
    for offset, clause, boundary in _clauses(text):
        content = re.sub(r"\[S[1-9][0-9]*\]", "", clause).strip()
        if not content:
            previous_boundary = boundary or previous_boundary
            continue
        if re.fullmatch(r"\s*(?:建議|我的建議)(?:以下)?(?:配置|安排)?\s*[:：]\s*", clause):
            header = True
            carry = True
            previous_boundary = boundary
            continue
        listed = bool(re.match(r"\s*(?:[-•·]|\d+[.)])", clause))
        # 建議標題只授權連續清單；新標題、非清單段落或明示現況都必須結束作用域，
        # 否則後面的實際持股占比會被誤當配置目標，跳過來源核對。
        if header and (content.endswith(("：", ":"))
                       or (previous_boundary == "\n" and not listed)
                       or re.match(r"\s*(?:(?:[-•·]|\d+[.)])\s*)?"
                                   r"(?:目前|現在|實際|現況|截至|已經)", clause)):
            header = False
        linked = bool(re.match(r"\s*(?:[-•·]|\d+[.)]|另外|另|再|然後|接著|其中|並)", clause))
        if re.match(r"\s*其中", clause):
            parent = next((index for index in reversed(range(len(proposals)))
                           if proposals[index].action == "invest" and not proposals[index].symbol), None)
        elif INTRO.match(clause) or re.match(r"\s*(?:另外|另|再|然後|接著)", clause) or (previous_boundary == "\n" and not linked):
            parent = None
        values = [match for match in VALUE.finditer(clause)
                  if match["low_unit"] or match["high_unit"] or match["currency_prefix"]]
        previous_end = 0
        listed_target = header and listed
        continuing = listed_target or (carry and (previous_boundary in {",", "，"} or linked))
        for index, match in enumerate(values):
            before = clause[previous_end:match.start()]
            after = clause[match.end():values[index + 1].start() if index + 1 < len(values) else len(clause)]
            if continuing and "、" in before:
                before = before.rsplit("、", 1)[-1]
            role = _role(before, after, aliases, continued=continuing, allow_target=listed_target)
            if not role:
                if re.search(r"目前|現在|實際|現況|截至|已經", before):
                    header = False
                    listed_target = False
                continuing = False
                previous_end = match.end()
                continue
            kind, action = role
            currency = match["currency_prefix"]
            if currency and currency.upper() not in {"NT$", "TWD", "NTD"}:
                raise ValueError("Proposal currency differs from the account currency")
            low_unit = match["low_unit"] or match["high_unit"] or "元"
            high_unit = match["high_unit"] or match["low_unit"] or "元"
            units = {"%": "%", "股": "shares", "張": "shares"}
            if any(re.fullmatch(FOREIGN_CURRENCY, item, re.I) for item in (low_unit, high_unit)):
                raise ValueError("Proposal currency differs from the account currency")
            unit = units.get(low_unit, "TWD")
            if units.get(high_unit, "TWD") != unit:
                raise ValueError("Mixed proposal units")
            scale = {"萬元": 10000, "萬": 10000, "千元": 1000, "千": 1000,
                     "億元": 100000000, "億": 100000000, "張": 1000}
            low = decimal_number(match["low"]) * scale.get(low_unit, 1)
            high = decimal_number(match["high"] or match["low"]) * scale.get(high_unit, 1)
            if kind == "amount" and unit == "%":
                raise ValueError("Percentage allocations require a named cash base")
            minimum = -100 if kind == "condition" and action == "rate" else 0
            if low < minimum or high < low or (unit == "%" and high > 100):
                raise ValueError("Invalid proposal range")
            if kind in {"risk", "target"} and unit != "%":
                raise ValueError("Invalid threshold unit")
            if kind == "condition" and unit not in ({"TWD", "%"} if action == "move"
                                                    else {"TWD" if action == "price" else "%"}):
                raise ValueError("Invalid condition unit")
            if kind == "allocation" and unit == "shares":
                raise ValueError("Share counts cannot describe a cash allocation")
            if kind == "sale" and (unit != "shares" or low != low.to_integral_value() or high != high.to_integral_value()):
                raise ValueError("Invalid sale quantity")
            symbol = _subject(before, after, aliases)
            multiplier = 1
            if re.search(r"每檔|各檔", before):
                named = {symbol for alias, symbol in aliases.items() if re.search(re.escape(alias), before + after, re.I)}
                named.update(re.findall(r"(?<!\d)\d{4,6}(?!\d)", before + after))
                multiplier = len(named)
            component = ""
            if kind == "target":
                component = symbol or ("holdings" if "持股" in before else "cash")
            proposals.append(Proposal(offset + match.start(), offset + match.end(), low, high, unit, kind, action,
                                      symbol, "equity" if "總資產" in before + after else "available_cash",
                                      multiplier, parent if action == "invest" else None, component))
            previous_end = match.end()
            continuing = True
        carry = continuing and bool(values)
        previous_boundary = boundary
    return proposals


def plan_supported(text, sources, aliases=None, *, require_portfolio=False):
    """Check a complete plan once, including allocations across citation units."""
    try:
        proposals = parse_proposals(text, aliases)
        targets = {proposal.component: proposal.high for proposal in proposals if proposal.kind == "target"}
        stock_targets = sum(value for component, value in targets.items() if component not in {"cash", "holdings"})
        if (stock_targets > targets.get("holdings", 100)
                or targets.get("cash", 0) + targets.get("holdings", stock_targets) > 100):
            return False
        actionable = [proposal for proposal in proposals if proposal.kind in {"amount", "allocation", "sale"}]
        portfolios = []
        for source in sources:
            if source.category == "personal":
                payload = json.loads(source.content)
                if "portfolio" in payload:
                    portfolios.append(payload["portfolio"])
        if not actionable:
            return True
        if not portfolios:
            # 帳戶模式由可信任的請求決定；回答改稱「假設」或省略個人引用不能取消資金與庫存檢查。
            return not require_portfolio
        if any(portfolio.get("initialized") is not True for portfolio in portfolios):
            return False
        budget = min(decimal_number(portfolio["available_cash"]) for portfolio in portfolios)
        spent = Decimal(0)
        sold = {}
        breakdowns = {}
        amounts = {}
        for proposal in actionable:
            if proposal.multiplier < 1:
                return False
            if proposal.kind == "sale":
                if not proposal.symbol:
                    return False
                inventories = [next((position for position in portfolio.get("positions", [])
                                    if position["symbol"] == proposal.symbol), None) for portfolio in portfolios]
                if any(position is None for position in inventories):
                    return False
                available = min(decimal_number(position["quantity"]) - decimal_number(position.get("reserved_quantity", 0))
                                for position in inventories)
                sold[proposal.symbol] = sold.get(proposal.symbol, Decimal(0)) + proposal.high
                if sold[proposal.symbol] > available:
                    return False
            elif proposal.unit in {"TWD", "%"}:
                amount = proposal.high
                if proposal.unit == "%":
                    base = budget if proposal.base == "available_cash" else min(decimal_number(portfolio["equity"]) for portfolio in portfolios)
                    amount = base * amount / 100
                amount *= proposal.multiplier
                if proposal.parent is not None:
                    breakdowns[proposal.parent] = breakdowns.get(proposal.parent, Decimal(0)) + amount
                    if breakdowns[proposal.parent] > amounts.get(proposal.parent, 0):
                        return False
                    continue
                amounts[proposals.index(proposal)] = amount
                spent += amount
                if spent > budget:
                    return False
            else:
                # A cash budget cannot establish an affordable share quantity
                # without a separately verified price calculation.
                return False
        return True
    except (ValueError, TypeError, KeyError, AttributeError, ArithmeticError):
        return False
