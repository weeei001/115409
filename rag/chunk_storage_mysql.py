"""切塊資料的 MySQL 存取層，取代 news_db_filtered/{source}/chunks/*_chunks.json。"""
import os

import pymysql
import pymysql.cursors


def _get_conn():
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "rag"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DATABASE", "rag_logs"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def ensure_table():
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS news_chunks (
                    chunk_id VARCHAR(80) PRIMARY KEY,
                    article_id VARCHAR(64),
                    stock_id VARCHAR(20),
                    source VARCHAR(50),
                    pub_time VARCHAR(40),
                    title TEXT,
                    url TEXT,
                    tags TEXT,
                    content_chunk TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_article_id (article_id),
                    INDEX idx_stock_id (stock_id),
                    INDEX idx_pub_time (pub_time)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
        conn.commit()


def get_chunked_article_ids():
    """回傳已經切過塊的 article_id 集合，供 run_chunking.py 判斷斷點續傳。"""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT article_id FROM news_chunks")
            return {row["article_id"] for row in cur.fetchall()}


def insert_chunks(chunks):
    """chunks: list of dict，欄位需含 chunk_id, article_id, stock_id, source, pub_time, title, url, tags, content_chunk"""
    if not chunks:
        return
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO news_chunks
                   (chunk_id, article_id, stock_id, source, pub_time, title, url, tags, content_chunk)
                   VALUES (%(chunk_id)s, %(article_id)s, %(stock_id)s, %(source)s, %(pub_time)s,
                           %(title)s, %(url)s, %(tags)s, %(content_chunk)s)
                   ON DUPLICATE KEY UPDATE content_chunk = VALUES(content_chunk)""",
                chunks,
            )
        conn.commit()


def get_all_chunk_ids():
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT chunk_id FROM news_chunks")
            return {row["chunk_id"] for row in cur.fetchall()}


def iter_chunks_grouped_by_stock():
    """回傳 {stock_id: [chunk dict, ...]}，供 build_vector_db 向量化使用。"""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT chunk_id, article_id, stock_id, source, pub_time, title, url, tags, content_chunk "
                "FROM news_chunks"
            )
            rows = cur.fetchall()

    grouped = {}
    for row in rows:
        grouped.setdefault(row["stock_id"], []).append(row)
    return grouped
