"""Stale-data notices, market-relative track record, and settled reviews fed back into text briefs."""
import asyncio
import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.clients.llm import LlmResult
from app.db.models.benchmark_price import BenchmarkPrice
from app.db.models.brief_lesson import BRIEF_LESSON_READY, BRIEF_LESSON_REJECTED, BriefLesson
from app.db.models.daily_price import DailyPrice
from app.db.models.stock_info import StockInfo
from app.features.analysis import lessons, repository, track_record as tr
from app.features.analysis.evidence import build_evidence_bundle, freshness_gaps
from app.features.analysis.schemas import StockBehaviorTextBriefRequest
from app.features.analysis.service import AnalysisService
from app.jobs import brief_lessons
from test_ai_effectiveness import add_brief, add_prices, trading_days
from test_analysis_service import AS_OF, FakeRag, brief_payload, seed_prices


def day(value):
    return SimpleNamespace(date=value)


# ── 資料過期警示 ──

def test_freshness_names_sources_that_stopped_updating():
    as_of = date(2026, 10, 8)
    prices = [day(date(2026, 10, 6)), day(date(2026, 10, 7))]
    gaps = freshness_gaps(price_rows=prices, chip_rows=[day(date(2026, 10, 6))], technical_rows=prices,
                          benchmark_rows=[day(date(2026, 10, 8))], as_of_date=as_of)
    assert gaps == ["2026-10-08 的個股行情（大盤已有該日收盤，個股只到 2026-10-07；可能暫停交易或資料尚未更新）",
                    "2026-10-06 之後的三大法人買賣超（行情已到 2026-10-07）"]
    # Lunar New Year closes the market for about nine days; that alone is not stale data.
    holiday = [day(date(2026, 2, 13))]
    assert freshness_gaps(price_rows=holiday, chip_rows=holiday, technical_rows=holiday,
                          benchmark_rows=holiday, as_of_date=date(2026, 2, 22)) == []
    stale = freshness_gaps(price_rows=holiday, chip_rows=[], technical_rows=[day(date(2026, 2, 12))],
                           benchmark_rows=[], as_of_date=date(2026, 3, 2))
    assert stale == ["2026-02-13 之後的行情（距分析基準日 17 天，資料可能尚未更新）",
                     "2026-02-12 之後的技術指標（行情已到 2026-02-13）"]
    assert freshness_gaps(price_rows=[], chip_rows=[], technical_rows=[], benchmark_rows=[], as_of_date=as_of) == []


def test_stale_stock_makes_the_bundle_limited_input():
    as_of = date(2026, 10, 8)
    rows = {"price_rows": [SimpleNamespace(date=date(2026, 10, 7), close=Decimal("100"), volume_shares=1000)],
            "chip_rows": [], "technical_rows": [], "income_rows": [], "revenue_rows": [], "valuation_rows": [],
            "benchmark_rows": [SimpleNamespace(date=date(2026, 10, 8), close=Decimal("20000"))]}
    bundle = build_evidence_bundle(symbol="2330", as_of_date=as_of, rows=rows, news_sources=[])
    assert bundle.missing_fields[0].startswith("2026-10-08 的個股行情")
    assert "past_reviews" not in bundle.as_payload_sections()


# ── 戰績：相對大盤 ──

def add_benchmark(db, closes):
    days = trading_days(len(closes))
    db.add_all([BenchmarkPrice(symbol="TAIEX", date=item, close=close) for item, close in zip(days, closes)])


def test_track_record_compares_each_call_with_the_market(db_session):
    # The stock rises 5% in five sessions while the market rises 10%: right on direction, behind the market.
    days = add_prices(db_session, "2330", [100, 101, 102, 103, 104, 105, 106])
    add_benchmark(db_session, [1000, 1020, 1040, 1060, 1080, 1100, 1110])
    add_brief(db_session, "2330", days[0])
    add_brief(db_session, "2330", days[1], short="bearish")
    db_session.commit()
    result = tr.track_record(db_session, symbol="2330", days=365, today=days[-1])
    first = result.recent[-1].outcomes[0]
    assert (first.result, first.return_pct, first.benchmark_return_pct, first.resolved_on) == (
        "hit", 5.0, 10.0, days[5].isoformat())
    assert tr.beat_market(first) is False
    second = result.recent[0].outcomes[0]
    # 101 -> 106 is a miss; the market's 1020 -> 1110 (8.82%) beats the stock's 4.95%, so bearish wins relatively.
    assert second.result == "miss" and tr.beat_market(second) is True
    short = result.horizons[0]
    assert (short.relative_calls, short.relative_hits, short.relative_hit_rate) == (2, 1, 0.5)


