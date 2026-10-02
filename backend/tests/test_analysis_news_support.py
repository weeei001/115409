from datetime import date
from types import SimpleNamespace

import pytest

from app.features.analysis.evidence import EvidenceBundle, build_news_items
from app.features.analysis.validation import _grounding_issues
from app.features.analysis import validation as gate
from app.features.analysis.service import AnalysisService
from app.features.analysis.router import get_service


def test_optional_forecast_excerpts_do_not_allow_fabricated_quotes_or_uncited_entities():
    bundle = EvidenceBundle(symbol="2317", as_of_date=date(2026, 10, 2), news=[
        {"id": "nw_01", "field": "news", "value": "ASIC 專案增加，訂單展望改善。"},
        {"id": "nw_02", "field": "news", "value": "公司預期明年訂單仍將持續向上。"},
        {"id": "nw_03", "field": "news", "value": "HBM 需求增加。"},
    ])
    view = {"stance": "bullish", "reason": "ASIC 訂單展望支持中期偏多。",
            "evidence_ids": ["nw_01", "nw_02"], "news_support": []}
    assert all(issue.startswith("未核實") for issue in _grounding_issues(view, bundle))
    view["news_support"] = [{"evidence_id": "nw_02", "quote": "公司保證股價上漲", "use": "attributed_view"}]
    assert "新聞主張引文不存在於引用片段" in _grounding_issues(view, bundle)
    view["news_support"] = []
    view["reason"] = "HBM 訂單展望支持中期偏多。"
    assert "主張的產品或實體名稱不在同項引用來源" in _grounding_issues(view, bundle)
    observation = {"id": "cs_01", "text": "ASIC 專案增加。", "evidence_ids": ["nw_01"], "news_support": []}
    assert "新聞主張缺少同項原文支持契約" in _grounding_issues(observation, bundle)


def test_financial_thresholds_use_local_citations_and_labeled_scenarios():
    bundle = EvidenceBundle(symbol="2330", as_of_date=date(2026, 9, 27),
        daily_timeline=[{"id": "d_01", "date": "2026-09-25", "close": 2400}],
        chip_summary=[{"id": "ch_01", "field": "foreign_net_10d_lots", "value": -300}],
        fundamental=[{"id": "fd_01", "field": "per", "date": "2026-09-25", "value": 30}],
        news=[{"id": "nw_01", "field": "news", "value": "公司表示 AI 資本支出成長，仍有需求不確定性。"}])
    item = {"id": "wp_02", "why_it_matters": "需觀察是否在 2,400 元附近形成強大支撐。",
            "evidence_ids": ["ch_01"]}
    assert "價格未獲同項證據支持" in _grounding_issues(item, bundle)
    item.update(why_it_matters="觀察 2026-09-25 收盤 2,400 元；歷史價位尚未證實為支撐。", evidence_ids=["d_01"])
    assert not _grounding_issues(item, bundle)
    item = {"id": "rk_01", "trigger": "本益比顯著低於 25 倍或 AI 資本支出降溫",
            "evidence_ids": ["nw_01"], "news_support": [{"evidence_id": "nw_01",
            "quote": bundle.news[0]["value"], "use": "attributed_view"}]}
    assert any("估值倍數" in issue for issue in _grounding_issues(item, bundle))
    item.update(trigger="本益比低於 25 倍", evidence_ids=["fd_01"], news_support=[])
    assert any("估值倍數" in issue for issue in _grounding_issues(item, bundle))
    item["trigger"] = "情境假設：本益比低於 25 倍；此門檻為推論，並非來源預測。"
    assert not _grounding_issues(item, bundle)
    item["trigger"] = "本益比低於 30 倍"
    assert not _grounding_issues(item, bundle)
    item["trigger"] = "股價淨值比低於 30 倍"
    assert _grounding_issues(item, bundle)


