import os
import glob
import time
import json
import uuid
import threading
import queue
import tkinter as tk
from tkinter import ttk
from pathlib import Path
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor

from langchain_core.documents import Document
from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

# 1. 載入 .env
load_dotenv(verbose=True)

# 併發數
MAX_WORKERS = 4

class VectorDBGUI:
    def __init__(self, root, total_tasks, initial_done):
        self.root = root
        self.root.title("NVIDIA RAG - Parallel Optimizer V4.1 (Fixed Metrics)")
        self.root.geometry("1000x850")

        self.root.configure(bg="#ffffff")

        # 設定更顯眼的字體
        self.font_main = ("Arial", 12)
        self.font_bold = ("Arial", 13, "bold")
        self.font_header = ("Arial", 18, "bold")
        self.font_mini = ("Courier New", 11, "bold")
        
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("Treeview", font=self.font_main, rowheight=40, background="white", foreground="black")
        style.configure("Treeview.Heading", font=self.font_bold, background="#000000", foreground="white")
        style.map("Treeview", background=[('selected', '#0078d4')], foreground=[('selected', 'white')])

        # --- 上方進度 ---
        self.header = tk.Frame(root, bg="#000000", pady=20)
        self.header.pack(fill=tk.X)
        self.title_lbl = tk.Label(self.header, text="向量資料庫並行建置工具 (高對比/聚合版)", font=self.font_header, fg="#00FF00", bg="#000000")
        self.title_lbl.pack()

        self.info_frame = tk.Frame(root, bg="#eeeeee", pady=20, padx=25, highlightthickness=2, highlightbackground="#000000")
        self.info_frame.pack(fill=tk.X, padx=15, pady=10)

        self.total_label = tk.Label(self.info_frame, text=f"📊 總處理進度: {initial_done} / {total_tasks}", font=self.font_bold, bg="#eeeeee", fg="#000000")
        self.total_label.pack(side=tk.LEFT)

        self.eta_label = tk.Label(self.info_frame, text="⏱ 預估剩餘: 計算中...", font=self.font_bold, bg="#eeeeee", fg="#555555")
        self.eta_label.pack(side=tk.LEFT, padx=20)
        self._start_time = time.time()
        self._initial_done = initial_done

        style.configure("TProgressbar", thickness=35, background="#00FF00")
        self.progress_bar = ttk.Progressbar(self.info_frame, length=500, mode='determinate', maximum=total_tasks, style="TProgressbar")
        self.progress_bar.pack(side=tk.RIGHT, padx=10)
        self.progress_bar['value'] = initial_done

        # --- 股票列表 ---
        self.tree_frame = tk.Frame(root, bg="#ffffff")
        self.tree_frame.pack(fill=tk.BOTH, expand=True, padx=15)
        self.tree = ttk.Treeview(self.tree_frame, columns=("Stock", "Progress", "Status"), show='headings')
        self.tree.heading("Stock", text="股票代號")
        self.tree.heading("Progress", text="進度 (已完成/總量)")
        self.tree.heading("Status", text="當前詳細狀態")
        self.tree.column("Stock", width=150, anchor=tk.CENTER)
        self.tree.column("Progress", width=250, anchor=tk.CENTER)
        self.tree.column("Status", width=450, anchor=tk.W)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # 高對比顏色定義
        self.tree.tag_configure('processing', background='#FFFF00', foreground='black') # 亮黃
        self.tree.tag_configure('success', background='#00FF00', foreground='black')    # 亮綠
        self.tree.tag_configure('completed_full', background='#000000', foreground='#FFFFFF') # 黑底白字
        self.tree.tag_configure('error', background='#FF0000', foreground='#FFFFFF')      # 紅底白字

        # --- Worker 監控 ---
        self.worker_frame = tk.LabelFrame(root, text=" ⚡ 核心狀態 (Core Status) ", font=self.font_bold, bg="#ffffff", fg="#000000")
        self.worker_frame.pack(fill=tk.X, padx=15, pady=15)

        self.worker_labels = []
        for i in range(MAX_WORKERS):
            f = tk.Frame(self.worker_frame, bg="#ffffff")
            f.pack(fill=tk.X, pady=4, padx=10)
            tk.Label(f, text=f"CORE {i+1}:", font=self.font_mini, width=10, bg="#000000", fg="#FFFFFF").pack(side=tk.LEFT)
            lbl = tk.Label(f, text="IDLE", font=self.font_mini, bg="#eeeeee", fg="#000000", width=100, anchor=tk.W, padx=5)
            lbl.pack(side=tk.LEFT, padx=5)
            self.worker_labels.append(lbl)

        self.stock_tasks = {}
        self.total_tasks = total_tasks
        self.current_done = initial_done
        self.gui_lock = threading.Lock()

    def add_stock(self, stock_id, done, total):
        with self.gui_lock:
            if stock_id in self.stock_tasks: return
            
            # 修正顯示邏輯：確保 done 不會超過 total
            display_done = min(done, total)
            if display_done >= total:
                status = "✅ 處理完畢 (100%)"
                tags = ('completed_full',)
            else:
                status = "WAITING"
                tags = ()
            
            item_id = self.tree.insert("", "end", values=(stock_id, f"{display_done} / {total}", status), tags=tags)
            self.stock_tasks[stock_id] = {"id": item_id, "done": display_done, "total": total}

    def update_stock(self, stock_id, done, status, tag=None):
        with self.gui_lock:
            task = self.stock_tasks.get(stock_id)
            if task:
                task["done"] = min(max(task["done"], done), task["total"])
                tags = (tag,) if tag else ()
                if task["done"] >= task["total"]:
                    status = "✅ 處理完畢"
                    tags = ('completed_full',)
                self.tree.item(task["id"], values=(stock_id, f"{task['done']} / {task['total']}", status), tags=tags)
                if tag == 'processing':
                    self.tree.see(task["id"])

    def update_worker(self, wid, status, color="#eeeeee", fg="#000000"):
        with self.gui_lock:
            if 0 <= wid < len(self.worker_labels):
                self.worker_labels[wid].config(text=status, bg=color, fg=fg)

    def update_overall(self, inc):
        with self.gui_lock:
            self.current_done = min(self.current_done + inc, self.total_tasks)
            self.progress_bar['value'] = self.current_done
            self.total_label.config(text=f"📊 總處理進度: {self.current_done} / {self.total_tasks}")

            # 計算 ETA
            elapsed = time.time() - self._start_time
            processed = self.current_done - self._initial_done
            if processed > 0:
                speed = processed / elapsed
                remaining = self.total_tasks - self.current_done
                eta_sec = remaining / speed
                if eta_sec >= 3600:
                    eta_str = f"{eta_sec/3600:.1f} 小時"
                elif eta_sec >= 60:
                    eta_str = f"{eta_sec/60:.0f} 分鐘"
                else:
                    eta_str = f"{eta_sec:.0f} 秒"
                self.eta_label.config(text=f"⏱ 預估剩餘: {eta_str}  ({speed:.1f} chunks/秒)")

            if self.current_done >= self.total_tasks:
                self.header.config(bg="#00ff00")
                self.title_lbl.config(text="🎉 向量化任務全數完成！", fg="#000000")
                self.eta_label.config(text="⏱ 已完成！", fg="#007700")

