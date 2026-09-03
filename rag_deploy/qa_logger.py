import os
import json
import datetime
import pymysql
import pymysql.cursors

LLM_MODEL = os.environ.get("RAG_INTENT_MODEL", "google/gemma-4-31b-it")


def _get_conn():
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", 3306)),
        user=os.environ.get("MYSQL_USER", "rag"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DATABASE", "topic_stock"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def init_db():
    with _get_conn() as conn:
        with conn.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS qa_logs (
                    id              INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp       DATETIME        NOT NULL,
                    query           TEXT            NOT NULL,
                    prompt          LONGTEXT        NOT NULL,
                    chunks_json     LONGTEXT        NOT NULL,
                    ai_answer       LONGTEXT,
                    llm_model       VARCHAR(100)    NOT NULL,
                    duration_ms     INT             NOT NULL,
                    status          VARCHAR(50)     NOT NULL,
                    error_msg       TEXT,
                    tokens_input    INT,
                    tokens_output   INT,
                    tokens_thinking INT
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
            """)
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
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with _get_conn() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO qa_logs
                    (timestamp, query, prompt, chunks_json, ai_answer,
                     llm_model, duration_ms, status, error_msg,
                     tokens_input, tokens_output, tokens_thinking)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (timestamp, query, prompt, chunks_json, ai_answer,
                 LLM_MODEL, duration_ms, status, error_msg,
                 tokens_input, tokens_output, tokens_thinking)
            )
        conn.commit()