def test_valuation_levels_do_not_prove_strong_downside_protection():
    bundle = EvidenceBundle(symbol="2603", as_of_date=date(2026, 9, 27), fundamental=[
        {"id": "fd_05", "field": "per", "value": 9.64, "pct_rank_1y": 94},
        {"id": "fd_07", "field": "dividend_yield", "value": 6.58, "pct_rank_1y": 2}])
    item = {"stance": "mildly_bullish", "reason": "本益比 9.64 倍與高殖利率 6.58% 提供強大下行支撐。",
            "evidence_ids": ["fd_05", "fd_07"]}
    assert any("強大下行支撐" in issue for issue in _grounding_issues(item, bundle))
    item["reason"] = "殖利率 6.58% 可能吸引收益需求，但無法確認是否足以支撐股價。"
    assert not _grounding_issues(item, bundle)
    item["reason"] = "本益比 9.64 倍不能證明強大下行支撐。"
    assert not _grounding_issues(item, bundle)


def test_revenue_growth_requires_growth_data_in_the_cited_month_or_news():
    bundle = EvidenceBundle(symbol="2603", as_of_date=date(2026, 9, 27), fundamental=[
        {"id": "fd_04", "field": "revenue_monthly", "period": "2026-08", "value": 48985697000, "yoy_last6": []}])
    item = {"stance": "bullish", "reason": "營收年增率強勁，長期基本面支撐穩固。", "evidence_ids": ["fd_04"]}
    assert any("營收年增敘述" in issue for issue in _grounding_issues(item, bundle))
    bundle.fundamental[0]["yoy_last6"] = [["2026-07", 20.0]]
    assert _grounding_issues(item, bundle)
    bundle.fundamental[0]["yoy_pct"] = -10.0
    assert _grounding_issues(item, bundle)
    bundle.fundamental[0]["yoy_pct"] = 48.6
    item["reason"] = "營收年增率強勁，可能有助營運，但價格方向仍不確定。"
    assert not _grounding_issues(item, bundle)
    bundle.fundamental[0].pop("yoy_pct")
    bundle.fundamental[0]["yoy_last6"] = [["2026-08", 48.6]]
    assert not _grounding_issues(item, bundle)
    bundle.fundamental[0]["yoy_last6"] = []
    item["reason"] = "營收年增率資料不足，無法判斷成長方向。"
    assert not _grounding_issues(item, bundle)
    quote = "公司八月營收年增48%，實際營運仍受景氣影響。"
    bundle.news = [{"id": "nw_01", "field": "news", "value": quote}]
    item.update(reason="報導指出營收年增強勁，惟未必帶動股價。", evidence_ids=["nw_01"],
                news_support=[{"evidence_id": "nw_01", "quote": quote, "use": "reported_fact"}])
    assert not _grounding_issues(item, bundle)


def test_macd_reversal_is_not_continuous_expansion_and_catalog_keeps_indicator():
    bundle = EvidenceBundle(symbol="2330", as_of_date=date(2026, 9, 27), daily_timeline=[
        {"id": "d_32", "date": "2026-09-15", "macd_hist": -2.39},
        {"id": "d_39", "date": "2026-09-24", "macd_hist": 6.14},
        {"id": "d_40", "date": "2026-09-25", "macd_hist": 5.81}])
    item = {"id": "cs_02", "text": "MACD 柱狀體由負轉正並持續擴大。",
            "evidence_ids": ["d_32", "d_39", "d_40"]}
    assert _grounding_issues(item, bundle) == ["MACD 趨勢未獲同項日期序列支持"]
    item["text"] = "MACD 柱狀體由負轉正。"
    assert not _grounding_issues(item, bundle)
    item["evidence_ids"] = ["d_39", "d_40"]
    assert _grounding_issues(item, bundle)
    item["text"] = "MACD 柱狀體持續縮小。"
    assert not _grounding_issues(item, bundle)
    bundle.daily_timeline[-1]["macd_hist"] = 7.0
    item.update(text="MACD 柱狀體由負轉正並持續擴大。", evidence_ids=["d_40", "d_32", "d_39"])
    assert not _grounding_issues(item, bundle)
    assert [row["value"]["macd_hist"] for row in bundle.catalog()] == [-2.39, 6.14, 7.0]


