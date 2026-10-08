"""A conditional entry and its metric-based risk control are not a market cause."""
import json

import pytest

from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.grounding import unsupported_market_cause
from app.features.chat.schemas import SourceChunk


CATALOG = {"2409": {"name": "友達"}, "2412": {"name": "中華電"}}
SOURCE = SourceChunk(
    citation_id="S1", title="Synthetic comparison", source="test", source_name="Test",
    pub_time="", url="", stock_id="", score=1, category="comparison",
    content=json.dumps({
        "common_start_date": "2026-09-09", "common_end_date": "2026-10-07",
        "stocks": [
            {"symbol": "2409", "annualized_volatility_pct": 88.53},
            {"symbol": "2412", "annualized_volatility_pct": 10.69},
            *[{"symbol": str(symbol), "annualized_volatility_pct": 20} for symbol in range(2501, 2505)],
        ],
    }),
)
AUDITED_ADVICE = (
    "積極成長方向（具條件採用）：若想追求動能較強的2409友達，"
    "採用條件為需等待該股短線漲多拉回、並確認回檔不再破支撐後才進場，"
    "因其年化波動度高於其餘5檔，必須嚴格設定停損條件"
)


@pytest.mark.parametrize("text", [
    AUDITED_ADVICE,
    "友達若回檔再進場，因其年化波動度88.53%，應設定停損條件。",
])
def test_explicit_risk_control_reason_is_not_an_observed_market_cause(text):
    assert unsupported_market_cause(text, [SOURCE], CATALOG) is None


@pytest.mark.parametrize("text", [
    "友達因訂單帶動上漲，建議設定停損條件。",
    "假設友達因取得大單帶動上漲，可考慮進場並設定停損。",
    "友達因大單帶動上漲，若回檔再進場，因其年化波動度88.53%，應設定停損條件。",
    "友達若回檔再進場，因公司取得大單，必須嚴格設定停損條件。",
    "友達若回檔再進場，因其年化波動度88.53%，帶動股價反彈。",
    "友達上漲，因其年化波動度88.53%，應設定停損條件。",
])
def test_advice_and_hypotheticals_do_not_hide_unsourced_market_causes(text):
    assert unsupported_market_cause(text, [SOURCE], CATALOG)


def test_risk_control_exception_does_not_bypass_the_numeric_validator():
    wrong = "友達若回檔再進場，因其年化波動度10.69%，應設定停損條件。[S1]"
    assert unsupported_market_cause(wrong, [SOURCE], CATALOG) is None
    with pytest.raises(NumericValidationError):
        _checked_answer(wrong, {"finish_reason": "stop"}, [SOURCE], company_catalog=CATALOG)


def test_audited_advice_still_checks_its_comparison_ranking():
    answer = AUDITED_ADVICE + "。[S1]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, [SOURCE], company_catalog=CATALOG).startswith(answer)
    payload = json.loads(SOURCE.content)
    payload["stocks"][0]["annualized_volatility_pct"] = 3
    changed = SOURCE.model_copy(update={"content": json.dumps(payload)})
    with pytest.raises(NumericValidationError, match="比較排名"):
        _checked_answer(answer, {"finish_reason": "stop"}, [changed], company_catalog=CATALOG)
