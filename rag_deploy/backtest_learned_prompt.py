"""
驗證階段：學到的 prompt（arm L）vs 現行 prompt（arm A）在 2025 測試期的方向命中率對照
====================================================================
每個測試期週五錨點：
  - Qdrant 語意 PIT 檢索（fetch_pit_articles，與訓練同一個 window_days）
  - 技術面（compute_technical）
  - 組 context（build_context_from_pit）
  - arm A：現行 prompt（backtest_digest_eval.DEFAULT_PROMPT_TEMPLATE）
  - arm L：methodology_trainer 產出的 best prompt（methodology/{...}/prompt_v{k}.txt）
  同一個 client、同一批新聞，逐一配對比。

輸出 decisions.csv / metrics.json（compute_metrics(arm_names=("A","L"))）/ predictions_cache.json，
schema 與 backtest_digest_eval 相同，供 backtest_report.py 直接讀。

洩漏防護：斷言 min(anchor) > train_end（讀自 methodology-dir/best.json）。

用法：
    QDRANT_HOST=127.0.0.1 python backtest_learned_prompt.py --stock 2330 \
        --start 2025-01-01 --end 2025-12-31 --horizon 20 --provider h200 \
        --methodology-dir methodology/2330_2024-01-01_2024-12-31

    # dry-run
    QDRANT_HOST=127.0.0.1 python backtest_learned_prompt.py --stock 2330 \
        --start 2025-01-01 --end 2025-12-31 --horizon 20 --limit 3 --provider h200 \
        --methodology-dir methodology/2330_2024-01-01_2024-12-31
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

from digest_core import fetch_pit_articles, fetch_prices, compute_technical
from build_analysis_digests import anchor_dates, build_qdrant_embeddings
from backtest_digest_eval import (
    make_nim_client, load_price_frame, actual_from_rows, classify,
    build_context_from_pit, predict_change_pct, compute_metrics,
    default_band_grid, DEFAULT_PROMPT_VERSION,
)
from digest_core import make_h200_client


def load_methodology(methodology_dir: Path, prompt_version: int | None) -> tuple[str, int, str]:
    """回傳 (learned_template, version, train_end)。prompt_version=None → 讀 best.json。"""
    best = json.loads((methodology_dir / "best.json").read_text())
    version = prompt_version if prompt_version is not None else best["version"]
    template = (methodology_dir / f"prompt_v{version}.txt").read_text()
    train_end = best["train_end"]
    return template, version, train_end


def run(args) -> Path:
    stock_id = args.stock
    methodology_dir = Path(args.methodology_dir)
    if not methodology_dir.is_absolute():
        methodology_dir = Path(__file__).parent / methodology_dir
    learned_template, prompt_version, train_end = load_methodology(methodology_dir, args.prompt_version)

    band = args.neutral_band if args.neutral_band is not None else (3.0 if args.horizon == 20 else 1.0)

    # ── 洩漏防護：測試期起點必須嚴格晚於訓練期終點 ──
    assert args.start > train_end, (
        f"洩漏：測試起點 {args.start} 未晚於方法論的 train_end {train_end}")

    if args.provider == "h200":
        client, model_name = make_h200_client()
        if client is None:
            print("❌ H200 未設定"); sys.exit(1)
    else:
        client, model_name = make_nim_client()
        if client is None:
            print("❌ NIM 未設定"); sys.exit(1)

    anchors = [d.isoformat() for d in anchor_dates(
        date.fromisoformat(args.start), date.fromisoformat(args.end), "week")]
    assert min(anchors) > train_end, f"洩漏：最早錨點 {min(anchors)} 未晚於 train_end {train_end}"
    if args.limit:
        anchors = anchors[: args.limit]

    out_dir = Path(args.out_dir) if args.out_dir else (
        Path(__file__).parent / "backtest_results"
        / f"{stock_id}_learned_{args.start}_{args.end}_h{args.horizon}")
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_path = out_dir / "predictions_cache.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}

    print(f"驗證：{stock_id} {args.start}~{args.end}｜horizon={args.horizon}｜中性帶 ±{band}%"
          f"｜provider={args.provider}｜模型 {model_name}")
    print(f"方法論：{methodology_dir.name} v{prompt_version}（train_end={train_end}）｜錨點 {len(anchors)} 個\n")

    qdrant_client, embeddings = build_qdrant_embeddings()
    price_rows = load_price_frame(stock_id, args.start, args.end, args.horizon)

    arms = (("A", None), ("L", learned_template))
    decisions = []
    llm_calls = 0
    for as_of in anchors:
        act = actual_from_rows(price_rows, as_of, args.horizon)
        if act is None:
            print(f"  [{as_of}] 略過（未來股價不足）")
            continue
        cact = classify(act, band)

        analyst, news = fetch_pit_articles(
            qdrant_client, embeddings, stock_id, as_of, window_days=args.window_days)
        closes = fetch_prices(stock_id, as_of, lookback_days=60)
        technical = compute_technical(closes)
        ctx = build_context_from_pit(analyst, news, technical, as_of)
        n_news = len(analyst) + len(news)

        arm_pred = {}
        for arm, template in arms:
            ver = DEFAULT_PROMPT_VERSION if arm == "A" else f"L_v{prompt_version}"
            key = f"{stock_id}|{as_of}|{arm}|{args.horizon}|{model_name}|{ver}"
            if key in cache:
                pred = cache[key]
            else:
                pred = predict_change_pct(client, model_name, stock_id, as_of, args.horizon,
                                          ctx, args.provider, prompt_template=template)
                cache[key] = pred
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2))
                llm_calls += 1
                if args.provider == "nim":
                    time.sleep(1.6)
            arm_pred[arm] = pred

        skipped = "llm_failed" if (arm_pred["A"] is None or arm_pred["L"] is None) else None
        for arm in ("A", "L"):
            pred = arm_pred[arm]
            if skipped:
                decisions.append({
                    "as_of": as_of, "arm": arm, "model": model_name,
                    "predicted_pct": pred, "predicted_dir": None,
                    "actual_pct": act, "actual_dir": cact, "hit": None, "abs_err": None,
                    "n_news": n_news, "n_digests_used": 0, "skipped_reason": skipped,
                    "prompt_version": DEFAULT_PROMPT_VERSION if arm == "A" else f"L_v{prompt_version}",
                })
                continue
            cpred = classify(pred, band)
            decisions.append({
                "as_of": as_of, "arm": arm, "model": model_name,
                "predicted_pct": pred, "predicted_dir": cpred,
                "actual_pct": act, "actual_dir": cact, "hit": cpred == cact,
                "abs_err": round(abs(pred - act), 2),
                "n_news": n_news, "n_digests_used": 0, "skipped_reason": None,
                "prompt_version": DEFAULT_PROMPT_VERSION if arm == "A" else f"L_v{prompt_version}",
            })

        if skipped:
            print(f"  [{as_of}] 略過統計｜A={arm_pred['A']}｜L={arm_pred['L']}")
        else:
            pa, pl = arm_pred["A"], arm_pred["L"]
            ca, cl = classify(pa, band), classify(pl, band)
            print(f"  [{as_of}] 實際{act:+.2f}%({cact})｜A {pa:+.2f}%({ca}){'✅' if ca==cact else '❌'}"
                  f"｜L {pl:+.2f}%({cl}){'✅' if cl==cact else '❌'}｜新聞={n_news}")

    # ── 落地 decisions.csv ──
    fieldnames = ["as_of", "arm", "model", "predicted_pct", "predicted_dir", "actual_pct",
                  "actual_dir", "hit", "abs_err", "n_news", "n_digests_used", "skipped_reason",
                  "prompt_version"]
    with (out_dir / "decisions.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(decisions)

    # ── metrics（arm L 為對照臂）──
    metrics = compute_metrics(
        decisions, arm_names=("A", "L"), band=band, seed=args.seed,
        config={"stock": stock_id, "period": "week", "start": args.start, "end": args.end,
                "horizon": args.horizon, "provider": args.provider, "model": model_name,
                "methodology_dir": str(methodology_dir), "prompt_version": prompt_version,
                "train_end": train_end},
        n_decision_points=len(anchors),
        band_grid=default_band_grid(band),
    )
    (out_dir / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2))

    by_arm, base, mc, verdict = (metrics["arms"], metrics["baselines"],
                                 metrics["mcnemar_sign_test"], metrics["verdict"])
    rel = metrics["relative_to_always_up"]
    print("\n" + "=" * 60)
    print(f"有效決策點：{metrics['coverage']['n_valid_as_of']}｜LLM 呼叫次數（本次新打）：{llm_calls}")
    print(f"A（現行 prompt）  命中率：{by_arm['A']['hit_rate']}｜相對 always_up：{rel['A']:+.4f}｜MAE：{by_arm['A']['mae']}")
    print(f"L（學到的 prompt）命中率：{by_arm['L']['hit_rate']}｜相對 always_up：{rel['L']:+.4f}｜MAE：{by_arm['L']['mae']}")
    print(f"always_up 基準線：{base['always_up']['hit_rate']}")
    print(f"McNemar：L勝{mc['b_wins']} / A勝{mc['a_wins']}，p={mc['p_value']}")
    print(f"判定（h{args.horizon}）：cond1（勝 always_up）={verdict['cond1_beats_always_up']}"
          f"｜cond2（L勝≥1.5×A勝）={verdict['cond2_wins_ratio']}｜passed={verdict['passed']}")
    print(f"\n輸出：{out_dir}")
    return out_dir


def main():
    ap = argparse.ArgumentParser(description="驗證階段：學到的 prompt vs 現行 prompt 命中率對照")
    ap.add_argument("--stock", default="2330")
    ap.add_argument("--start", default="2025-01-01")
    ap.add_argument("--end", default="2025-12-31")
    ap.add_argument("--horizon", type=int, default=20)
    ap.add_argument("--neutral-band", type=float, default=None)
    ap.add_argument("--provider", choices=["nim", "h200"], default="h200")
    ap.add_argument("--window-days", type=int, default=14)
    ap.add_argument("--methodology-dir", required=True,
                    help="methodology_trainer 的輸出目錄（含 best.json / prompt_v*.txt）")
    ap.add_argument("--prompt-version", type=int, default=None, help="指定用哪一版；預設讀 best.json")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    run(args)


if __name__ == "__main__":
    main()
