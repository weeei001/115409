from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import time
from typing import Any, Generator, Sequence

from sqlalchemy.orm import Session

from database import SessionLocal
from models.news_article import NewsArticle
from models.news_sentiment import NewsSentiment
from news_sentiment.cleaner import (
    clean_text,
    compute_config_hash,
    compute_input_hash,
    estimate_token_count,
    parse_news_pub_time,
    TAIPEI_TZ,
)
from news_sentiment.client import (
    LLMUsage,
    SentimentLLMClient,
    calculate_cost,
)
from news_sentiment.constants import (
    DEFAULT_MAX_RETRIES_PER_PAIR,
    DEFAULT_MODEL,
    INPUT_PRICE_PER_M,
    MAX_COMPLETION_TOKENS,
    MAX_CONSECUTIVE_FAILURES,
    MAX_INPUT_TOKENS,
    OUTPUT_PRICE_PER_M,
    PROMPT_VERSION,
    TARGET_STOCKS,
)
from news_sentiment.prompt import (
    SYSTEM_PROMPT,
    SENTIMENT_OUTPUT_SCHEMA_STR,
    build_user_message,
)
from news_sentiment.validator import validate_sentiment_payload

LOCK_FILE_PATH = Path(__file__).resolve().parent.parent / "sentiment_batch.lock"
LOGS_DIR = Path(__file__).resolve().parent.parent / "logs" / "sentiment_runs"


class BatchLockError(Exception):
    """取得批次單一執行鎖失敗時拋出"""


@contextmanager
def acquire_batch_lock() -> Generator[None, None, None]:
    """保證同一時間僅有一個分析批次在執行，避免重複並行產生多餘費用。"""
    if LOCK_FILE_PATH.exists():
        # 檢查是否為過期鎖（超過 2 小時）
        try:
            mtime = LOCK_FILE_PATH.stat().st_mtime
            if time.time() - mtime > 7200:
                LOCK_FILE_PATH.unlink(missing_ok=True)
            else:
                raise BatchLockError(
                    f"已有批次任務執行中（鎖定檔案: {LOCK_FILE_PATH}），退出本次執行。"
                )
        except OSError:
            raise BatchLockError(f"無法檢查鎖定檔案: {LOCK_FILE_PATH}")

    try:
        LOCK_FILE_PATH.write_text(f"pid={os.getpid()} time={datetime.now().isoformat()}", encoding="utf-8")
        yield
    finally:
        LOCK_FILE_PATH.unlink(missing_ok=True)


