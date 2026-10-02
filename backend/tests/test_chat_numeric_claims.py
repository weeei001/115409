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
