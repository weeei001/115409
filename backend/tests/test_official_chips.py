from datetime import date

import httpx

from app.jobs.market import institutional, margin


def test_institutional_reports_do_not_double_count_dealer_components():
    fields = ["證券代號", "外陸資買進股數(不含外資自營商)", "外陸資賣出股數(不含外資自營商)",
              "投信買進股數", "投信賣出股數", "自營商買進股數(自行買賣)",
              "自營商賣出股數(自行買賣)", "自營商買進股數(避險)",
              "自營商賣出股數(避險)", "三大法人買賣超股數"]
    def respond(request):
        if request.url.path.endswith("T86"):
            return httpx.Response(200, json={"stat": "OK", "date": "20260923", "fields": fields,
                                         "data": [["2330", "100", "20", "30", "10", "5", "2", "7", "1", "109"]]})
        return httpx.Response(200, json=[{
            "Date": "1150923", "SecuritiesCompanyCode": "5347",
            "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Buy": "100",
            " Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Sell": "20",
            "SecuritiesInvestmentTrustCompanies-TotalBuy": "30",
            "SecuritiesInvestmentTrustCompanies-TotalSell": "10",
            "Dealers-TotalBuy": "12", "Dealers-TotalSell": "3", "TotalDifference": "109"}])
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        listed = institutional.fetch_twse(http, date(2026, 9, 23))[0]
        otc = institutional.fetch_tpex(http)[0]
    assert listed["dealer_buy"] == otc["dealer_buy"] == 12
    assert listed["total_institutional_net"] == otc["total_institutional_net"] == 109


def test_margin_reports_map_buy_sell_and_reported_dates():
    twse = ["2330", "台積電", "5", "3", "1", "10", "11", "100", "2", "4", "0", "8", "10", "100", "0", ""]
    otc = {"Date": "1150923", "SecuritiesCompanyCode": "5347", "MarginPurchase": "5",
           "MarginSales": "3", "CashRedemption": "1", "MarginPurchaseBalancePreviousDay": "10",
           "MarginPurchaseBalance": "11", "MarginPurchaseQuota": "100", "ShortConvering": "2",
           "ShortSale": "4", "StockRedemption": "0", "ShortSaleBalancePreviousDay": "8",
           "ShortSaleBalance": "10", "ShortSaleQuota": "100", "Offsetting": "0", "Note": ""}
    def respond(request):
        if request.url.path.endswith("MI_MARGN"):
            return httpx.Response(200, json={"stat": "OK", "date": "20260923", "tables": [
                {}, {"fields": margin.TWSE_COLUMNS, "data": [twse]}]})
        return httpx.Response(200, json=[otc])
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        listed = margin.fetch_twse(http, date(2026, 9, 23))[0]
        quoted = margin.fetch_tpex(http)[0]
    assert listed["date"] == quoted["date"] == "2026-09-23"
    assert listed["margin_purchase_buy"] == quoted["margin_purchase_buy"] == "5"
    assert listed["short_sale_buy"] == quoted["short_sale_buy"] == "2"
