from __future__ import annotations

import re
from typing import NamedTuple

class ComplianceHit(NamedTuple):
    rule: str
    severity: str
    snippet: str

_HARD_RULES = (
    ("目標價型-hard", re.compile(r"目標價|上看\s*\d|下看\s*\d|挑戰\s*\d[\d,.]*\s*元")),
    ("未來價位型-hard", re.compile(
        r"(支撐|壓力|防守|買點|賣點)[^。，,；;\r\n\d]{0,12}[\d,]+(?:\.\d+)?\s*(元|塊)")),
    (
        "操作指令-hard",
        re.compile(
            r"空手觀望|建議持有|"
            r"(建議|不妨|逢低|逢高|嚴設"
            r"|(?<![反回因供適對相效呼響順感])應"
            # 「可說是大舉買進」 describes flows; 「可以買進」 remains an instruction.
            r"|(?<![不認許])可(?!能|望|見|謂|說)"
            r"|(?<![假建增])設定?"
            r"|(?<![便合適權])宜"
            r")[^。]{0,8}"
            r"(買進|賣出|加碼|減碼|進場|出場|停損|停利)"
        ),
    ),
    (
        "前瞻報酬-hard",
        re.compile(
            r"(預期|預估|可望|上看|挑戰|目標|將)[^。，,；;\r\n]{0,10}"
            r"(上漲|下跌|漲|跌)幅?[^。，,；;\r\n]{0,6}\d+(\.\d+)?\s*%"
        ),
    ),
    ("承諾詞-hard", re.compile(
        r"(?:不能|無法|不是|並非)不保證|"
        # 「保證金」 is margin-trading vocabulary and 「不必然」 is a hedge; neither is a promise.
        # 「履約保證」「背書保證」 are financial-statement terms, not promises to the reader.
        r"(?<!不)(?<!未)(?<!非)(?<!無法)(?<!不能)(?<!未能)(?<!不是)"
        r"(?<!履約)(?<!背書)(?<!擔保)(?<!銀行)(?<!信用)保證(?!金|責任|函|書|人|款)"
        r"|(?<!不)(?<!未)(?<!非)(?<!無)(?<!沒有)必然|穩賺|絕對(會|能)")),
    (
        "資金配置-hard",
        # Advice to the reader, not a company's capital spending such as 「投入千億資金建廠」.
        re.compile(
            r"(?:建議|不妨|宜|(?<![反回因供適對相效呼響順感])應|(?<![不認許])可(?!能|望|見|謂|說)|適合|酌量|分批)"
            r"[^。，,；;]{0,6}(?:投入|配置|布局|佈局|加碼)[^。]{0,10}(?:資金|部位|持股|資產)"
            r"|(?:投入|配置)\s*(?:\d+(?:\.\d+)?\s*(?:%|成)|全部|所有|全數|大部分|一半|半數)[^。]{0,6}(?:資金|部位|持股|資產)"
            r"|重壓|全押|梭哈|部位[^。]{0,6}(?:比例|配置)"),
    ),
    # A past move such as 「上攻至年線」 is description; only a forward one is a view.
    ("投資觀點-hard", re.compile(
        r"看好|看壞"
        r"|(?:可|將|有望|可望|仍有|有機會|進一步|若)[^。，,；;\r\n]{0,6}(?:上攻|下殺|下探)")),
)

# Opinion words inside 「」 are quoted source text, not the brief's own view.
_QUOTE_EXEMPT_RULES = frozenset({"投資觀點-hard"})
_QUOTED_SOURCE = re.compile(r"「[^「」]*」")
# A named speaker in the same clause; vague subjects such as 「市場」 can launder the brief's own view.
_ATTRIBUTED_SPEAKER = re.compile(
    r"法人|外資|投信|自營商|分析師|券商|投顧|研調|研究機構|董事長|總經理|執行長|CEO|管理層|經營層"
    r"|報導|媒體|新聞|指出|表示|認為|提到", re.IGNORECASE)
