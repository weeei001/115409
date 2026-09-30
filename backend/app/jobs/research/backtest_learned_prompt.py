"""Compare the baseline and learned prompts on a strictly held-out period."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import time
from datetime import date
from pathlib import Path

from app.core.config import state_directory
from app.jobs.research.digest_core import (
    compute_technical, fetch_pit_articles, fetch_prices, make_h200_client,
)
from app.jobs.research.build_analysis_digests import anchor_dates, build_qdrant_embeddings
from app.jobs.research.backtest_digest_eval import (
    DEFAULT_PROMPT_TEMPLATE, DEFAULT_PROMPT_VERSION, actual_from_rows,
    build_context_from_pit, classify, compute_metrics, default_band_grid,
    load_price_frame, make_nim_client, predict_change_pct,
)


def load_methodology(methodology_dir: Path, prompt_version: int | None) -> tuple[str, int, str]:
    """Return the requested (or best) template, its version and training end."""
    best = json.loads((methodology_dir / "best.json").read_text(encoding="utf-8"))
    version = prompt_version if prompt_version is not None else best["version"]
    if type(version) is not int or version < 0:
        raise ValueError("prompt version must be a nonnegative integer")
    template = (methodology_dir / f"prompt_v{version}.txt").read_text(encoding="utf-8")
    if not template.strip():
        raise ValueError("learned prompt must not be empty")
    train_end = date.fromisoformat(best["train_end"]).isoformat()
    return template, version, train_end


def _validate_args(args) -> None:
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    if start > end:
        raise ValueError("--start must be on or before --end")
    args.start, args.end = start.isoformat(), end.isoformat()
    for name in ("horizon", "window_days", "limit"):
        value = getattr(args, name)
        if value is not None and (type(value) is not int or value <= 0):
            raise ValueError(f"--{name.replace('_', '-')} must be a positive integer")
    if args.prompt_version is not None and (
        type(args.prompt_version) is not int or args.prompt_version < 0
    ):
        raise ValueError("--prompt-version must be a nonnegative integer")
    if args.neutral_band is not None and (
        not math.isfinite(args.neutral_band) or args.neutral_band < 0
    ):
        raise ValueError("--neutral-band must be finite and nonnegative")
    if not args.stock.strip():
        raise ValueError("--stock must not be empty")
    if args.provider not in {"h200", "nim"}:
        raise ValueError("unsupported provider")
    if getattr(args, "period", "week") not in {"day", "week"}:
        raise ValueError("unsupported period")


def run(args) -> Path:
    _validate_args(args)
    stock_id = args.stock
    methodology_dir = Path(args.methodology_dir).resolve()
    learned_template, prompt_version, train_end = load_methodology(methodology_dir, args.prompt_version)
    if args.start <= train_end:
        raise ValueError(f"test start {args.start} must be after training end {train_end}")

    band = args.neutral_band if args.neutral_band is not None else (3.0 if args.horizon == 20 else 1.0)
    period = getattr(args, "period", "week")
    price_rows = load_price_frame(stock_id, args.start, args.end, args.horizon)
    trading_dates = {d for d, _ in price_rows}
    anchors = [d.isoformat() for d in anchor_dates(
        date.fromisoformat(args.start), date.fromisoformat(args.end), period)
        if period != "day" or d.isoformat() in trading_dates]
    if args.limit is not None:
        anchors = anchors[:args.limit]

    out_dir = Path(args.out_dir) if args.out_dir else (
        state_directory() / "backtest_results"
        / f"{stock_id}_learned_{args.start}_{args.end}_h{args.horizon}")
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_path = out_dir / "predictions_cache.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}

    # Empty periods still produce reviewable artifacts without external clients.
    client, model_name = None, None
    if anchors:
        client, model_name = make_h200_client() if args.provider == "h200" else make_nim_client()
        if client is None:
            raise RuntimeError(f"{args.provider} is not configured")
        qdrant_client, embeddings = build_qdrant_embeddings()

    print(f"Backtest: {stock_id} {args.start}..{args.end}; horizon={args.horizon}; band={band}%"
          f"; provider={args.provider}; model={model_name}")
    print(f"Methodology: {methodology_dir.name} v{prompt_version}; train_end={train_end}; anchors={len(anchors)}")
    decisions = []
    llm_calls = 0
    for as_of in anchors:
        act = actual_from_rows(price_rows, as_of, args.horizon)
        if act is None:
            print(f"  [{as_of}] Skipped: insufficient future prices")
            continue
        cact = classify(act, band)
        analyst, news = fetch_pit_articles(
            qdrant_client, embeddings, stock_id, as_of, window_days=args.window_days)
        technical = compute_technical(fetch_prices(stock_id, as_of, lookback_days=60))
        ctx = build_context_from_pit(analyst, news, technical, as_of)
        n_news = len(analyst) + len(news)
        arm_pred = {}
        for arm, template in (("A", None), ("L", learned_template)):
            version = DEFAULT_PROMPT_VERSION if arm == "A" else f"L_v{prompt_version}"
            key = hashlib.sha256(json.dumps(
                [stock_id, as_of, arm, args.horizon, args.provider, model_name, version,
                 DEFAULT_PROMPT_TEMPLATE if template is None else template, ctx],
                ensure_ascii=False, sort_keys=True,
            ).encode("utf-8")).hexdigest()
            pred = cache.get(key)
            if pred is None:
                pred = predict_change_pct(client, model_name, stock_id, as_of, args.horizon,
                                          ctx, args.provider, prompt_template=template)
                if pred is not None and not math.isfinite(pred):
                    pred = None
                cache[key] = pred
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
                llm_calls += 1
                if args.provider == "nim":
                    time.sleep(1.6)
            arm_pred[arm] = pred

        skipped = "llm_failed" if any(p is None for p in arm_pred.values()) else None
        for arm, pred in arm_pred.items():
            cpred = classify(pred, band) if not skipped else None
            decisions.append({
                "as_of": as_of, "arm": arm, "model": model_name,
                "predicted_pct": pred, "predicted_dir": cpred,
                "actual_pct": act, "actual_dir": cact,
                "hit": cpred == cact if not skipped else None,
                "abs_err": round(abs(pred - act), 2) if not skipped else None,
                "n_news": n_news, "n_digests_used": 0, "skipped_reason": skipped,
                "prompt_version": DEFAULT_PROMPT_VERSION if arm == "A" else f"L_v{prompt_version}",
            })
        print(f"  [{as_of}] actual={act:+.2f}%; A={arm_pred['A']}; L={arm_pred['L']}; skipped={skipped}")

    fieldnames = ["as_of", "arm", "model", "predicted_pct", "predicted_dir", "actual_pct",
                  "actual_dir", "hit", "abs_err", "n_news", "n_digests_used", "skipped_reason",
                  "prompt_version"]
    with (out_dir / "decisions.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(decisions)
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    metrics = compute_metrics(
        decisions, arm_names=("A", "L"), band=band, seed=args.seed,
        config={"stock": stock_id, "period": period, "start": args.start, "end": args.end,
                "comparison_scope": "prompt_only_shared_retrieval",
                "quality_scope": "historical_direction_not_online_answer_quality",
                "horizon": args.horizon, "provider": args.provider, "model": model_name,
                "methodology_dir": str(methodology_dir), "prompt_version": prompt_version,
                "train_end": train_end, "window_days": args.window_days},
        n_decision_points=len(anchors), band_grid=default_band_grid(band),
    )
    (out_dir / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Valid decision points: {metrics['coverage']['n_valid_as_of']}; new LLM calls: {llm_calls}")
    for arm in ("A", "L"):
        stats = metrics["arms"][arm]
        relative = metrics["relative_to_always_up"][arm]
        relative_text = f"{relative:+.4f}" if relative is not None else "N/A"
        print(f"{arm}: hit_rate={stats['hit_rate']}; relative_to_always_up={relative_text}; MAE={stats['mae']}")
    print(f"always_up: {metrics['baselines']['always_up']['hit_rate']}")
    print(f"McNemar: {metrics['mcnemar_sign_test']}")
    print(f"Verdict: {metrics['verdict']}")
    print(f"Output: {out_dir}")
    return out_dir


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stock", default="2330")
    parser.add_argument("--start", default="2025-01-01")
    parser.add_argument("--end", default="2025-12-31")
    parser.add_argument("--horizon", type=int, default=20)
    parser.add_argument("--neutral-band", type=float, default=None)
    parser.add_argument("--provider", choices=["nim", "h200"], default="h200")
    parser.add_argument("--period", choices=["week", "day"], default="week",
                        help="Evaluate weekly anchors or each trading day")
    parser.add_argument("--window-days", type=int, default=14)
    parser.add_argument("--methodology-dir", required=True,
                        help="Trainer output directory containing best.json and prompt_v*.txt")
    parser.add_argument("--prompt-version", type=int, default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--out-dir", default=None)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)
    try:
        _validate_args(args)
    except ValueError as exc:
        parser.error(str(exc))
    run(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
