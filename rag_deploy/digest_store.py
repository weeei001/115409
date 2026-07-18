"""
analysis_digests 資料存取層
===========================
落地「週期性個股分析總結」到 MySQL rag_logs.analysis_digests，
供離線預建腳本 upsert、第二支 API 查詢、以及未來「前期分析當參考」查歷史。

MySQL 連線沿用 qa_logger 同一組 MYSQL_* 環境變數（同一個 rag_logs DB）。
"""

from __future__ import annotations

import os
import json
import datetime

import pymysql
import pymysql.cursors


def _get_conn():
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "localhost"),
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
                CREATE TABLE IF NOT EXISTS analysis_digests (
                    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
                    stock_id       VARCHAR(16)  NOT NULL,
                    as_of_date     DATE         NOT NULL,
                    period         ENUM('week','month') NOT NULL,
                    model_name     VARCHAR(100) NOT NULL,
                    analyst_json   JSON,
                    news_json      JSON,
                    technical_json JSON,
                    digest_json    JSON,
                    prompt_used    LONGTEXT,
                    created_at     DATETIME     NOT NULL,
                    UNIQUE KEY uq_digest (stock_id, as_of_date, period)
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
            """)
        conn.commit()


def exists(stock_id: str, as_of_date: str, period: str) -> bool:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM analysis_digests WHERE stock_id=%s AND as_of_date=%s AND period=%s LIMIT 1",
                (stock_id, as_of_date[:10], period),
            )
            return cur.fetchone() is not None


def upsert(record: dict):
    """寫入一筆 digest（同 stock_id+as_of_date+period 已存在則覆蓋）。
    record 即 digest_core.generate_digest 的回傳 dict。"""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO analysis_digests
                    (stock_id, as_of_date, period, model_name,
                     analyst_json, news_json, technical_json, digest_json,
                     prompt_used, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    model_name=VALUES(model_name),
                    analyst_json=VALUES(analyst_json),
                    news_json=VALUES(news_json),
                    technical_json=VALUES(technical_json),
                    digest_json=VALUES(digest_json),
                    prompt_used=VALUES(prompt_used),
                    created_at=VALUES(created_at)
                """,
                (
                    record["stock_id"], record["as_of_date"][:10], record["period"],
                    record["model_name"],
                    json.dumps(record["analyst_json"], ensure_ascii=False),
                    json.dumps(record["news_json"], ensure_ascii=False),
                    json.dumps(record["technical_json"], ensure_ascii=False),
                    json.dumps(record["digest_json"], ensure_ascii=False),
                    record["prompt_used"], now,
                ),
            )
        conn.commit()


def _row_to_dict(row: dict) -> dict:
    def _load(v):
        if v is None:
            return None
        return json.loads(v) if isinstance(v, str) else v
    return {
        "stock_id": row["stock_id"],
        "as_of_date": row["as_of_date"].isoformat() if hasattr(row["as_of_date"], "isoformat") else str(row["as_of_date"]),
        "period": row["period"],
        "model_name": row["model_name"],
        "analyst_json": _load(row.get("analyst_json")),
        "news_json": _load(row.get("news_json")),
        "technical_json": _load(row.get("technical_json")),
        "digest_json": _load(row.get("digest_json")),
        "created_at": row["created_at"].isoformat() if hasattr(row.get("created_at"), "isoformat") else str(row.get("created_at")),
    }


def get(stock_id: str, as_of_date: str, period: str) -> dict | None:
    """精確取某時點的 digest。"""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM analysis_digests WHERE stock_id=%s AND as_of_date=%s AND period=%s LIMIT 1",
                (stock_id, as_of_date[:10], period),
            )
            row = cur.fetchone()
            return _row_to_dict(row) if row else None


def get_prior(stock_id: str, before_date: str, period: str, limit: int = 2) -> list[dict]:
    """取 before_date 之前（不含）最近 limit 筆同 period 的 digest，
    供「前期分析當參考」使用（point-in-time：只回較早的）。"""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM analysis_digests
                WHERE stock_id=%s AND period=%s AND as_of_date < %s
                ORDER BY as_of_date DESC LIMIT %s
                """,
                (stock_id, period, before_date[:10], limit),
            )
            return [_row_to_dict(r) for r in cur.fetchall()]
