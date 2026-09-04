"""
一次性腳本：僅向量化 pub_time >= 2025-01-01 的 chunk。

背景：2026-09-02 embedding 模型從 nvidia/nv-embedqa-e5-v5（1024維，已下架）
換成 nvidia/nemotron-3-embed-1b（2048維），Qdrant collection 需整個重建。
先只補 2025 年至今的資料應急，之後要補齊全量歷史時再跑 build_vector_db_headless.py
（沿用同一顆 embedding 模型，靠 existing_ids 斷點續傳，不會重複算 2025+ 已做過的部分）。

用法：cd rag && python build_vector_db_2025plus.py
"""
import os
import sys
import time
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

from langchain_core.documents import Document
from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

sys.path.insert(0, os.path.dirname(__file__))
from chunk_storage_mysql import iter_chunks_grouped_by_stock  # noqa: E402
from build_vector_db import _pub_time_to_ts  # noqa: E402

load_dotenv(verbose=True)

CUTOFF_TS = _pub_time_to_ts("2025-01-01T00:00:00+08:00")
MAX_WORKERS = 8


def main():
    persist_directory = "./qdrant_db"
    collection_name = "news_chunks"
    existing_ids = set()

    qdrant_host = os.environ.get("QDRANT_HOST", "")
    if qdrant_host:
        client = QdrantClient(host=qdrant_host, port=6333)
    else:
        client = QdrantClient(path=persist_directory)

    if qdrant_host or os.path.exists(persist_directory):
        try:
            results = client.scroll(collection_name=collection_name, limit=200_000, with_payload=True)
            for point in results[0]:
                if "chunk_id" in point.payload:
                    existing_ids.add(point.payload["chunk_id"])
        except Exception:
            pass
    print(f"Qdrant 已存在 chunk 數：{len(existing_ids)}")

    chunks_by_stock = iter_chunks_grouped_by_stock()
    stocks_data = {}
    skipped_old = 0
    for sid, chunks in chunks_by_stock.items():
        if not chunks:
            continue
        for c in chunks:
            ts = _pub_time_to_ts(c["pub_time"])
            if ts is None or ts < CUTOFF_TS:
                skipped_old += 1
                continue
            if sid not in stocks_data:
                stocks_data[sid] = {"total": 0, "rem_docs": [], "done": 0}
            stocks_data[sid]["total"] += 1
            if c["chunk_id"] in existing_ids:
                stocks_data[sid]["done"] += 1
            else:
                doc = Document(
                    page_content=c["content_chunk"],
                    metadata={
                        "chunk_id": c["chunk_id"],
                        "stock_id": sid,
                        "title": c["title"],
                        "source": c["source"],
                        "pub_time": c["pub_time"],
                        "pub_ts": ts,
                        "url": c.get("url", ""),
                        "tags": c.get("tags", ""),
                    },
                )
                stocks_data[sid]["rem_docs"].append(doc)

    total_all = sum(d["total"] for d in stocks_data.values())
    done_all = sum(d["done"] for d in stocks_data.values())
    todo_all = total_all - done_all
    print(f"2025-01-01 起 chunk 數：{total_all}（略過 2025 年以前：{skipped_old}），已向量化：{done_all}，待處理：{todo_all}")
    for sid, d in stocks_data.items():
        print(f"  {sid}: {d['done']}/{d['total']}")

    if todo_all == 0:
        print("沒有待處理的 chunk，結束。")
        return

    embeddings = NVIDIAEmbeddings(model=os.environ.get("EMBED_MODEL", "nvidia/nemotron-3-embed-1b"))

    all_batch_tasks = []
    for sid, data in stocks_data.items():
        for i in range(0, len(data["rem_docs"]), 50):
            all_batch_tasks.append({"docs": data["rem_docs"][i:i + 50], "sid": sid})

    start_time = time.time()
    counters = {"done": 0, "fail": 0}
    db_lock = threading.Lock()
    stats_lock = threading.Lock()

    def process_batch(task):
        docs = task["docs"]
        sid = task["sid"]
        texts = [d.page_content for d in docs]
        metadatas = [d.metadata for d in docs]

        MAX_RETRY = 3
        for attempt in range(MAX_RETRY):
            try:
                vectors = embeddings.embed_documents(texts)
                with db_lock:
                    try:
                        client.get_collection(collection_name)
                    except Exception:
                        client.create_collection(
                            collection_name=collection_name,
                            vectors_config=VectorParams(size=len(vectors[0]), distance=Distance.COSINE),
                        )
                    points = [
                        PointStruct(id=str(uuid.uuid4()), vector=vector, payload={"page_content": text, **metadata})
                        for text, vector, metadata in zip(texts, vectors, metadatas)
                    ]
                    client.upsert(collection_name=collection_name, points=points)
                with stats_lock:
                    counters["done"] += len(docs)
                    done_count = counters["done"]
                    elapsed = time.time() - start_time
                    speed = done_count / elapsed if elapsed > 0 else 0
                    print(f"[進度] {sid}: +{len(docs)}（累計 {done_count}/{todo_all}，{speed:.1f} chunks/秒）", flush=True)
                return
            except Exception as e:
                err_short = str(e)[:120]
                if attempt < MAX_RETRY - 1:
                    wait = 5 * (attempt + 1)
                    print(f"[重試 {attempt+1}/{MAX_RETRY-1}] {sid}: {err_short}，{wait}s 後重試", flush=True)
                    time.sleep(wait)
                else:
                    with stats_lock:
                        counters["fail"] += len(docs)
                    print(f"[錯誤] {sid} 批次失敗（已重試 {MAX_RETRY} 次）: {err_short}", flush=True)

    workers = MAX_WORKERS if qdrant_host else 1
    print(f"開始向量化：{len(all_batch_tasks)} 個批次，{workers} 條執行緒", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        list(executor.map(process_batch, all_batch_tasks))

    print(f"完成！成功向量化 {counters['done']} 筆，失敗 {counters['fail']} 筆（待處理共 {todo_all} 筆）。")


if __name__ == "__main__":
    main()