class SentimentBatchRunner:
    """新聞情緒分類批次處理執行器"""

    def __init__(
        self,
        *,
        client: SentimentLLMClient | None = None,
        db_session: Session | None = None,
        max_cost_usd: float = 0.50,
        limit: int = 100,
        model: str = DEFAULT_MODEL,
        execute: bool = False,
        run_id: str | None = None,
    ):
        self.client = client or SentimentLLMClient(model=model)
        self._external_db = db_session
        self.max_cost_usd = max_cost_usd
        self.limit = limit
        self.model = model
        self.execute = execute
        self.run_id = run_id or datetime.now().strftime("%Y%m%d_%H%M%S")

        # 計算當前設定的 config_hash
        gen_params = {
            "max_completion_tokens": MAX_COMPLETION_TOKENS,
            "reasoning_effort": "none",
        }
        self.config_hash = compute_config_hash(
            model=self.model,
            prompt_version=PROMPT_VERSION,
            system_prompt=SYSTEM_PROMPT,
            schema_definition=SENTIMENT_OUTPUT_SCHEMA_STR,
            generation_params=gen_params,
        )

        # 單次最大調用預留費用（8k input + 1024 output）
        self.reserved_per_call_usd = (MAX_INPUT_TOKENS / 1e6 * INPUT_PRICE_PER_M) + (
            MAX_COMPLETION_TOKENS / 1e6 * OUTPUT_PRICE_PER_M
        )

        # 狀態統計
        self.total_processed = 0
        self.success_count = 0
        self.failed_count = 0
        self.skipped_count = 0
        self.reused_count = 0
        self.api_calls_count = 0
        self.accumulated_cost_usd = 0.0
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.latencies_ms: list[float] = []
        self.consecutive_failures = 0
        self.skip_reasons: dict[str, int] = {}

    def _get_db(self) -> Session:
        return self._external_db if self._external_db is not None else SessionLocal()

    def _log_attempt(self, record: dict[str, Any]) -> None:
        """寫入 JSONL 審計日誌"""
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        log_file = LOGS_DIR / f"{self.run_id}.jsonl"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def run_manifest(self, manifest_items: Sequence[dict[str, Any]]) -> dict[str, Any]:
        """
        執行傳入的 manifest 清單。
        清單每筆需包含 article_id 與 symbol (target_stock_id)。
        """
        items_to_process = manifest_items[: self.limit]
        db = self._get_db()
        should_close_db = self._external_db is None

        try:
            for item in items_to_process:
                article_id = item.get("article_id")
                target_stock_id = item.get("symbol") or item.get("target_stock_id")

                if not article_id or not target_stock_id:
                    self.skipped_count += 1
                    self.skip_reasons["missing_id_or_symbol"] = (
                        self.skip_reasons.get("missing_id_or_symbol", 0) + 1
                    )
                    continue

                if target_stock_id not in TARGET_STOCKS:
                    self.skipped_count += 1
                    self.skip_reasons["not_in_target_stocks"] = (
                        self.skip_reasons.get("not_in_target_stocks", 0) + 1
                    )
                    continue

                self.total_processed += 1
                target_stock_name = TARGET_STOCKS[target_stock_id]

                # 1. 讀取新聞
                article = (
                    db.query(NewsArticle)
                    .filter(NewsArticle.article_id == article_id)
                    .first()
                )
                if not article:
                    self.skipped_count += 1
                    self.skip_reasons["article_not_found_in_db"] = (
                        self.skip_reasons.get("article_not_found_in_db", 0) + 1
                    )
                    continue

                # 2. 清理新聞內文與標題
                cleaned_title = clean_text(article.title)
                cleaned_content = clean_text(article.content)

                if not cleaned_content:
                    self.skipped_count += 1
                    self.skip_reasons["skipped_empty_content"] = (
                        self.skip_reasons.get("skipped_empty_content", 0) + 1
                    )
                    if self.execute:
                        self._save_record(
                            db,
                            article_id=article_id,
                            target_stock_id=target_stock_id,
                            input_hash="",
                            status="skipped",
                            error_code="skipped_empty_content",
                        )
                    continue

                # 3. 解析發布日期
                pub_dt, canonical_pub_time = parse_news_pub_time(article.pub_time)
                if pub_dt is None:
                    self.skipped_count += 1
                    self.skip_reasons["skipped_invalid_date"] = (
                        self.skip_reasons.get("skipped_invalid_date", 0) + 1
                    )
                    if self.execute:
                        self._save_record(
                            db,
                            article_id=article_id,
                            target_stock_id=target_stock_id,
                            input_hash="",
                            status="skipped",
                            error_code="skipped_invalid_date",
                        )
                    continue

                # 4. Token 長度估算檢查
                user_msg = build_user_message(
                    target_stock_id=target_stock_id,
                    target_stock_name=target_stock_name,
                    pub_time=canonical_pub_time,
                    title=cleaned_title,
                    content=cleaned_content,
                )
                est_tokens = estimate_token_count(SYSTEM_PROMPT) + estimate_token_count(user_msg)
                if est_tokens > MAX_INPUT_TOKENS:
                    self.skipped_count += 1
                    self.skip_reasons["skipped_input_too_long"] = (
                        self.skip_reasons.get("skipped_input_too_long", 0) + 1
                    )
                    if self.execute:
                        self._save_record(
                            db,
                            article_id=article_id,
                            target_stock_id=target_stock_id,
                            input_hash="",
                            status="skipped",
                            error_code="skipped_input_too_long",
                        )
                    continue

                # 5. 計算 input_hash
                input_hash = compute_input_hash(
                    cleaned_title=cleaned_title,
                    cleaned_content=cleaned_content,
                    pub_time_str=canonical_pub_time,
                    target_stock_id=target_stock_id,
                    target_stock_name=target_stock_name,
                )

                # 6. 檢查既有成功結果重用（規格第 6 節）
                existing = (
                    db.query(NewsSentiment)
                    .filter(
                        NewsSentiment.input_hash == input_hash,
                        NewsSentiment.config_hash == self.config_hash,
                        NewsSentiment.status == "success",
                    )
                    .first()
                )
                if existing:
                    self.reused_count += 1
                    self.success_count += 1
                    self.consecutive_failures = 0
                    if self.execute:
                        # 寫入或更新當前 article_id + target_stock_id 的關聯
                        self._save_record(
                            db,
                            article_id=article_id,
                            target_stock_id=target_stock_id,
                            input_hash=input_hash,
                            status="success",
                            label=existing.label,
                            reason=existing.reason,
                            evidence=existing.evidence,
                            model=existing.model,
                            prompt_version=existing.prompt_version,
                            input_tokens=0,
                            output_tokens=0,
                            reasoning_tokens=0,
                            estimated_cost_usd=0.0,
                            analyzed_at=datetime.now(TAIPEI_TZ),
                            error_code=None,
                        )
                    continue

                # 若僅為預覽模式，不呼叫 API
                if not self.execute:
                    continue

                # 7. 預算檢查（規格第 7 節）：保留下一次調用的上限預算
                if self.accumulated_cost_usd + self.reserved_per_call_usd > self.max_cost_usd:
                    print(
                        f"預算保護觸發：累計費用 ${self.accumulated_cost_usd:.4f} USD "
                        f"加上預留額度已達上限 ${self.max_cost_usd:.4f} USD，批次停止。"
                    )
                    break

                # 8. 調用 LLM（含有限次重試）
                success_item, err_code = self._process_single_with_retry(
                    db=db,
                    article_id=article_id,
                    target_stock_id=target_stock_id,
                    input_hash=input_hash,
                    cleaned_title=cleaned_title,
                    cleaned_content=cleaned_content,
                    user_msg=user_msg,
                )

                if success_item:
                    self.success_count += 1
                    self.consecutive_failures = 0
                else:
                    self.failed_count += 1
                    self.consecutive_failures += 1

                    # 終端錯誤或熔斷檢查
                    if err_code in ("auth_error_401", "model_not_found"):
                        print(f"遇到嚴重終端錯誤 {err_code}，停止整批任務。")
                        break

                    if self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                        print(
                            f"連續 {MAX_CONSECUTIVE_FAILURES} 筆失敗，觸發熔斷機制，停止整批任務。"
                        )
                        break

        finally:
            if should_close_db:
                db.close()

        return self.get_summary()

    def _process_single_with_retry(
        self,
        *,
        db: Session,
        article_id: str,
        target_stock_id: str,
        input_hash: str,
        cleaned_title: str,
        cleaned_content: str,
        user_msg: str,
    ) -> tuple[bool, str | None]:
        """單筆配對調用與重試邏輯（最多 2 次嘗試）"""
        extra_prompt: str | None = None
        last_error_code: str | None = None

        for attempt in range(1, DEFAULT_MAX_RETRIES_PER_PAIR + 1):
            self.api_calls_count += 1
            parsed, raw_text, usage, latency_ms, error = self.client.call_classifier(
                system_prompt=SYSTEM_PROMPT,
                user_message=user_msg,
                extra_user_prompt=extra_prompt,
            )
            self.latencies_ms.append(latency_ms)

            # 記錄用量與費用
            if usage.input_tokens:
                self.total_input_tokens += usage.input_tokens
            if usage.output_tokens:
                self.total_output_tokens += usage.output_tokens
            if usage.estimated_cost_usd:
                self.accumulated_cost_usd += usage.estimated_cost_usd

            # 審計日誌
            self._log_attempt(
                {
                    "run_id": self.run_id,
                    "timestamp": datetime.now(TAIPEI_TZ).isoformat(),
                    "article_id": article_id,
                    "target_stock_id": target_stock_id,
                    "attempt": attempt,
                    "model": self.model,
                    "config_hash": self.config_hash,
                    "input_hash": input_hash,
                    "latency_ms": round(latency_ms, 2),
                    "usage": usage.to_dict(),
                    "error": error,
                    "raw_preview": raw_text[:200] if raw_text else "",
                }
            )

            # API 呼叫失敗處理
            if error:
                last_error_code = error
                if error == "rate_limit_429" and attempt < DEFAULT_MAX_RETRIES_PER_PAIR:
                    time.sleep(2.0)
                    continue
                if error == "timeout":
                    # timeout 不在同批次重複送，避免未知計費累積
                    break
                if error in ("auth_error_401", "model_not_found"):
                    break
                continue

            # 輸出驗證
            val_result = validate_sentiment_payload(
                parsed,
                cleaned_title=cleaned_title,
                cleaned_content=cleaned_content,
            )

            if val_result.is_valid:
                # 驗證成功，存入資料庫
                self._save_record(
                    db,
                    article_id=article_id,
                    target_stock_id=target_stock_id,
                    input_hash=input_hash,
                    status="success",
                    label=val_result.label,
                    reason=val_result.reason,
                    evidence=json.dumps(val_result.evidence, ensure_ascii=False),
                    model=self.model,
                    prompt_version=PROMPT_VERSION,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    reasoning_tokens=usage.reasoning_tokens,
                    estimated_cost_usd=usage.estimated_cost_usd,
                    analyzed_at=datetime.now(TAIPEI_TZ),
                    error_code=None,
                )
                return True, None
            else:
                last_error_code = f"validation_failed: {val_result.error_message}"
                if attempt < DEFAULT_MAX_RETRIES_PER_PAIR:
                    # 帶入錯誤提示重試一次
                    extra_prompt = (
                        f"前次輸出格式或引用驗證失敗：{val_result.error_message}。"
                        "請嚴格檢查 quote 必須出現在原文，混合類必須固定 2 筆引用，並僅回傳指定 JSON 格式。"
                    )
                    continue

        # 重試耗盡仍失敗
        self._save_record(
            db,
            article_id=article_id,
            target_stock_id=target_stock_id,
            input_hash=input_hash,
            status="failed",
            error_code=last_error_code,
            model=self.model,
            prompt_version=PROMPT_VERSION,
            analyzed_at=datetime.now(TAIPEI_TZ),
        )
        return False, last_error_code

    def _save_record(
        self,
        db: Session,
        *,
        article_id: str,
        target_stock_id: str,
        input_hash: str,
        status: str,
        label: str | None = None,
        reason: str | None = None,
        evidence: str | None = None,
        model: str | None = None,
        prompt_version: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        reasoning_tokens: int | None = None,
        estimated_cost_usd: float | None = None,
        analyzed_at: datetime | None = None,
        error_code: str | None = None,
    ) -> None:
        """寫入或更新 news_sentiments 資料表"""
        existing = (
            db.query(NewsSentiment)
            .filter(
                NewsSentiment.article_id == article_id,
                NewsSentiment.target_stock_id == target_stock_id,
            )
            .first()
        )
        safe_error_code = str(error_code)[:250] if error_code else None
        if existing:
            existing.input_hash = input_hash
            existing.config_hash = self.config_hash
            existing.status = status
            existing.label = label
            existing.reason = reason
            existing.evidence = evidence
            existing.model = model
            existing.prompt_version = prompt_version
            existing.input_tokens = input_tokens
            existing.output_tokens = output_tokens
            existing.reasoning_tokens = reasoning_tokens
            existing.estimated_cost_usd = estimated_cost_usd
            existing.analyzed_at = analyzed_at
            existing.error_code = safe_error_code
        else:
            sentiment = NewsSentiment(
                article_id=article_id,
                target_stock_id=target_stock_id,
                input_hash=input_hash,
                config_hash=self.config_hash,
                status=status,
                label=label,
                reason=reason,
                evidence=evidence,
                model=model,
                prompt_version=prompt_version,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                reasoning_tokens=reasoning_tokens,
                estimated_cost_usd=estimated_cost_usd,
                analyzed_at=analyzed_at,
                error_code=safe_error_code,
            )
            db.add(sentiment)

        db.commit()

    def get_summary(self) -> dict[str, Any]:
        """產出批次摘要統計"""
        p50 = 0.0
        p95 = 0.0
        if self.latencies_ms:
            sorted_lat = sorted(self.latencies_ms)
            p50 = sorted_lat[int(len(sorted_lat) * 0.5)]
            p95 = sorted_lat[int(len(sorted_lat) * 0.95)]

        return {
            "run_id": self.run_id,
            "mode": "execute" if self.execute else "preview",
            "model": self.model,
            "config_hash": self.config_hash,
            "total_items": self.total_processed,
            "success": self.success_count,
            "failed": self.failed_count,
            "skipped": self.skipped_count,
            "reused": self.reused_count,
            "api_calls": self.api_calls_count,
            "skip_reasons": self.skip_reasons,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_cost_usd": round(self.accumulated_cost_usd, 6),
            "total_cost_twd": round(self.accumulated_cost_usd * 32.0, 2),
            "latency_p50_ms": round(p50, 1),
            "latency_p95_ms": round(p95, 1),
        }
