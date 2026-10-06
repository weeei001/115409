from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.db.models.market_extra import ForeignShareholding
from app.jobs.market.import_csv import normalized_rows, upsert_rows
from app.jobs.market.foreign_shareholding import TWSE_FIELDS, fetch_tpex, fetch_twse


def test_official_foreign_holding_maps_full_twse_and_partial_tpex_without_erasing_old_values(db_session):
    day = date(2026, 8, 14)
    twse = {"stat": "OK", "date": "20260814", "fields": list(TWSE_FIELDS), "data": [[
        "2330", "台積電", "TW0002330008", "25,932,370,067", "7,992,401,606", "17,939,968,461",
        30.82, 69.17, "100.00", "100.00", "", "115/05/26",
    ]]}
    tpex = [{"Date": "1150814", "Rank": "1", "SecuritiesCompanyCode": "6488",
             "CompanyName": "環球晶", "NumberOfSharesIssued": "395000000",
             "AvailableSharesForOC/FIToInvest": "90000000", "CurrentlySharesOC/FIHeld": "305000000",
             "PercentageOfAvailableInvestmentForOC/FI": "22.78%",
             "PercentageOfSharesOC/FMIHeld": "77.21%", "UpperLimitOfRegulatedInvestment": "100%", "Note": ""}]

    def provider(request):
        if request.url.path.endswith("MI_QFIIS"):
            assert request.url.params["selectType"] == "ALLBUT0999"
            return httpx.Response(200, json=twse)
        return httpx.Response(200, json=tpex)

    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        listed = fetch_twse(http, day)
        otc = fetch_tpex(http)
        with pytest.raises(ValueError, match="Unexpected TWSE"):
            fetch_twse(http, date(2026, 8, 15))

    assert listed[0]["foreign_investment_shares"] == "17939968461"
    assert listed[0]["foreign_investment_shares_ratio"] == "69.17"
    assert listed[0]["international_code"] == "TW0002330008"
    assert listed[0]["recently_declare_date"] == "2026-05-26"
    assert otc[0]["date"] == "2026-08-14"
    assert otc[0]["international_code"] == "" and otc[0]["chinese_investment_upper_limit_ratio"] == ""

    db_session.add(ForeignShareholding(date=day, symbol="6488", international_code="TW0006488000",
                                       chinese_investment_upper_limit_ratio=Decimal("100.0000")))
    db_session.commit()
    upsert_rows(db_session, ForeignShareholding, normalized_rows(ForeignShareholding, otc, "6488"))
    db_session.commit()
    saved = db_session.get(ForeignShareholding, (day, "6488"))
    db_session.refresh(saved)
    assert saved.international_code == "TW0006488000"
    assert saved.chinese_investment_upper_limit_ratio == Decimal("100.0000")
    assert saved.foreign_investment_shares == 305000000