db_lock = threading.Lock()

def process_batch_task(wid, batch_docs, embeddings, stock_id, current_done, update_queue, vectorstore_ref, qdrant_params):
    MAX_RETRY = 3
    for attempt in range(MAX_RETRY):
        try:
            texts = [doc.page_content for doc in batch_docs]
            metadatas = [doc.metadata for doc in batch_docs]

            update_queue.put(("worker", (wid, f"🚀 [API] {stock_id} 運算中...", "#FFFF00", "black")))
            update_queue.put(("update_stock", (stock_id, current_done, "🌐 API 請求中...", "processing")))

            vectors = embeddings.embed_documents(texts)

            update_queue.put(("worker", (wid, f"📥 [DB] {stock_id} 寫入中...", "#00FF00", "black")))
            with db_lock:
                client = vectorstore_ref["client"]
                collection_name = qdrant_params["collection_name"]

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

            update_queue.put(("overall_inc", len(batch_docs)))
            update_queue.put(("update_stock", (stock_id, current_done + len(batch_docs), "🟢 批次寫入成功", "success")))
            update_queue.put(("worker", (wid, "IDLE", "#eeeeee", "black")))
            return  # 成功後直接返回
        except Exception as e:
            err_short = str(e)[:80]
            if attempt < MAX_RETRY - 1:
                wait = 5 * (attempt + 1)
                update_queue.put(("worker", (wid, f"⚠️ Retry {attempt+1}/{MAX_RETRY-1}: {err_short}", "#FFA500", "black")))
                time.sleep(wait)
            else:
                update_queue.put(("update_stock", (stock_id, current_done, f"❌ {err_short}", "error")))
                update_queue.put(("worker", (wid, f"❌ 失敗: {err_short}", "#FF0000", "white")))

