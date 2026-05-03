from __future__ import annotations

from typing import Any

from .core_mode_types import FinalHoldoutSettings, MarketRow


def _range_payload(rows: list[MarketRow], start: int, end: int) -> dict[str, Any]:
    if not rows or start >= end or start < 0 or end <= 0:
        return {
            "start_index": -1,
            "end_index": -1,
            "start_date": None,
            "end_date": None,
        }
    return {
        "start_index": start,
        "end_index": end - 1,
        "start_date": rows[start].date.isoformat(),
        "end_date": rows[end - 1].date.isoformat(),
    }


def _dedupe_warnings(warnings: list[str]) -> list[str]:
    return list(dict.fromkeys(warnings))


def split_train_validation_final_holdout(
    *,
    rows: list[MarketRow],
    final_holdout_settings: FinalHoldoutSettings,
) -> dict[str, Any]:
    total = len(rows)
    warnings: list[str] = []

    if total == 0:
        return {
            "train_range": _range_payload(rows, 0, 0),
            "validation_range": _range_payload(rows, 0, 0),
            "final_holdout_range": _range_payload(rows, 0, 0),
            "train_rows": [],
            "search_rows": [],
            "validation_rows": [],
            "train_plus_validation_rows": [],
            "final_holdout_rows": [],
            "warnings": ["無可用資料，已略過三段式切分。"],
        }

    train_ratio = float(final_holdout_settings.train_ratio)
    validation_ratio = float(final_holdout_settings.validation_ratio)
    final_holdout_ratio = float(final_holdout_settings.final_holdout_ratio)
    ratio_sum = train_ratio + validation_ratio + final_holdout_ratio

    if abs(ratio_sum - 1.0) > 1e-6:
        warnings.append(
            f"final_holdout_settings ratio 總和為 {ratio_sum:.6f}，已自動正規化為 1.0。"
        )
        if ratio_sum <= 1e-9:
            train_ratio, validation_ratio, final_holdout_ratio = 0.60, 0.20, 0.20
        else:
            train_ratio /= ratio_sum
            validation_ratio /= ratio_sum
            final_holdout_ratio /= ratio_sum

    if final_holdout_ratio < 0.10 or final_holdout_ratio > 0.40:
        warnings.append(
            f"final_holdout_ratio={final_holdout_ratio:.4f} 建議落在 0.10~0.40。"
        )

    final_holdout_count = 0
    if final_holdout_settings.enabled:
        if final_holdout_settings.mode == "days":
            if final_holdout_settings.final_holdout_days is None or final_holdout_settings.final_holdout_days <= 0:
                warnings.append("mode=days 但 final_holdout_days 無效，改用 final_holdout_ratio 計算。")
                final_holdout_count = int(round(total * final_holdout_ratio))
            else:
                final_holdout_count = int(final_holdout_settings.final_holdout_days)
        else:
            final_holdout_count = int(round(total * final_holdout_ratio))

        max_allowed = max(1, int(total * 0.5))
        if final_holdout_count > max_allowed:
            warnings.append(
                f"final_holdout_days({final_holdout_count}) 超過資料長度 50%，已調整為 {max_allowed}。"
            )
            final_holdout_count = max_allowed

        min_final_holdout_days = max(1, int(final_holdout_settings.min_final_holdout_days))
        if final_holdout_count < min_final_holdout_days:
            warnings.append(
                f"final holdout row 數量不足 min_final_holdout_days({min_final_holdout_days})，已停用 final holdout 評估。"
            )
            final_holdout_count = 0
    else:
        warnings.append("final holdout 已停用（final_holdout_settings.enabled=false）。")

    final_holdout_count = max(0, min(final_holdout_count, total))
    train_plus_validation_count = total - final_holdout_count

    if train_plus_validation_count <= 1:
        warnings.append("train+validation 區段資料不足，validation 會被清空。")
        train_count = max(0, train_plus_validation_count)
        validation_count = 0
    else:
        ratio_tv = train_ratio + validation_ratio
        if ratio_tv <= 1e-9:
            train_weight = 0.625
        else:
            train_weight = train_ratio / ratio_tv
        train_count = int(round(train_plus_validation_count * train_weight))
        train_count = max(1, min(train_count, train_plus_validation_count - 1))
        validation_count = train_plus_validation_count - train_count

    train_start = 0
    train_end = train_count
    validation_start = train_end
    validation_end = train_end + validation_count
    final_holdout_start = validation_end
    final_holdout_end = total

    train_rows = rows[train_start:train_end]
    validation_rows = rows[validation_start:validation_end]
    final_holdout_rows = rows[final_holdout_start:final_holdout_end]
    train_plus_validation_rows = rows[:validation_end]

    if final_holdout_rows and train_plus_validation_rows:
        if train_plus_validation_rows[-1].date >= final_holdout_rows[0].date:
            warnings.append("資料切分時間順序異常：final holdout 並未晚於 train/validation。")

    if len(train_rows) + len(validation_rows) != len(train_plus_validation_rows):
        warnings.append("train_plus_validation_rows 長度異常，已使用保守切分結果。")

    return {
        "train_range": _range_payload(rows, train_start, train_end),
        "validation_range": _range_payload(rows, validation_start, validation_end),
        "final_holdout_range": _range_payload(rows, final_holdout_start, final_holdout_end),
        "train_rows": train_rows,
        "search_rows": train_rows,
        "validation_rows": validation_rows,
        "train_plus_validation_rows": train_plus_validation_rows,
        "final_holdout_rows": final_holdout_rows,
        "warnings": _dedupe_warnings(warnings),
    }


def get_search_rows(split_payload: dict[str, Any]) -> list[MarketRow]:
    return list(split_payload.get("search_rows") or [])


def get_validation_rows(split_payload: dict[str, Any]) -> list[MarketRow]:
    return list(split_payload.get("validation_rows") or [])


def get_final_holdout_rows(split_payload: dict[str, Any]) -> list[MarketRow]:
    return list(split_payload.get("final_holdout_rows") or [])


def build_final_holdout_metadata(split_payload: dict[str, Any]) -> dict[str, Any]:
    train_range = split_payload.get("train_range") or {}
    validation_range = split_payload.get("validation_range") or {}
    final_holdout_range = split_payload.get("final_holdout_range") or {}
    train_rows = list(split_payload.get("search_rows") or [])
    validation_rows = list(split_payload.get("validation_rows") or [])
    final_holdout_rows = list(split_payload.get("final_holdout_rows") or [])
    warnings = list(split_payload.get("warnings") or [])
    return {
        "train_start": train_range.get("start_date"),
        "train_end": train_range.get("end_date"),
        "validation_start": validation_range.get("start_date"),
        "validation_end": validation_range.get("end_date"),
        "final_holdout_start": final_holdout_range.get("start_date"),
        "final_holdout_end": final_holdout_range.get("end_date"),
        "train_count": len(train_rows),
        "validation_count": len(validation_rows),
        "final_holdout_count": len(final_holdout_rows),
        "warnings": _dedupe_warnings(warnings),
    }