def test_single_day_foreign_trades_are_not_confused_with_volume_percentage():
    bundle = EvidenceBundle(symbol="2014", as_of_date=date(2026, 10, 1), daily_timeline=[
        {"id": "d_40", "date": "2026-09-24", "chg_pct": 1.5,
         "vol_vs_ma5_pct": 106.0, "foreign_net_lots": 1927}],
        chip_summary=[{"id": "ch_01", "field": "foreign_net_10d_lots", "value": -229}])
    item = {"id": "kd_04", "date": "2026-09-24", "ref": "d_40", "evidence_ids": ["d_40"],
            "what": "股價上漲 1.5% 且成交量較五日均量放大 106%，外資單日買超 1927 張。"}
    assert not _grounding_issues(item, bundle)
    item["what"] = "外資單日買超 1928 張。"
    assert _grounding_issues(item, bundle)
    item.update(what="外資近十日買超 1927 張。", evidence_ids=["d_40", "ch_01"])
    assert _grounding_issues(item, bundle)


def test_historical_revenue_signs_do_not_override_the_latest_month():
    bundle = EvidenceBundle(symbol="2014", as_of_date=date(2026, 10, 1), fundamental=[
        {"id": "fd_04", "field": "revenue_monthly", "period": "2026-08", "yoy_pct": -29.3,
         "yoy_last6": [["2026-02", -24.5], ["2026-03", -24.7], ["2026-04", -10.0],
                       ["2026-05", 4.3], ["2026-06", 47.9], ["2026-08", -29.3]]}])
    item = {"id": "neg_01", "evidence_ids": ["fd_04"],
            "text": "8 月營收年增率衰退 29.3%，近六筆已提供月份中有兩筆年增為正。"}
    assert not _grounding_issues(item, bundle)
    item["text"] = "2026-05 月營收年增 4.3%；2026-08 月營收年減 29.3%。"
    assert not _grounding_issues(item, bundle)
    item["text"] = "8 月營收年增為正。"
    assert _grounding_issues(item, bundle)
    item["text"] = "8 月營收年減 47.9%。"
    assert _grounding_issues(item, bundle)


def test_eps_condition_is_checked_as_earnings_instead_of_stock_price():
    bundle = EvidenceBundle(symbol="2727", as_of_date=date(2026, 10, 1),
        daily_timeline=[{"id": "d_40", "date": "2026-09-24", "close": 232}],
        fundamental=[{"id": "fd_01", "field": "eps", "period": "2026Q2",
                      "date": "2026-06-30", "value": 4.82}])
    item = {"stance": "mildly_bullish", "reason": "已公告單季 EPS 4.82 元，後續獲利仍待觀察。",
            "invalidation": "單季 EPS 較 2026Q2 (4.82元) 顯著衰退", "evidence_ids": ["fd_01"]}
    assert not _grounding_issues(item, bundle)
    assert not any(hit.severity == "hard" for hit in gate._scan_text_brief_compliance(
        item, prices=gate._historical_prices(bundle)))
    item["invalidation"] = "單季 EPS 為 999 元。"
    assert _grounding_issues(item, bundle)
    item.update(reason="後續獲利仍待觀察。", invalidation="單季 EPS 為 4.82 元。", evidence_ids=["d_40"])
    assert _grounding_issues(item, bundle)
    item.update(invalidation="股價跌破 4.82 元", evidence_ids=["fd_01"])
    assert any(hit.severity == "hard" for hit in gate._scan_text_brief_compliance(
        item, prices=gate._historical_prices(bundle)))