def build_worker_pool(gui, update_queue, client, collection_name, existing_ids):
    embeddings = NVIDIAEmbeddings(model="nvidia/nv-embedqa-e5-v5")
    vectorstore_ref = {"client": client}


    # 掃描新結構（各來源子資料夾）+ 舊結構（chunks/）
    chunk_files = (
        glob.glob(os.path.join("news_db_filtered", "*", "chunks", "*_chunks.json")) +
        glob.glob(os.path.join("news_db_filtered", "chunks", "*_chunks.json"))
    )
    stocks_data = {} # 聚合資料: stock_id -> {'total': int, 'rem_docs': list, 'done': int}

    # 1. 聚合所有檔案中的 chunks 到以股票為單位的字典
    for f in chunk_files:
        with open(f, 'r', encoding='utf-8') as jf:
            chunks = json.load(jf)
        if not chunks: continue

        sid = chunks[0]['stock_id']
        if sid not in stocks_data:
            stocks_data[sid] = {'total': 0, 'rem_docs': [], 'done': 0}

        stocks_data[sid]['total'] += len(chunks)
        for c in chunks:
            if c['chunk_id'] in existing_ids:
                stocks_data[sid]['done'] += 1
            else:
                doc = Document(page_content=c['content_chunk'],
                              metadata={
                                  "chunk_id": c['chunk_id'],
                                  "stock_id": sid,
                                  "title": c['title'],
                                  "source": c['source'],
                                  "pub_time": c['pub_time'],
                                  "url": c.get('url', ''),
                                  "tags": c.get('tags', ''),
                              })
                stocks_data[sid]['rem_docs'].append(doc)

    # 2. 初始化 UI 並準備任務清單
    all_batch_tasks = []
    for sid, data in stocks_data.items():
        # 初始化 UI
        update_queue.put(("add", (sid, data['done'], data['total'])))

        # 分批任務
        for i in range(0, len(data['rem_docs']), 50):
            all_batch_tasks.append({
                "docs": data['rem_docs'][i:i+50],
                "sid": sid,
                "curr": data['done'] + i
            })

    qdrant_params = {"collection_name": collection_name}

    # 3. 執行並行處理
    if all_batch_tasks:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            for i, task in enumerate(all_batch_tasks):
                executor.submit(process_batch_task, i % MAX_WORKERS, task["docs"], embeddings,
                                task["sid"], task["curr"], update_queue, vectorstore_ref, qdrant_params)

def main():
    root = tk.Tk()
    persist_directory = "./qdrant_db"
    collection_name = "news_chunks"
    embeddings = NVIDIAEmbeddings(model="nvidia/nv-embedqa-e5-v5")
    existing_ids = set()

    # 建立唯一的 Qdrant client（避免並發鎖定），並載入已存在的 chunk_id
    try:
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
    except Exception as e:
        print(f"建立 client 失敗: {e}")
        client = None

    chunk_files = (
        glob.glob(os.path.join("news_db_filtered", "*", "chunks", "*_chunks.json")) +
        glob.glob(os.path.join("news_db_filtered", "chunks", "*_chunks.json"))
    )
    total_all = 0
    done_all = 0

    for f in chunk_files:
        with open(f, 'r', encoding='utf-8') as jf:
            data = json.load(jf)
            total_all += len(data)
            # 全域 Done 數也只計算目前存在於 JSON 裡的 ID
            done_all += sum(1 for c in data if c['chunk_id'] in existing_ids)

    gui = VectorDBGUI(root, total_all, done_all)
    q = queue.Queue()

    def poll():
        try:
            while True:
                m, d = q.get_nowait()
                if m == "add": gui.add_stock(*d)
                elif m == "update_stock": gui.update_stock(*d)
                elif m == "overall_inc": gui.update_overall(d)
                elif m == "worker": gui.update_worker(*d)
                q.task_done()
        except: pass
        root.after(50, poll)

    threading.Thread(target=build_worker_pool, args=(gui, q, client, collection_name, existing_ids), daemon=True).start()
    poll()
    root.mainloop()

if __name__ == "__main__":
    main()
