"""NewsStorageManager 的 MySQL 版本。

取代 news_storage.py 的檔案系統儲存（index.json + {source}/content/*.txt），
改為讀寫 MySQL topic_stock 資料庫的 news_articles 表。

article_id 產生規則與去重邏輯與 news_storage.py 保持一致：
    article_id = md5(f"{source}_{title}_{pub_time}")
"""
import hashlib
import os

import pymysql
import pymysql.cursors


def _get_conn():
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "rag"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DATABASE", "topic_stock"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


MEDIA_SOURCES = {"cnyes", "ltn", "moneydj", "udn", "yahoo", "chinatimes"}


def _source_group(source):
    return source if source in MEDIA_SOURCES else "cmoney"


class NewsStorageManagerMySQL:
    def __init__(self):
        self._ensure_table()

    def _ensure_table(self):
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS news_articles (
                        article_id VARCHAR(64) PRIMARY KEY,
                        source VARCHAR(50),
                        source_group VARCHAR(50),
                        stock_id VARCHAR(20),
                        title TEXT,
                        pub_time VARCHAR(40),
                        url TEXT,
                        tags TEXT,
                        content LONGTEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_stock_id (stock_id),
                        INDEX idx_pub_time (pub_time),
                        INDEX idx_source (source)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """)
            conn.commit()

    def add_news(self, source, stock_id, title, pub_time, url, content, tags=""):
        article_id = hashlib.md5(f"{source}_{title}_{pub_time}".encode("utf-8")).hexdigest()
        source_group = _source_group(source)

        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM news_articles WHERE article_id = %s", (article_id,))
                if cur.fetchone():
                    return False, "Duplicate article"

                cur.execute(
                    """INSERT INTO news_articles
                       (article_id, source, source_group, stock_id, title, pub_time, url, tags, content)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (article_id, source, source_group, stock_id, title, pub_time, url, tags, content),
                )
            conn.commit()
        return True, article_id

    def get_stats(self):
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS total FROM news_articles")
                total = cur.fetchone()["total"]
                cur.execute("SELECT source, COUNT(*) AS cnt FROM news_articles GROUP BY source")
                sources = {row["source"]: row["cnt"] for row in cur.fetchall()}
        return {"total_count": total, "sources": sources}

    def get_all_articles(self):
        """回傳所有文章（不含 content 全文，供 chunking 逐篇再查 content）。"""
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT article_id, source, source_group, stock_id, title, pub_time, url, tags "
                    "FROM news_articles"
                )
                return cur.fetchall()

    def get_content(self, article_id):
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT content FROM news_articles WHERE article_id = %s", (article_id,))
                row = cur.fetchone()
                return row["content"] if row else None
