from copy import deepcopy
from datetime import date

import pytest

from app.jobs.market import institutional


def report():
    # Foreign dealers must not be counted again in the institutional total.
    groups = [(100, 20, 80), (7, 2, 5), (107, 22, 85), (40, 10, 30),
              (9, 4, 5), (8, 14, -6), (17, 18, -1)]
    return {"stat": "ok", "date": "20241007", "tables": [{
        "title": "三大法人買賣明細資訊", "date": "113/10/07",
        "fields": ["代號", "名稱"] + ["買進股數", "賣出股數", "買賣超股數"] * 7
                  + ["三大法人買賣超股數合計"],
        "data": [["5347", "Example"] + [str(v) for group in groups for v in group] + ["109"]],
    }, {}]}


def test_tpex_history_preserves_shares_and_excludes_foreign_dealers():
    row = institutional.parse_tpex_history(report(), date(2024, 10, 7))[0]
    assert row["date"] == "2024-10-07"
    assert row["foreign_buy"] == 100
    assert row["dealer_net"] == -1
    assert row["total_institutional_net"] == 109


@pytest.mark.parametrize("fault", ["date", "table_date", "schema", "group", "components", "total"])
def test_tpex_history_rejects_wrong_dates_and_inconsistent_values(fault):
    payload = deepcopy(report())
    table = payload["tables"][0]
    if fault == "date":
        payload["date"] = "20241008"
    elif fault == "table_date":
        table["date"] = "113/10/08"
    elif fault == "schema":
        table["fields"][2] = "Unknown"
    elif fault == "group":
        table["data"][0][4] = "79"
    elif fault == "components":
        table["data"][0][8:11] = ["108", "22", "86"]
    else:
        table["data"][0][-1] = "114"
    with pytest.raises(ValueError):
        institutional.parse_tpex_history(payload, date(2024, 10, 7))


def test_fetch_history_uses_dated_tpex_endpoint():
    class Client:
        def json(self, method, url, **kwargs):
            assert method == "GET"
            assert url.endswith("/insti/dailyTrade")
            assert kwargs["params"] == {"date": "2024/10/07", "type": "Daily",
                                        "sect": "EW", "response": "json"}
            return report()

    assert institutional.fetch_history(Client(), date(2024, 10, 7), "TPEx")[0]["symbol"] == "5347"
