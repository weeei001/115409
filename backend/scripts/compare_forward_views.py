"""比對 forward_views 三段骨架的建議品質，跨 eval 版本並排。

量的是「文字建議」本身：時間尺度往後拉，模型還敢不敢下判斷、有沒有掛證據、
有沒有寫失效條件。與股價預測準確度無關。

舊報告（v3 shadow 端點）的 forward_views 是 list、新版是 dict，兩種都吃：
腳本直接拿報告裡的 results 重跑 aggregate_eval_results，所以歷史報告不必重跑
LLM 就能補上新指標。

用法：
    python -m scripts.compare_forward_views                      # 全部報告
    python -m scripts.compare_forward_views --out compare.md     # 另存 markdown
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from stock_behavior.eval_metrics import FORWARD_HORIZONS, aggregate_eval_results

HORIZON_LABEL = {
    "short_1_5": "短線 1-5 日",
    "swing_6_20": "波段 6-20 日（中期骨架）",
    "medium_21_40": "中期 21-40 日（後期骨架）",
}

# (輸出列名, 指標 key, 是否以百分比呈現)
METRIC_ROWS = (
    ("不給方向比例", "directionless_rate", True),
    ("平均立場強度（0-2）", "avg_stance_strength", False),
    ("重複立場一致性", "repeat_agreement", False),
    ("有寫失效條件比例", "invalidation_rate", True),
    ("平均引用證據數", "evidence_ids_avg", False),
    ("理由平均字數", "reason_len_avg", False),
)


def report_label(report: dict[str, Any]) -> str:
    config = report.get("config") or {}
    example_set = config.get("example_set_version") or "none"
    few_shot = "無" if example_set in ("none", "") else "有"
    return (
        f"{config.get('prompt_version', '?')}"
        f" / {config.get('compliance_policy_version', '?')}"
        f" / few-shot={few_shot}"
    )


def collect(report: dict[str, Any]) -> dict[str, dict[str, float]]:
    """回傳 {horizon: {指標: 值}}，一致性從 stance_agreement 併進來。"""
    aggregate = aggregate_eval_results(report.get("results") or [])
    quality = aggregate.get("forward_view_quality") or {}
    agreement = (aggregate.get("stance_agreement") or {}).get("forward_views") or {}
    merged: dict[str, dict[str, float]] = {}
    for horizon in FORWARD_HORIZONS:
        metrics = dict(quality.get(horizon) or {})
        metrics["repeat_agreement"] = round(agreement.get(horizon, 0.0), 4)
        merged[horizon] = metrics
    return merged


def format_value(value: Any, as_percent: bool) -> str:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return "-"
    return f"{value * 100:.1f}%" if as_percent else f"{value:.3f}".rstrip("0").rstrip(".")


def render(entries: list[tuple[str, str, dict[str, dict[str, float]]]]) -> str:
    lines = [
        "# forward_views 骨架品質比對",
        "",
        "量的是文字建議的具體度，不是股價準確度。",
        "",
    ]

    for label, filename, merged in entries:
        samples = merged.get("short_1_5", {}).get("samples", 0)
        lines.extend(
            [
                f"## {label}",
                "",
                f"來源：`{filename}`，有效簡報 {samples} 份",
                "",
                "| 指標 | " + " | ".join(HORIZON_LABEL[h] for h in FORWARD_HORIZONS) + " |",
                "|---|" + "---|" * len(FORWARD_HORIZONS),
            ]
        )
        for row_label, key, as_percent in METRIC_ROWS:
            cells = [
                format_value(merged.get(h, {}).get(key), as_percent)
                for h in FORWARD_HORIZONS
            ]
            lines.append(f"| {row_label} | " + " | ".join(cells) + " |")
        lines.append("")

    if len(entries) > 1:
        lines.extend(["## 跨版本趨勢：不給方向比例", "", "| 版本 | " + " | ".join(
            HORIZON_LABEL[h] for h in FORWARD_HORIZONS) + " |",
            "|---|" + "---|" * len(FORWARD_HORIZONS)])
        for label, _filename, merged in entries:
            cells = [
                format_value(merged.get(h, {}).get("directionless_rate"), True)
                for h in FORWARD_HORIZONS
            ]
            lines.append(f"| {label} | " + " | ".join(cells) + " |")
        lines.append("")

    return "\n".join(lines)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reports",
        type=Path,
        default=BACKEND_ROOT / "eval_reports",
        help="eval 報告資料夾或單一 json 檔",
    )
    parser.add_argument("--out", type=Path, default=None, help="輸出 markdown 路徑")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    paths = (
        sorted(args.reports.glob("*.json"))
        if args.reports.is_dir()
        else [args.reports]
    )
    if not paths:
        raise SystemExit(f"找不到 eval 報告：{args.reports}")

    entries = []
    for path in paths:
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"跳過 {path.name}：{exc}", file=sys.stderr)
            continue
        entries.append((report_label(report), path.name, collect(report)))

    markdown = render(entries)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(markdown, encoding="utf-8")
        print(f"report_markdown={args.out}")
    else:
        print(markdown)


if __name__ == "__main__":
    main()
