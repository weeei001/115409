"""Useful wording boundaries retained from the pre-main working changes."""
import pytest

from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.claims import numeric_claims_supported
from test_chat_arrangement_rankings import CATALOG, source


@pytest.mark.parametrize("qualifier", ["低至", "達到", "高達", "僅", "僅有", "僅為"])
def test_qualifiers_keep_values_bound_to_the_named_stock(qualifier):
    assert numeric_claims_supported(f"友達年化波動度{qualifier}88.53%。", [source()], CATALOG)
    assert not numeric_claims_supported(f"友達年化波動度{qualifier}10.69%。", [source()], CATALOG)


@pytest.mark.parametrize("text", [
    "中華電報酬率最高。[S1]", "友達報酬率最高。[S1]",
    "晶華年化波動度在六檔中最低。[S1]", "晶華年化波動度在十二檔中最低。[S1]",
    "中華電年化波動度不能說是最高，但中華電年化波動度最低。[S1]",
])
def test_undefined_returns_wrong_scope_and_local_negation_remain_rejected(text):
    with pytest.raises(NumericValidationError):
        _checked_answer(text, {"finish_reason": "stop"}, [source()], company_catalog=CATALOG)


@pytest.mark.parametrize("text", [
    "中華電年化波動度不能說是最低。[S1]",
    "晶華年化波動度在三檔中最低。[S1]", "友達區間價格報酬率最高。[S1]",
])
def test_negated_claims_and_defined_rankings_pass(text):
    assert _checked_answer(text, {"finish_reason": "stop"}, [source()], company_catalog=CATALOG).startswith(text)
