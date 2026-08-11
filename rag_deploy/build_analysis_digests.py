"""
離線預建「週期性個股分析總結」
================================
在不同時間點（每週五 / 每月底）為指定股票預先產出個股分析 digest，
落地到 MySQL topic_stock.analysis_digests，供第二支 API（/api/analysis_digest）直接回傳。

用自架 H200 重模型產 digest（無限速、可用大模型），embedding 檢索仍走 NVIDIA NIM。
斷點續傳：同 stock+as_of+period 已存在則跳過（--force 可強制重建）。

用法：
    python build_analysis_digests.py --stock 2330 --start 2025-01-01 --end 2025-03-01 --period week
    python build_analysis_digests.py --stock all --start 2025-01-01 --end 2025-07-01 --period month
"""

import argparse
import sys
from datetime import date, timedelta

from dotenv import load_dotenv

import digest_store
from digest_core import STOCK_NAMES, make_h200_client, generate_digest, DigestConfigError

load_dotenv()


def _fridays(start: date, end: date):
    d = start
    while d.weekday() != 4:  # 移到第一個週五
        d += timedelta(days=1)
    while d <= end:
        yield d
        d += timedelta(days=7)


def _month_ends(start: date, end: date):
    # 逐月推進，取每月最後一天
    y, m = start.year, start.month
    while True:
        # 下個月第一天再減一天 = 當月最後一天
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        last = date(ny, nm, 1) - timedelta(days=1)
        if last > end:
            break
        if last >= start:
            yield last
        y, m = ny, nm


def anchor_dates(start: date, end: date, period: str):
    return list(_fridays(start, end) if period == "week" else _month_ends(start, end))


def build_qdrant_embeddings():
    import os
    from qdrant_client import QdrantClient
    from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings

    qdrant_host = os.environ.get("QDRANT_HOST", "")
    qdrant_url = os.environ.get("QDRANT_URL", "")
    if qdrant_host:
        client = QdrantClient(host=qdrant_host, port=6333)
    elif qdrant_url:
        client = QdrantClient(url=qdrant_url)
    else:
        client = QdrantClient(path="./qdrant_db")
    embeddings = NVIDIAEmbeddings(model="nvidia/nv-embedqa-e5-v5")
    return client, embeddings


def main():
    ap = argparse.ArgumentParser(description="離線預建週期性個股分析 digest")
    ap.add_argument("--stock", required=True, help="股票代號，如 2330；或 all 代表全部")
    ap.add_argument("--start", required=True, help="起始日 YYYY-MM-DD")
    ap.add_argument("--end", required=True, help="結束日 YYYY-MM-DD")
    ap.add_argument("--period", choices=["week", "month"], default="week")
    ap.add_argument("--window", type=int, default=30, help="新聞回溯天數（預設 30）")
    ap.add_argument("--force", action="store_true", help="已存在也重建")
    args = ap.parse_args()

    stocks = list(STOCK_NAMES) if args.stock == "all" else [args.stock]
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    anchors = anchor_dates(start, end, args.period)

    llm_client, model_name = make_h200_client()
    if llm_client is None:
        print("❌ 尚未設定 H200：請在 .env 填入 H200_BASE_URL 與 H200_API_KEY（H200_MODEL 選填）後再執行。")
        print(f"   目前 model_name 解析為：{model_name}")
        sys.exit(1)

    digest_store.ensure_table()
    qdrant_client, embeddings = build_qdrant_embeddings()

    total = len(stocks) * len(anchors)
    print(f"預建範圍：{len(stocks)} 檔 × {len(anchors)} 個 {args.period} 錨點 = {total} 筆（模型 {model_name}）")

    done = skipped = failed = 0
    for sid in stocks:
        for anchor in anchors:
            as_of = anchor.isoformat()
            tag = f"[{sid} {as_of} {args.period}]"
            if not args.force and digest_store.exists(sid, as_of, args.period):
                skipped += 1
                print(f"  {tag} 已存在，跳過")
                continue
            try:
                record = generate_digest(
                    qdrant_client, embeddings, llm_client, model_name,
                    sid, as_of, args.period, window_days=args.window,
                )
                digest_store.upsert(record)
                done += 1
                na, nn = len(record["analyst_json"]), len(record["news_json"])
                print(f"  {tag} ✅ 完成（分析師 {na} / 新聞 {nn}）")
            except DigestConfigError as e:
                print(f"  {tag} ❌ 設定錯誤：{e}")
                sys.exit(1)
            except Exception as e:
                failed += 1
                print(f"  {tag} ⚠️ 失敗：{e}")

    print(f"\n完成 {done}、跳過 {skipped}、失敗 {failed}。")


if __name__ == "__main__":
    main()
