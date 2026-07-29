"""
build_vector_db.py 的無 GUI 版本。

背景：此機器的系統 Python 綁定的 Tcl/Tk 版本過舊，無法辨識新版 macOS，
執行 build_vector_db.py 會在 tk.Tk() 直接崩潰（"macOS XX required" 錯誤）。

注意：本地 SQLite-backed QdrantClient（`QdrantClient(path=...)`）不支援跨
執行緒操作，所有 Qdrant 讀寫必須集中在主執行緒依序執行（不可用 ThreadPoolExecutor
平行呼叫 client.upsert，否則會拋出 "SQLite objects created in a thread can
only be used in that same thread"）。
"""
import os
import sys
import time
import uuid
from dotenv import load_dotenv

from langchain_core.documents import Document
from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

sys.path.insert(0, os.path.dirname(__file__))
from chunk_storage_mysql import iter_chunks_grouped_by_stock  # noqa: E402
from build_vector_db import _pub_time_to_ts  # noqa: E402

load_dotenv(verbose=True)


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
        results = client.scroll(collection_name=collection_name, limit=200_000, with_payload=True)
        for point in results[0]:
            if "chunk_id" in point.payload:
                existing_ids.add(point.payload["chunk_id"])
    print(f"Qdrant 已存在 chunk 數：{len(existing_ids)}")

    chunks_by_stock = iter_chunks_grouped_by_stock()
    stocks_data = {}
    for sid, chunks in chunks_by_stock.items():
        if not chunks:
            continue
        if sid not in stocks_data:
            stocks_data[sid] = {"total": 0, "rem_docs": [], "done": 0}
        stocks_data[sid]["total"] += len(chunks)
        for c in chunks:
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
                        "pub_ts": _pub_time_to_ts(c["pub_time"]),
                        "url": c.get("url", ""),
                        "tags": c.get("tags", ""),
                    },
                )
                stocks_data[sid]["rem_docs"].append(doc)

    total_all = sum(d["total"] for d in stocks_data.values())
    done_all = sum(d["done"] for d in stocks_data.values())
    todo_all = total_all - done_all
    print(f"總 chunk 數：{total_all}，已向量化：{done_all}，待處理：{todo_all}")
    for sid, d in stocks_data.items():
        print(f"  {sid}: {d['done']}/{d['total']}")

    if todo_all == 0:
        print("沒有待處理的 chunk，結束。")
        return

    embeddings = NVIDIAEmbeddings(model="nvidia/nv-embedqa-e5-v5")

    all_batch_tasks = []
    for sid, data in stocks_data.items():
        for i in range(0, len(data["rem_docs"]), 50):
            all_batch_tasks.append({"docs": data["rem_docs"][i:i + 50], "sid": sid})

    start_time = time.time()
    done_count = 0
    fail_count = 0

    for task in all_batch_tasks:
        docs = task["docs"]
        sid = task["sid"]
        texts = [d.page_content for d in docs]
        metadatas = [d.metadata for d in docs]

        MAX_RETRY = 3
        for attempt in range(MAX_RETRY):
            try:
                vectors = embeddings.embed_documents(texts)
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
                done_count += len(docs)
                elapsed = time.time() - start_time
                speed = done_count / elapsed if elapsed > 0 else 0
                print(f"[進度] {sid}: +{len(docs)}（累計 {done_count}/{todo_all}，{speed:.1f} chunks/秒）", flush=True)
                break
            except Exception as e:
                err_short = str(e)[:120]
                if attempt < MAX_RETRY - 1:
                    wait = 5 * (attempt + 1)
                    print(f"[重試 {attempt+1}/{MAX_RETRY-1}] {sid}: {err_short}，{wait}s 後重試", flush=True)
                    time.sleep(wait)
                else:
                    fail_count += len(docs)
                    print(f"[錯誤] {sid} 批次失敗（已重試 {MAX_RETRY} 次）: {err_short}", flush=True)

    print(f"完成！成功向量化 {done_count} 筆，失敗 {fail_count} 筆（待處理共 {todo_all} 筆）。")


if __name__ == "__main__":
    main()
