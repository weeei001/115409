"""
一次性對照腳本：用 H200 重跑「舊版 prompt」（無CoT、無動能/均值回歸引導），
排除 provider 差異，跟 backtest_digest_eval.py 的新版 prompt v2（同樣用H200）做乾淨比較。
用完即可刪除，不是常駐工具。
"""
from __future__ import annotations

import json
import os
import re
import time
import random
import csv
from pathlib import Path

from dotenv import load_dotenv

from backtest_digest_eval import (
    list_digests, fetch_recent_digests, context_A, context_B,
    load_price_frame, actual_from_rows, classify, _mcnemar_p,
)
from digest_core import STOCK_NAMES, make_h200_client, DIGEST_EXTRA_BODY

load_dotenv()


def predict_change_pct_v1(client, model_name: str, stock_id: str, as_of: str, horizon: int,
                           context_block: str) -> float | None:
    """舊版 prompt：直接要求輸出JSON，無CoT、無動能/均值回歸引導、無區間錨點。"""
    name = STOCK_NAMES.get(stock_id, stock_id)
    prompt = f"""你是台股分析師。根據以下截至 {as_of} 的資訊，預測 {name}（{stock_id}）未來 {horizon} 個交易日的「總漲跌幅」。
只能用下方資訊，不得引入 {as_of} 之後才知道的事。

{context_block}

請只輸出 JSON，不要其他文字：
{{"change_pct": 預估總漲跌幅數字（例如 2.5 代表漲 2.5%，-1.8 代表跌 1.8%）}}"""

    def _call():
        resp = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3, max_tokens=200, stream=False,
            extra_body=DIGEST_EXTRA_BODY,
        )
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"<think>.*?</think>\s*", "", raw, flags=re.DOTALL)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            raise ValueError(f"no JSON in response: {raw[:200]}")
        return float(json.loads(m.group()).get("change_pct"))

    for attempt in range(2):
        try:
            return _call()
        except Exception as e:
            print(f"      ⚠️ 預測失敗（第 {attempt+1} 次）：{e}")
            if attempt == 0:
                time.sleep(2.0)
    return None


def main():
    stock, period, start, end, horizon, band = "2330", "week", "2024-01-01", "2024-12-31", 20, 3.0
    out_dir = Path(__file__).parent / "backtest_results" / f"{stock}_{period}_{start}_{end}_h{horizon}_promptv1_h200"
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_path = out_dir / "predictions_cache.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}

    client, model_name = make_h200_client()
    if client is None:
        print("❌ H200 未設定")
        return

    recs = list_digests(stock, period, start, end)
    price_rows = load_price_frame(stock, start, end, horizon)

    print(f"舊版prompt對照實驗：{stock} {period} {start}~{end}｜horizon={horizon}｜provider=h200｜模型 {model_name}")

    decisions = []
    for rec in recs:
        as_of = rec["as_of_date"]
        act = actual_from_rows(price_rows, as_of, horizon)
        if act is None:
            continue
        cact = classify(act, band)
        recent_digests = fetch_recent_digests(stock, as_of, period, n=4)
        ctx_a, ctx_b = context_A(rec), context_B(rec, recent_digests)
        n_news, n_digests_used = len(rec["news_json"]), len(recent_digests)

        arm_results = {}
        for arm, ctx in (("A", ctx_a), ("B", ctx_b)):
            key = f"{stock}|{as_of}|{arm}|{horizon}|{model_name}|v1"
            if key in cache:
                pred = cache[key]
            else:
                pred = predict_change_pct_v1(client, model_name, stock, as_of, horizon, ctx)
                cache[key] = pred
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2))
                time.sleep(0.5)
            arm_results[arm] = pred

        skipped = arm_results["A"] is None or arm_results["B"] is None
        for arm in ("A", "B"):
            pred = arm_results[arm]
            if skipped:
                decisions.append({"as_of": as_of, "arm": arm, "model": model_name, "predicted_pct": pred,
                                   "predicted_dir": None, "actual_pct": act, "actual_dir": cact, "hit": None,
                                   "abs_err": None, "n_news": n_news, "n_digests_used": n_digests_used,
                                   "skipped_reason": "llm_failed"})
                continue
            cpred = classify(pred, band)
            hit = cpred == cact
            decisions.append({"as_of": as_of, "arm": arm, "model": model_name, "predicted_pct": pred,
                               "predicted_dir": cpred, "actual_pct": act, "actual_dir": cact, "hit": hit,
                               "abs_err": round(abs(pred - act), 2), "n_news": n_news,
                               "n_digests_used": n_digests_used, "skipped_reason": None})
        if not skipped:
            print(f"  [{as_of}] 實際{act:+.2f}%({cact})｜A {arm_results['A']:+.2f}%｜B {arm_results['B']:+.2f}%")

    csv_path = out_dir / "decisions.csv"
    fieldnames = ["as_of", "arm", "model", "predicted_pct", "predicted_dir", "actual_pct", "actual_dir",
                  "hit", "abs_err", "n_news", "n_digests_used", "skipped_reason"]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(decisions)

    valid_as_of = {d["as_of"] for d in decisions if d["arm"] == "A" and d["skipped_reason"] is None}
    by_arm = {}
    for arm in ("A", "B"):
        rows = [d for d in decisions if d["arm"] == arm and d["as_of"] in valid_as_of]
        n, hits = len(rows), sum(1 for r in rows if r["hit"])
        mae = sum(r["abs_err"] for r in rows) / n if n else None
        by_arm[arm] = {"n": n, "hit_rate": round(hits / n, 4) if n else None, "hits": hits,
                        "mae": round(mae, 4) if mae is not None else None}

    actuals = [d["actual_dir"] for d in decisions if d["arm"] == "A" and d["as_of"] in valid_as_of]
    n_valid = len(actuals)
    always_up_hits = sum(1 for a in actuals if a == "up")

    metrics = {
        "config": {"stock": stock, "period": period, "start": start, "end": end, "horizon": horizon,
                    "neutral_band": band, "provider": "h200", "model": model_name, "prompt_version": "v1_original"},
        "arms": by_arm,
        "baselines": {"always_up": {"n": n_valid, "hit_rate": round(always_up_hits / n_valid, 4) if n_valid else None}},
        "coverage": {"n_decision_points": len(recs), "n_valid_as_of": n_valid},
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2))

    print("\n" + "=" * 60)
    print(f"有效決策點：{n_valid}")
    print(f"A（舊prompt）方向命中率：{by_arm['A']['hit_rate']}｜MAE：{by_arm['A']['mae']}")
    print(f"B（舊prompt）方向命中率：{by_arm['B']['hit_rate']}｜MAE：{by_arm['B']['mae']}")
    print(f"always_up 基準線：{round(always_up_hits/n_valid, 4) if n_valid else None}")
    print(f"\n輸出：{out_dir}")


if __name__ == "__main__":
    main()
