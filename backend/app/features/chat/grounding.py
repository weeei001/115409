"""Literal source binding for limited market-cause and price-target claims.

This is a conservative guard for recognized wording, not semantic entailment.
"""
from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation

from app.features.market.company_catalog import company_aliases


REPORT = re.compile(
    r"^(?:(?:據|根據|依據)(?:本篇|該)?(?:報導|新聞|來源)(?:指出|表示)?"
    r"|(?:本篇|該)?(?:報導|新聞|來源)(?:指出|表示|寫道|提及|提到|記載|認為|說明))[,：:]*"
)
TARGET = re.compile(r"(?:目標價(?:位)?|合理價(?:位)?|上看|下看)"
                    r"[^。，,；;\n\d]{0,8}(\d+(?:\.\d+)?)\s*(?:元|塊)")
MOVE = r"(?:上漲|下跌|大漲|大跌|走高|走低|回檔|拉回|回落|反彈|收紅|收黑|走強|走弱|漲|跌)"
MARKET = rf"(?:股價|走勢|行情|漲勢|跌勢|漲幅|跌幅|{MOVE})"
CAUSE = r"(?:因為|由於|主因|原因是|原因為|因(?!此|而|應|素)|反映|帶動|導致|促使|使得|拖累|激勵|利多出盡|獲利了結)"
CURRENT = re.compile(r"今天|今日|昨天|昨日|本週|本月|近期|這波|這次|本次|此波|當前|目前|現在|已經|已反映"
                     r"|\d{4}[-年/]\d{1,2}|\d{1,2}月\d{1,2}日")
UNCONFIRMED = re.compile(
    r"(?:但|然而|不過)?(?:目前|現有|本輪)?(?:(?:行情)?(?:資料|來源|證據|報導))?(?:仍|尚)?"
    r"(?:不足以|無法|不能|尚無法|未能)(?:判斷|確認|證實|說明)"
    r"(?:本次|這次|今日)?(?:股價)?(?:上漲|下跌|漲跌|回檔)?(?:的)?(?:原因|主因)"
)
RISK_METRIC_REASON = re.compile(
    r"(?:因為|由於|因)(?:其|該股(?:的)?)?(?:年化波動(?:度|率)|最大回撤(?:幅度)?)"
    r"(?:為|達|高達|僅)?(?:-?\d+(?:\.\d+)?%|高於其餘\d+檔)"
)
ENTRY_CONDITION = re.compile(r"(?:若|如果|並確認|確認|等待).{0,40}(?:才|再)(?:進場|買進|加碼)$")
RISK_ACTION = re.compile(r"(?:必須|應|需要|建議|宜)(?:嚴格)?(?:設定|設置)(?:停損(?:條件|點)?|部位上限)")


def _clean(text):
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\[S[1-9][0-9]*\]", "", text, flags=re.I)
    text = re.sub(r"[*_`]", "", text)
    text = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", text)
    return re.sub(r"\s+", "", text)


def _statement(text):
    return text.strip("。.!?！？\"「」『』“” ")


def _sentences(text):
    # 逗號、分號與換行可能承接否定或條件，不能切掉後只核對有利的片段。
    for part in re.split(r"[。!?！？]+|(?<!\d)\.(?!\d)", _clean(text)):
        part = _statement(part)
        if part:
            yield part


def _reported_body(text, *, quoted=False):
    text = re.sub(r"^(?:[-•·]|\d+[.)])", "", _clean(text))
    match = REPORT.match(text)
    if not match:
        return None
    body = text[match.end():]
    if quoted and not body.startswith(("「", "『", '"', "“")):
        return None
    return _statement(body)


def _literal_report_supported(text, sources, *, quoted=False):
    body = _reported_body(text, quoted=quoted)
    if not body:
        return False
    # 只使用原始新聞文字；impact_context 等模型摘要不能替另一個模型提供事實保證。
    return any(source.category == "news" and body in set(_sentences(source.content)) for source in sources)


def target_quote_supported(sentence, number, sources, catalog=None):
    """Keep the target, company and speaker in the same visible source sentence."""
    body = _reported_body(sentence)
    if not body:
        return False
    try:
        value = Decimal(str(number).replace(",", ""))
        if not value.is_finite() or not any(Decimal(match[1]) == value for match in TARGET.finditer(body)):
            return False
    except InvalidOperation:
        return False
    # 比對完整原句同時保留股票、說話者、否定與條件；不能借用 EPS 或另一家公司相同的數字。
    return _literal_report_supported(sentence, sources)


def _has_subject(text, sources, catalog):
    for symbol, company in (catalog or {}).items():
        if re.search(rf"(?<!\d){re.escape(symbol)}(?!\d)", text):
            return True
        if any(alias in text for alias in company_aliases(symbol, company)):
            return True
    return any(source.stock_id and re.search(rf"(?<!\d){re.escape(source.stock_id)}(?!\d)", text)
               for source in sources)


def _market_cause(sentence, sources, catalog):
    # 資料不足的明確說明可以保留；同句其他原因敘述仍須各自核對，不能靠一句提醒放行。
    clauses = [part for part in re.split(r"[,;；]", sentence) if not UNCONFIRMED.fullmatch(part)]
    for index in range(1, len(clauses) - 1):
        if (ENTRY_CONDITION.search(clauses[index - 1])
                and RISK_METRIC_REASON.fullmatch(clauses[index])
                and RISK_ACTION.fullmatch(clauses[index + 1])):
            # This local reason explains the required risk control after a
            # conditional entry, not why a market move occurred. Keep the
            # metric text and all other causes; numeric/ranking checks still
            # validate the original answer independently.
            clauses[index] = re.sub(r"^(?:因為|由於|因)", "", clauses[index])
    text = ",".join(clauses)
    # 「可考慮部分獲利了結」是操作建議，不是宣稱已發生獲利了結賣壓。
    text = re.sub(r"(?:可(?:以)?(?:考慮)?|建議|不妨|考慮)(?:先|部分|分批)?獲利了結", "", text)
    if not re.search(MARKET, text) or not re.search(CAUSE, text):
        return False
    if not (_has_subject(text, sources, catalog) or CURRENT.search(text)):
        return False
    if re.search(r"利多出盡|獲利了結|提前反映", text):
        return True
    if re.search(rf"{MARKET}.*{CAUSE}", text):
        return True
    if re.search(rf"(?:帶動|導致|促使|使得|拖累|激勵|反映).*{MOVE}", text):
        return True
    # 前因後果需出現結果連接詞、逗號後的行情，或同一子句的個股與「因」。
    if re.search(rf"(?:因為|由於|因(?!應|素)).+(?:而|因此|所以|,).*(?:{MOVE})", text):
        return True
    return any(_has_subject(clause, sources, catalog)
               and re.search(rf".+(?:因為|由於|因(?!應|素)).+{MOVE}", clause) for clause in clauses)


def unsupported_market_cause(text, sources, catalog=None):
    """Return the first unsupported recognized market-cause statement, if any."""
    for sentence in _sentences(text):
        if _market_cause(sentence, sources, catalog) and not _literal_report_supported(sentence, sources, quoted=True):
            return sentence
    return None
