"""將 news_db_filtered/（原始新聞 + 切塊後 chunks）匯出為 MySQL .sql 檔。

讀取來源：
  news_db_filtered/index.json                       -> news_articles（含全文）
  news_db_filtered/{source}/chunks/*_chunks.json     -> news_chunks

輸出：
  news_articles.sql（CREATE TABLE + INSERT，含全文）
  news_chunks.sql（CREATE TABLE + INSERT，含切塊內容，FK 關聯 article_id）

用法：
  python3 export_news_to_sql.py
匯入方式（同事那邊）：
  mysql -u <user> -p <database> < news_articles.sql
  mysql -u <user> -p <database> < news_chunks.sql
"""
import glob
import json
import os

DB_ROOT = "news_db_filtered"
INDEX_PATH = os.path.join(DB_ROOT, "index.json")
BATCH_SIZE = 500


def sql_escape(value):
    if value is None:
        return "NULL"
    s = str(value)
    s = s.replace("\\", "\\\\").replace("'", "\\'").replace("\r", "\\r").replace("\n", "\\n").replace("\0", "")
    return f"'{s}'"


def export_articles():
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        index = json.load(f)
    articles = index["news"]

    out_path = "news_articles.sql"
    with open(out_path, "w", encoding="utf-8") as out:
        out.write("SET NAMES utf8mb4;\n")
        out.write("DROP TABLE IF EXISTS news_articles;\n")
        out.write("""CREATE TABLE news_articles (
    article_id VARCHAR(64) PRIMARY KEY,
    source VARCHAR(50),
    source_group VARCHAR(50),
    stock_id VARCHAR(20),
    title TEXT,
    pub_time VARCHAR(40),
    url TEXT,
    tags TEXT,
    content LONGTEXT,
    INDEX idx_stock_id (stock_id),
    INDEX idx_pub_time (pub_time),
    INDEX idx_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
""")

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
                sql_escape(art["article_id"]),
                sql_escape(art.get("source")),
                sql_escape(art.get("source_group")),
                sql_escape(art.get("stock_id")),
                sql_escape(art.get("title")),
                sql_escape(art.get("pub_time")),
                sql_escape(art.get("url")),
                sql_escape(art.get("tags")),
                sql_escape(content),
            ))

        cols = "(article_id, source, source_group, stock_id, title, pub_time, url, tags, content)"
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i + BATCH_SIZE]
            values = ",\n".join(
                "(" + ", ".join(r) + ")" for r in batch
            )
            out.write(f"INSERT INTO news_articles {cols} VALUES\n{values};\n")

    print(f"news_articles.sql 完成：{len(rows)} 篇（略過 {skipped} 篇找不到全文檔案）")


def export_chunks():
    chunk_files = (
        glob.glob(os.path.join(DB_ROOT, "*", "chunks", "*_chunks.json")) +
        glob.glob(os.path.join(DB_ROOT, "chunks", "*_chunks.json"))
    )

    out_path = "news_chunks.sql"
    with open(out_path, "w", encoding="utf-8") as out:
        out.write("SET NAMES utf8mb4;\n")
        out.write("DROP TABLE IF EXISTS news_chunks;\n")
        out.write("""CREATE TABLE news_chunks (
    chunk_id VARCHAR(80) PRIMARY KEY,
    article_id VARCHAR(64),
    stock_id VARCHAR(20),
    source VARCHAR(50),
    pub_time VARCHAR(40),
    title TEXT,
    url TEXT,
    tags TEXT,
    content_chunk TEXT,
    INDEX idx_article_id (article_id),
    INDEX idx_stock_id (stock_id),
    INDEX idx_pub_time (pub_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
""")

        rows = []
        for f in chunk_files:
            with open(f, "r", encoding="utf-8") as jf:
                chunks = json.load(jf)
            for c in chunks:
                rows.append((
                    sql_escape(c["chunk_id"]),
                    sql_escape(c.get("article_id")),
                    sql_escape(c.get("stock_id")),
                    sql_escape(c.get("source")),
                    sql_escape(c.get("pub_time")),
                    sql_escape(c.get("title")),
                    sql_escape(c.get("url")),
                    sql_escape(c.get("tags")),
                    sql_escape(c.get("content_chunk")),
                ))

        cols = "(chunk_id, article_id, stock_id, source, pub_time, title, url, tags, content_chunk)"
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i + BATCH_SIZE]
            values = ",\n".join(
                "(" + ", ".join(r) + ")" for r in batch
            )
            out.write(f"INSERT INTO news_chunks {cols} VALUES\n{values};\n")

    print(f"news_chunks.sql 完成：{len(rows)} 個 chunk（來自 {len(chunk_files)} 個檔案）")


if __name__ == "__main__":
    export_articles()
    export_chunks()