@pytest.mark.parametrize("eps,refs,allowed", [
    ("4.82", ["fd_01"], True),
    ("999", ["fd_01"], False),
    ("4.82", ["d_40"], False),
    ("4.82", [], False),
])
def test_parenthesized_eps_condition_requires_the_actual_cited_earnings(eps, refs, allowed):
    bundle = EvidenceBundle(symbol="2727", as_of_date=date(2026, 10, 1),
        daily_timeline=[{"id": "d_40", "date": "2026-09-24", "close": 232}],
        fundamental=[{"id": "fd_01", "field": "eps", "period": "2026Q2",
                      "date": "2026-06-30", "value": 4.82}])
    item = {"stance": "mildly_bullish", "reason": "後續獲利仍待觀察。",
            "invalidation": f"單季 EPS 較 2026Q2 ({eps}元) 顯著衰退", "evidence_ids": refs}
    issues = _grounding_issues(item, bundle)
    assert (not any(not issue.startswith("未核實") for issue in issues)) == allowed
    if allowed:
        assert not any(hit.severity == "hard" for hit in gate._scan_text_brief_compliance(
            item, prices=gate._historical_prices(bundle)))


@pytest.mark.parametrize("field", ["trigger", "invalidation"])
def test_price_scenario_cannot_authorize_a_fabricated_observed_close(field):
    bundle = EvidenceBundle(symbol="2727", as_of_date=date(2026, 10, 1),
        daily_timeline=[{"id": "d_40", "date": "2026-09-24", "close": 232}])
    item = {field: "情境假設：若股價跌破230元則失效", "evidence_ids": ["d_40"]}
    prices = gate._historical_prices(bundle)
    assert not any(not issue.startswith("未核實") for issue in _grounding_issues(item, bundle))
    hits = gate._scan_text_brief_compliance(item, prices=prices)
    assert not any(hit.severity == "hard" for hit in hits)
    assert any(hit.severity == "soft" for hit in hits)

    item[field] = "2026-09-24 已收盤 999 元，情境假設：若股價跌破230元則失效"
    assert any(not issue.startswith("未核實") for issue in _grounding_issues(item, bundle))


def test_historical_support_wording_keeps_local_price_evidence():
    bundle = EvidenceBundle(symbol="2727", as_of_date=date(2026, 10, 1),
        daily_timeline=[{"id": "d_40", "date": "2026-09-24", "close": 232}])
    item = {"id": "cs_01", "text": "2026-09-24 歷史收盤支撐 232 元，是否守住仍待觀察。",
            "evidence_ids": ["d_40"]}
    assert not _grounding_issues(item, bundle)
    assert not any(hit.severity == "hard" for hit in gate._scan_text_brief_compliance(
        item, prices=gate._historical_prices(bundle)))
    item["text"] = "歷史收盤支撐 233 元。"
    assert _grounding_issues(item, bundle)


def test_provided_price_position_and_moving_average_metrics_are_not_rejected():
    bundle = EvidenceBundle(symbol="2330", as_of_date=date(2026, 9, 27), long_term_anchor=[
        {"id": "lt_03", "field": "close_pos_in_1y_pct", "value": 97.1},
        {"id": "lt_04", "field": "vs_ma60_pct", "value": 3.0}],
        daily_timeline=[{"id": "d_40", "date": "2026-09-25", "close": 2475, "vs_ma20_pct": 1.2}])
    item = {"id": "cs_01", "text": "目前股價位於 2,475 元，落在近一年高低區間的 97.1% 位置。",
            "evidence_ids": ["d_40", "lt_03"]}
    assert not _grounding_issues(item, bundle)
    item["evidence_ids"] = ["d_40"]
    assert _grounding_issues(item, bundle)
    item.update(text="目前處於 97.1% 的年度高位。", evidence_ids=["lt_03"])
    assert not _grounding_issues(item, bundle)
    item.update(text="相對季線乖離 3.0%；相對月線乖離 1.2%。", evidence_ids=["d_40", "lt_04"])
    assert not _grounding_issues(item, bundle)
    item["text"] = "目前股價在 2,000 至 2,475 元之間。"
    assert _grounding_issues(item, bundle)


