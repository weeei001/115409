from datetime import date
from urllib.parse import parse_qs

import httpx
import pytest
from sqlalchemy import delete, select

from app.db.models.market_extra import HoldingShareLevel
from app.jobs.market import tdcc_history as history
from app.jobs.market.tdcc_shareholding import map_rows


DAY = date(2025, 10, 17)


def html(symbol="2330", *, day=DAY, levels=17, adjustment=True):
    form = ('<form id="form1" action="/portal/zh/smWeb/qryStock">'
            '<input type="hidden" name="SYNCHRONIZER_TOKEN" value="token">'
            '<input type="hidden" name="firDate" value="20251024">'
            '<select name="scaDate"><option value="20251017">20251017</option>'
            '<option value="20251024">20251024</option></select></form>')
    header = "<thead><tr>" + "".join(f"<th>{value}</th>" for value in history.HEADERS) + "</tr></thead>"
    labels = list(history.LEVELS[:levels])
    if not adjustment and levels == 17:
        labels = [*history.LEVELS[:15], history.LEVELS[16]]
    rows = []
    for sequence, label in enumerate(labels, 1):
        is_adjustment = label.startswith("差異數調整")
        people, shares, percent = ("", "-1,000", "-0.01") if is_adjustment else ("1", "1,000", "1.00")
        rows.append(f"<tr><td>{sequence}</td><td>{label}</td><td>{people}</td><td>{shares}</td><td>{percent}</td></tr>")
    return (form + f"證券代號：{symbol} 資料日期：{day.year-1911}年{day.month}月{day.day}日"
            + "<table>" + header + "".join(rows) + "</table>")


def test_tdcc_advertised_dates_and_session_post_preserve_negative_adjustment():
    calls = []
    def handler(request):
        calls.append(request.method)
        if request.method == "POST":
            data = parse_qs(request.content.decode())
            assert data["scaDate"] == ["20251017"] and data["stockNo"] == ["2330"]
            assert data["SYNCHRONIZER_TOKEN"] == ["token"]
        return httpx.Response(200, text=html())
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        client = history.QueryClient(http, interval=0)
        assert client.discover() == [DAY, date(2025, 10, 24)]
        rows = client.fetch(DAY, "2330")
    assert len(rows) == 17 and calls == ["GET", "POST"]
    assert rows[15]["people"] is None and rows[15]["unit"] == -1000 and rows[15]["percent"] == "-0.01"


def test_tdcc_history_accepts_omitted_zero_adjustment_level():
    rows = history.parse_distribution(html(adjustment=False), DAY, "2330")
    assert len(rows) == 16
    assert rows[-1]["holding_shares_level"] == "合計"


@pytest.mark.parametrize("body", [html("6488"), html(day=date(2025, 10, 24)), html(levels=16)])
def test_tdcc_rejects_wrong_company_date_or_missing_level(body):
    with pytest.raises(ValueError):
        history.parse_distribution(body, DAY, "2330")


def test_tdcc_resume_keeps_old_history_and_checks_all_levels(db_session, tmp_path):
    class Client:
        calls = 0
        def discover(self):
            return [DAY]
        def fetch(self, day, symbol):
            self.calls += 1
            return history.parse_distribution(html(symbol), day, symbol)
    client = Client()
    options = dict(symbols=["2330", "6488"], start=date(2021, 1, 1), end=date(2026, 10, 10),
                   out=tmp_path / "report.json")
    report = history.backfill(db_session.bind, client, **options)
    assert report["ok"] and report["available_range_complete"] and not report["requested_range_complete"]
    assert report["expected_company_weeks"] == report["complete_company_weeks"] == 2
    assert report["available_dates"] == ["2025-10-17"]
    assert len(list(db_session.scalars(select(HoldingShareLevel)))) == 34
    history.backfill(db_session.bind, client, **options, resume=True)
    assert client.calls == 2
    db_session.execute(delete(HoldingShareLevel).where(HoldingShareLevel.symbol == "6488",
        HoldingShareLevel.holding_shares_level == history.LEVELS[0]))
    db_session.commit()
    history.backfill(db_session.bind, client, **options, resume=True)
    assert client.calls == 3 and len(list(db_session.scalars(select(HoldingShareLevel)))) == 34


def test_tdcc_backfill_accepts_complete_week_without_adjustment_level(db_session, tmp_path):
    class Client:
        def discover(self):
            return [DAY]
        def fetch(self, day, symbol):
            return history.parse_distribution(html(symbol, adjustment=False), day, symbol)
    report = history.backfill(db_session.bind, Client(), symbols=["2330"], start=DAY, end=DAY,
                              out=tmp_path / "no-adjustment.json")
    assert report["ok"] and report["complete_company_weeks"] == 1
    assert len(list(db_session.scalars(select(HoldingShareLevel)))) == 16


def test_tdcc_snapshot_allows_only_adjustment_level_negative_values():
    row = {"證券代號": "2330", "\ufeff資料日期": "20251017", "持股分級": "16",
           "人數": "", "股數": "-1000", "占集保庫存數比例%": "-0.01"}
    result = map_rows([row], {"2330"})[0]
    assert result["unit"] == -1000 and result["people"] is None
    with pytest.raises(ValueError):
        map_rows([{**row, "持股分級": "1"}], {"2330"})