def test_market_change_needs_the_benchmark_to_have_traded_through_the_end():
    series = [(date(2026, 1, 5), 100.0), (date(2026, 1, 6), 110.0)]
    assert tr.benchmark_change(series, date(2026, 1, 5), date(2026, 1, 6)) == pytest.approx(0.1)
    assert tr.benchmark_change(series, date(2026, 1, 5), date(2026, 1, 7)) is None
    assert tr.benchmark_change(series, date(2025, 12, 1), date(2026, 1, 6)) is None
    assert tr.benchmark_change([], date(2026, 1, 5), date(2026, 1, 6)) is None


# ── 結算與檢討 ──

class FakeReviewer:
    model_name = "review-model"

    def __init__(self, text="五日個股上漲 5.00%，加權指數上漲 10.00%，偏多方向成立但落後大盤。"
                            "當時理由中的價格位置被結果支持。下次要另外比較同期大盤。"):
        self.text_value, self.prompts = text, []

    async def text(self, *, system_prompt, prompt):
        self.prompts.append(prompt)
        return LlmResult({}, self.text_value, {"truncated": False})


@pytest.fixture
def factory(db_session):
    return sessionmaker(db_session.get_bind(), expire_on_commit=False)


def seed_daily_briefs(db, count=10):
    days = add_prices(db, "2330", [100 + i for i in range(60)])
    add_benchmark(db, [1000 + i for i in range(60)])
    for index in range(count):
        add_brief(db, "2330", days[index])
    db.commit()
    return days


def settle(factory, llm, today, **kwargs):
    return asyncio.run(brief_lessons.settle(factory, llm, ["2330"], limit=kwargs.pop("limit", 30),
                                            execute=kwargs.pop("execute", True), today=today, **kwargs))


def test_overlapping_daily_calls_are_thinned_to_one_review_per_window(db_session, factory):
    days = seed_daily_briefs(db_session)
    # The day-2 short call is reviewed (window days 2–7); the swing calls are neutral; one 40-day call.
    db_session.add(BriefLesson(symbol="2330", as_of_date=days[2], horizon="short_1_5", snapshot_id=0,
                               stance="bullish", return_pct=1.0, result="hit", resolved_on=days[7],
                               lesson="x", status=BRIEF_LESSON_READY))
    db_session.commit()
    due, _ = brief_lessons._load_due(factory, ["2330"], days[-1], 365)
    # Days 0–6 overlap the reviewed window, including the earlier ones; day 7 starts on its last close.
    assert sorted((item.horizon, item.as_of_date) for item in due) == [
        ("medium_21_40", days[0]), ("short_1_5", days[7])]
    # Prices only rise: the short bullish calls hit and the 40-day bearish call misses.
    assert {item.horizon: item.result for item in due} == {"short_1_5": "hit", "medium_21_40": "miss"}

    # Once the reviewed brief falls out of the lookback, its window still covers the calls after it.
    lookback = (days[-1] - days[3]).days
    due, _ = brief_lessons._load_due(factory, ["2330"], days[-1], lookback)
    assert sorted((item.horizon, item.as_of_date) for item in due) == [
        ("medium_21_40", days[3]), ("short_1_5", days[7])]


def test_settle_writes_reviews_once_and_rejects_advice(db_session, factory):
    days = seed_daily_briefs(db_session, count=1)
    reviewer = FakeReviewer()
    dry = settle(factory, reviewer, days[-1], execute=False)
    assert dry["due"] == 2 and not reviewer.prompts
    report = settle(factory, reviewer, days[-1])
    assert (report["ready"], report["rejected"], report["failed"]) == (2, 0, 0)
    assert "當時立場：偏多" in reviewer.prompts[-1] or "當時立場：偏空" in reviewer.prompts[-1]
    assert "加權指數 +" in reviewer.prompts[0]
    rows = list(db_session.scalars(select(BriefLesson).order_by(BriefLesson.horizon)))
    assert [(row.horizon, row.status, row.model_name) for row in rows] == [
        ("medium_21_40", BRIEF_LESSON_READY, "review-model"), ("short_1_5", BRIEF_LESSON_READY, "review-model")]
    assert rows[1].resolved_on == days[5] and rows[1].benchmark_return_pct == pytest.approx(0.5, abs=0.01)
    assert settle(factory, reviewer, days[-1])["due"] == 0

    db_session.query(BriefLesson).delete()
    db_session.commit()
    settle(factory, FakeReviewer("下次遇到同樣情況建議逢低買進，並嚴設停損。"), days[-1])
    assert {row.status for row in db_session.scalars(select(BriefLesson))} == {BRIEF_LESSON_REJECTED}


def test_lessons_scope_setting():
    assert not lessons.lessons_enabled(SimpleNamespace(TEXT_BRIEF_LESSONS_SYMBOLS=""), "2330")
    assert lessons.lessons_enabled(SimpleNamespace(TEXT_BRIEF_LESSONS_SYMBOLS="*"), "2330")
    scoped = SimpleNamespace(TEXT_BRIEF_LESSONS_SYMBOLS="2330, 2454")
    assert lessons.lessons_enabled(scoped, "2454") and not lessons.lessons_enabled(scoped, "2317")


