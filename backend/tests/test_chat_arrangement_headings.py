"""Neutral headings observed in investment reviews must not consume a repair."""
import pytest

from app.features.chat.answer_validation import CitationValidationError, GroundingValidationError, NumericValidationError, _checked_answer
from app.features.chat.schemas import SourceChunk
from test_chat_personal_validation import CATALOG, personal_source


@pytest.mark.parametrize("heading", [
    "重大風險與調整建議條件：", "評選標準與支持來源如下：",
    "## 帳戶概況", "### 1. 帳戶現況", "**二、分析範圍與資料日期**",
    "### 配置問題與下一步方案",
])
@pytest.mark.parametrize("separator", ["\n", "\n\n"])
def test_neutral_headings_need_no_independent_evidence(heading, separator):
    answer = heading + separator + "可用資金20000元。[S1]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, [personal_source()],
                           company_catalog=CATALOG).startswith(answer)


@pytest.mark.parametrize("heading", [
    "**台積電持股999股**", "目前持股過度集中：", "台積電是最佳選擇：",
    "評選台積電為優先標的之標準與支持來源如下：", "重大風險已經解除：",
])
def test_claims_disguised_as_headings_still_require_evidence(heading):
    with pytest.raises(CitationValidationError):
        _checked_answer(heading + "\n\n可用資金20000元。[S1]", {"finish_reason": "stop"},
                        [personal_source()], company_catalog=CATALOG)


def test_heading_exemption_never_supplies_a_citation_to_the_body():
    with pytest.raises(CitationValidationError):
        _checked_answer("## 帳戶概況\n\n可用資金20000元。\n\n建議保留現金。[S1]",
                        {"finish_reason": "stop"}, [personal_source()], company_catalog=CATALOG)


def test_heading_exemption_preserves_account_checks():
    with pytest.raises(NumericValidationError):
        _checked_answer("## 帳戶概況\n\n可用資金99999元。[S1]", {"finish_reason": "stop"},
                        [personal_source()], company_catalog=CATALOG)


@pytest.mark.parametrize("separator", ["\n", "\n\n"])
def test_list_leadin_uses_only_the_immediately_following_item_evidence(separator):
    answer = "以下依據可用資金20000元，提出安排供討論：" + separator + "* 建議投入10000元，保留10000元。[S1]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, [personal_source()],
                           company_catalog=CATALOG).startswith(answer)


@pytest.mark.parametrize("leadin", ["以下依據可用資金99999元，提出安排供討論：", "以下依據鴻海持股999股，提出安排供討論："])
def test_list_leadin_facts_are_still_checked(leadin):
    with pytest.raises(NumericValidationError):
        _checked_answer(leadin + "\n\n* 建議投入10000元。[S1]", {"finish_reason": "stop"},
                        [personal_source()], company_catalog=CATALOG)


def test_list_leadin_cannot_borrow_a_later_items_citation():
    with pytest.raises(CitationValidationError):
        _checked_answer("以下依據可用資金20000元，提出安排供討論：\n* 維持現金。\n* 建議投入10000元。[S1]",
                        {"finish_reason": "stop"}, [personal_source()], company_catalog=CATALOG)


def test_list_leadin_does_not_turn_numeric_support_into_causal_support():
    with pytest.raises(GroundingValidationError):
        _checked_answer("以下根據台積電因公司取得大單而上漲，安排如下：\n* 建議投入10000元。[S1]",
                        {"finish_reason": "stop"}, [personal_source()], company_catalog=CATALOG)


def test_list_leadin_cash_needs_personal_evidence_in_the_first_item():
    market = SourceChunk(citation_id="S2", title="Price", source="test", source_name="Test",
                         pub_time="", url="", stock_id="2330", score=1, category="market_technical",
                         content='{"columns":["date","close"],"rows":[["2026-10-02",100]]}')
    with pytest.raises(NumericValidationError):
        _checked_answer("以下依據可用資金20000元，安排如下：\n* 台積電收盤價100元。[S2]\n* 建議投入10000元。[S1]",
                        {"finish_reason": "stop"}, [personal_source(), market], company_catalog=CATALOG)