def test_observed_breakout_uses_inequality_but_future_price_still_needs_anchor():
    from app.features.analysis.validation import _scan_text_brief_compliance, _historical_prices
    bundle = EvidenceBundle(symbol="2454", as_of_date=date(2026, 9, 27),
        daily_timeline=[{"id": "d_40", "date": "2026-09-25", "close": 5010}])
    item = {"id": "cs_01", "text": "股價突破 5,000 元。", "evidence_ids": ["d_40"]}
    assert not _grounding_issues(item, bundle)
    item["text"] = "股價突破 5,100 元。"
    assert _grounding_issues(item, bundle)
    item = {"trigger": "股價突破 5,000 元", "evidence_ids": ["d_40"]}
    assert _scan_text_brief_compliance(item, prices=_historical_prices(bundle))


def test_detached_news_support_is_not_accepted_as_market_only_claim():
    bundle, item = fixture("2026-09-01T10:00:00+08:00")
    item["evidence_ids"] = ["d_01"]
    assert _grounding_issues(item, bundle) == ["新聞支持契約未列入同項證據引用"]


def test_industry_profit_keeps_aggregate_subject_and_company_paragraph_stays_valid():
    quote = "累計前八月獲利超過去年全年。"
    bundle = EvidenceBundle(symbol="2881", as_of_date=date(2026, 9, 27), news=[
        {"id": "nw_01", "field": "news", "value": "13家金控合計獲利成長，" + quote + "\n富邦金前八月稅後獲利1202億元。"}])
    item = {"id": "pos_01", "text": "公司前八月獲利超過去年全年。", "evidence_ids": ["nw_01"],
            "news_support": [{"evidence_id": "nw_01", "quote": quote, "use": "reported_fact"}]}
    assert _grounding_issues(item, bundle) == ["金控合計獲利未保留產業主詞，不能當成單一公司獲利"]
    item["text"] = "13家金控合計前八月獲利超過去年全年。"
    assert not _grounding_issues(item, bundle)
    item["text"] = item["news_support"][0]["quote"] = "富邦金前八月稅後獲利1202億元。"
    assert not _grounding_issues(item, bundle)


def test_market_evidence_cannot_invent_operating_price_change():
    bundle = EvidenceBundle(symbol="2002", as_of_date=date(2026, 9, 27),
        daily_timeline=[{"id": "d_01", "date": "2026-09-25", "close": 19.25}])
    item = {"stance": "neutral", "reason": "基本面利多（調漲）與外資賣超互相抵消。", "evidence_ids": ["d_01"]}
    assert any("公司調價事件" in issue for issue in _grounding_issues(item, bundle))
    item["reason"] = "股價上漲，但成交量不足。"
    assert not _grounding_issues(item, bundle)
    bundle.news = [{"id": "nw_01", "field": "news", "value": "公司公告產品盤價調漲。"}]
    item.update(reason="公司公告盤價調漲，可能有利營收，實際影響尚待確認。", evidence_ids=["nw_01"],
                news_support=[{"evidence_id": "nw_01", "quote": "公司公告產品盤價調漲。", "use": "reported_fact"}])
    assert not _grounding_issues(item, bundle)


def test_attribution_disclaimer_is_not_target_price_or_guarantee():
    from app.features.analysis.compliance import scan_compliance_hits
    note = "新聞中提及的目標價為分析師觀點，非事實保證。"
    assert not scan_compliance_hits(note)
    assert any(hit.severity == "hard" for hit in scan_compliance_hits(note + "目標價 300 元。"))


