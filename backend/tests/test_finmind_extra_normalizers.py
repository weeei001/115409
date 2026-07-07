from argparse import Namespace

import pandas as pd

from crawler.finmind.fetch_finmind import (
    get_holding_share_levels_df,
    normalize_financial_statement_df,
    normalize_foreign_shareholding_df,
    normalize_margin_df,
    normalize_monthly_revenue_df,
    normalize_per_pbr_df,
)


def test_statement_normalizer_adds_statement_and_renames_type():
    raw = pd.DataFrame(
        [
            {
                "date": "2024-03-31",
                "stock_id": "2330",
                "type": "EPS",
                "origin_name": "基本每股盈餘",
                "value": "8.70",
            }
        ]
    )

    out = normalize_financial_statement_df(raw, "2330", "income")

    assert out.to_dict("records") == [
        {
            "date": "2024-03-31",
            "symbol": "2330",
            "statement": "income",
            "item_type": "EPS",
            "origin_name": "基本每股盈餘",
            "value": 8.7,
        }
    ]


def test_monthly_revenue_normalizer_coerces_schema():
    raw = pd.DataFrame(
        [
            {
                "date": "2024-05-01",
                "stock_id": 2330,
                "country": "Taiwan",
                "revenue": "229620000000",
                "revenue_month": "4",
                "revenue_year": "2024",
                "create_time": "",
            }
        ]
    )

    out = normalize_monthly_revenue_df(raw, "2330")

    row = out.iloc[0].to_dict()
    assert row["symbol"] == "2330"
    assert row["revenue"] == 229620000000
    assert row["revenue_month"] == 4
    assert row["revenue_year"] == 2024


def test_per_pbr_normalizer_coerces_numbers_and_names():
    raw = pd.DataFrame(
        [{"date": "2024-01-02", "stock_id": "2330", "dividend_yield": "1.5", "PER": "18.2", "PBR": ""}]
    )

    out = normalize_per_pbr_df(raw, "2330")

    row = out.iloc[0].to_dict()
    assert row["symbol"] == "2330"
    assert row["dividend_yield"] == 1.5
    assert row["per"] == 18.2
    assert pd.isna(row["pbr"])


def test_margin_normalizer_coerces_numeric_columns():
    raw = pd.DataFrame(
        [
            {
                "date": "2024-01-02",
                "stock_id": "2330",
                "MarginPurchaseBuy": "10",
                "MarginPurchaseSell": "2",
                "MarginPurchaseTodayBalance": "100",
                "ShortSaleBuy": "",
                "ShortSaleSell": "3",
                "ShortSaleTodayBalance": "20",
            }
        ]
    )

    out = normalize_margin_df(raw, "2330")

    row = out.iloc[0].to_dict()
    assert row["margin_purchase_buy"] == 10
    assert row["margin_purchase_sell"] == 2
    assert row["margin_purchase_today_balance"] == 100
    assert pd.isna(row["short_sale_buy"])
    assert row["short_sale_sell"] == 3


def test_foreign_shareholding_normalizer_coerces_numeric_columns():
    raw = pd.DataFrame(
        [
            {
                "date": "2024-01-02",
                "stock_id": "2330",
                "stock_name": "台積電",
                "InternationalCode": "TW0002330008",
                "ForeignInvestmentRemainingShares": "100",
                "ForeignInvestmentShares": "900",
                "ForeignInvestmentRemainRatio": "10.5",
                "ForeignInvestmentSharesRatio": "89.5",
                "ForeignInvestmentUpperLimitRatio": "100",
                "ChineseInvestmentUpperLimitRatio": "",
                "NumberOfSharesIssued": "1000",
                "RecentlyDeclareDate": "2023-12-31",
                "note": "",
            }
        ]
    )

    out = normalize_foreign_shareholding_df(raw, "2330")

    row = out.iloc[0].to_dict()
    assert row["foreign_investment_remaining_shares"] == 100
    assert row["foreign_investment_shares"] == 900
    assert row["foreign_investment_remain_ratio"] == 10.5
    assert pd.isna(row["chinese_investment_upper_limit_ratio"])
    assert row["number_of_shares_issued"] == 1000


def test_holding_shares_per_disabled_returns_empty_without_fetching():
    args = Namespace(include_holding_shares_per=False, start="2024-01-01", end="2024-01-31")

    out, warnings = get_holding_share_levels_df("2330", args, token=None)

    assert out.empty
    assert "skipped" in warnings[0].lower()
