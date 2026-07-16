from __future__ import annotations

import re
from typing import NamedTuple


COMPLIANCE_POLICY_VERSION = "q7-blacklist-v2"


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
            r"買進|賣出|加碼|減碼|空手觀望|建議持有|停損|停利|"
            r"(建議|可|應|宜|不妨|逢低|逢高)[^。]{0,8}(進場|出場)"
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

_SOFT_RULES = (
    ("進出場-descriptive-soft", re.compile(r"進場|出場")),
    ("歷史報酬-soft", re.compile(r"(漲|跌)幅?\s*\d+(\.\d+)?\s*%")),
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
