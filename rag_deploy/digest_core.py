"""
個股分析總結（digest）共用核心
================================
把「取 point-in-time 分析師文章 + 一般新聞 → 算技術面 → 組 prompt → 呼叫 LLM」
抽成純同步函式，讓「離線預建腳本」（build_analysis_digests.py）與
「即時第二支 API」（api_server.py 的 /api/analysis_digest）共用同一套邏輯，
只差傳入的 LLM client 不同（離線用 H200 重模型、即時 fallback 亦可用同一個）。

刻意不 import api_server，避免循環 import；下方常數為 api_server 對應常數的鏡像，
若 api_server 的來源分類有調整，這裡需一併同步（見 CLAUDE.md「獨立副本需手動同步」）。
"""

import json
import re
from datetime import date, datetime, timedelta

from prediction_core import (
    normalize_time,
    compute_weighted_regression,
    compute_momentum_meanreversion_curve,
)

# ── 股票中文名（鏡像 api_server.STOCK_OPTIONS）──
STOCK_NAMES = {
    "2330": "台積電", "2317": "鴻海", "2454": "聯發科",
    "2881": "富邦金", "2408": "南亞", "2615": "萬海",
}

# ── 來源分層（鏡像 api_server.CMONEY_SOURCES；moneydj 併入分析師層）──
_CMONEY_SOURCES = {
    "tpshouse", "cmoney", "newsyoudeservetoknow", "lewis", "coneyresearcher",
    "cmoneyaicurator", "josh", "money", "nico", "cmoneyairesearcher",
    "ruanmuhhwa", "star", "captain", "firebro", "bubuypope", "wealthonebro",
    "emily", "yolandawu", "alansays", "jiahongxlinying", "ugly", "sharon",
    "laochien", "edwin", "jacklai", "ericlu", "stockmantalk", "crawler_csv",
    "p", "so2ym6jh",
}
ANALYST_SOURCES = {"moneydj"} | _CMONEY_SOURCES  # 專業分析師/專欄 tier（加權高）
WIRE_NEWS_SOURCES = {"cnyes", "ltn", "udn", "chinatimes", "yahoo"}  # 一般新聞 tier


def is_analyst_source(source: str) -> bool:
    """判斷來源是否屬於「專業分析師/專欄」層。"""
    return (source or "").strip() in ANALYST_SOURCES


# ── LLM client 工廠（離線重模型：自架 H200，OpenAI 相容）──
def make_h200_client():
    """依 .env 建立指向自架 H200 的 OpenAI 相容 client。
    回傳 (client, model_name)。缺 base_url/api_key 時回傳 (None, model_name)，
    由呼叫端給出清楚提示而非崩潰（API key 目前先留空 placeholder）。"""
    import os
    from openai import OpenAI

    base_url = os.environ.get("H200_BASE_URL", "").strip()
    api_key = os.environ.get("H200_API_KEY", "").strip()
    model_name = os.environ.get("H200_MODEL", "").strip() or "local-model"
    if not base_url or not api_key:
        return None, model_name
    import httpx
    client = OpenAI(base_url=base_url, api_key=api_key, http_client=httpx.Client(timeout=120.0))
    return client, model_name


class DigestConfigError(RuntimeError):
    """H200 設定不完整（base_url / api_key 未提供）時拋出。"""


# ── Point-in-time 文章檢索（重用 /api/analyze 的語意檢索 + 防洩漏夾住）──
def fetch_pit_articles(qdrant_client, embeddings, stock_id: str, as_of: str,
                       window_days: int = 30, pool_limit: int = 40,
                       analyst_limit: int = 6, news_limit: int = 10):
    """取截至 as_of（含當日）、往前 window_days 天的相關文章，分成分析師/一般新聞兩層。
    - 語意檢索（query_points）+ pub_time 雙邊夾住，且一律 <= as_of 防洩漏未來。
    - 回傳 (analyst_articles, news_articles)，每筆為 dict。
    """
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    stock_name = STOCK_NAMES.get(stock_id, stock_id)
    as_of_day = as_of[:10]
    time_from = (date.fromisoformat(as_of_day) - timedelta(days=window_days)).strftime("%Y-%m-%d 00:00:00")
    time_to = f"{as_of_day} 23:59:59"

    query_text = f"{stock_name} 近期表現 營收 股價 財報 法人 展望"
    query_vector = embeddings.embed_query(query_text)
    results = qdrant_client.query_points(
        collection_name="news_chunks",
        query=query_vector,
        query_filter=Filter(must=[FieldCondition(key="stock_id", match=MatchValue(value=stock_id))]),
        limit=pool_limit,
        with_payload=True,
    )

    analyst, news = [], []
    seen_titles = set()
    for pt in results.points:
        p = pt.payload or {}
        title = p.get("title", "")
        pub = normalize_time(p.get("pub_time", ""))
        if not title or not pub or title in seen_titles:
            continue
        if not (time_from <= pub <= time_to):  # 夾在區間內，且天然 <= as_of
            continue
        seen_titles.add(title)
        item = {
            "title": title,
            "source": p.get("source", ""),
            "pub_time": p.get("pub_time", ""),
            "url": p.get("url", ""),
            "content": p.get("page_content", ""),
        }
        (analyst if is_analyst_source(item["source"]) else news).append(item)

    analyst = analyst[:analyst_limit]
    news = news[:news_limit]

    # ── 防洩漏斷言：任何文章的發布日都不得晚於 as_of ──
    for item in analyst + news:
        assert normalize_time(item["pub_time"])[:10] <= as_of_day, (
            f"洩漏未來資料：{item['source']} 的新聞 {item['pub_time']} 晚於 as_of {as_of_day}"
        )
    return analyst, news


