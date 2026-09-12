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
    return [f"{hit.rule}: {hit.snippet}" for hit in scan_compliance_hits(text)]

def compliance_rules_signature() -> list[str]:
    return [
        f"{severity}:{name}:{pattern.pattern}"
        for severity, rules in (("hard", _HARD_RULES), ("soft", _SOFT_RULES))
        for name, pattern in rules
    ]
