"""build_vector_db.py 的純終端機版本（不依賴 Tkinter）。
邏輯與 build_vector_db.py 相同：從 MySQL news_chunks 表讀取切塊資料，
以 chunk_id 判斷斷點續傳，並行寫入 Qdrant，僅將進度改印在終端機。
"""
import os
import sys
import time
import uuid
import threading
import queue
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "rag"))
from chunk_storage_mysql import iter_chunks_grouped_by_stock  # noqa: E402

load_dotenv(verbose=True)

MAX_WORKERS = 4


def _pub_time_to_ts(pub_time):
    if not pub_time:
        return None
    s = pub_time.replace("T", " ")
    if "+" in s:
        s = s[:s.index("+")]
    s = s[:19].strip()
    try:
        from datetime import datetime
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


progress_lock = threading.Lock()
progress = {"done": 0, "total": 0, "start": time.time()}
db_write_queue = queue.Queue()


def _print_progress():
    with progress_lock:
        done, total = progress["done"], progress["total"]
        elapsed = time.time() - progress["start"]
        speed = done / elapsed if elapsed > 0 else 0
        eta = (total - done) / speed if speed > 0 else 0
        pct = (done / total * 100) if total else 0
        print(f"\r進度: {done}/{total} ({pct:.1f}%)  {speed:.1f} chunks/秒  預估剩餘 {eta/60:.1f} 分鐘", end="", flush=True)


def process_batch_task(batch_docs, embeddings, stock_id):
    """僅負責呼叫 embedding API（thread-safe），實際 Qdrant 寫入交給主執行緒的 queue 處理，
    避免 local QdrantClient（SQLite-backed）跨執行緒使用而崩潰。"""
    MAX_RETRY = 3
    for attempt in range(MAX_RETRY):
        try:
            texts = [doc.page_content for doc in batch_docs]
            metadatas = [doc.metadata for doc in batch_docs]
            vectors = embeddings.embed_documents(texts)
            db_write_queue.put((stock_id, texts, vectors, metadatas, len(batch_docs)))
            return
        except Exception as e:
            err_short = str(e)[:120]
            if attempt < MAX_RETRY - 1:
                wait = 5 * (attempt + 1)
                print(f"\n⚠️  {stock_id} 批次失敗，{wait}秒後重試 ({attempt+1}/{MAX_RETRY-1}): {err_short}")
                time.sleep(wait)
            else:
                print(f"\n❌ {stock_id} 批次最終失敗: {err_short}")
                db_write_queue.put(None)  # 通知主執行緒此任務結束（失敗）


def main():
    persist_directory = "./qdrant_db"
    collection_name = "news_chunks"
    embeddings = NVIDIAEmbeddings(model="nvidia/nv-embedqa-e5-v5")
    existing_ids = set()

    print("連線 Qdrant 並載入既有 chunk_id...")
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
        except Exception as e:
            print(f"（collection 尚不存在或讀取失敗，將視為全新建置: {e}）")

    print(f"已存在 chunk 數: {len(existing_ids)}")

    print("從 MySQL 讀取 chunks...")
    chunks_by_stock = iter_chunks_grouped_by_stock()

    stocks_data = {}
    for sid, chunks in chunks_by_stock.items():
        if not chunks:
            continue
        stocks_data[sid] = {"total": len(chunks), "rem_docs": []}
        for c in chunks:
            if c["chunk_id"] in existing_ids:
                continue
            doc = Document(
                page_content=c["content_chunk"],
                metadata={
                    "chunk_id": c["chunk_id"],
                    "stock_id": sid,
                    "title": c["title"],
                    "source": c["source"],
                    "pub_time": c["pub_time"],
                    "pub_ts": _pub_time_to_ts(c["pub_time"]),
                    "url": c.get("url", ""),
                    "tags": c.get("tags", ""),
                },
            )
            stocks_data[sid]["rem_docs"].append(doc)

    total_all = sum(d["total"] for d in stocks_data.values())
    remaining_all = sum(len(d["rem_docs"]) for d in stocks_data.values())
    done_all = total_all - remaining_all

    progress["total"] = total_all
    progress["done"] = done_all
    progress["start"] = time.time()

    print(f"總 chunk 數: {total_all}，已完成: {done_all}，待處理: {remaining_all}")
    for sid, d in stocks_data.items():
        if d["rem_docs"]:
            print(f"  - {sid}: 待處理 {len(d['rem_docs'])} / 總 {d['total']}")

    if remaining_all == 0:
        print("沒有新的 chunk 需要向量化，已是最新狀態。")
        return

    all_batch_tasks = []
    for sid, d in stocks_data.items():
        for i in range(0, len(d["rem_docs"]), 50):
            all_batch_tasks.append((sid, d["rem_docs"][i:i + 50]))

    _print_progress()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [
            executor.submit(process_batch_task, docs, embeddings, sid)
            for sid, docs in all_batch_tasks
        ]

        # 主執行緒是唯一操作 Qdrant client 的地方（local/SQLite 模式無法跨執行緒使用）
        pending = len(futures)
        while pending > 0:
            item = db_write_queue.get()
            pending -= 1
            if item is None:
                continue
            stock_id, texts, vectors, metadatas, n = item
            try:
                client.get_collection(collection_name)
            except Exception:
                client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(size=len(vectors[0]), distance=Distance.COSINE)
                )
            points = [
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=vector,
                    payload={"page_content": text, **metadata}
                )
                for text, vector, metadata in zip(texts, vectors, metadatas)
            ]
            client.upsert(collection_name=collection_name, points=points)
            with progress_lock:
                progress["done"] += n
            _print_progress()

        for fut in futures:
            fut.result()

    print("\n✅ 向量化任務全數完成！")


if __name__ == "__main__":
    main()