# ── 技術面（只用 <= as_of 的股價）──
def fetch_prices(stock_id: str, as_of: str, lookback_days: int = 60):
    """yfinance 抓 as_of（含）往前 lookback_days 天的日線收盤，回傳 closes 陣列（最多 30 筆）。"""
    import yfinance as yf

    as_of_day = as_of[:10]
    start = (date.fromisoformat(as_of_day) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    end = (date.fromisoformat(as_of_day) + timedelta(days=1)).strftime("%Y-%m-%d")  # end 為排他，+1 才含 as_of
    ticker = yf.Ticker(f"{stock_id}.TW")
    df = ticker.history(start=start, end=end, interval="1d")
    if df is None or df.empty:
        return []
    closes = [round(float(row["Close"]), 2) for _, row in df.iterrows()]
    return closes[-30:]


def compute_technical(closes: list) -> dict:
    """由收盤價算技術面摘要（斜率、近月漲跌、MA20、短期動能路徑）。"""
    if not closes:
        return {"available": False}
    n = len(closes)
    change_pct = round((closes[-1] - closes[0]) / closes[0] * 100, 2) if closes[0] else 0.0
    _, slope, _ = compute_weighted_regression(closes)
    ma20 = round(sum(closes[-20:]) / min(20, n), 2)
    curve = compute_momentum_meanreversion_curve(closes, horizon_days=5)
    return {
        "available": True,
        "n_days": n,
        "first_close": closes[0],
        "last_close": closes[-1],
        "change_pct": change_pct,
        "slope_per_day": round(slope, 3),
        "ma20": ma20,
        "vs_ma20_pct": round((closes[-1] - ma20) / ma20 * 100, 2) if ma20 else 0.0,
        "short_momentum_next5": curve,
    }


# ── prompt 組裝 ──
def build_digest_prompt(stock_id: str, as_of: str, period: str,
                        analyst: list, news: list, technical: dict) -> str:
    stock_name = STOCK_NAMES.get(stock_id, stock_id)

    def _fmt(items):
        if not items:
            return "（無）"
        lines = []
        for it in items:
            snippet = (it.get("content") or "").strip().replace("\n", " ")[:120]
            lines.append(f"- [{it.get('pub_time', '')[:10]}] {it['title']}｜{snippet}")
        return "\n".join(lines)

    if technical.get("available"):
        tech_desc = (
            f"近 {technical['n_days']} 個交易日收盤 {technical['first_close']} → {technical['last_close']} "
            f"元（{technical['change_pct']:+.2f}%），加權迴歸斜率每日 {technical['slope_per_day']:+.3f} 元，"
            f"MA20={technical['ma20']}（現價相對 MA20 {technical['vs_ma20_pct']:+.2f}%）。"
        )
    else:
        tech_desc = "（無足夠股價資料）"

    period_zh = "本週" if period == "week" else "本月"
    return f"""你是一位資深台股分析師。以下是 {stock_name}（{stock_id}）截至 {as_of[:10]} 為止的資料，請彙整成一份「{period_zh}個股分析總結」，供後續分析引用。

嚴格限制：只能根據下方提供的資料撰寫，不得引入你已知的、發布日期晚於 {as_of[:10]} 的任何資訊。

## 專業分析師觀點（權重較高）
{_fmt(analyst)}

## 一般新聞
{_fmt(news)}

## 技術面
{tech_desc}

請輸出 JSON（繁體中文，不要輸出其他文字）：
{{
  "analyst_view": "綜合上方專業分析師觀點的重點（2-3 句；若無分析師資料則說明缺乏）",
  "news_summary": "一般新聞面的重點（2-3 句）",
  "technical_read": "技術面判讀（1-2 句，趨勢方向與位階）",
  "overall": "綜合以上的整體研判（2-3 句）",
  "key_points": ["3 到 5 條關鍵重點（每條一句）"]
}}"""


def call_digest_llm(client, prompt: str, model_name: str) -> dict:
    """呼叫 LLM 產出 digest JSON，含抽取與失敗預設值。"""
    result = {
        "analyst_view": "", "news_summary": "", "technical_read": "",
        "overall": "", "key_points": [],
    }
    resp = client.chat.completions.create(
        model=model_name,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=800,
        stream=False,
    )
    raw = (resp.choices[0].message.content or "").strip()
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        parsed = json.loads(m.group())
        for k in result:
            if k in parsed:
                result[k] = parsed[k]
    return result


def generate_digest(qdrant_client, embeddings, llm_client, model_name: str,
                    stock_id: str, as_of: str, period: str,
                    window_days: int = 30) -> dict:
    """單一進入點：組出某時點的個股分析總結。
    回傳 dict，可直接落地 analysis_digests 表。llm_client 為 None 時拋 DigestConfigError。"""
    if llm_client is None:
        raise DigestConfigError(
            "H200 LLM client 尚未設定（請在 .env 填入 H200_BASE_URL 與 H200_API_KEY）"
        )

    analyst, news = fetch_pit_articles(qdrant_client, embeddings, stock_id, as_of, window_days)
    closes = fetch_prices(stock_id, as_of)
    technical = compute_technical(closes)
    prompt = build_digest_prompt(stock_id, as_of, period, analyst, news, technical)
    digest = call_digest_llm(llm_client, prompt, model_name)

    return {
        "stock_id": stock_id,
        "as_of_date": as_of[:10],
        "period": period,
        "model_name": model_name,
        "analyst_json": analyst,
        "news_json": news,
        "technical_json": technical,
        "digest_json": digest,
        "prompt_used": prompt,
    }
