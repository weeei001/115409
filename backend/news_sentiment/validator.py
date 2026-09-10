from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from news_sentiment.constants import (
    ALLOWED_LABELS,
    LABEL_INSUFFICIENT,
    LABEL_MIXED,
    LABEL_NEUTRAL,
    LABEL_NEGATIVE,
    LABEL_POSITIVE,
    MAX_QUOTE_CHARACTERS,
    MAX_REASON_CHARACTERS,
)


@dataclass
class EvidenceItem:
    field: str
    quote: str

    def to_dict(self) -> dict[str, str]:
        return {"field": self.field, "quote": self.quote}


@dataclass
class ValidationResult:
    is_valid: bool
    error_message: str | None = None
    label: str | None = None
    reason: str | None = None
    evidence: list[dict[str, str]] | None = None


def validate_sentiment_payload(
    payload: Any,
    *,
    cleaned_title: str,
    cleaned_content: str,
) -> ValidationResult:
    """
    依據規格書第 5.3 節嚴格驗證模型輸出 JSON：
    1. 必填欄位 label, reason, evidence，禁止額外欄位
    2. label 必須為 5 類之一
    3. reason 為 1～80 字元
    4. evidence 筆數：
       - positive, negative, neutral: 至少 1 筆
       - mixed: 固定 2 筆
       - insufficient: 0～2 筆（通常為 0）
    5. 每筆 evidence：field 必須為 title 或 content，quote 為 1～80 字元
    6. 原文引用存在性驗證：quote 必須完全出現在指定欄位的清理後文字中，不接受改寫或拼接
    """
    if not isinstance(payload, dict):
        return ValidationResult(
            is_valid=False,
            error_message="輸出格式錯誤：根節點必須為 JSON 物件",
        )

    # 欄位檢查
    expected_keys = {"label", "reason", "evidence"}
    actual_keys = set(payload.keys())
    missing_keys = expected_keys - actual_keys
    if missing_keys:
        return ValidationResult(
            is_valid=False,
            error_message=f"缺少必填欄位: {', '.join(sorted(missing_keys))}",
        )

    extra_keys = actual_keys - expected_keys
    if extra_keys:
        return ValidationResult(
            is_valid=False,
            error_message=f"包含禁止的額外欄位: {', '.join(sorted(extra_keys))}",
        )

    # label 檢查
    label = payload.get("label")
    if not isinstance(label, str) or label not in ALLOWED_LABELS:
        return ValidationResult(
            is_valid=False,
            error_message=f"無效的情緒標籤: {label!r}，允許值為 {sorted(ALLOWED_LABELS)}",
        )

    # reason 檢查
    reason = payload.get("reason")
    if not isinstance(reason, str) or not (1 <= len(reason.strip()) <= MAX_REASON_CHARACTERS):
        return ValidationResult(
            is_valid=False,
            error_message=f"理由長度不符合規範（需為 1～{MAX_REASON_CHARACTERS} 字元，實際長度 {len(reason) if isinstance(reason, str) else 0}）",
        )
    reason = reason.strip()

    # evidence 檢查
    raw_evidence = payload.get("evidence")
    if not isinstance(raw_evidence, list):
        return ValidationResult(
            is_valid=False,
            error_message="evidence 必須為陣列",
        )

    evidence_count = len(raw_evidence)
    if evidence_count > 2:
        return ValidationResult(
            is_valid=False,
            error_message=f"evidence 筆數最多 2 筆，實際為 {evidence_count} 筆",
        )

    if label in (LABEL_POSITIVE, LABEL_NEGATIVE, LABEL_NEUTRAL):
        if evidence_count < 1:
            return ValidationResult(
                is_valid=False,
                error_message=f"{label} 標籤必須至少提供 1 筆原文引用",
            )
    elif label == LABEL_MIXED:
        if evidence_count != 2:
            return ValidationResult(
                is_valid=False,
                error_message=f"mixed 標籤必須固定提供 2 筆原文引用（分別支持正面與負面），實際為 {evidence_count} 筆",
            )
    elif label == LABEL_INSUFFICIENT:
        # insufficient 允許 0~2 筆
        pass

    validated_evidence: list[dict[str, str]] = []
    field_texts = {
        "title": cleaned_title,
        "content": cleaned_content,
    }

    for idx, item in enumerate(raw_evidence):
        if not isinstance(item, dict):
            return ValidationResult(
                is_valid=False,
                error_message=f"evidence[{idx}] 必須為 JSON 物件",
            )

        item_keys = set(item.keys())
        if item_keys != {"field", "quote"}:
            return ValidationResult(
                is_valid=False,
                error_message=f"evidence[{idx}] 欄位必須恰為 field 與 quote，不允許其他欄位",
            )

        field_name = item.get("field")
        quote = item.get("quote")

        if field_name not in ("title", "content"):
            return ValidationResult(
                is_valid=False,
                error_message=f"evidence[{idx}].field 必須為 'title' 或 'content'，實際為 {field_name!r}",
            )

        if not isinstance(quote, str) or not (1 <= len(quote.strip()) <= MAX_QUOTE_CHARACTERS):
            return ValidationResult(
                is_valid=False,
                error_message=f"evidence[{idx}].quote 長度需為 1～{MAX_QUOTE_CHARACTERS} 字元",
            )
        quote = quote.strip()

        # 原文存在性比對：必須為完全子字串
        target_text = field_texts[field_name]
        if quote not in target_text:
            return ValidationResult(
                is_valid=False,
                error_message=f"evidence[{idx}].quote 未出現在原文的 {field_name} 中: {quote[:40]!r}",
            )

        validated_evidence.append({"field": field_name, "quote": quote})

    return ValidationResult(
        is_valid=True,
        label=label,
        reason=reason,
        evidence=validated_evidence,
    )
