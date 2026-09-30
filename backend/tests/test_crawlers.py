from datetime import datetime, timedelta
import json
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy import event, select

from app.db.models.news_article import NewsArticle
from app.jobs.impact import migrate as impact_migrate
from app.jobs import crawlers


def cnyes_raw(**changes):
    return {"title": "  台積電營運展望  ", "publishAt": 1704067200, "newsId": "12345",
            "stock": ["2330", "2330"], "market": [{"code": "2317"}, {"code": "2330"}],
            "content": "<p>第一段&amp;內容<br />第二行</p><p>最後&nbsp; 一段</p>", **changes}


def article_html(title="台積電與鴻海營運展望", **changes):
    fields = {"title": title, "pub_time": "2024-01-02T08:30:00+08:00",
              "content": "企業公布最新營運數據，市場持續關注未來產能與客戶需求，相關產業供應鏈也受到關注。", **changes}
    return ('<html><head><meta name="pubdate" content="{pub_time}"></head><body><h1>{title}</h1>'
            '<div class="content"><p>{content}</p><p>點我下載APP</p><p>相關新聞 不應留下</p></div></body></html>').format(**fields)


def cnyes_detail_html(body="完整新聞內文第一段。完整新聞內文第二段。"):
    payload = json.dumps({"@type": "NewsArticle", "headline": "台積電營運展望", "articleBody": body}, ensure_ascii=False)
    return f'<html><script type="application/ld+json">{payload}</script></html>'


def test_cnyes_news_identity_html_stock_tags_and_timestamp_aliases():
    item = crawlers.cnyes_item(cnyes_raw())
    assert item["article_id"] == crawlers.article_id("cnyes", "台積電營運展望", "2024-01-01T08:00:00+08:00")
    assert item["source"] == item["source_group"] == "cnyes"
    assert item["stock_id"] == "2330" and item["tags"] == "2330,2317"
    assert item["url"] == "https://news.cnyes.com/news/id/12345"
    assert item["content"] == "第一段&內容\n第二行\n最後 一段"
    assert item["content_kind"] == "summary"
    fallback = crawlers.cnyes_item(cnyes_raw(publishAt=None, createdAt=1704067200, stock=[], market=[],
        content=None, summary="<p>摘要</p>", newsId="invalid", link="https://news.cnyes.com/summary"))
    assert fallback["pub_time"] == item["pub_time"] and fallback["content"] == "摘要"
    assert fallback["stock_id"] is None and fallback["tags"] == ""
    assert fallback["url"] == "https://news.cnyes.com/summary"
    assert fallback["content_kind"] == "summary"
    assert crawlers.cnyes_item(cnyes_raw(content=None))["content_kind"] == "title_only"


def test_cnyes_article_body_reads_full_public_body_from_json_ld():
    assert crawlers.cnyes_article_fields(cnyes_detail_html()) == {"content": "完整新聞內文第一段。完整新聞內文第二段。", "title": "台積電營運展望"}
    assert crawlers.cnyes_article_url("12345") == "https://news.cnyes.com/news/id/12345"
    assert crawlers.cnyes_article_url("invalid") is None


@pytest.mark.parametrize("headline,heading,name,expected", [
    ("公司公布財報", "其他標題", "公司公布財報 | 鉅亨網", "公司公布財報"),
    (None, "公司更新營運展望", "公司公布財報 | 鉅亨網", "公司更新營運展望"),
    (None, None, "公司公布財報 | 鉅亨網", "公司公布財報"),
    (None, None, "公司 | 產業觀察", "公司 | 產業觀察"),
])
def test_cnyes_detail_uses_article_title_without_publisher_seo_suffix(headline, heading, name, expected):
    payload = {"@context": "https://schema.org", "@type": "NewsArticle",
               "name": name, "articleBody": "公司公布最新財報與完整營運展望。"}
    if headline:
        payload["headline"] = headline
    html = f'<script type="application/ld+json">{json.dumps(payload, ensure_ascii=False)}</script>'
    if heading:
        html += f"<article><h1>{heading}</h1></article>"
    assert crawlers.cnyes_article_fields(html) == {
        "title": expected, "content": "公司公布最新財報與完整營運展望。"}


