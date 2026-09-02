"""
crawl_to_qdrant.py
從鉅亨網 API 抓取指定股票的最新新聞，切塊後直接寫入 Docker Qdrant server。
不需要 MySQL，不需要 GUI。

用法：
    python crawl_to_qdrant.py                      # 自動從 Qdrant 最新時間點抓到現在
    python crawl_to_qdrant.py --days 30            # 抓最近 30 天
    python crawl_to_qdrant.py --from 2026-03-01    # 指定起始日期
"""
import argparse
import hashlib
import html
import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from dotenv import load_dotenv
from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, Filter, FieldCondition, MatchValue, PointStruct, VectorParams

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "rag_deploy", ".env"), override=False)

# ── 設定 ──────────────────────────────────────────────
TARGET_STOCKS = {"2330", "2317", "2454", "2881", "2408", "2615"}
STOCK_NAMES = {
    "2330": "台積電", "2317": "鴻海", "2454": "聯發科",
    "2881": "富邦金", "2408": "南亞", "2615": "萬海",
}
COLLECTION_NAME = "news_chunks"
QDRANT_HOST = os.environ.get("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.environ.get("QDRANT_PORT", "6333"))
BATCH_SIZE = 20  # 每批 embed 筆數

CNYES_API = "https://api.cnyes.com/media/api/v1/newslist/category/tw_stock_news"
CNYES_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://news.cnyes.com",
    "Referer": "https://news.cnyes.com/",
}

# 中文優先 splitter（與 run_chunking.py 相同設定）
splitter = RecursiveCharacterTextSplitter(
    chunk_size=400,
    chunk_overlap=50,
    separators=["\n\n", "\n", "。", "！", "？", "，", " ", ""],
)


# ── 工具函式 ──────────────────────────────────────────
def clean_html(raw: Optional[str]) -> str:
    if not raw:
        return ""
    text = html.unescape(raw)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def article_hash(news_id) -> str:
    return hashlib.md5(str(news_id).encode()).hexdigest()


def ts_to_iso(ts) -> str:
    if not ts:
        return ""
    try:
        dt = datetime.fromtimestamp(int(ts), tz=timezone(timedelta(hours=8)))
        return dt.isoformat()
    except Exception:
        return ""


def _pub_time_to_ts(pub_time):
    """將 pub_time ISO 字串轉為 Unix timestamp（供 Qdrant Range filter 使用，pub_time 本身是字串無法直接做數值範圍查詢）"""
    if not pub_time:
        return None
    s = pub_time.replace("T", " ")
    if "+" in s:
        s = s[: s.index("+")]
    s = s[:19].strip()
    try:
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


def extract_stocks(row: dict) -> list[str]:
    stocks = []
    for s in row.get("stock", []) or []:
        code = str(s).strip()
        if code and code not in stocks:
            stocks.append(code)
    for m in row.get("market", []) or []:
        if isinstance(m, dict):
            code = str(m.get("code", "")).strip()
            if code and code not in stocks:
                stocks.append(code)
    return stocks


# ── Qdrant ────────────────────────────────────────────
def get_qdrant_client() -> QdrantClient:
    return QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


def get_existing_chunk_ids(client: QdrantClient) -> set[str]:
    """載入已存在的 chunk_id，用於去重"""
    existing = set()
    offset = None
    while True:
        result = client.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=None,
            limit=10000,
            offset=offset,
            with_payload=["chunk_id"],
        )
        for pt in result[0]:
            cid = pt.payload.get("chunk_id")
            if cid:
                existing.add(cid)
        offset = result[1]
        if offset is None:
            break
    return existing


def get_latest_pub_time(client: QdrantClient) -> Optional[datetime]:
    """查詢 Qdrant 中最新的 pub_time"""
    latest = None
    offset = None
    while True:
        result = client.scroll(
            collection_name=COLLECTION_NAME,
            limit=10000,
            offset=offset,
            with_payload=["pub_time"],
        )
        for pt in result[0]:
            t = pt.payload.get("pub_time", "")
            if t:
                try:
                    dt = datetime.fromisoformat(t)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone(timedelta(hours=8)))
                    if latest is None or dt > latest:
                        latest = dt
                except Exception:
                    pass
        offset = result[1]
        if offset is None:
            break
    return latest


def ensure_collection(client: QdrantClient, vector_size: int):
    try:
        client.get_collection(COLLECTION_NAME)
    except Exception:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )


