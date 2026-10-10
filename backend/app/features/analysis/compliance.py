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
)

# 這些用語可能涉及建議；命中詞彙無法確認說話者的意圖。
_SEMANTIC_RULES = frozenset({"操作指令-hard", "承諾詞-hard", "資金配置-hard", "前瞻報酬-hard"})
_QUOTED_SOURCE = re.compile(r"「[^「」]*」")
# 出現轉述主體時，語意仍不確定；這項判斷不會核實來源歸屬或引文。
_REPORTED_SUBJECT = re.compile(
    r"(?:法人|外資|投信|自營商|分析師|券商|投顧|研調|研究機構|董事長|總經理|執行長|CEO|管理層|經營層|公司)"
    r"(?:\s*(?:指出|表示|認為|提到|預期|估計|稱|說))?\s*$", re.IGNORECASE)
_CLAUSE_BOUNDARY = re.compile(r"[。；;，,：:\r\n]|但是|然而|不過|而是|反而|但|卻")
# 否定須緊接相關述詞；子句其他位置的字元（例如「未來」的「未」）不算否定。
_NEGATED_PREDICATE = re.compile(
    r"(?:不|未|非|無|勿|不會|不能|無法|並非|不是|並未|尚未|未能|避免|禁止)"
    r"(?:一定|真的|必定|要|再|應|會|能|是|有)?\s*$")
_NEGATED_EXISTENCE = re.compile(r"(?:沒有|不存在)[^。；;，,：:\r\n]{0,8}$")
_ADVICE_ACTION = re.compile(
    r"買進|賣出|加碼|減碼|進場|出場|停損|停利|投入|配置|布局|佈局|重壓|全押|梭哈|上漲|下跌|漲|跌")
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
    ("投資觀點-semantic-soft", re.compile(
        r"看好|看壞"
        r"|(?:可|將|有望|可望|仍有|有機會|進一步|若)[^。，,；;\r\n]{0,6}(?:上攻|下殺|下探)")),
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


def _is_negated_candidate(prefix: str, candidate: str) -> bool:
    if _NEGATED_PREDICATE.search(prefix) or _NEGATED_EXISTENCE.search(prefix):
        return True
    # 明確的雙重否定仍屬肯定保證。
    if re.fullmatch(r"(?:不能|無法|不是|並非)不保證", candidate):
        return False
    return any(_NEGATED_PREDICATE.search(candidate[:action.start()])
               for action in _ADVICE_ACTION.finditer(candidate))


def scan_compliance_hits(text: str, *, grounded_condition: bool = False) -> list[ComplianceHit]:
    """語意不確定時只留下診斷；正規表示式無法核實說話者、引文或主張。"""
    text = _TARGET_PRICE_SOURCE_NOTE.sub("", text)
    # Blanked rather than removed, so match spans still index the original snippet.
    scanned = _NEGATED_SCOPE.sub(_blank, text)
    quoted_spans = [match.span() for match in _QUOTED_SOURCE.finditer(scanned)]
    hits: list[ComplianceHit] = []
    classified_spans: list[tuple[int, int]] = []
    for rule_name, pattern in _HARD_RULES:
        for match in pattern.finditer(scanned):
            if (grounded_condition and rule_name == "未來價位型-hard"
                    and match.group(1) in {"支撐", "壓力", "防守"}
                    and not re.search(r"買點|賣點", match.group(0))):
                continue
            prefix = _CLAUSE_BOUNDARY.split(scanned[:match.start()])[-1]
            snippet = text[max(0, match.start() - 20) : match.end() + 20]
            classified_spans.append(match.span())
            if rule_name in _SEMANTIC_RULES and (
                _is_negated_candidate(prefix, match.group(0))
                or _REPORTED_SUBJECT.search(prefix)
                or any(start <= match.start() < end for start, end in quoted_spans)
            ):
                hits.append(ComplianceHit(rule_name.removesuffix("-hard") + "-semantic-soft", "soft", snippet))
                continue
            hits.append(ComplianceHit(rule_name, "hard", snippet))

    for rule_name, pattern in _SOFT_RULES:
        for match in pattern.finditer(text):
            start, end = match.span()
            if any(start < classified_end and classified_start < end
                   for classified_start, classified_end in classified_spans):
                continue
            snippet = text[max(0, start - 20) : end + 20]
            hits.append(ComplianceHit(rule_name, "soft", snippet))
    return hits

def compliance_rules_signature() -> list[str]:
    return [f"source-note:{_TARGET_PRICE_SOURCE_NOTE.pattern}", f"negated-scope:{_NEGATED_SCOPE.pattern}",
            f"reported-subject:{_REPORTED_SUBJECT.pattern}",
            f"negated-predicate:{_NEGATED_PREDICATE.pattern}",
            f"negated-existence:{_NEGATED_EXISTENCE.pattern}",
            f"advice-action:{_ADVICE_ACTION.pattern}",
            f"clause-boundary:{_CLAUSE_BOUNDARY.pattern}",
            f"quoted-source:{_QUOTED_SOURCE.pattern}",
            f"semantic-rules:{','.join(sorted(_SEMANTIC_RULES))}"] + [
        f"{severity}:{name}:{pattern.pattern}"
        for severity, rules in (("hard", _HARD_RULES), ("soft", _SOFT_RULES))
        for name, pattern in rules
    ]