def fixture(published, quote="公司公布最新營收，並表示需求仍待觀察。", use="reported_fact", event_date=None):
    bundle = EvidenceBundle(symbol="2330", as_of_date=date(2026, 9, 2),
        daily_timeline=[{"id": "d_01", "date": "2026-07-31", "close": 100}],
        news=[{"id": "nw_01", "field": "news", "value": quote, "published_at": published}])
    item = {"id": "kd_01", "date": "2026-07-31", "ref": "d_01", "what": "營收造成當日上漲",
            "evidence_ids": ["d_01", "nw_01"], "news_support": [
                {"evidence_id": "nw_01", "quote": quote, "use": use, "event_date": event_date}]}
    return bundle, item


@pytest.mark.parametrize("published", ["2026-09-01T10:00:00+08:00", "2026-07-31T16:33:00+08:00",
                                         "2026-07-31", "2026-07-31T10:00:00", None])
@pytest.mark.parametrize("motive", ["營收帶動上漲", "利多出盡", "市場已提前反映", "獲利了結"])
def test_unverified_news_is_separated_from_price_regardless_of_motive(published, motive):
    bundle, item = fixture(published, use="price_reaction")
    item["what"] = motive
    issues = _grounding_issues(item, bundle)
    assert issues and all(issue.startswith("未核實") for issue in issues)
    assert motive not in item["what"]
    assert "收盤 100 元" in item["what"] and "未核實價格因果" in item["what"]
    assert item["news_support"][0]["use"] == "reported_fact"
    if published is None:
        assert "發布時間未知" in item["what"] and "00:00" not in item["what"]


@pytest.mark.parametrize("published,quote,use", [
    ("2026-08-01T10:00:00+08:00", "昨日公司公布營運資訊。", "retrospective"),
    ("2026-09-01T10:00:00+08:00", "2026-07-31公司公布營運資訊。", "retrospective"),
    ("2026-07-31T04:00:00+00:00", "2026-07-31公司公布營運資訊。", "price_reaction"),
])
def test_explicit_retrospective_and_intraday_sources_keep_attribution(published, quote, use):
    bundle, item = fixture(published, quote, use, "2026-07-31")
    assert not _grounding_issues(item, bundle)
    assert quote in item["what"] and published in item["what"]
    assert item["news_support"][0]["use"] == use


def test_retrospective_cannot_invent_event_date_and_product_needs_its_quote():
    bundle, item = fixture("2026-09-01T10:00:00+08:00", use="retrospective", event_date="2026-07-31")
    assert "事件日期" in _grounding_issues(item, bundle)[0]
    item.pop("what")
    item.pop("date")
    item["text"] = "MLCC 產品漲價"
    item["news_support"][0].update(use="reported_fact", event_date=None)
    assert "產品" in _grounding_issues(item, bundle)[0]
    quote = "MLCC 產品漲價，公司表示將持續觀察需求。"
    bundle.news[0]["value"] = item["news_support"][0]["quote"] = quote
    assert not _grounding_issues(item, bundle)


@pytest.mark.parametrize("use", ["reported_fact", "attributed_view"])
def test_unused_unsupported_news_event_date_is_removed_with_a_limitation(use):
    quote = "公司公布最新營收，並表示需求仍待觀察。"
    bundle, item = fixture("2026-09-01T10:00:00+08:00", quote, use, "2026-07-31")
    item.pop("what")
    item.pop("date")
    item["text"] = quote
    issues = _grounding_issues(item, bundle)
    assert issues and all(issue.startswith("未核實") for issue in issues)
    assert item["news_support"][0]["event_date"] is None
    assert item["news_support"][0]["quote"] == quote


@pytest.mark.parametrize("use", ["reported_fact", "attributed_view"])
@pytest.mark.parametrize("date_text", ["7/31", "07/31", "2026/07/31", "2026-7-31", "2026-07-31"])
def test_news_body_cannot_claim_an_unsupported_event_date(use, date_text):
    bundle, item = fixture("2026-09-01T10:00:00+08:00", use=use, event_date="2026-07-31")
    item.pop("what")
    item.pop("date")
    item["text"] = f"公司於{date_text}公布最新營收。"
    issues = _grounding_issues(item, bundle)
    assert issues and any(not issue.startswith("未核實") for issue in issues)


