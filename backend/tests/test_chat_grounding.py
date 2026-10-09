"""Bind recognized causes and price targets to complete attributed news statements."""
import pytest

from app.features.chat.grounding import target_quote_supported, unsupported_market_cause
from app.features.chat.answer_validation import GroundingValidationError, _checked_answer
from app.features.chat.schemas import SourceChunk


CATALOG = {"2330": {"name": "台積電"}, "2317": {"name": "鴻海"}}


def source(text, *, category="news", citation_id="S1", **extra):
    return SourceChunk(title="來源", source="test", source_name="Test", pub_time="", url="",
                       stock_id="2330", category=category, citation_id=citation_id, score=1,
                       content=text, **extra)


@pytest.mark.parametrize("answer", [
    "台積電因AI需求強勁而上漲2%。",
    "因AI需求強勁，台積電今日上漲2%。",
    "台積電上漲2%，主因是AI需求強勁。",
    "台積電可能因AI需求強勁上漲2%。",
    "台積電今日股價反映AI需求強勁。",
    "一定程度反映 AI 需求，台積電當日上漲 3.33%[S1]。",
    "台積電下跌2%，是利多出盡。",
    "台積電下跌2%，可能是獲利了結。",
    "AI需求強勁帶動台積電漲2%。",
])
def test_observed_market_causes_cannot_be_inferred_from_price_data_alone(answer):
    market = source('{"columns":["date","close","chg_pct"],"rows":[["2026-10-02",100,2]]}',
                    category="market_technical")
    assert unsupported_market_cause(answer, [market], CATALOG) is not None


@pytest.mark.parametrize("answer", [
    "成交量可能反映市場參與程度。",
    "一般而言，需求增加可能帶動價格上漲。",
    "因為KD是動能指標，台積電收盤價100元。",
    "優先研究台積電，因為台積電區間漲幅4.21%。",
    "台積電上漲2%，因此可再觀察量能。",
    "若台積電漲超過10%，可考慮部分獲利了結。",
    "台積電上漲2%，但現有資料無法確認主因。",
    "台積電上漲2%，資料不足，無法確認主因。",
    "來源無法確認主因。",
])
def test_general_concepts_conditions_and_explicit_uncertainty_remain_available(answer):
    assert unsupported_market_cause(answer, [], CATALOG) is None


def test_an_attributed_complete_cause_quote_is_supported():
    statement = "台積電上漲2%，報導認為主因是AI需求增加"
    news = source(statement + "。")
    answer = f"來源指出：「{statement}。」[S1]"
    assert unsupported_market_cause(answer, [news], CATALOG) is None


def test_matching_words_without_report_attribution_are_not_a_verified_cause():
    statement = "台積電因AI需求增加而上漲2%"
    assert unsupported_market_cause(statement + "。", [source(statement + "。")], CATALOG) is not None


@pytest.mark.parametrize("original", [
    "沒有證據顯示台積電因AI需求增加而上漲2%。",
    "報導否認台積電因AI需求增加而上漲2%。",
    "沒有證據顯示\n台積電因AI需求增加而上漲2%。",
    "若AI需求增加，台積電可能因此上漲2%，但目前尚未發生。",
])
def test_cause_quotes_cannot_drop_negation_or_qualifying_context(original):
    answer = "報導指出：「台積電因AI需求增加而上漲2%。」"
    assert unsupported_market_cause(answer, [source(original)], CATALOG) is not None


def test_a_disclaimer_cannot_exempt_an_earlier_asserted_cause():
    answer = "台積電上漲2%，主因是AI需求增加，但現有資料無法確認主因。"
    assert unsupported_market_cause(answer, [], CATALOG) is not None


def test_cause_support_does_not_come_from_a_generated_impact_summary():
    statement = "台積電因AI需求增加而上漲2%"
    news = source("台積電公布財報。", impact_context=[{"summary": statement}])
    assert unsupported_market_cause(f"來源指出：「{statement}。」", [news], CATALOG) is not None