# ── 注入到 AI 摘要 ──

class CapturingLlm:
    model_name = "test-model"

    def __init__(self, payload=None):
        self.payload, self.calls, self.packet, self.system = payload or brief_payload(), 0, None, None

    def require_enabled(self):
        return None

    async def generate(self, *, system_prompt, payload, schema, examples=()):
        self.calls += 1
        self.packet, self.system = payload, system_prompt
        return LlmResult(json.loads(json.dumps(self.payload)), json.dumps(self.payload), {"truncated": False})


def review(symbol="2330", as_of=date(2026, 7, 1), resolved=date(2026, 7, 8), status=BRIEF_LESSON_READY, text="檢討"):
    return BriefLesson(symbol=symbol, as_of_date=as_of, horizon="short_1_5", snapshot_id=1, stance="bullish",
                       return_pct=-2.5, benchmark_return_pct=0.4, result="miss", resolved_on=resolved,
                       lesson=text, status=status)


def run(db, settings, llm, **request):
    async def go():
        async with httpx.AsyncClient() as http:
            service = AnalysisService(db=db, settings=settings, http=http, llm=llm, rag=FakeRag())
            return await service.generate_text_brief(StockBehaviorTextBriefRequest(symbol="2330", as_of_date=AS_OF,
                                                                                   **request))
    return asyncio.run(go())


@pytest.fixture
def seeded(db_session):
    db_session.add(StockInfo(symbol="2330", name="TSMC"))
    seed_prices(db_session)
    db_session.add_all([
        review(text="五日下跌 2.50%，偏多判斷不成立。"),
        review(as_of=date(2026, 7, 2), resolved=date(2026, 7, 14), text="到期日在分析日之後"),
        review(as_of=date(2026, 7, 3), resolved=date(2026, 7, 9), status=BRIEF_LESSON_REJECTED, text="被擋下"),
        review(symbol="2317", text="別檔"),
    ])
    db_session.commit()
    return db_session


def test_reviews_reach_the_brief_only_when_enabled_and_already_settled(seeded, settings):
    plain = CapturingLlm()
    assert run(seeded, settings, plain).past_review_count is None
    assert "past_reviews" not in plain.packet and "past_reviews" not in plain.system
    stored = json.loads(seeded.scalar(select(repository.LlmResponse.config_json)))
    assert "past_reviews" not in stored and "past_review_count" not in stored

    settings.TEXT_BRIEF_LESSONS_SYMBOLS = "2330"
    cited = brief_payload()
    cited["current_status"][0]["evidence_ids"] = ["d_04", "pr_01"]
    llm = CapturingLlm(cited)
    response = run(seeded, settings, llm)
    assert llm.calls == 1, "enabling reviews changes the config, so the earlier snapshot is not reused"
    assert [item["review"] for item in llm.packet["past_reviews"]] == ["五日下跌 2.50%，偏多判斷不成立。"]
    assert llm.packet["past_reviews"][0]["id"] == "pr_01"
    assert "<past_reviews>" in llm.system
    assert response.brief.current_status[0].evidence_ids == ["d_04"]
    assert response.past_review_count == 1
    assert repository.load_latest_saved(seeded, symbol="2330", as_of=AS_OF).past_review_count == 1
    configs = [json.loads(value) for value in seeded.scalars(
        select(repository.LlmResponse.config_json).order_by(repository.LlmResponse.id))]
    assert configs[-1]["past_review_count"] == 1 and configs[-1]["past_reviews"]


def test_a_new_review_invalidates_the_cached_brief(seeded, settings):
    settings.TEXT_BRIEF_LESSONS_SYMBOLS = "*"
    llm = CapturingLlm()
    run(seeded, settings, llm)
    assert run(seeded, settings, llm).cached and llm.calls == 1
    seeded.add(review(as_of=date(2026, 7, 6), resolved=date(2026, 7, 13), text="新結算的檢討"))
    seeded.commit()
    assert not run(seeded, settings, llm).cached and llm.calls == 2
    assert llm.packet["past_reviews"][-1]["review"] == "新結算的檢討"


def test_compare_splits_briefs_by_whether_they_read_reviews(db_session, factory):
    days = add_prices(db_session, "2330", [100 + i for i in range(10)])
    add_brief(db_session, "2330", days[0])
    add_brief(db_session, "2330", days[1], short="bearish")
    db_session.commit()
    first, second = db_session.scalars(select(repository.LlmResponse).order_by(repository.LlmResponse.id))
    second.config_json = json.dumps({"purpose": "production", "past_review_count": 2})
    db_session.commit()
    report = brief_lessons.compare(factory, None, days[-1], 365)
    assert report["with_reviews"]["briefs"] == report["without_reviews"]["briefs"] == 1
    assert report["with_reviews"]["horizons"][0]["hit_rate"] == 0.0
    assert report["without_reviews"]["horizons"][0]["hit_rate"] == 1.0
