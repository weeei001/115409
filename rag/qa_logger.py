import os
import sqlite3
import json
import datetime

DB_PATH = "./qa_logs.db"

LLM_MODEL = os.environ.get("RAG_LLM_MODEL", "deepseek-ai/deepseek-v4-pro-0813")


def init_db():
    """建立 qa_logs 資料表（若不存在），並自動補齊新欄位（向後相容舊資料庫）"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS qa_logs (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp       TEXT    NOT NULL,
                query           TEXT    NOT NULL,
                prompt          TEXT    NOT NULL,
                chunks_json     TEXT    NOT NULL,
                ai_answer       TEXT,
                llm_model       TEXT    NOT NULL,
                duration_ms     INTEGER NOT NULL,
                status          TEXT    NOT NULL,
                error_msg       TEXT,
                tokens_input    INTEGER,
                tokens_output   INTEGER,
                tokens_thinking INTEGER
            )
        """)
        # 若資料庫已存在但缺少 token 欄位，自動補欄（不影響舊資料）
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(qa_logs)")}
        for col, definition in [
            ("tokens_input",    "INTEGER"),
            ("tokens_output",   "INTEGER"),
            ("tokens_thinking", "INTEGER"),
        ]:
            if col not in existing_cols:
                conn.execute(f"ALTER TABLE qa_logs ADD COLUMN {col} {definition}")
        conn.commit()


def log_qa(
    query: str,
    prompt: str,
    chunks: list,
    ai_answer: str | None,
    duration_ms: int,
    status: str,
    error_msg: str | None = None,
    tokens_input: int | None = None,
    tokens_output: int | None = None,
    tokens_thinking: int | None = None,
):
    """
    寫入一筆問答紀錄。

    Parameters
    ----------
    query           : 使用者問題
    prompt          : 實際送給 LLM 的完整 prompt 字串
    chunks          : Qdrant ScoredPoint 物件列表
    ai_answer       : LLM 回答全文（失敗時為 None）
    duration_ms     : LLM 呼叫耗時（毫秒）
    status          : "success" 或 "error"
    error_msg       : 失敗時的錯誤訊息
    tokens_input    : 輸入 token 數
    tokens_output   : 輸出 token 數
    tokens_thinking : 思考 token 數（若模型支援）
    """
    init_db()

    chunks_data = []
    for hit in chunks:
        p = hit.payload or {}
        chunks_data.append({
            "chunk_id":     p.get("chunk_id", ""),
            "title":        p.get("title", ""),
            "source":       p.get("source", ""),
            "pub_time":     p.get("pub_time", ""),
            "url":          p.get("url", ""),
            "stock_id":     p.get("stock_id", ""),
            "page_content": p.get("page_content", ""),
        })
    chunks_json = json.dumps(chunks_data, ensure_ascii=False)

    timestamp = datetime.datetime.now().isoformat(timespec="seconds")

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO qa_logs
                (timestamp, query, prompt, chunks_json, ai_answer,
                 llm_model, duration_ms, status, error_msg,
                 tokens_input, tokens_output, tokens_thinking)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (timestamp, query, prompt, chunks_json, ai_answer,
             LLM_MODEL, duration_ms, status, error_msg,
             tokens_input, tokens_output, tokens_thinking)
        )
        conn.commit()