@pytest.mark.parametrize("category", ["knowledge", "market_technical"])
def test_non_news_source_categories_cannot_authorize_an_observed_market_cause(category):
    statement = "台積電因AI需求增加而上漲2%"
    assert unsupported_market_cause(f"來源指出：「{statement}。」",
                                    [source(statement + "。", category=category)], CATALOG) is not None


def test_target_quote_preserves_the_original_positive_case_and_number_formatting():
    news = source("外資券商給予台積電目標價 1,500 元。")
    assert target_quote_supported("報導指出，外資券商給予台積電目標價 1,500 元", "1500", [news], CATALOG)
    assert target_quote_supported("來源指出：「外資券商給予台積電目標價1500元。」", "1500", [news], CATALOG)


@pytest.mark.parametrize("original,answer", [
    ("台積電EPS為1500元。", "報導指出，台積電目標價1500元。"),
    ("外資券商給予鴻海目標價1500元。", "報導指出，外資券商給予台積電目標價1500元。"),
    ("外資券商給予台積電目標價1500元。", "報導指出，董事長給予台積電目標價1500元。"),
    ("外資券商否認給予台積電目標價1500元。", "報導指出，外資券商給予台積電目標價1500元。"),
    ("外資券商給予台積電目標價1500元，但僅適用於樂觀情境。", "報導指出，外資券商給予台積電目標價1500元。"),
])
def test_target_quotes_cannot_borrow_another_metric_company_speaker_or_qualifier(original, answer):
    assert not target_quote_supported(answer, "1500", [source(original)], CATALOG)


def test_a_target_statement_keeps_a_condition_after_the_price():
    statement = "外資券商給予台積電目標價1500元，但僅適用於樂觀情境"
    assert target_quote_supported(f"報導指出：「{statement}。」", "1500", [source(statement + "。")], CATALOG)


def test_target_number_and_statement_must_be_supported_by_one_news_source():
    news = [source("外資券商給予台積電目標價1400元。"),
            source("台積電EPS為1500元。", citation_id="S2")]
    assert not target_quote_supported("報導指出，外資券商給予台積電目標價1500元。", "1500", news, CATALOG)


def test_the_requested_number_must_itself_be_a_target_in_the_quoted_statement():
    statement = "外資券商預估台積電EPS150元，給予目標價1500元"
    assert not target_quote_supported("報導指出，" + statement, "150", [source(statement + "。")], CATALOG)


def test_a_literal_negated_target_can_be_reported_without_turning_it_into_a_forecast():
    statement = "外資券商否認給予台積電目標價1500元"
    assert target_quote_supported("報導指出，" + statement, "1500", [source(statement + "。")], CATALOG)


def test_answer_gate_rejects_a_cause_even_when_all_observed_numbers_match():
    market = source('{"columns":["date","close","chg_pct"],"rows":[["2026-10-02",100,2]]}',
                    category="market_technical")
    with pytest.raises(GroundingValidationError):
        _checked_answer("因公司取得大單，2330上漲2%。[S1]", {"finish_reason": "stop"},
                        [market], company_catalog=CATALOG)


def test_answer_gate_keeps_cause_support_local_to_its_citation():
    statement = "台積電因AI需求增加而上漲2%"
    market = source('{"columns":["date","chg_pct"],"rows":[["2026-10-02",2]]}',
                    category="market_technical")
    news = source(statement + "。", citation_id="S2")
    with pytest.raises(GroundingValidationError):
        _checked_answer(f"報導指出：「{statement}。」[S1]", {"finish_reason": "stop"},
                        [market, news], company_catalog=CATALOG)
    answer = f"報導指出：「{statement}。」[S2]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, [market, news],
                           company_catalog=CATALOG).startswith(answer)


def test_answer_gate_preserves_the_condition_after_the_quoted_target():
    statement = "外資券商給予台積電目標價1500元，但僅適用於樂觀情境"
    answer = f"報導指出：「{statement}。」[S1]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, [source(statement + "。")],
                           company_catalog=CATALOG).startswith(answer)
