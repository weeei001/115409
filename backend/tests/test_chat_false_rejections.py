"""Answers that are supported by their citations must not trigger a repair retry.

Each accepted case was rejected before and made the chat show
「回答未通過核對，正在依據來源重新產生…」; each rejected case keeps a guard.
"""
import json

import pytest

from app.features.chat.answer_validation import (AnswerValidationError, CitationValidationError,
                                                 ComplianceValidationError, NumericValidationError, _checked_answer)
from app.features.chat.schemas import SourceChunk

COLUMNS = ["date", "close", "chg_pct", "vol_vs_ma5_pct", "kd_k9", "kd_d9"]
CATALOG = {"2330": {"name": "台積電"}, "2317": {"name": "鴻海"}}
NEWS = ("台積電法說會預期第四季營收將季增 10%，AI 相關營收占比約 60%。台積電外資持股比例 72.3%，"
        "股東權益報酬率（ROE）30%。截至2026-10-06，報導指出台積電今年以來股價上漲 35%。")


def source(citation_id, category, content, stock_id="2330"):
    return SourceChunk(citation_id=citation_id, title="t", source="s", source_name="n", pub_time="2026-10-06",
                       url="", stock_id=stock_id, score=1, category=category,
                       content=content if isinstance(content, str) else json.dumps(content, ensure_ascii=False))


SOURCES = [
    source("S1", "market_technical", {"columns": COLUMNS, "rows": [
        ["2026-10-03", 1050.0, -0.47, -12, 62.3, 60.1],
        ["2026-10-06", 1085.0, 3.33, 21, 78.9, 70.5]]}),
    source("S2", "institutional", {"columns": ["date", "foreign_net"], "rows": [["2026-10-06", 5234567]]}),
    source("S3", "fundamental", {"items": [
        {"field": "gross_margin_pct", "period": "2026Q2", "value": 58.6},
        {"field": "revenue_monthly", "period": "2026-09", "value": 251873456000},
        {"field": "dividend_yield", "value": 1.47, "date": "2026-10-06"}]}),
    source("S4", "comparison", {
        "requested_start_date": "2026-09-06", "requested_end_date": "2026-10-06",
        "common_start_date": "2026-09-08", "common_end_date": "2026-10-06",
        "stocks": [{"symbol": "2330", "interval_return_pct": 5.234567}]}, stock_id=""),
    source("S5", "news", NEWS),
]


def check(answer):
    return _checked_answer(answer, {"finish_reason": "stop"}, SOURCES, company_catalog=CATALOG)


@pytest.mark.parametrize("answer", [
    # Comparison symbols are not HTML.
    "台積電 K 值 78.9 高於 D 值 70.5，前一日 K<D[S1]。",
    "收盤價 1,085 元，若跌回 < MA20 需留意[S1]。",
    # Short uncited headings and closing reminders carry no claim.
    "**技術面**\n\n台積電 2026-10-06 收盤價 1,085 元[S1]。",
    "**台積電（2330）**\n\n收盤價 1,085 元[S1]。",
    "結論：\n\n台積電收盤價 1,085 元[S1]。",
    "台積電收盤價 1,085 元[S1]。\n\n以上資訊僅供參考。",
    # The prompt labels evidence "[片段N] [SN]"; ranges name consecutive sources.
    "台積電收盤價 1,085 元[片段1]。",
    "台積電收盤價 1,085 元[S1-S3]。",
    "台積電收盤價 1,085 元（S1）。",
    # Rounded to the written precision.
    "台積電 9 月營收約 2,518.7 億元[S3]。",
    "台積電 2026-10-06 外資買賣超 5,235 張[S2]。",
    "台積電 2026Q2 毛利率約 59%[S3]。",
    "台積電殖利率約 1.5%[S3]。",
    # A multi-day move is an interval return; a compared date is not the observation date.
    "台積電近一個月漲幅 5.23%[S4]。",
    "台積電 2026-10-06 收盤 1,085 元，較 2026-10-03 的 1,050 元上漲 3.33%[S1]。",
    # Attributed quotes of cited news.
    "法說會預期第四季營收將季增 10%[S5]。",
    "公司表示 AI 相關營收占比約 60%[S5]。",
    "台積電外資持股比例 72.3%[S5]。",
    "台積電股東權益報酬率（ROE）30%[S5]。",
    "截至 2026-10-06，報導指出台積電今年以來股價上漲 35%[S5]。",
    # 「一定程度」 is extent, not a guarantee.
    "台積電當日上漲3.33%，短線仍有一定程度的風險需評估[S1]。",
])
def test_supported_answers_pass_without_repair(answer):
    assert "\n\n【引用來源】\n- [S" in check(answer)


def test_citation_variants_are_normalized_before_publishing():
    assert check("台積電收盤價 1,085 元[片段1]。").startswith("台積電收盤價 1,085 元[S1]。")
    assert check("台積電收盤價 1,085 元[S1-S3]。").startswith("台積電收盤價 1,085 元[S1][S2][S3]。")