def test_cnyes_html_cleaner_removes_footer_and_app_promos():
    item = crawlers.cnyes_item(cnyes_raw(content=(
        "<p>先看正文</p><p>請繼續往下閱讀</p><p>熱門新訊more</p><p>延伸閱讀</p>")))
    assert item["content"] == "先看正文"


@pytest.mark.parametrize("cleaner", [crawlers.clean_html_content, crawlers.clean_ltn_content])
def test_cleaners_preserve_body_after_inline_prompts_and_footer_words_in_prose(cleaner):
    text = "第一段正文\n請繼續往下閱讀\n第二段提到相關新聞的報導。\n按我看活動辦法\n第三段營收展望。\n延伸閱讀\n頁尾連結"
    assert cleaner(text) == "第一段正文\n第二段提到相關新聞的報導。\n第三段營收展望。"
    assert cleaner("前半段請繼續往下閱讀後半段") == "前半段後半段"


def test_cnyes_normalizes_known_market_symbols_without_guessing_unknown_prefixes():
    item = crawlers.cnyes_item(cnyes_raw(stock=["TWS:2330", "2330.TW", None],
        market=[{"code": "TWSE:2317"}, {"code": "2454.TWO"}, {"code": "UNKNOWN:2408"}]))
    assert item["stock_id"] == "2330"
    assert item["tags"] == "2330,2317,2454,UNKNOWN:2408"


@pytest.mark.parametrize("envelope", [lambda rows: {"items": {"data": rows}}, lambda rows: {"items": rows},
    lambda rows: {"data": rows}, lambda rows: {"data": {"items": rows}},
    lambda rows: {"data": {"list": rows}}, lambda rows: {"list": rows}])
def test_cnyes_upstream_list_shapes_and_request_bounds(envelope):
    def provider(request):
        assert dict(request.url.params) == {"page": "2", "limit": "30", "isCategoryHeadline": "0", "startAt": "10", "endAt": "20"}
        assert request.headers["origin"] == "https://news.cnyes.com"
        return httpx.Response(200, json=envelope([cnyes_raw()]))
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        assert crawlers.cnyes_page(http, 2, 10, 20) == [cnyes_raw()]


def test_month_ranges_have_no_gaps_or_overlap_at_taipei_leap_month_boundary():
    start = datetime(2024, 2, 28, 8, tzinfo=crawlers.TAIPEI)
    end = datetime(2024, 3, 2, 16, tzinfo=crawlers.TAIPEI)
    ranges = crawlers.month_ranges(start, end)
    assert ranges[0][0] == int(start.timestamp()) and ranges[-1][1] == int(end.timestamp())
    assert ranges[0][1] + 1 == ranges[1][0]
    assert datetime.fromtimestamp(ranges[0][1], crawlers.TAIPEI).isoformat() == "2024-02-29T23:59:59+08:00"


def test_store_news_deduplicates_and_updates_longer_existing_content_without_ddl(db_session):
    item = crawlers.cnyes_item(cnyes_raw())
    sql = []
    listener = lambda conn, cursor, statement, parameters, context, executemany: sql.append(statement)
    event.listen(db_session.bind, "before_cursor_execute", listener)
    try:
        assert crawlers.store_news(db_session, [item, item]) == {"inserted": 1, "updated": 0, "skipped": 1}
        initial_hash = db_session.get(NewsArticle, item["article_id"]).analysis_input_hash
        full = {**item, "content": "changed upstream content with the complete article body"}
        assert crawlers.store_news(db_session, [full]) == {"inserted": 0, "updated": 1, "skipped": 0}
    finally:
        event.remove(db_session.bind, "before_cursor_execute", listener)
    assert db_session.get(NewsArticle, item["article_id"]).content == full["content"]
    assert db_session.get(NewsArticle, item["article_id"]).analysis_input_hash != initial_hash
    assert not any(statement.lstrip().upper().startswith(("CREATE", "ALTER", "DROP")) for statement in sql)


