from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Sequence

from news_sentiment.constants import (
    ALLOWED_LABELS,
    LABEL_INSUFFICIENT,
    LABEL_MIXED,
    LABEL_NEGATIVE,
    LABEL_NEUTRAL,
    LABEL_POSITIVE,
)


@dataclass
class ClassificationMetrics:
    accuracy: float
    macro_f1: float
    precision_by_class: dict[str, float]
    recall_by_class: dict[str, float]
    f1_by_class: dict[str, float]
    support_by_class: dict[str, int]
    confusion_matrix: dict[str, dict[str, int]]


def compute_metrics(
    true_labels: Sequence[str],
    pred_labels: Sequence[str],
    classes: Sequence[str] = (
        LABEL_POSITIVE,
        LABEL_NEGATIVE,
        LABEL_NEUTRAL,
        LABEL_MIXED,
        LABEL_INSUFFICIENT,
    ),
) -> ClassificationMetrics:
    """計算準確率、各類 Precision/Recall/F1 與 Macro-F1 以及混淆矩陣"""
    total = len(true_labels)
    if total == 0:
        return ClassificationMetrics(
            accuracy=0.0,
            macro_f1=0.0,
            precision_by_class={c: 0.0 for c in classes},
            recall_by_class={c: 0.0 for c in classes},
            f1_by_class={c: 0.0 for c in classes},
            support_by_class={c: 0 for c in classes},
            confusion_matrix={c: {c2: 0 for c2 in classes} for c in classes},
        )

    correct = sum(1 for t, p in zip(true_labels, pred_labels) if t == p)
    accuracy = correct / total

    # 混淆矩陣 matrix[true][pred]
    cm: dict[str, dict[str, int]] = {c: {c2: 0 for c2 in classes} for c in classes}
    for t, p in zip(true_labels, pred_labels):
        if t in cm and p in cm[t]:
            cm[t][p] += 1

    precision: dict[str, float] = {}
    recall: dict[str, float] = {}
    f1: dict[str, float] = {}
    support: dict[str, int] = {}

    for c in classes:
        tp = cm[c][c]
        fn = sum(cm[c][other] for other in classes if other != c)
        fp = sum(cm[other][c] for other in classes if other != c)
        supp = tp + fn
        support[c] = supp

        p = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        r = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f = (2 * p * r) / (p + r) if (p + r) > 0 else 0.0

        precision[c] = round(p, 4)
        recall[c] = round(r, 4)
        f1[c] = round(f, 4)

    # 僅對 support > 0 的類別計算 Macro-F1（避免無樣本類別扭曲分數）
    active_f1s = [f1[c] for c in classes if support[c] > 0]
    macro_f1 = sum(active_f1s) / len(active_f1s) if active_f1s else 0.0

    return ClassificationMetrics(
        accuracy=round(accuracy, 4),
        macro_f1=round(macro_f1, 4),
        precision_by_class=precision,
        recall_by_class=recall,
        f1_by_class=f1,
        support_by_class=support,
        confusion_matrix=cm,
    )


def evaluate_batch_results(
    results: list[dict[str, Any]],
    output_report_path: Path | None = None,
) -> dict[str, Any]:
    """評估批次分析成果並產出報告"""
    total = len(results)
    successes = [r for r in results if r.get("status") == "success"]
    failed = [r for r in results if r.get("status") == "failed"]
    skipped = [r for r in results if r.get("status") == "skipped"]

    # 標籤分布
    label_counts = Counter(r.get("label") for r in successes)

    # 引用存在率檢查
    total_quotes = 0
    valid_quotes = 0
    for r in successes:
        ev = r.get("evidence")
        if isinstance(ev, str):
            try:
                ev = json.loads(ev)
            except Exception:
                ev = []
        if isinstance(ev, list):
            for item in ev:
                total_quotes += 1
                if item.get("quote"):
                    valid_quotes += 1

    quote_presence_rate = (valid_quotes / total_quotes) if total_quotes > 0 else 1.0

    # 費用與 Token 統計
    total_in_tokens = sum(r.get("input_tokens") or 0 for r in results)
    total_out_tokens = sum(r.get("output_tokens") or 0 for r in results)
    total_cost_usd = sum(r.get("estimated_cost_usd") or 0.0 for r in results)

    eval_summary = {
        "total_pairs": total,
        "success_count": len(successes),
        "failed_count": len(failed),
        "skipped_count": len(skipped),
        "coverage_rate": round(len(successes) / total, 4) if total > 0 else 0.0,
        "quote_presence_rate": round(quote_presence_rate, 4),
        "label_distribution": dict(label_counts),
        "total_input_tokens": total_in_tokens,
        "total_output_tokens": total_out_tokens,
        "total_cost_usd": round(total_cost_usd, 6),
        "total_cost_twd": round(total_cost_usd * 32.0, 2),
    }

    if output_report_path:
        output_report_path.parent.mkdir(parents=True, exist_ok=True)
        md_content = f"""# 新聞情緒分類評估報告

- **樣本總數**：{total}
- **成功筆數**：{len(successes)} ({eval_summary['coverage_rate'] * 100:.1f}%)
- **失敗筆數**：{len(failed)}
- **跳過筆數**：{len(skipped)}
- **原文引用有效率**：{quote_presence_rate * 100:.1f}%
- **總 Token 用量**：輸入 {total_in_tokens:,} / 輸出 {total_out_tokens:,}
- **總支出**：${total_cost_usd:.4f} USD（約 NT$ {total_cost_usd * 32:.2f}）

## 標籤分布
| 標籤 | 筆數 | 佔比 |
|---|---:|---:|
"""
        for lbl, cnt in label_counts.most_common():
            md_content += f"| `{lbl}` | {cnt} | {cnt / len(successes) * 100:.1f}% |\n"

        with open(output_report_path, "w", encoding="utf-8") as f:
            f.write(md_content)

    return eval_summary
