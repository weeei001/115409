"""Investment proposals must stay distinct from sourced account observations."""
import json

import pytest

from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.claims import numeric_claims_supported
from app.features.chat.schemas import SourceChunk


CATALOG = {"2330": {"name": "台積電"}, "2317": {"name": "鴻海"}}


def evidence():
    personal = SourceChunk(
        title="Portfolio", source="test", source_name="Test", pub_time="", url="",
        stock_id="", category="personal", score=1, citation_id="S1",
        content=json.dumps({"portfolio": {
            "initialized": True, "as_of": "2026-10-05T10:00:00+08:00",
            "available_cash": 50000, "cash": 50000, "equity": 50000,
            "holdings_value": 0, "total_pnl": 0,
            "available_cash_allocation_pct": 100, "cash_allocation_pct": 100,
            "holdings_allocation_pct": 0, "positions": [],
        }}),
    )
    market = SourceChunk(
        title="Price", source="test", source_name="Test", pub_time="", url="",
        stock_id="2330", category="market_technical", score=1, citation_id="S2",
        content=json.dumps({"columns": ["date", "close", "chg_pct"],
                            "rows": [["2026-10-02", 100, 2]]}),
    )
    return [personal, market]


@pytest.mark.parametrize("text", [
    "建議先分批投入可用資金的20%。",
    "建議每檔分配可用資金的10%。",
    "建議配置20%的可用資金。",
    "可考慮將現金占比控制在50%。",
    "建議投入可用資金約20%。",
    "建議先保留約30%現金。",
    "建議保留20至30%現金。",
    "建議保留20-30%現金。",
    "建議台積電持股占比10%。",
    "若股價為95元，再評估進場。",
    "若台積電下跌5%，先暫停加碼。",
    "假設收盤價95元，先觀察。",
    "建議設定5%的停損幅度。",
    "建議停損跌幅5%。",
    "建議設定10%的停利幅度。",
    "建議設定目標報酬率10%。",
    "建議投入可用資金20000元。",
    "若報酬率為-5%，暫停加碼。",
    "建議投入NT$20000可用資金。",
    "建議設定目標報酬率10%但不保證實現。",
    "停損可設在8%。",
    "目前停損可設在8%。",
    "停損點約設在8%。",
    "目標報酬率可抓15%。",
    "跌破8%停損。",
    "可考慮在回檔5%至10%時分批買進。",
    "若回檔5%，再分批布局。",
    "若回檔5%再分批布局。",
    "短線若漲超過10%可考慮部分獲利了結。",
    "一旦跌破1,000元就停損。",
    "每次投入30%資金分批買進。",
])
def test_explicit_proposals_and_conditions_are_not_existing_observations(text):
    assert numeric_claims_supported(text, evidence(), CATALOG)


@pytest.mark.parametrize("text", [
    "建議分配可用資金-20%。",
    "建議分批投入可用資金的120%。",
    "建議保留20至120%現金。",
    "建議保留30至20%現金。",
    "建議設定-5%的停損幅度。",
    "預期報酬率10%。",
    "未來報酬率一定達10%。",
    "建議先分批投入可用資金的20%，目前可用資金999元。",
    "建議保留20%現金，目前現金占比20%。",
    "建議設定5%的停損幅度，但目前股價999元。",
    "若股價為95元而目前股價999元。",
    "若你想投資，股價999元。",
    "如果想投入資金股價999元。",
    "建議先分批投入可用資金的20%，2317收盤價100元。",
    "建議先投入可用資金的20%，現金占比50%。",
    "建議保留20%現金，現金占比50%。",
    "建議投入USD60000元可用資金。",
    "建議投入60000美元。",
    "建議投入20000元至30000美元。",
    "若股價為100股，再評估進場。",
    "若股價為100%，再評估進場。",
    "若報酬率為2元，再評估進場。",
    "若報酬率為-101%，暫停加碼。",
    "若台積電下跌-5%，暫停加碼。",
    "未來保證上漲2%。",
    "預期報酬率2%。",
    "建議設定5%停損，目前停損幅度2%。",
    "建議設定目標報酬率10%保證實現。",
    "建議設定目標報酬率10%，一定達成。",
    "建議投入100%。",
    "跌破8%。",
    "台積電下跌9.9%後可分批買進。",
    "近一個月回檔5%後可分批買進。",
    "若回檔-5%再分批布局。",
    "若回檔5%一定反彈。",
    "停損設在8%，目前股價999元。",
])
def test_proposals_do_not_exempt_invalid_ranges_predictions_or_observations(text):
    assert not numeric_claims_supported(text, evidence(), CATALOG)


