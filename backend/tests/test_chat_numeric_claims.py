import json

import pytest

from app.features.chat.claims import numeric_claims_supported
from app.features.chat.schemas import SourceChunk
from app.features.chat.service import CitationValidationError, _checked_answer


def source(content, category="market_technical"):
    return SourceChunk(citation_id="S1", title="Observations", source="test",
                       source_name="Test", pub_time="2026-10-02", url="",
                       stock_id="2317", score=1, category=category, content=content)


@pytest.mark.parametrize("claim,supported", [
    ("漲跌幅 +0.99%", True), ("上漲 0.99%", True),
    ("漲跌幅 -0.99%", False), ("上漲 0.98%", False),
    ("上漲 305265510.99%", False),
])
def test_compact_market_rows_validate_individual_numbers(claim, supported):
    evidence = source('{"columns":["date","volume","chg_pct"],'
                      '"rows":[["2026-10-02",30526551,0.99]]}')
    answer = claim + "。[S1]"
    if supported:
        assert answer in _checked_answer(answer, {"finish_reason": "stop"}, [evidence])
    else:
        with pytest.raises(CitationValidationError):
            _checked_answer(answer, {"finish_reason": "stop"}, [evidence])


@pytest.mark.parametrize("content,claim,supported", [
    ('[1,234]', "變動 1234%", False),
    ('[1,234]', "變動 234%", True),
    ('{"values":[1,234.56]}', "變動 1234.56%", False),
    ('{"values":[1,234.56]}', "變動 234.56%", True),
    ('{"value":9.9e-3}', "變動 0.0099%", True),
    ('{"value":-0.99}', "變動 −0.99%", True),
    ('{"value":-0.99}', "變動 +0.99%", False),
    ('{"value":true,"other":null}', "變動 1%", False),
    ('{"0.99":0}', "變動 0.99%", False),
    ('{"note":"變動 -1,234.56%"}', "變動 −1,234.56%", True),
    ('變動 +1,234.56%', "變動 1,234.56%", True),
    ('變動 -1,234.56%', "變動 −1,234.56%", True),
    ('變動 -1,234.56%', "變動 +1,234.56%", False),
    ('漲跌幅 -0.99%，收盤價 1,234.56 元', "收盤價 1,234.56 元、漲跌幅 −0.99%", True),
])
def test_json_values_and_prose_keep_numeric_boundaries_and_sign(content, claim, supported):
    assert numeric_claims_supported(claim, [source(content, "news")]) is supported


def test_equal_number_in_another_field_does_not_support_metric_claim():
    evidence = source('{"columns":["date","close","chg_pct"],'
                      '"rows":[["2026-10-02",0.99,1.25]]}')
    assert not numeric_claims_supported("漲跌幅 0.99%", [evidence])


def test_percentage_in_uncited_source_does_not_support_claim():
    cited = source('{"value":1.25}')
    uncited = source('{"value":0.99}').model_copy(update={"citation_id": "S2"})
    with pytest.raises(CitationValidationError):
        _checked_answer("上漲 0.99%。[S1]", {"finish_reason": "stop"}, [cited, uncited])


def portfolio_source(**overrides):
    portfolio = dict(initialized=True, available_cash=20000, cash=25000, equity=30000,
                     holdings_value=5000, available_cash_allocation_pct=66.67,
                     cash_allocation_pct=83.33, reserved_cash_allocation_pct=16.67,
                     holdings_allocation_pct=16.67)
    portfolio.update(overrides)
    return source(json.dumps({"portfolio": portfolio}), "personal")


@pytest.mark.parametrize("answer", [
    "可用資金為 20,000 元，可用資金占比為 66.67%；持股配置比例為 16.67%。[S1]",
    "可用資金為 2 萬元，現金占比為 83.33%，持股占比為 16.67%。[S1]",
])
def test_portfolio_amounts_and_precomputed_allocations_pass_citation_check(answer):
    assert answer in _checked_answer(answer, {"finish_reason": "stop"}, [portfolio_source()])


@pytest.mark.parametrize("answer", [
    "可用資金為 30,000 元。[S1]",
    "可用資金占比為 83.33%。[S1]",
    "持股配置比例為 66.67%。[S1]",
    "持股占比為 16.7%。[S1]",
])
def test_portfolio_wrong_field_or_invented_rounding_remains_rejected(answer):
    with pytest.raises(CitationValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, [portfolio_source()])


def test_missing_allocation_is_not_zero_even_if_other_evidence_contains_zero():
    with pytest.raises(CitationValidationError):
        _checked_answer("持股占比為 0%。[S1]", {"finish_reason": "stop"},
                        [portfolio_source(holdings_allocation_pct=None, total_pnl=0)])


def test_uninitialized_cash_placeholder_is_not_an_account_balance():
    assert not numeric_claims_supported("可用資金為 0 元。", [portfolio_source(initialized=False, available_cash=0)])
