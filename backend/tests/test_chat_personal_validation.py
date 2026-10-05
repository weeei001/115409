"""Check personal observations and concrete sale proposals against the cited snapshot."""
import json

import pytest

from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.claims import numeric_claims_supported
from app.features.chat.schemas import SourceChunk


CATALOG = {"2330": {"name": "台積電"}, "2317": {"name": "鴻海"}, "2454": {"name": "聯發科"}}


def personal_source():
    payload = {
        "favorites": [{"symbol": symbol, "name": info["name"]} for symbol, info in CATALOG.items()],
        "portfolio": {
            "initialized": True, "available_cash": 20000, "cash": 25000,
            "equity": 50000, "holdings_value": 25000, "total_pnl": 0,
            "as_of": "2026-10-05T09:00:00+08:00",
            "cash_allocation_pct": 50, "available_cash_allocation_pct": 40,
            "reserved_cash_allocation_pct": 10, "holdings_allocation_pct": 50,
            "positions": [
                {"symbol": "2330", "quantity": 100, "reserved_quantity": 80,
                 "average_cost": 90, "market_price": 100, "market_date": "2026-10-02",
                 "market_value": 10000, "allocation_pct": 20},
                {"symbol": "2317", "quantity": 150, "reserved_quantity": 0,
                 "average_cost": 80, "market_price": 100, "market_date": "2026-10-02",
                 "market_value": 15000, "allocation_pct": 30},
            ],
        },
    }
    return SourceChunk(citation_id="S1", title="Personal snapshot", source="test", source_name="Test",
                       pub_time="", url="", stock_id="", score=1, category="personal",
                       content=json.dumps(payload, ensure_ascii=False))


@pytest.mark.parametrize("answer", [
    "台積電持股占比20%，可用資金20000元。",
    "台積電持股占比20%，整體持股占比50%。",
    "截至2026-10-02台積電股價100元，目前可用資金20000元。",
    "截至2026-10-02台積電股價100元，目前總資產50000元。",
    "2026-10-05可用資金20000元。",
])
def test_account_observations_do_not_inherit_a_preceding_stock_or_market_date(answer):
    assert numeric_claims_supported(answer, [personal_source()], CATALOG)


@pytest.mark.parametrize("answer", [
    "2026-10-04可用資金20000元。",
    "截至2026-10-01台積電股價100元，目前可用資金20000元。",
    "台積電持股占比30%，可用資金20000元。",
    "台積電持股占比20%，整體持股占比20%。",
])
def test_separating_account_context_preserves_direct_date_and_value_checks(answer):
    assert not numeric_claims_supported(answer, [personal_source()], CATALOG)


@pytest.mark.parametrize("answer", [
    "可用資金有20000元。", "可用資金剩餘20000元。", "可用資金剩下20000元。",
    "目前現金是25000元。", "目前現金餘額為25000元。",
])
def test_common_current_cash_wording_is_checked(answer):
    assert numeric_claims_supported(answer, [personal_source()], CATALOG)


@pytest.mark.parametrize("answer", [
    "可用資金有9999元。", "可用資金剩餘9999元。", "可用資金剩下9999元。",
    "目前現金是9999元。", "目前現金餘額為9999元。",
])
def test_qualifiers_cannot_hide_invented_current_cash(answer):
    assert not numeric_claims_supported(answer, [personal_source()], CATALOG)


@pytest.mark.parametrize("currency", ["日圓", "JPY", "歐元", "EUR", "美元", "USD", "港幣", "HKD"])
def test_explicit_foreign_currency_does_not_match_twd(currency):
    assert not numeric_claims_supported(f"可用資金20000{currency}。", [personal_source()], CATALOG)


@pytest.mark.parametrize("answer", [
    "台積電持股100股。", "台積電可用股數20股。", "台積電已委託賣出80股。",
    "鴻海持股150股。", "鴻海可用股數150股。", "鴻海已委託賣出0股。",
    "台積電平均成本90元。", "鴻海平均成本80元。",
    "收藏清單有3檔股票。", "你收藏了3檔股票。", "目前持有2檔股票。",
    "台積電持股市值10000元，整體持股市值25000元。",
    "鴻海持股市值15000元，整體持股市值25000元。",
    "收藏股票：2330、2317。", "你收藏了2330（台積電）。",
    "收藏：2330、2317。", "收藏股票2330與2317。",
    "收藏檔數3。", "收藏股票2330的股價100元。",
])
def test_personal_counts_inventory_costs_and_values_use_their_own_fields(answer):
    assert numeric_claims_supported(answer, [personal_source()], CATALOG)


@pytest.mark.parametrize("answer", [
    "台積電持股9999股。", "台積電可用股數100股。", "台積電已委託賣出20股。",
    "鴻海持股100股。", "鴻海可用股數20股。", "鴻海已委託賣出80股。",
    "台積電平均成本80元。", "鴻海平均成本90元。",
    "收藏清單有2檔股票。", "你收藏了999檔股票。", "目前持有3檔股票。",
    "台積電持股市值25000元。", "鴻海持股市值10000元。", "整體持股市值10000元。",
    "收藏檔數2。", "收藏股票2454的股價100元。",
])
def test_unrelated_account_fields_cannot_support_personal_observations(answer):
    assert not numeric_claims_supported(answer, [personal_source()], CATALOG)


@pytest.mark.parametrize("quantity", [1, 20])
def test_concrete_sale_proposal_can_use_inventory_remaining_after_reservations(quantity):
    answer = f"建議賣出2330的{quantity}股。[S1]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, [personal_source()],
                           company_catalog=CATALOG).startswith(answer)


@pytest.mark.parametrize("answer", [
    "建議賣出2330的21股。[S1]", "建議賣出2330的100股。[S1]",
    "建議賣出2454的1股。[S1]",
])
def test_sale_proposals_cannot_use_reserved_or_nonexistent_inventory(answer):
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, [personal_source()], company_catalog=CATALOG)


@pytest.mark.parametrize("answer", [
    "建議賣出台積電10股，另賣出台積電11股。[S1]",
    "建議賣出台積電10股。[S1]\n\n另賣出台積電11股。[S1]",
    "建議買入台積電300股。[S1]",
])
def test_complete_plan_checks_cumulative_sales_and_requires_a_verified_buy_budget(answer):
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, [personal_source()], company_catalog=CATALOG)


def test_pending_sale_proceeds_are_not_current_available_cash():
    source = personal_source()
    payload = json.loads(source.content)
    payload["portfolio"]["available_cash"] = 0
    source.content = json.dumps(payload)
    answer = "建議賣出台積電20股，然後投入賣出所得2000元買2317。[S1]"
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, [source], company_catalog=CATALOG)
