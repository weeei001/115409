import asyncio
import json
from datetime import date
from decimal import Decimal

from app.db.models.daily_price import DailyPrice
from app.db.models.llm_response import LlmResponse
from app.db.models.market_extra import FinancialStatementRow, MonthlyRevenue, StockValuation
from app.db.models.news_article import NewsArticle
from app.db.models.stock_info import StockInfo
from app.features.analysis import repository
from app.features.analysis.evidence import build_evidence_bundle
from app.features.analysis.schemas import StockBehaviorTextBriefRequest
from app.features.analysis.service import AnalysisService
from app.features.retrieval.schemas import RagResult
from test_analysis_service import FakeLlm, FakeRag, brief_payload


AS_OF = date(2026, 10, 12)
SYMBOL = "6446"
NAME = "藥華藥"


def test_mixed_period_database_evidence_reaches_llm_without_output_content_gate(db_session, settings):
    db_session.add(StockInfo(symbol=SYMBOL, name=NAME))
    days = [date(2026, 10, day) for day in (6, 7, 8, 12)]
    db_session.add_all([
        DailyPrice(symbol=SYMBOL, date=day, close=Decimal(600 + index), volume_shares=1_000_000)
        for index, day in enumerate(days)
    ])
    for period, eps in ((date(2025, 6, 30), "2.50"), (date(2025, 9, 30), "3.99"),
                        (date(2025, 12, 31), "3.98"), (date(2026, 3, 31), "5.79"),
                        (date(2026, 6, 30), "6.13")):
        db_session.add(FinancialStatementRow(
            symbol=SYMBOL, date=period, statement="income", item_type="EPS", value=Decimal(eps),
        ))
    db_session.add_all([
        FinancialStatementRow(symbol=SYMBOL, date=date(2026, 6, 30), statement="income",
                              item_type=metric, value=value)
        for metric, value in (("Revenue", 1000), ("GrossProfit", 942), ("OperatingIncome", 460))
    ])
    db_session.add_all([
        MonthlyRevenue(symbol=SYMBOL, date=date(year, month, 1), revenue_year=year,
                       revenue_month=month, revenue=value)
        for year, month, value in ((2025, 9, 1000), (2026, 8, 2200), (2026, 9, 3000))
    ])
    db_session.add(StockValuation(symbol=SYMBOL, date=date(2026, 10, 8), per=Decimal("40.2")))
    source = {
        "title": "藥華藥第三季營收公告", "summary": "2026 年第三季營收 77.59 億元，前三季累計 197.37 億元。",
        "timestamp": "2026-10-09T09:00:00+08:00", "url": "https://example.test/news/q3-revenue",
        "publisher": "Test publisher", "article_id": "period-news", "chunk_id": "period-chunk",
    }
    db_session.add(NewsArticle(
        article_id=source["article_id"], source="cnyes", stock_id=SYMBOL, title=source["title"],
        content=source["summary"], pub_time=source["timestamp"], url=source["url"], content_kind="fulltext",
    ))
    db_session.commit()
    bundle = build_evidence_bundle(
        symbol=SYMBOL, as_of_date=AS_OF,
        rows=repository.collect_rows(db_session, symbol=SYMBOL, as_of=AS_OF), news_sources=[source],
    )
    raw_catalog = {item["id"]: item for item in bundle.catalog()}
    payload = brief_payload()
    for item, day in zip(payload["key_days"], days[1:]):
        item["date"] = day.isoformat()
    # The regression targets the model's input, not a new validator for its answer.
    wrong_period_claim = "2026 年第三季每股盈餘為 6.13 元。"
    payload["current_status"][0].update(text=wrong_period_claim, evidence_ids=["fd_01"])
    llm = FakeLlm(payload)
    rag = FakeRag(RagResult(news_sources=[source]))
    service = AnalysisService(db=db_session, settings=settings, http=None, llm=llm, rag=rag)
    response = asyncio.run(service.generate_text_brief(
        StockBehaviorTextBriefRequest(symbol=SYMBOL, as_of_date=AS_OF),
    ))

    packet = llm.packet
    fundamental = {item["field"]: item for item in packet["fundamental"]}
    eps = fundamental["eps"]
    assert eps["subject"] == {"symbol": SYMBOL, "name": NAME}
    assert (eps["id"], eps["period"], eps["value"]) == ("fd_01", "2026Q2", 6.13)
    assert (eps["period_start"], eps["period_end"]) == ("2026-04-01", "2026-06-30")
    assert eps["metric_basis"] == "single_quarter" and eps["unit"] == "TWD/share"
    assert eps["date_role"] == "reporting_period_end"
    assert (eps["qoq_base_period"], eps["yoy_base_period"]) == ("2026Q1", "2025Q2")
    assert eps["yoy_pct"] == 145.2 and eps["qoq_pct"] == 5.9
    assert all(text in eps["fact"] for text in (NAME, "2026", "6.13"))
    assert eps["last4q"][-1] == {
        "period": "2026Q2", "period_start": "2026-04-01", "period_end": "2026-06-30",
        "period_label": "2026 年第 2 季（4–6 月）", "value": 6.13,
    }
    for field in ("gross_margin_pct", "operating_margin_pct"):
        assert fundamental[field]["period"] == "2026Q2"
        assert fundamental[field]["metric_basis"] == "single_quarter"
    revenue = fundamental["revenue_monthly"]
    assert (revenue["period"], revenue["period_start"], revenue["period_end"]) == (
        "2026-09", "2026-09-01", "2026-09-30",
    )
    assert revenue["metric_basis"] == "single_month" and revenue["unit"] == "TWD"
    assert (revenue["mom_base_period"], revenue["yoy_base_period"]) == ("2026-08", "2025-09")
    assert revenue["yoy_last6"] == [{"period": "2026-09", "base_period": "2025-09", "yoy_pct": 200.0}]
    assert fundamental["per"]["date_role"] == "trading_date"
    assert packet["temporal_context"]["analysis_cutoff"] == AS_OF.isoformat()
    assert packet["temporal_context"]["latest_included"] == {
        "trading_date": "2026-10-12", "financial_period": "2026Q2",
        "monthly_revenue_period": "2026-09", "valuation_date": "2026-10-08",
    }
    news = packet["news"][0]
    assert (news["date"], news["date_role"]) == ("2026-10-09", "news_publication_date")
    assert news["article_id"] == source["article_id"] and news["chunk_id"] == source["chunk_id"]
    assert news["value"] == source["summary"] and "event_date" not in news

    catalog = {item.id: item.model_dump(exclude_none=True) for item in response.evidence_catalog}
    for item in packet["fundamental"]:
        original = raw_catalog[item["id"]]
        saved = catalog[item["id"]]
        for key, value in original.items():
            if key != "collected_at":
                assert saved[key] == value
        assert "subject" not in saved and "fact" not in saved and "metric_basis" not in saved
        assert item["publication_basis"] == original["publication_basis"]
    assert catalog["fd_01"]["last4q"][-1] == ["2026Q2", 6.13]
    assert "date_role" not in catalog[news["id"]]
    assert response.brief.current_status[0].text == wrong_period_claim
    assert response.status != "unavailable" and llm.calls == rag.calls == 1
    snapshot = db_session.get(LlmResponse, response.snapshot_id)
    assert json.loads(snapshot.config_json)["content_validation"] is False
    assert json.loads(snapshot.response_json)["brief"]["current_status"][0]["text"] == wrong_period_claim