# ── 抓取 ──────────────────────────────────────────────
def fetch_page(page: int, start_at: int, end_at: int) -> list[dict]:
    params = {
        "page": page,
        "limit": 30,
        "isCategoryHeadline": 0,
        "startAt": start_at,
        "endAt": end_at,
    }
    resp = requests.get(CNYES_API, params=params, headers=CNYES_HEADERS, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    # 解析多種 API 格式
    if isinstance(data, dict):
        items = data.get("items") or data.get("data") or {}
        if isinstance(items, dict):
            return items.get("data") or items.get("list") or []
        if isinstance(items, list):
            return items
    return []


def fetch_all_for_range(start_dt: datetime, end_dt: datetime) -> list[dict]:
    """抓取時間範圍內所有相關的台股新聞，並過濾出目標股票"""
    start_at = int(start_dt.timestamp())
    end_at = int(end_dt.timestamp())
    collected = []

    print(f"📡 抓取區間：{start_dt.strftime('%Y-%m-%d')} ~ {end_dt.strftime('%Y-%m-%d')}")

    page = 1
    seen_ids = set()
    while True:
        try:
            rows = fetch_page(page, start_at, end_at)
        except Exception as e:
            print(f"  ⚠️ Page {page} 抓取失敗: {e}")
            break

        if not rows:
            break

        for row in rows:
            news_id = row.get("newsId") or row.get("news_id") or row.get("id")
            if not news_id or news_id in seen_ids:
                continue
            seen_ids.add(news_id)

            related = extract_stocks(row)
            matched = [s for s in related if s in TARGET_STOCKS]
            if not matched:
                # 也從標題/內容找關鍵字 fallback
                title = (row.get("title") or "").strip()
                for code, name in STOCK_NAMES.items():
                    if name in title or code in title:
                        if code not in matched:
                            matched.append(code)
            if not matched:
                continue

            content = clean_html(row.get("content") or row.get("summary") or "")
            if not content:
                continue

            pub_time = ts_to_iso(
                row.get("publishAt") or row.get("publish_at") or row.get("createdAt")
            )
            url = row.get("url") or f"https://news.cnyes.com/news/id/{news_id}"

            for stock_id in matched:
                collected.append({
                    "news_id": news_id,
                    "stock_id": stock_id,
                    "title": (row.get("title") or "").strip(),
                    "content": content,
                    "pub_time": pub_time,
                    "url": url,
                    "source": "cnyes",
                    "tags": ",".join(related),
                })

        print(f"  頁 {page}：共 {len(rows)} 筆，本頁新增 {len(collected)} 筆（含目標股票）")
        if len(rows) < 30:
            break
        page += 1
        time.sleep(0.3)

    return collected


# ── 切塊 + 向量化 + 寫入 ──────────────────────────────
def process_and_upsert(
    articles: list[dict],
    embeddings: NVIDIAEmbeddings,
    client: QdrantClient,
    existing_ids: set[str],
) -> tuple[int, int]:
    new_count = 0
    skip_count = 0
    pending_points = []

    def flush_batch():
        nonlocal new_count
        if not pending_points:
            return
        texts = [p[0] for p in pending_points]
        try:
            vectors = embeddings.embed_documents(texts)
        except Exception as e:
            print(f"  ❌ Embedding 失敗: {e}")
            return
        points = [
            PointStruct(id=str(uuid.uuid4()), vector=vec, payload=payload)
            for (_, payload), vec in zip(pending_points, vectors)
        ]
        client.upsert(collection_name=COLLECTION_NAME, points=points)
        new_count += len(points)
        pending_points.clear()

    for art in articles:
        ahash = article_hash(art["news_id"])
        chunks = splitter.split_text(art["content"])
        for i, chunk in enumerate(chunks):
            chunk_id = f"{ahash}_{i}"
            if chunk_id in existing_ids:
                skip_count += 1
                continue
            existing_ids.add(chunk_id)
            payload = {
                "page_content": chunk,
                "chunk_id": chunk_id,
                "stock_id": art["stock_id"],
                "title": art["title"],
                "source": art["source"],
                "pub_time": art["pub_time"],
                "pub_ts": _pub_time_to_ts(art["pub_time"]),
                "url": art["url"],
                "tags": art["tags"],
            }
            pending_points.append((chunk, payload))
            if len(pending_points) >= BATCH_SIZE:
                flush_batch()

    flush_batch()
    return new_count, skip_count


# ── 主程式 ────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="鉅亨網新聞 → Qdrant 向量庫")
    parser.add_argument("--days", type=int, default=None, help="抓最近 N 天")
    parser.add_argument("--from", dest="from_date", default=None, help="起始日期 YYYY-MM-DD")
    args = parser.parse_args()

    client = get_qdrant_client()
    print("✅ 連線 Qdrant 成功")

    # 決定起始時間
    tz_taipei = timezone(timedelta(hours=8))
    end_dt = datetime.now(tz=tz_taipei)

    if args.days:
        start_dt = end_dt - timedelta(days=args.days)
    elif args.from_date:
        start_dt = datetime.fromisoformat(args.from_date).replace(tzinfo=tz_taipei)
    else:
        latest = get_latest_pub_time(client)
        if latest:
            if latest.tzinfo is None:
                latest = latest.replace(tzinfo=tz_taipei)
            start_dt = latest - timedelta(hours=1)  # 往前一小時確保無遺漏
            print(f"📅 自動偵測最新時間點：{latest.strftime('%Y-%m-%d %H:%M')}，從此開始補齊")
        else:
            start_dt = end_dt - timedelta(days=30)
            print("⚠️  Qdrant 無資料，預設抓最近 30 天")

    # 抓取
    articles = fetch_all_for_range(start_dt, end_dt)
    print(f"\n📋 共找到 {len(articles)} 篇相關文章（含重複股票）")
    if not articles:
        print("無新文章，結束。")
        return

    # 載入已存在 chunk_id
    print("🔍 載入現有 chunk_id...")
    existing_ids = get_existing_chunk_ids(client)
    print(f"   已有 {len(existing_ids)} 個 chunk")

    # Embedding
    print("🚀 開始向量化並寫入...")
    embeddings = NVIDIAEmbeddings(model="nvidia/nemotron-3-embed-1b")

    # 確保 collection 存在（用一個測試 embed 取得維度）
    test_vec = embeddings.embed_query("test")
    ensure_collection(client, len(test_vec))

    new_count, skip_count = process_and_upsert(articles, embeddings, client, existing_ids)

    print(f"\n✅ 完成！新增 {new_count} 個 chunk，跳過 {skip_count} 個（已存在）")
    info = client.get_collection(COLLECTION_NAME)
    print(f"📊 Qdrant 總向量數：{info.points_count}")


if __name__ == "__main__":
    main()
