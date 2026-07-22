"""一次性遷移腳本：把 news_db_filtered/（檔案系統版）匯入 MySQL news_articles / news_chunks 表。

用法（於 repo 根目錄執行，因為 news_db_filtered 路徑是相對於根目錄）：
    cd /Users/bob/Projects/rag
    python3 rag/migrate_news_to_mysql.py
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pymysql
import pymysql.cursors

from chunk_storage_mysql import ensure_table as ensure_chunks_table
from news_storage_mysql import _get_conn, _source_group  # noqa: F401 (reuse conn helper)

DB_ROOT = "news_db_filtered"
BATCH_SIZE = 500


def migrate_articles():
    with open(os.path.join(DB_ROOT, "index.json"), "r", encoding="utf-8") as f:
        index = json.load(f)
    articles = index["news"]

    rows = []
    skipped = 0
    for art in articles:
        content_path = os.path.join(DB_ROOT, art["content_file"])
        try:
            with open(content_path, "r", encoding="utf-8") as cf:
                content = cf.read()
        except FileNotFoundError:
            skipped += 1
            continue
        rows.append((
            art["article_id"], art.get("source"), art.get("source_group"),
            art.get("stock_id"), art.get("title"), art.get("pub_time"),
            art.get("url"), art.get("tags"), content,
        ))

    with _get_conn() as conn:
        with conn.cursor() as cur:
            for i in range(0, len(rows), BATCH_SIZE):
                batch = rows[i:i + BATCH_SIZE]
                cur.executemany(
                    """INSERT IGNORE INTO news_articles
                       (article_id, source, source_group, stock_id, title, pub_time, url, tags, content)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    batch,
                )
        conn.commit()

    print(f"news_articles 遷移完成：{len(rows)} 篇（略過 {skipped} 篇找不到全文檔案）")


def migrate_chunks():
    ensure_chunks_table()
    chunk_files = (
        glob.glob(os.path.join(DB_ROOT, "*", "chunks", "*_chunks.json")) +
        glob.glob(os.path.join(DB_ROOT, "chunks", "*_chunks.json"))
    )

    rows = []
    for f in chunk_files:
        with open(f, "r", encoding="utf-8") as jf:
            chunks = json.load(jf)
        for c in chunks:
            rows.append((
                c["chunk_id"], c.get("article_id"), c.get("stock_id"), c.get("source"),
                c.get("pub_time"), c.get("title"), c.get("url"), c.get("tags"), c.get("content_chunk"),
            ))

    with _get_conn() as conn:
        with conn.cursor() as cur:
            for i in range(0, len(rows), BATCH_SIZE):
                batch = rows[i:i + BATCH_SIZE]
                cur.executemany(
                    """INSERT IGNORE INTO news_chunks
                       (chunk_id, article_id, stock_id, source, pub_time, title, url, tags, content_chunk)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    batch,
                )
        conn.commit()

    print(f"news_chunks 遷移完成：{len(rows)} 個 chunk（來自 {len(chunk_files)} 個檔案）")


if __name__ == "__main__":
    migrate_articles()
    migrate_chunks()