def test_news_quote_must_still_exist_in_the_cited_source():
    bundle, item = fixture("2026-09-01T10:00:00+08:00")
    item["news_support"][0]["quote"] = "公司公布獲利創歷史新高。"
    issues = _grounding_issues(item, bundle)
    assert issues and any(not issue.startswith("未核實") for issue in issues)


def test_unknown_time_and_fact_groups_survive_evidence_packet():
    source = {"title": "Report", "summary": "Report passage", "timestamp": "2026-09-01",
              "shared_fact_ids": ["fact-1"], "shared_facts": [{"fact_id": "fact-1"}],
              "retrieval_branch": "guidance", "observed_at": "2026-09-02T10:00:00+08:00"}
    item = build_news_items([source], summary_chars=None)[0]
    assert item["published_time_precision"] == "date" and "published_at" not in item
    assert "first_public_at" not in item and item["observed_at"] == source["observed_at"]
    assert item["shared_facts"] == source["shared_facts"]


def test_analysis_default_retrieval_requires_and_receives_independent_factory(settings):
    with pytest.raises(ValueError, match="session factory"):
        AnalysisService(db=None, settings=settings, http=None)
    factory = lambda: None
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        settings=settings, http=None, session_factory=factory)))
    service = get_service(request, db=None)
    assert service.rag.session_factory is factory


def test_analysis_default_retrieval_checks_sql_content_and_propagates_failure(db_session, settings, monkeypatch):
    import asyncio
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.exc import OperationalError
    from app.core.errors import ServiceUnavailable
    from app.db.models.news_article import NewsArticle
    from app.db.models.news_chunk import chunk_metadata
    from app.features.retrieval.chunking import article_chunks
    from app.jobs.ingestion.repository import insert_article_chunks
    from app.features.analysis.schemas import StockBehaviorRagRequest
    from test_retrieval import FakeVector

    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: {"2330": {"name": "台積電"}})
    settings = settings.model_copy(update={"NEWS_INDEX_VERSION": "news-v1"})
    chunk_metadata.create_all(db_session.get_bind())
    article = NewsArticle(article_id="freshness", title="台積電營收", content="台積電營收成長。",
                          content_kind="full_text", pub_time="2026-09-01T12:00:00+08:00")
    db_session.add(article)
    db_session.flush()
    chunk = article_chunks(vars(article), index_version=settings.NEWS_INDEX_VERSION,
                           max_chars=settings.NEWS_CHUNK_MAX_CHARS, overlap_chars=settings.NEWS_CHUNK_OVERLAP_CHARS,
                           embedding_model=settings.EMBED_MODEL)[0]
    insert_article_chunks(db_session, [chunk])
    db_session.commit()
    factory = sessionmaker(bind=db_session.get_bind())
    service = AnalysisService(db=db_session, settings=settings, http=None, session_factory=factory)
    hit = {"id": chunk["chunk_id"], "score": .9, "payload": {**chunk, "page_content": chunk["content_chunk"]}}
    service.rag.vector = FakeVector(lambda *_: [hit])
    request = StockBehaviorRagRequest(symbols=["2330"], as_of_date=date(2026, 9, 2))
    assert asyncio.run(service.collect_rag_news(request)).news_sources
    article.content = "台積電更正營收內容。"
    db_session.commit()
    assert not asyncio.run(service.collect_rag_news(request)).news_sources
    def unavailable():
        raise OperationalError("SELECT", {}, RuntimeError("offline"))
    service.rag.session_factory = unavailable
    with pytest.raises(ServiceUnavailable):
        asyncio.run(service.collect_rag_news(request))