@pytest.mark.parametrize("separator", [" ", "\n\n"], ids=["adjacent_citations", "paragraphs"])
@pytest.mark.parametrize("first,second", [
    ("建議投入可用資金的20%配置台積電。", "建議投入可用資金的30%配置鴻海。"),
    ("建議投入10000元買台積電。", "建議投入20000元買鴻海。"),
])
def test_complete_answer_accepts_allocations_within_the_available_cash(first, second, separator):
    answer = f"{first}[S1]{separator}{second}[S1]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, evidence(),
                           company_catalog=CATALOG).startswith(answer)


@pytest.mark.parametrize("separator", [" ", "\n\n"], ids=["adjacent_citations", "paragraphs"])
@pytest.mark.parametrize("first,second", [
    ("建議投入可用資金的80%配置台積電。", "建議投入可用資金的80%配置鴻海。"),
    ("建議投入30000元買台積電。", "建議投入30000元買鴻海。"),
    ("建議投入可用資金的80%配置台積電。", "建議投入20000元買鴻海。"),
])
def test_complete_answer_rejects_reusing_the_same_available_cash(first, second, separator):
    answer = f"{first}[S1]{separator}{second}[S1]"
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, evidence(), company_catalog=CATALOG)


def test_condition_and_following_observation_keep_separate_citation_checks():
    answer = "若台積電下跌5%，先暫停加碼。[S2] 目前股價999元。[S2]"
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, evidence(), company_catalog=CATALOG)


@pytest.mark.parametrize("answer", [
    "建議投入30000元，其中投入10000元買2330，投入20000元買2317。[S1]",
    "建議投入30000元，其中投入10000元買2330、投入20000元買2317。[S1]",
    "建議投入30000元，其中投入10000元買2330。[S1]\n\n另保留20000元現金。[S1]",
    "建議配置：\n\n- 台積電投入30000元。[S1]\n- 鴻海投入20000元。[S1]",
    "建議配置：\n- 台積電持股占比50%。[S1]\n- 鴻海持股占比30%。[S1]",
    "建議配置：\n- 台積電持股占比50%。[S1]\n- 現金占比50%。[S1]",
    "建議每檔投入10000元買2330與2317。[S1]",
])
def test_complete_plans_recognize_lists_and_nested_breakdowns(answer):
    assert _checked_answer(answer, {"finish_reason": "stop"}, evidence(), company_catalog=CATALOG).startswith(answer)


@pytest.mark.parametrize("answer", [
    "建議投入40000元買2330，另投入20000元買2317。[S1]",
    "建議投入30000元買2330。[S1]\n\n另外投入30000元買2317。[S1]",
    "建議每檔投入30000元買2330與2317。[S1]",
    "建議每檔投入10000元。[S1]",
    "建議配置：\n- 台積電投入40000元。[S1]\n- 鴻海投入20000元。[S1]",
    "建議配置：\n- 台積電持股占比80%。[S1]\n- 鴻海持股占比80%。[S1]",
    "建議現金占比80%，建議持股占比80%。[S1]",
    "建議投入30000元，其中投入20000元買2330，投入20000元買2317。[S1]",
    "建議投入40000元，其中投入20000元買2330，投入20000元買2317，另保留20000元現金。[S1]",
    "建議投入30000元，其中投入10000元買2330。另投入30000元買2317。[S1]",
    "建議投入30000元，其中投入10000元買2330、投入60000元買2317。[S1]",
])
def test_complete_plans_reject_hidden_overcommitments(answer):
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, evidence(), company_catalog=CATALOG)


def test_guarantee_after_a_citation_cannot_exempt_a_numeric_target():
    answer = "建議設定目標報酬率10%[S2]保證實現。"
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, evidence(), company_catalog=CATALOG)
