"""Formatting exceptions and citation choice cannot disable factual/account checks."""
import json

import pytest

from app.features.chat.answer_validation import CitationValidationError, NumericValidationError, _checked_answer
from app.features.chat.schemas import AskResponse, SourceChunk
from test_chat_personal_validation import CATALOG, personal_source


def market_source():
    return SourceChunk(citation_id="S2", title="2330 price", source="system_market", source_name="Test",
                       pub_time="", url="", stock_id="2330", score=1, category="market_technical",
                       content=json.dumps({"columns": ["date", "close"], "rows": [["2026-10-02", 100]]}))


@pytest.mark.parametrize("uncited", [
    "### 公司已取得大單", "綜合來看，公司已取得大單。",
    "公司已取得大單，僅供參考。", "公司已取得大單：",
    "### 台積電（9999）",
])
def test_uncited_facts_cannot_hide_in_structural_exceptions(uncited):
    answer = uncited + "\n\n- 2026-10-02台積電收盤價100元。[S2]"
    with pytest.raises(CitationValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, [market_source()], company_catalog=CATALOG)


@pytest.mark.parametrize("label", ["【重點】", "### 台積電（2330）", "以下是重點："])
def test_structural_labels_still_pass_without_fabricated_citations(label):
    answer = label + "\n\n- 2026-10-02台積電收盤價100元。[S2]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, [market_source()],
                           company_catalog=CATALOG).startswith(answer)


@pytest.mark.parametrize("answer", [
    "建議投入20001元買台積電。[S2]",
    "建議投入15000元買台積電。[S2]\n\n另保留6000元。[S2]",
    "建議賣出台積電21股。[S2]",
    "假設賣出台積電21股。[S2]",
    "建議賣出台積電10股。[S1]\n\n另賣出台積電11股。[S2]",
])
def test_omitting_account_citation_cannot_bypass_complete_snapshot_limits(answer):
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, [personal_source(), market_source()],
                        company_catalog=CATALOG)


@pytest.mark.parametrize("answer", ["建議投入20000元買台積電。[S2]", "建議賣出台積電20股。[S2]"])
def test_account_bound_proposals_may_cite_their_market_rationale(answer):
    assert _checked_answer(answer, {"finish_reason": "stop"}, [personal_source(), market_source()],
                           company_catalog=CATALOG).startswith(answer)


def test_account_mode_requires_snapshot_but_teaching_does_not_invent_one():
    answer = "假設投入60000元買台積電。[S2]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, [market_source()],
                           company_catalog=CATALOG).startswith(answer)
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, [market_source()],
                        company_catalog=CATALOG, require_portfolio=True)


def test_account_mode_is_server_only_context():
    response = AskResponse(answer="", detected_stocks=[], time_range=None, sources=[], tokens={},
                           duration_ms=0, current_time="", _requires_portfolio=True)
    assert response._requires_portfolio is False
    response._requires_portfolio = True
    assert "_requires_portfolio" not in response.model_dump()