def test_store_news_preserves_identity_by_source_url_after_title_revision(db_session):
    first = crawlers.cnyes_item(cnyes_raw())
    crawlers.store_news(db_session, [first])
    revised = crawlers.cnyes_item(cnyes_raw(title="修正後的台積電營運展望", content="更新後的完整內容"))
    assert revised["article_id"] != first["article_id"]
    assert crawlers.store_news(db_session, [revised]) == {"inserted": 0, "updated": 1, "skipped": 0}
    articles = db_session.scalars(select(NewsArticle)).all()
    assert len(articles) == 1
    assert articles[0].article_id == first["article_id"] and articles[0].title == revised["title"]


def test_failed_page_commit_rolls_back_and_session_remains_usable(db_session, monkeypatch):
    item = crawlers.cnyes_item(cnyes_raw())
    commit = db_session.commit
    monkeypatch.setattr(db_session, "commit", Mock(side_effect=RuntimeError("database failure")))
    with pytest.raises(RuntimeError):
        crawlers.store_news(db_session, [item])
    assert db_session.get(NewsArticle, item["article_id"]) is None
    monkeypatch.setattr(db_session, "commit", commit)
    assert crawlers.store_news(db_session, [item]) == {"inserted": 1, "updated": 0, "skipped": 0}


def test_cnyes_worker_fetches_and_writes_page_then_skips_existing(db_session):
    requested = []
    def provider(request):
        requested.append(request)
        return httpx.Response(200, json={"items": {"data": [cnyes_raw(), cnyes_raw()]}})
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        arguments = (db_session.bind, http, datetime(2024, 1, 1), datetime(2024, 1, 3))
        assert crawlers.crawl_cnyes(*arguments) == {"inserted": 1, "updated": 0, "skipped": 1, "failed": 0}
        assert crawlers.crawl_cnyes(*arguments) == {"inserted": 0, "updated": 0, "skipped": 2, "failed": 0}
    assert len(requested) == 4 and len(db_session.scalars(select(NewsArticle)).all()) == 1
    assert {request.url.path.rsplit("/", 1)[-1] for request in requested} == set(crawlers.CNYES_CATEGORIES)


def test_cnyes_worker_replaces_list_excerpt_with_detail_body(db_session):
    def provider(request):
        if "newslist" in request.url.path:
            return httpx.Response(200, json={"items": {"data": [cnyes_raw(content="列表摘要")]}})
        return httpx.Response(200, text=cnyes_detail_html())

    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        result = crawlers.crawl_cnyes(db_session.bind, http, datetime(2024, 1, 1), datetime(2024, 1, 3),
                                      limit=1, fetch_details=True)
    item = crawlers.cnyes_item(cnyes_raw())
    assert result == {"inserted": 1, "updated": 0, "skipped": 0, "failed": 0}
    stored = db_session.get(NewsArticle, item["article_id"])
    assert stored.content == "完整新聞內文第一段。完整新聞內文第二段。"
    assert stored.content_kind == "full_text"
    original_hash = stored.analysis_input_hash
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        crawlers.crawl_cnyes(db_session.bind, http, datetime(2024, 1, 1), datetime(2024, 1, 3),
                             limit=1, fetch_details=False)
    db_session.expire_all()
    stored = db_session.get(NewsArticle, item["article_id"])
    assert stored.content_kind == "full_text" and stored.analysis_input_hash == original_hash


def test_refresh_cnyes_existing_uses_coherent_detail_title_and_body(db_session):
    item = crawlers.cnyes_item(cnyes_raw(content="列表摘要"))
    crawlers.store_news(db_session, [item])

    def provider(request):
        return httpx.Response(200, text=cnyes_detail_html())

    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        result = crawlers.refresh_cnyes_existing(db_session.bind, http)
    assert result == {"read": 1, "updated": 1, "skipped": 0, "failed": 0}
    stored = db_session.get(NewsArticle, item["article_id"])
    assert stored.content == "完整新聞內文第一段。完整新聞內文第二段。"
    assert stored.content_kind == "full_text"


