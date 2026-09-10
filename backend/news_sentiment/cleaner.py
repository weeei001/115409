from __future__ import annotations

from datetime import datetime, timezone, timedelta
import hashlib
import html
import json
import re
from typing import Any

from news_sentiment.constants import (
    DEFAULT_MODEL,
    TARGET_STOCKS,
    NORMALIZATION_VERSION,
)


TAIPEI_TZ = timezone(timedelta(hours=8))
HTML_TAG_RE = re.compile(r"<[^>]+>", re.IGNORECASE)
MULTIPLE_SPACES_RE = re.compile(r"[^\S\r\n]+")
MULTIPLE_NEWLINES_RE = re.compile(r"\n{3,}")


def extract_candidate_stocks(stock_id: str | None, tags: str | None) -> list[str]:
    """
    從 stock_id 與逗號分隔 tags 精確解析六檔目標股票。
    去除空白與 .TW 後比對，不單靠文章內文隨意出現的四位數字。
    """
    raw_candidates: list[str] = []
    if stock_id:
        raw_candidates.append(stock_id)
    if tags:
        raw_candidates.extend(tags.split(","))

    seen: set[str] = set()
    result: list[str] = []
    for item in raw_candidates:
        s = item.strip()
        s = re.sub(r"\.TW$", "", s, flags=re.IGNORECASE).strip()
        if s in TARGET_STOCKS and s not in seen:
            seen.add(s)
            result.append(s)

    return result


def clean_text(raw_text: str | None) -> str:
    """
    內文與標題清理：
    1. 解碼 HTML entities
    2. 移除 HTML 標籤
    3. 統一換行符為 \n
    4. 消除各行多餘空白（行首行尾去除空白，行內多餘空白折疊為單一空格）
    5. 連續 3 個以上換行折疊為 2 個
    6. 保留數字、標點、否定詞與條件句
    """
    if not raw_text:
        return ""

    text = html.unescape(raw_text)
    text = HTML_TAG_RE.sub("", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    lines = [MULTIPLE_SPACES_RE.sub(" ", line).strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = MULTIPLE_NEWLINES_RE.sub("\n\n", text)
    return text.strip()



def parse_news_pub_time(pub_time_str: str | None) -> tuple[datetime | None, str]:
    """
    解析發布時間字串至 Asia/Taipei 時區。
    有時區字串轉換至台北時間，無時區字串以台北時間解讀。
    無法解析時回傳 (None, "")，不盲目猜測。
    """
    if not pub_time_str or not pub_time_str.strip():
        return None, ""

    s = pub_time_str.strip()
    dt: datetime | None = None

    # 嘗試標準 ISO 格式
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        pass

    # 嘗試常見的格式
    if dt is None:
        formats = [
            "%Y-%m-%d %H:%M:%S",
            "%Y/%m/%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y/%m/%d %H:%M",
            "%Y-%m-%d",
            "%Y/%m/%d",
        ]
        for fmt in formats:
            try:
                dt = datetime.strptime(s, fmt)
                break
            except ValueError:
                continue

    if dt is None:
        return None, ""

    # 時區處理
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TAIPEI_TZ)
    else:
        dt = dt.astimezone(TAIPEI_TZ)

    return dt, dt.isoformat()


def compute_input_hash(
    *,
    cleaned_title: str,
    cleaned_content: str,
    pub_time_str: str,
    target_stock_id: str,
    target_stock_name: str,
) -> str:
    """
    計算輸入摘要 SHA-256。
    採用規範要求的固定 JSON 序列化（key 排序、緊湊格式、UTF-8）。
    """
    data = {
        "content": cleaned_content,
        "normalization_version": NORMALIZATION_VERSION,
        "pub_time": pub_time_str,
        "target_stock_id": target_stock_id,
        "target_stock_name": target_stock_name,
        "title": cleaned_title,
    }
    payload = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_config_hash(
    *,
    model: str,
    prompt_version: str,
    system_prompt: str,
    schema_definition: str,
    generation_params: dict[str, Any],
) -> str:
    """
    計算設定摘要 SHA-256。
    涵蓋模型、Prompt、Schema、正規化規則與生成參數。
    """
    data = {
        "generation_params": generation_params,
        "model": model,
        "normalization_version": NORMALIZATION_VERSION,
        "prompt_version": prompt_version,
        "schema_definition": schema_definition,
        "system_prompt": system_prompt,
    }
    payload = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def estimate_token_count(text: str) -> int:
    """
    快速且保守估算 Token 數量。
    中文字元通常 1~2 tokens，英文詞 1~1.5 tokens。
    這裡採用字元與詞彙綜合權重並加上預留開銷。
    """
    if not text:
        return 0
    # 計算中日韓字元數
    cjk_chars = len(re.findall(r"[\u4e00-\u9fff\u3400-\u4dbf]", text))
    non_cjk = len(text) - cjk_chars
    # 保守估計：CJK 約 1.3 token，非 CJK 約 0.4 token
    return int(cjk_chars * 1.3 + non_cjk * 0.4) + 10


def get_active_config_hash(model: str = DEFAULT_MODEL) -> str:
    """取得當前預設模型與設定的 config_hash"""
    from news_sentiment.prompt import SYSTEM_PROMPT, SENTIMENT_OUTPUT_SCHEMA_STR
    from news_sentiment.constants import MAX_COMPLETION_TOKENS, PROMPT_VERSION

    gen_params = {
        "max_completion_tokens": MAX_COMPLETION_TOKENS,
        "reasoning_effort": "none",
    }
    return compute_config_hash(
        model=model,
        prompt_version=PROMPT_VERSION,
        system_prompt=SYSTEM_PROMPT,
        schema_definition=SENTIMENT_OUTPUT_SCHEMA_STR,
        generation_params=gen_params,
    )
