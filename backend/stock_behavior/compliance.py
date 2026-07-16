from __future__ import annotations

import re


COMPLIANCE_POLICY_VERSION = "q7-blacklist-v1"

_COMPLIANCE_RULES = (
    ("操作指令詞", re.compile(r"買進|賣出|加碼|減碼|進場|出場|停損|停利|建議持有|空手觀望")),
    ("承諾詞", re.compile(r"保證|必然|穩賺|絕對(會|能)")),
    ("目標價型", re.compile(r"目標價|上看\s*\d|下看\s*\d|挑戰\s*\d+(\.\d+)?\s*元")),
    ("未來價位型", re.compile(r"(支撐|壓力|防守|買點|賣點)[^。]{0,12}\d+(\.\d+)?\s*(元|塊)")),
    ("報酬型", re.compile(r"(漲|跌)幅?\s*(約|可達|上看)?\s*\d+(\.\d+)?\s*%")),
)


def scan_compliance(text: str) -> list[str]:
    """回傳命中的違規描述清單（Wave 1 觀測用，不阻擋）。"""
    violations: list[str] = []
    for rule_name, pattern in _COMPLIANCE_RULES:
        for match in pattern.finditer(text):
            snippet = text[max(0, match.start() - 20) : match.end() + 20]
            violations.append(f"{rule_name}: {snippet}")
    return violations
