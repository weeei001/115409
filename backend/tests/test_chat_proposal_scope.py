"""Keep proposal scope local while enforcing account limits across the whole plan."""
import json

import pytest

from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.proposals import parse_proposals, plan_supported
from app.features.chat.schemas import SourceChunk


CATALOG = {"2330": {"name": "台積電"}, "2317": {"name": "鴻海"}}
ALIASES = {company["name"]: symbol for symbol, company in CATALOG.items()}


def personal_source(*, initialized=True):
    return SourceChunk(
        citation_id="S1", title="帳戶快照", source="test", source_name="Test",
        pub_time="", url="", stock_id="", category="personal", score=1,
        content=json.dumps({"portfolio": {
            "initialized": initialized, "as_of": "2026-10-05T09:00:00+08:00",
            "available_cash": 20000, "cash": 25000, "equity": 50000,
            "holdings_value": 25000, "cash_allocation_pct": 50,
            "available_cash_allocation_pct": 40, "holdings_allocation_pct": 50,
            "positions": [{
                "symbol": "2330", "quantity": 100, "reserved_quantity": 80,
                "market_price": 100, "market_date": "2026-10-02",
                "market_value": 10000, "allocation_pct": 20,
            }, {
                "symbol": "2317", "quantity": 150, "reserved_quantity": 0,
                "market_price": 100, "market_date": "2026-10-02",
                "market_value": 15000, "allocation_pct": 30,
            }],
        }}),
    )


def checked(answer):
    return _checked_answer(answer, {"finish_reason": "stop"}, [personal_source()],
                           company_catalog=CATALOG)


@pytest.mark.parametrize("heading", ["目前帳戶：", "### 目前帳戶", "【目前帳戶】", "【資料限制】"])
def test_observations_after_a_new_heading_cannot_inherit_a_proposal_exemption(heading):
    prefix = f"建議配置：\n- 台積電持股占比10%。[S1]\n\n{heading}\n\n"
    correct = prefix + "- 台積電持股占比20%。[S1]"
    invented = prefix + "- 台積電持股占比90%。[S1]"
    assert checked(correct).startswith(correct)
    with pytest.raises(NumericValidationError):
        checked(invented)


@pytest.mark.parametrize("transition", [
    "以下是帳戶現況。[S1]",
    "- 目前整體持股占比50%。[S1]",
    "- 台積電目前持股占比20%。[S1]",
])
def test_current_context_ends_the_inherited_target_scope(transition):
    answer = ("建議配置：\n- 台積電持股占比10%。[S1]\n\n"
              f"{transition}\n\n- 台積電持股占比90%。[S1]")
    with pytest.raises(NumericValidationError):
        checked(answer)


def test_blank_lines_and_citations_do_not_break_a_continuous_suggestion_list():
    answer = ("建議配置：\n\n- 台積電持股占比50%。[S1]\n\n"
              "- 鴻海持股占比30%。[S1]\n\n- 現金占比20%。[S1]")
    assert checked(answer).startswith(answer)


@pytest.mark.parametrize("text", [
    "目前停損可設在8%。", "現在台積電停損可以設在8%。", "目前目標報酬率建議抓15%。",
])
def test_explicit_current_recommendations_are_settings_not_observations(text):
    answer = text + "[S1]"
    assert checked(answer).startswith(answer)


@pytest.mark.parametrize("text", [
    "目前停損為8%。", "目前停損已設在8%。",
    "目前停損可設在8%，目前可用資金999元。",
])
def test_current_wording_without_an_explicit_setting_keeps_fact_validation(text):
    with pytest.raises(NumericValidationError):
        checked(text + "[S1]")


def test_current_setting_exception_does_not_apply_to_prices_or_account_cash():
    assert not parse_proposals("目前股價可設在999元。", ALIASES)
    assert not parse_proposals("目前可用資金可設在999元。", ALIASES)


@pytest.mark.parametrize("text", ["建議投入10000元。", "建議賣出台積電20股。"])
def test_account_mode_requires_a_portfolio_for_executable_proposals(text):
    assert not plan_supported(text, [], ALIASES, require_portfolio=True)
    assert not plan_supported(text, [personal_source(initialized=False)], ALIASES, require_portfolio=True)
    assert plan_supported(text, [personal_source()], ALIASES, require_portfolio=True)


def test_tutorial_wording_cannot_override_the_trusted_account_mode():
    text = "虛構教學情境：\n建議投入30000元買台積電。"
    assert plan_supported(text, [], ALIASES)
    assert not plan_supported(text, [], ALIASES, require_portfolio=True)
    assert not plan_supported(text, [personal_source()], ALIASES)


@pytest.mark.parametrize("condition", ["假設", "如果", "若"])
@pytest.mark.parametrize("action", ["投入30000元買台積電", "賣出台積電21股"])
def test_hypothetical_trades_still_obey_the_trusted_account_limits(condition, action):
    text = condition + action + "。"
    assert plan_supported(text, [], ALIASES)
    assert not plan_supported(text, [], ALIASES, require_portfolio=True)
    assert not plan_supported(text, [personal_source()], ALIASES)


@pytest.mark.parametrize("text", ["假設目前持股占比90%。", "假設目前可用資金30000元。"])
def test_a_hypothetical_label_does_not_exempt_claims_about_current_account_state(text):
    assert not parse_proposals(text, ALIASES)
    with pytest.raises(NumericValidationError):
        checked(text + "[S1]")


def test_conditions_without_an_executable_plan_do_not_require_account_data():
    assert plan_supported("若股價為95元，再評估進場。", [], ALIASES, require_portfolio=True)


@pytest.mark.parametrize("text", [
    "建議投入15000元買台積電。\n\n另一項建議：\n建議投入10000元買鴻海。",
    "建議賣出台積電10股。\n\n另一項建議：\n建議賣出台積電11股。",
])
def test_section_boundaries_do_not_reset_cumulative_cash_or_inventory(text):
    assert not plan_supported(text, [personal_source()], ALIASES, require_portfolio=True)
