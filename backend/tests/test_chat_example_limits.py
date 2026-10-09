"""Example wording cannot cancel an actual account's cash or inventory limits."""
import pytest

from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.proposals import parse_proposals, plan_supported
from test_chat_proposal_scope import ALIASES, CATALOG, personal_source


@pytest.mark.parametrize("intro", ["", "示範", "例如", "舉例來說", "比方說", "假設"])
@pytest.mark.parametrize("action", ["賣出台積電21股", "投入20001元買台積電"])
def test_explicit_actions_obey_available_cash_and_pending_orders(intro, action):
    text = intro + action + "。"
    assert parse_proposals(text, ALIASES)
    assert not plan_supported(text, [personal_source()], ALIASES, require_portfolio=True)
    with pytest.raises(NumericValidationError):
        _checked_answer(text + "[S1]", {"finish_reason": "stop"}, [personal_source()],
                        company_catalog=CATALOG, require_portfolio=True)


@pytest.mark.parametrize("text", [
    "示範投入12000元買台積電。示範保留9000元。",
    "示範賣出台積電10股。賣出台積電11股。",
    "假設賣出台積電10股。示範賣出台積電11股。",
])
def test_demonstrations_are_counted_cumulatively(text):
    assert not plan_supported(text, [personal_source()], ALIASES, require_portfolio=True)


@pytest.mark.parametrize("text", ["示範賣出台積電20股。", "示範投入12000元買台積電。示範保留8000元。"])
def test_feasible_demonstrations_remain_available(text):
    assert plan_supported(text, [personal_source()], ALIASES, require_portfolio=True)


@pytest.mark.parametrize("text", ["示範目前持股占比90%。", "示範目前可用資金30000元。"])
def test_example_wording_does_not_exempt_fabricated_account_observations(text):
    assert not parse_proposals(text, ALIASES)
    with pytest.raises(NumericValidationError):
        _checked_answer(text + "[S1]", {"finish_reason": "stop"}, [personal_source()],
                        company_catalog=CATALOG, require_portfolio=True)


def test_negative_trade_instruction_is_not_an_executable_sale():
    assert not parse_proposals("不建議賣出台積電100股。", ALIASES)
