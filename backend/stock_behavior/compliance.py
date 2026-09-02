from __future__ import annotations

import re
from typing import NamedTuple


class ComplianceHit(NamedTuple):
    rule: str
    severity: str
    snippet: str


_HARD_RULES = (
    ("目標價型-hard", re.compile(r"目標價|上看\s*\d|下看\s*\d|挑戰\s*\d+(\.\d+)?\s*元")),
    ("未來價位型-hard", re.compile(r"(支撐|壓力|防守|買點|賣點)[^。]{0,12}\d+(\.\d+)?\s*(元|塊)")),
    (
        "操作指令-hard",
        # 只攔「對使用者下指令」的語境：建議/可/應/宜等引導詞＋操作動詞。
        # 描述法人或市場行為（外資減碼、技術性停損賣壓、波段減碼格局）屬分析語言，
        # 落 soft 觀測（見 _SOFT_RULES 操作詞-descriptive-soft）。
        # 引導詞的單字型（可/應/宜/設）須排除常見複合詞：可能/可望、反應/因應、便宜、假設/建設。
        re.compile(
            r"空手觀望|建議持有|"
            r"(建議|不妨|逢低|逢高|嚴設"
            r"|(?<![反回因供適對])應"
            r"|(?<![不認許])可(?!能|望|見|謂)"
            r"|(?<![假建增])設定?"
            r"|(?<![便合適權])宜"
            r")[^。]{0,8}"
            r"(買進|賣出|加碼|減碼|進場|出場|停損|停利)"
        ),
    ),
    (
        "前瞻報酬-hard",
        re.compile(
            r"(預期|預估|可望|上看|挑戰|目標|將)[^。]{0,10}"
            r"(上漲|下跌|漲|跌)幅?[^。]{0,6}\d+(\.\d+)?\s*%"
        ),
    ),
    ("承諾詞-hard", re.compile(r"保證|必然|穩賺|絕對(會|能)")),
    (
        "資金配置-hard",
        re.compile(r"(投入|配置|重壓|全押)[^。]{0,10}(資金|部位|持股)|部位[^。]{0,6}(比例|配置)"),
    ),
)

# 前瞻語境詞：與 _HARD_RULES 的「前瞻報酬-hard」互補。hard 規則攔的是
# 預期／預估／可望／上看／挑戰／目標／將 這幾個明確承諾詞；此處補上語氣較弱、
# 但仍指向未來的說法。純歷史陳述（「7/15 上漲 3.07%」）不再命中——key_days
# 的核心就是描述已發生的當日波幅，若一律視為違規會讓每份簡報都被降級。
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
            rf"(?:{_FORWARD_SOFT_MARKERS})[^。]{{0,12}}(?:上漲|下跌|漲|跌)幅?[^。]{{0,6}}\d+(?:\.\d+)?\s*%"
            rf"|\d+(?:\.\d+)?\s*%[^。]{{0,4}}(?:的空間|上檔空間|下檔空間)"
        ),
    ),
)


def scan_compliance_hits(text: str) -> list[ComplianceHit]:
    hits: list[ComplianceHit] = []
    hard_spans: list[tuple[int, int]] = []
    for rule_name, pattern in _HARD_RULES:
        for match in pattern.finditer(text):
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


def scan_compliance(text: str) -> list[str]:
    """相容介面：回傳 hard 與 soft 的格式化命中片段。"""
    return [f"{hit.rule}: {hit.snippet}" for hit in scan_compliance_hits(text)]


def compliance_rules_signature() -> list[str]:
    """規則內容的指紋，供快取鍵使用。

    直接列出實際的 pattern，改了規則就會自動讓舊快照失效，
    不必再維護一個要人工記得 bump 的版本字串。
    """
    return [
        f"{severity}:{name}:{pattern.pattern}"
        for severity, rules in (("hard", _HARD_RULES), ("soft", _SOFT_RULES))
        for name, pattern in rules
    ]
