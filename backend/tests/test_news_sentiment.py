import json
from datetime import datetime, timezone, timedelta
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models.news_article import NewsArticle
from models.news_sentiment import NewsSentiment
from news_sentiment.cleaner import (
    clean_text,
    compute_config_hash,
    compute_input_hash,
    estimate_token_count,
    extract_candidate_stocks,
    get_active_config_hash,
    parse_news_pub_time,
    TAIPEI_TZ,
)
from news_sentiment.client import MockSentimentLLMClient, LLMUsage, calculate_cost
from news_sentiment.constants import (
    LABEL_INSUFFICIENT,
    LABEL_MIXED,
    LABEL_NEGATIVE,
    LABEL_NEUTRAL,
    LABEL_POSITIVE,
    TARGET_STOCKS,
)
from news_sentiment.validator import validate_sentiment_payload
from news_sentiment.batch_runner import SentimentBatchRunner
from crud import news_article as crud_news


@pytest.fixture
def in_memory_db():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_extract_candidate_stocks():
    # 支援逗號分隔、空白、.TW 結尾
    assert extract_candidate_stocks("2330", "2317.TW, 2454, 9999") == ["2330", "2317", "2454"]
    assert extract_candidate_stocks(None, "2615.tw, 2881") == ["2615", "2881"]
    assert extract_candidate_stocks("9999", "8888") == []


def test_clean_text():
    raw_html = "<p>台積電 &amp; 鴻海\r\n\r\n  營收  創新高！<br></p>"
    cleaned = clean_text(raw_html)
    assert cleaned == "台積電 & 鴻海\n\n營收 創新高！"


def test_parse_news_pub_time():
    # ISO 格式帶時區
    dt1, s1 = parse_news_pub_time("2026-08-05T14:30:00+08:00")
    assert dt1 is not None
    assert dt1.tzinfo == TAIPEI_TZ
    assert "2026-08-05T14:30:00+08:00" in s1

    # ISO UTC
    dt2, s2 = parse_news_pub_time("2026-08-05T06:30:00Z")
    assert dt2 is not None
    assert dt2.hour == 14  # UTC 6:30 -> Taipei 14:30

    # 無效日期
    dt_inv, s_inv = parse_news_pub_time("not-a-date")
    assert dt_inv is None
    assert s_inv == ""


def test_compute_hashes():
    h1 = compute_input_hash(
        cleaned_title="標題A",
        cleaned_content="內文B",
        pub_time_str="2026-08-05T10:00:00+08:00",
        target_stock_id="2330",
        target_stock_name="台積電",
    )
    h2 = compute_input_hash(
        cleaned_title="標題A",
        cleaned_content="內文B",
        pub_time_str="2026-08-05T10:00:00+08:00",
        target_stock_id="2330",
        target_stock_name="台積電",
    )
    assert h1 == h2
    assert len(h1) == 64

    # 內文不同則 hash 不同
    h3 = compute_input_hash(
        cleaned_title="標題A",
        cleaned_content="內文C",
        pub_time_str="2026-08-05T10:00:00+08:00",
        target_stock_id="2330",
        target_stock_name="台積電",
    )
    assert h1 != h3


def test_validate_sentiment_payload():
    title = "台積電營收創新高 資本支出上調"
    content = "台積電今日公佈財報，營收創下歷史新高。然而海外建廠成本上升帶來毛利壓力。"

    # 1. 成功 positive
    p_pos = {
        "label": "positive",
        "reason": "營收創新高且資本支出上調，公司表示營運成長。",
        "evidence": [{"field": "title", "quote": "營收創新高"}],
    }
    v_pos = validate_sentiment_payload(p_pos, cleaned_title=title, cleaned_content=content)
    assert v_pos.is_valid is True

    # 2. 成功 mixed（必須恰好 2 筆引用）
    p_mix = {
        "label": "mixed",
        "reason": "營收創新高展現成長，但海外建廠成本上升帶來毛利壓力。",
        "evidence": [
            {"field": "content", "quote": "營收創下歷史新高"},
            {"field": "content", "quote": "海外建廠成本上升帶來毛利壓力"},
        ],
    }
    v_mix = validate_sentiment_payload(p_mix, cleaned_title=title, cleaned_content=content)
    assert v_mix.is_valid is True

    # 3. 失敗：mixed 只有 1 筆引用
    p_mix_bad = {
        "label": "mixed",
        "reason": "正負並存",
        "evidence": [{"field": "content", "quote": "營收創下歷史新高"}],
    }
    v_mix_bad = validate_sentiment_payload(p_mix_bad, cleaned_title=title, cleaned_content=content)
    assert v_mix_bad.is_valid is False
    assert "mixed 標籤必須固定提供 2 筆原文引用" in v_mix_bad.error_message

    # 4. 失敗：引用不存在於原文
    p_fake_quote = {
        "label": "positive",
        "reason": "利多消息",
        "evidence": [{"field": "content", "quote": "股價必定飆破兩千元"}],
    }
    v_fake = validate_sentiment_payload(p_fake_quote, cleaned_title=title, cleaned_content=content)
    assert v_fake.is_valid is False
    assert "未出現在原文" in v_fake.error_message

    # 5. 失敗：理由超過 80 字元
    p_long_reason = {
        "label": "positive",
        "reason": "A" * 85,
        "evidence": [{"field": "title", "quote": "營收創新高"}],
    }
    v_long = validate_sentiment_payload(p_long_reason, cleaned_title=title, cleaned_content=content)
    assert v_long.is_valid is False
    assert "理由長度不符合規範" in v_long.error_message