@pytest.mark.parametrize("answer,published", [
    ("台積電收盤價 1,085 元<br>短線偏強[S1]。", "台積電收盤價 1,085 元\n短線偏強[S1]。"),
    ("<b>台積電</b>收盤價 1,085 元[S1]。", "台積電收盤價 1,085 元[S1]。"),
    ("<script>alert(1)</script>台積電收盤價 1,085 元[S1]。", "台積電收盤價 1,085 元[S1]。"),
    ("台積電收盤價 1,085 元[S1]。詳見 https://made-up.test/x", "台積電收盤價 1,085 元[S1]。詳見"),
    ("台積電收盤價 1,085 元[S1][3]。", "台積電收盤價 1,085 元[S1]。"),
    ("[注意] 台積電收盤價 1,085 元[S1]。", "【注意】 台積電收盤價 1,085 元[S1]。"),
    ("台積電收盤價 1,085 元[S1]。\n\n【引用來源】\n- [S1] 捏造標題", "台積電收盤價 1,085 元[S1]。"),
])
def test_removable_formatting_is_repaired_before_checking(answer, published):
    assert check(answer).startswith(published + "\n\n【引用來源】\n- [S1] t")


@pytest.mark.parametrize("answer", [
    # An uncited closing line may summarize or admit uncertainty without new facts.
    "台積電收盤價 1,085 元[S1]。\n\n綜合來看，短線方向仍不明確。",
    "台積電收盤價 1,085 元[S1]。\n\n目前資料不足以判斷漲跌方向。",
    # A listed stock code in a heading names the subject.
    "### 台積電 2330\n\n收盤價 1,085 元[S1]。",
    # A conditional buy/sell view is allowed by the answer prompt; only promises and unsourced targets are not.
    "台積電收盤價 1,085 元，若站穩可考慮分批買進[S1]。",
])
def test_summaries_headings_and_conditional_views_pass(answer):
    assert "\n\n【引用來源】\n- [S" in check(answer)


def test_attributed_target_price_from_cited_news_passes():
    news = source("S6", "news", "外資券商給予台積電目標價 1,500 元。")
    answer = "報導指出，外資券商給予台積電目標價 1,500 元[S6]。"
    assert _checked_answer(answer, {"finish_reason": "stop"}, SOURCES + [news], company_catalog=CATALOG).startswith(answer)


@pytest.mark.parametrize("answer", [
    "台積電目標價 1,500 元[S5]。",
    "若突破 1,100 元，上看 1,200 元[S1]。",
    "台積電收盤價 1,085 元，長線穩賺[S1]。",
    "台積電收盤價 1,085 元，明年一定會上漲[S1]。",
])
def test_promises_and_unsourced_targets_are_rejected(answer):
    with pytest.raises(ComplianceValidationError):
        check(answer)


def test_negated_promise_passes():
    assert check("台積電收盤價 1,085 元，但不一定會上漲[S1]。").startswith("台積電收盤價 1,085 元，但不一定會上漲[S1]。")


@pytest.mark.parametrize("answer", [
    "台積電收盤價 1,085 元[S1-S50]。",
    "台積電收盤價 1,085 元[S1]。\n\n綜合來看，短線偏強。",
    "### 營收 2518 億\n\n收盤價 1,085 元[S1]。",
    "**建議買進台積電**\n\n收盤價 1,085 元[S1]。",
    "台積電收盤價 1,085 元[S1]。\n\n建議買進台積電，僅供參考。",
    "台積電收盤價 1,085 元[S1]。\n\n台積電短線偏強。",
])
def test_uncited_or_unsafe_text_is_still_rejected(answer):
    with pytest.raises(CitationValidationError):
        check(answer)


@pytest.mark.parametrize("answer", [
    # Rounding coarser than the written precision, or a different value.
    "台積電 9 月營收約 2,500 億元[S3]。",
    "台積電 9 月營收約 3 千億元[S3]。",
    "台積電 2026Q2 毛利率約 60%[S3]。",
    "台積電 2026-10-06 外資買賣超 5,300 張[S2]。",
    # An undated whole percent could match any one of many daily changes.
    "台積電上漲 3%[S1]。",
    # Comparison metrics keep at least two decimals.
    "台積電區間報酬率 5.2%[S4]。",
    # Forecasts need both a cited news number and a speaker.
    "未來營收可望季增 10%[S5]。",
    "預期報酬率 10%[S5]。",
    # News numbers belong to the stock the news is about.
    "鴻海外資持股比例 72.3%[S5]。",
    "台積電外資持股比例 75%[S5]。",
])
def test_unsupported_numbers_are_still_rejected(answer):
    with pytest.raises(NumericValidationError):
        check(answer)


def test_citation_failure_names_the_paragraph_for_the_retry():
    with pytest.raises(AnswerValidationError) as raised:
        check("台積電收盤價 1,085 元[S1]。\n\n台積電短線偏強。")
    assert "台積電短線偏強" in raised.value.hint
    assert "台積電短線偏強" not in str(raised.value.detail)