@pytest.mark.parametrize("failure", ["timeout", "malformed", "invalid_articles", "repeated_page"])
def test_cnyes_worker_exposes_failure_and_stops_broken_pagination(db_session, failure):
    requests = []
    def provider(request):
        requests.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("private upstream information")
        if failure == "malformed":
            return httpx.Response(200, json={"private": "invalid envelope"})
        rows = [{}] * 30 if failure == "invalid_articles" else [cnyes_raw()] * 30
        return httpx.Response(200, json={"items": rows})
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        result = crawlers.crawl_cnyes(db_session.bind, http, datetime(2024, 1, 1), datetime(2024, 1, 3))
    assert result["failed"] > 0 and len(requests) <= 2 * len(crawlers.CNYES_CATEGORIES)


def test_ltn_html_preserves_id_time_and_priority_stock_and_removes_footer():
    item = crawlers.ltn_article(article_html(), "https://ec.ltn.com.tw/article/1")
    assert item["pub_time"] == "2024-01-02T08:30:00+08:00" and item["stock_id"] == "2330"
    assert item["tags"] == "2330,2317"
    assert item["article_id"] == crawlers.article_id("ltn", item["title"], item["pub_time"])
    assert "相關新聞" not in item["content"] and "不應留下" not in item["content"]
    assert crawlers.ltn_article(article_html(title="整體市場最新展望"), item["url"])["stock_id"] == "tw_stock"
    assert item["content_kind"] == "full_text"
    assert crawlers.clean_ltn_content("保留內文\n點我下載APP\n延伸閱讀\n刪除內容") == "保留內文"
    with pytest.raises(ValueError):
        crawlers.ltn_article(article_html(content="太短"), item["url"])


def test_ltn_tags_include_late_mentions_and_exact_symbols_only():
    content = "企業公布最新營運展望，市場關注供應鏈需求。" * 60 + "南亞科與聯發科（2454）公布新計畫。"
    item = crawlers.ltn_article(article_html(title="鴻海營运展望", content=content), "https://ec.ltn.com.tw/article/2")
    assert item["stock_id"] == "2317" and item["tags"] == "2317,2454,2408"
    unrelated = "企業公布最新營運數據，市場持續關注需求。訂單編號123301、A2317B、12345與notTSMC不可當成股票代號。"
    item = crawlers.ltn_article(article_html(title="市場營運展望", content=unrelated), "https://ec.ltn.com.tw/article/3")
    assert item["stock_id"] == "tw_stock" and item["tags"] == ""


def test_ltn_catalog_tags_company_outside_legacy_six():
    catalog = {"2308": {"symbol": "2308", "name": "台達電", "market": "TWSE", "aliases": []}}
    item = crawlers.ltn_article(article_html(title="台達電營運展望"),
                                "https://ec.ltn.com.tw/article/catalog", catalog)
    assert item["stock_id"] == "2308" and item["tags"] == "2308"


def test_ltn_page_order_date_boundary_and_url_deduplication():
    base = "https://ec.ltn.com.tw/article/"
    pages = {
        1: [{"url": base + suffix, "A_ViewTime": when} for suffix, when in (
            ("known", "2024/01/03"), ("new", "2024/01/03"), ("new", "2024/01/03"), ("old", "2024/01/01"))],
        2: [{"url": base + "boundary", "A_ViewTime": "2024/01/02"},
            {"url": "http://127.0.0.1/private", "A_ViewTime": "2024/01/03"}],
        3: [{"url": base + "older", "A_ViewTime": "2024/01/01"}],
    }
    def provider(request):
        assert request.headers["x-requested-with"] == "XMLHttpRequest"
        return httpx.Response(200, json=pages.get(int(request.url.path.rsplit("/", 1)[1]), []))
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        urls, failed = crawlers.collect_ltn_urls(http, {base + "known"}, datetime(2024, 1, 2), max_pages=10)
    assert urls == [base + "new", base + "boundary"] and failed == 1