def test_batch_runner_execute_and_reuse(in_memory_db):
    # 建立一筆測試文章
    art = NewsArticle(
        article_id="test_art_01",
        stock_id="2330",
        title="台積電營運強勁",
        content="台積電本季營收與毛利皆優於預期。",
        pub_time="2026-08-05 10:00:00",
    )
    in_memory_db.add(art)
    in_memory_db.commit()

    manifest = [{"article_id": "test_art_01", "symbol": "2330"}]

    mock_resp = {
        "label": "positive",
        "reason": "公司本季營收與毛利皆優於預期。",
        "evidence": [{"field": "content", "quote": "台積電本季營收與毛利皆優於預期"}],
    }
    client = MockSentimentLLMClient(mock_response=mock_resp)

    # 第一次執行：呼叫 Mock API 並存入資料庫
    runner1 = SentimentBatchRunner(
        client=client,
        db_session=in_memory_db,
        execute=True,
    )
    sum1 = runner1.run_manifest(manifest)
    assert sum1["success"] == 1
    assert sum1["api_calls"] == 1
    assert client.call_count == 1

    # 驗證 DB 記錄
    saved = (
        in_memory_db.query(NewsSentiment)
        .filter(NewsSentiment.article_id == "test_art_01", NewsSentiment.target_stock_id == "2330")
        .first()
    )
    assert saved is not None
    assert saved.status == "success"
    assert saved.label == "positive"

    # 第二次執行：相同輸入與設定應直接命中重用，LLM 呼叫次數為 0
    runner2 = SentimentBatchRunner(
        client=client,
        db_session=in_memory_db,
        execute=True,
    )
    sum2 = runner2.run_manifest(manifest)
    assert sum2["success"] == 1
    assert sum2["reused"] == 1
    assert sum2["api_calls"] == 0
    assert client.call_count == 1  # 沒有增加


def test_attach_sentiments_to_news(in_memory_db):
    art = NewsArticle(
        article_id="art_100",
        stock_id="2330",
        title="台積電展望樂觀",
        content="公司表示展望樂觀。",
        pub_time="2026-08-05 10:00:00",
    )
    in_memory_db.add(art)
    in_memory_db.commit()

    active_cfg = get_active_config_hash()
    in_hash = compute_input_hash(
        cleaned_title="台積電展望樂觀",
        cleaned_content="公司表示展望樂觀。",
        pub_time_str="2026-08-05T10:00:00+08:00",
        target_stock_id="2330",
        target_stock_name="台積電",
    )

    # 寫入成功情緒結果
    sentiment = NewsSentiment(
        article_id="art_100",
        target_stock_id="2330",
        input_hash=in_hash,
        config_hash=active_cfg,
        status="success",
        label="positive",
        reason="公司表示展望樂觀。",
        evidence=json.dumps([{"field": "content", "quote": "公司表示展望樂觀"}]),
    )
    in_memory_db.add(sentiment)
    in_memory_db.commit()

    items = [art]
    crud_news.attach_sentiments_to_news(in_memory_db, items, stock="2330")
    assert hasattr(items[0], "sentiments")
    assert len(items[0].sentiments) == 1
    assert items[0].sentiments[0]["label"] == "positive"
    assert items[0].sentiments[0]["target_stock_id"] == "2330"

    # 若過濾不同股票（例如 2317），則不回傳
    crud_news.attach_sentiments_to_news(in_memory_db, items, stock="2317")
    assert len(items[0].sentiments) == 0