# 「本簡報不提供目標價」 limits the brief; it states no target.
_NEGATED_SCOPE = re.compile(r"(?:不|未|無|沒有|並未|不會)(?:提供|給出|包含|包括|含|做|作|涉及|列出|構成)[^。；;，,\r\n]{0,12}")

_TARGET_PRICE_SOURCE_NOTE = re.compile(
    r"新聞中提及的目標價為分析師觀點，非事實保證。?"
    r"|"
    r"(?:部分)?新聞(?:為|僅為|是)媒體轉述(?:之|的)?目標價[，,](?:並)?非(?:正式)?公司公告[。]?"
    r"|(?:部分)?新聞提及(?:之|的)?目標價(?:為|僅為|是)分析師預測[，,](?:並)?非確定事實[。]?"
)

_FORWARD_SOFT_MARKERS = (
    r"未來|後續|接下來|有機會|預料|看好|推估|評估|下一階段|中期內|短線內|波段內"
)

_SOFT_RULES = (
    (
        "操作詞-descriptive-soft",
        re.compile(r"買進|賣出|加碼|減碼|進場|出場|停損|停利"),
    ),
    (
        "前瞻報酬-soft",
        re.compile(
            rf"(?:{_FORWARD_SOFT_MARKERS})[^。，,；;\r\n]{{0,12}}(?:上漲|下跌|漲|跌)幅?[^。，,；;\r\n]{{0,6}}\d+(?:\.\d+)?\s*%"
            rf"|\d+(?:\.\d+)?\s*%[^。，,；;\r\n]{{0,4}}(?:的空間|上檔空間|下檔空間)"
        ),
    ),
)

def _blank(match: re.Match) -> str:
    return " " * len(match.group(0))


def scan_compliance_hits(text: str, *, grounded_condition: bool = False,
                         cites_news: bool = False) -> list[ComplianceHit]:
    """`cites_news`: the item cites news, so a named speaker's view is a report, not the brief's view."""
    text = _TARGET_PRICE_SOURCE_NOTE.sub("", text)
    # Blanked rather than removed, so match spans still index the original snippet.
    scanned = _NEGATED_SCOPE.sub(_blank, text)
    unquoted = _QUOTED_SOURCE.sub(_blank, scanned)
    hits: list[ComplianceHit] = []
    hard_spans: list[tuple[int, int]] = []
    for rule_name, pattern in _HARD_RULES:
        for match in pattern.finditer(unquoted if rule_name in _QUOTE_EXEMPT_RULES else scanned):
            if (grounded_condition and rule_name == "未來價位型-hard"
                    and match.group(1) in {"支撐", "壓力", "防守"}
                    and not re.search(r"買點|賣點", match.group(0))):
                continue
            if rule_name == "投資觀點-hard" and cites_news:
                clause = re.split(r"[。；;\r\n]", text[:match.start()])[-1]
                if _ATTRIBUTED_SPEAKER.search(clause):
                    hits.append(ComplianceHit("投資觀點-attributed-soft", "soft",
                                              text[max(0, match.start() - 20): match.end() + 20]))
                    continue
            hard_spans.append(match.span())
            snippet = text[max(0, match.start() - 20) : match.end() + 20]
            hits.append(ComplianceHit(rule_name, "hard", snippet))

    for rule_name, pattern in _SOFT_RULES:
        for match in pattern.finditer(text):
            start, end = match.span()
            if any(start < hard_end and hard_start < end for hard_start, hard_end in hard_spans):
                continue
            snippet = text[max(0, start - 20) : end + 20]
            hits.append(ComplianceHit(rule_name, "soft", snippet))
    return hits

def compliance_rules_signature() -> list[str]:
    return [f"source-note:{_TARGET_PRICE_SOURCE_NOTE.pattern}", f"negated-scope:{_NEGATED_SCOPE.pattern}",
            f"attributed-speaker:{_ATTRIBUTED_SPEAKER.pattern}"] + [
        f"{severity}:{name}:{pattern.pattern}"
        for severity, rules in (("hard", _HARD_RULES), ("soft", _SOFT_RULES))
        for name, pattern in rules
    ]
