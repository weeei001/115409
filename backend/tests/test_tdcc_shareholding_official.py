from datetime import date

import httpx
import pytest

from app.jobs.market import tdcc_shareholding


def test_tdcc_weekly_distribution_maps_levels_and_rejects_changed_schema():
    rows = [
        {"證券代號": "2330  ", "\ufeff資料日期": "20260918", "持股分級": "1",
         "人數": "2,496,562", "股數": "291447275", "占集保庫存數比例%": "1.12"},
        {"證券代號": "2330  ", "\ufeff資料日期": "20260918", "持股分級": "17",
         "人數": "3000000", "股數": "25900000000", "占集保庫存數比例%": "100.00"},
        {"證券代號": "0050  ", "\ufeff資料日期": "20260918", "持股分級": "1",
         "人數": "1", "股數": "1", "占集保庫存數比例%": "1"},
    ]
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=rows))) as http:
        mapped = tdcc_shareholding.fetch(http, {"2330"})
    assert len(mapped) == 2
    assert mapped[0] == {"date": date(2026, 9, 18).isoformat(), "symbol": "2330",
                         "holding_shares_level": "1-999", "people": 2496562,
                         "percent": "1.12", "unit": 291447275}
    assert mapped[1]["holding_shares_level"] == "合計"
    with pytest.raises(ValueError, match="fields"):
        tdcc_shareholding.map_rows([{**rows[0], "股數": "invalid"}], {"2330"})