@pytest.mark.parametrize("category", ["strategy", "international"])
def test_ltn_extra_categories_use_their_own_list_and_referer(category):
    def provider(request):
        assert request.url.path.startswith(f"/list_ajax/{category}/")
        assert request.headers["referer"] == f"https://ec.ltn.com.tw/list/{category}"
        return httpx.Response(200, json=[])
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        assert crawlers.collect_ltn_urls(http, set(), datetime(2024, 1, 1), max_pages=3,
                                         category=category) == ([], 0)


def test_ltn_worker_avoids_fetching_existing_urls_and_records_bad_article(db_session):
    requested = []
    base = "https://ec.ltn.com.tw/article/"
    def provider(request):
        requested.append(request.url.path)
        if "list_ajax" in request.url.path:
            rows = [{"url": base + suffix, "A_ViewTime": "2024/01/02 08:30"} for suffix in ("good", "bad")]
            return httpx.Response(200, json=rows if request.url.path.endswith("/1") else [])
        return httpx.Response(200, text=article_html() if request.url.path.endswith("good") else "invalid article")
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        arguments = (db_session.bind, http, datetime(2024, 1, 1))
        assert crawlers.crawl_ltn(*arguments) == {"inserted": 1, "updated": 0, "skipped": 0, "failed": 1}
        assert crawlers.crawl_ltn(*arguments) == {"inserted": 0, "updated": 0, "skipped": 0, "failed": 1}
    assert requested.count("/article/good") == 1 and requested.count("/article/bad") == 2
    assert {path.split("/")[2] for path in requested if path.startswith("/list_ajax/")} == set(crawlers.LTN_CATEGORIES)
    assert len(db_session.scalars(select(NewsArticle)).all()) == 1


def test_ltn_unavailable_list_is_not_reported_as_success():
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503))) as http:
        urls, failed = crawlers.collect_ltn_urls(http, set(), datetime(2024, 1, 1), max_pages=3)
    assert urls == [] and failed == 3


@pytest.mark.parametrize("source, arguments, days", [("cnyes", [], 30), ("cnyes", ["--backfill-month"], 30),
    ("cnyes", ["--scheduled-once"], 5), ("ltn", [], 30), ("ltn", ["--scheduled-once", "--lookback-days", "90"], 90)])
def test_cli_preserves_lookback_options_and_disposes_engine(source, arguments, days, settings, monkeypatch, capsys):
    engine, captured = Mock(), []
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2024, 4, 1, 8, tzinfo=tz)
    def run(*args):
        captured.append(args)
        return {"inserted": 1, "skipped": 0, "failed": 0}
    monkeypatch.setattr(crawlers, "datetime", FixedDateTime)
    monkeypatch.setattr(crawlers, "get_settings", lambda: settings)
    monkeypatch.setattr(crawlers, "make_engine", lambda value: engine)
    monkeypatch.setattr(impact_migrate, "migrate_news_impact", lambda value: None)
    monkeypatch.setattr(crawlers, "crawl_" + source, run)
    assert crawlers.crawler_main(source, arguments) == 0
    assert json.loads(capsys.readouterr().out) == {"source": source, "inserted": 1, "skipped": 0, "failed": 0}
    start = captured[0][2]
    assert start.replace(tzinfo=None) == datetime(2024, 4, 1, 8) - timedelta(days=days)
    engine.dispose.assert_called_once()


@pytest.mark.parametrize("raise_error", [False, True])
def test_cli_partial_and_unexpected_failure_return_nonzero_and_sanitize_logs(raise_error, settings, monkeypatch, caplog):
    engine = Mock()
    def run(*args):
        if raise_error:
            raise RuntimeError("private database credentials")
        return {"inserted": 2, "skipped": 0, "failed": 1}
    monkeypatch.setattr(crawlers, "get_settings", lambda: settings)
    monkeypatch.setattr(crawlers, "make_engine", lambda value: engine)
    monkeypatch.setattr(impact_migrate, "migrate_news_impact", lambda value: None)
    monkeypatch.setattr(crawlers, "crawl_cnyes", run)
    assert crawlers.crawler_main("cnyes", ["--scheduled-once"]) == 1
    assert "private" not in caplog.text
    engine.dispose.assert_called_once()
