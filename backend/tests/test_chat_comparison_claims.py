import json

import pytest

from app.features.chat.claims import numeric_claims_supported
from app.features.chat.schemas import SourceChunk


CATALOG = {"2330": {"name": "台積電"}, "1101": {"name": "台泥"}, "1303": {"name": "南亞"}}


def comparison_source():
    return SourceChunk(citation_id="S11", title="Comparison", source="system_comparison",
        source_name="Comparison", pub_time="2026-10-01", url="", stock_id="", score=1,
        category="comparison", content=json.dumps({
            "requested_start_date": "2026-09-03", "requested_end_date": "2026-10-03",
            "common_start_date": "2026-09-03", "common_end_date": "2026-10-01",
            "stocks": [
                {"symbol": "2330", "interval_return_pct": 5.020921,
                 "annualized_volatility_pct": 17.98024, "max_drawdown_pct": -3.643725},
                {"symbol": "1101", "interval_return_pct": 4.498978,
                 "annualized_volatility_pct": 32.493508, "max_drawdown_pct": -4.032258},
                {"symbol": "1303", "interval_return_pct": 14.932127,
                 "annualized_volatility_pct": 52.509199, "max_drawdown_pct": -9.221311},
            ], "common_price_samples": 20,
        }))


@pytest.mark.parametrize("paragraph", [
    "* **趨勢穩定**：2026-09-03 至 10-01 的區間報酬率為 5.02%，且年化波動度 (17.98%) 是三檔中最低的，代表價格相對穩健 [S11]。",
    "* 價格報酬：在 2026-09-03 至 2026-10-01 的共同區間內，南亞的區間報酬率為 14.93% [S11]。台積電的區間報酬率為 5.02%，台泥的區間報酬率為 4.50% [S11]。",
    "股票 2330 區間報酬率為 5.020921%，年化波動率為 17.980%，最大回撤為 -3.64%。",
    "2026-09-03 至 2026-10-03 股票 1101 區間報酬率為 4.50%。",
    "2026-10-01 股票 1303 區間報酬率為 14.93%。",
    "* 台積電 (2330)：表現相對穩健，同期間報酬率為 5.02% [S11]。",
    "股票 2330 期間報酬率為 5.02%，同期報酬率為 5.02%。",
    # An unqualified return can refer to the cited interval; it is not inherently daily.
    "股票 2330 報酬率為 5.020921%。",
    "股票 2330 報酬率為 5.02%。",
])
def test_comparison_observations_allow_displayed_decimal_precision(paragraph):
    assert numeric_claims_supported(paragraph, [comparison_source()], CATALOG)


@pytest.mark.parametrize("paragraph", [
    # 後一句未標指標，不能跨句猜成報酬率，再以其他欄位中的相同百分比補證明。
    "* 價格報酬：在 2026-09-03 至 2026-10-01 的共同區間內，南亞的報酬率最高，達 14.93% [S11]。相比之下，台積電為 5.02%，台泥為 4.50% [S11]。",
    "台積電的區間報酬率為14.93%。",
    "股票 1101 區間報酬率為 5.02%。",
    "股票 1101 同期間報酬率為 5.02%。",
    "2330 年化波動率為 32.49%。",
    "股票 2330 區間報酬率為 5.03%。",
    "股票 2330 區間報酬率為 5.0%。",
    "股票 2330 年化波動度 (5.02%)。",
    "股票 2330 最大回撤為 3.64%。",
    "2026-09-04 至 2026-10-01 股票 2330 區間報酬率為 5.02%。",
    "2026-09-03 至 10-02 股票 2330 區間報酬率為 5.02%。",
    "2026-09-30 股票 2330 區間報酬率為 5.02%。",
    "股票 1101 變動 5.020921%。",
    "股票 2330 漲跌幅為 5.02%。",
    "股票 2330 當日報酬率為 5.020921%。",
    "比例為 20%。",
])
def test_comparison_observations_reject_wrong_metric_subject_period_or_value(paragraph):
    assert not numeric_claims_supported(paragraph, [comparison_source()], CATALOG)


def test_rounding_does_not_apply_to_other_evidence_categories():
    source = comparison_source().model_copy(update={"category": "news"})
    assert not numeric_claims_supported("變動 5.02%。", [source])


@pytest.mark.parametrize("paragraph", ["年化波動度為 17.98%。", "區間報酬率為 5%。"])
def test_news_only_comparison_wording_keeps_existing_exact_validation(paragraph):
    source = comparison_source().model_copy(update={"category": "news", "content": paragraph})
    assert numeric_claims_supported(paragraph, [source])


def test_missing_comparison_metric_cannot_be_assumed_zero():
    source = comparison_source()
    payload = json.loads(source.content)
    payload["stocks"][0]["max_drawdown_pct"] = None
    source.content = json.dumps(payload)
    assert not numeric_claims_supported("股票 2330 最大回撤為 0%。", [source])
