"""Prediction prompts and paired evaluation preserved from Bob's experiments."""
from __future__ import annotations

import json
import math
import os
import random
import re
import time
from datetime import date, timedelta
from pathlib import Path

from app.jobs.research.digest_core import (
    STOCK_NAMES, DIGEST_EXTRA_BODY, make_h200_client, read_price_rows,
)


def make_nim_client():
    # Provider credentials and endpoint come from the shared backend settings.
    return make_h200_client()


def load_price_frame(stock_id: str, start: str, end: str, horizon: int):
    return read_price_rows(stock_id, date.fromisoformat(start) - timedelta(days=7),
                           date.fromisoformat(end) + timedelta(days=horizon * 2 + 15))


def price_trend_desc(tech: dict) -> str:
    if not tech.get("available"):
        return "（無足夠股價資料）"
    return (f"近 {tech['n_days']} 個交易日收盤 {tech['first_close']} → {tech['last_close']} 元"
            f"（{tech['change_pct']:+.2f}%），迴歸斜率每日 {tech['slope_per_day']:+.3f} 元，MA20={tech['ma20']}。")


def _news_full_text_block(news_json: list[dict], as_of: str) -> str:
    """完整新聞內文清單（不截斷），防洩漏：過濾掉 pub_time > as_of 的項目。"""
    items = []
    for n in news_json:
        pub = str(n.get("pub_time", ""))[:10]
        if pub and pub > as_of:
            continue
        title = n.get("title", "")
        content = n.get("content", "") or n.get("page_content", "")
        items.append(f"- [{pub or '?'}] {title}｜{content}")
    return "\n".join(items) or "（無新聞）"


_MAGNITUDE_BUCKETS = (
    "D5+(跌逾5%) / D4(跌4-5%) / D3(跌3-4%) / D2(跌2-3%) / D1(跌0-2%) / "
    "U1(漲0-2%) / U2(漲2-3%) / U3(漲3-4%) / U4(漲4-5%) / U5+(漲逾5%)"
)


def build_context_from_pit(analyst_items: list[dict], news_items: list[dict],
                           technical: dict, as_of: str) -> str:
    """等價於 context_A，但直接吃 digest_core.fetch_pit_articles 的輸出（不經 analysis_digests 表）。
    分析師層與一般新聞合併成一份完整內文清單，讓訓練/驗證兩階段共用同一個 context 組法。"""
    news_block = _news_full_text_block(list(analyst_items) + list(news_items), as_of)
    return f"## 近期價格趨勢\n{price_trend_desc(technical)}\n\n## 近期新聞（完整內文）\n{news_block}"


DEFAULT_PROMPT_VERSION = "A_v1"


PROMPT_PLACEHOLDERS = ("as_of", "name", "stock_id", "horizon", "context_block", "magnitude_buckets")


PROMPT_REQUIRED_PLACEHOLDERS = ("as_of", "name", "stock_id", "horizon", "context_block")


PROMPT_OUTPUT_KEYS = ("market_regime", "technical_reasoning", "news_reasoning", "change_pct")


DEFAULT_PROMPT_TEMPLATE = """你是台股分析師。根據以下截至 {as_of} 的資訊，預測 {name}（{stock_id}）未來 {horizon} 個交易日的「總漲跌幅」。
只能用下方資訊，不得引入 {as_of} 之後才知道的事。

{context_block}

請依序完成以下推理步驟：

步驟1（市場狀態判斷）：先判斷目前是「強趨勢」還是「盤整／雜訊」——
觀察近期價格走勢的斜率是否一致、方向是否穩定（強趨勢：斜率持續同向、無劇烈來回；
盤整：漲跌互見、乖離不大、方向不明）。這一步決定後續要用哪一套邏輯：
動能策略在盤整期容易失準，均值回歸策略在強趨勢中也容易失準，兩者要看市場狀態選用，
不要無條件套用其中一種。

步驟2（技術面推理）：依步驟1判斷的市場狀態，評估近期價格走勢：
若判斷為強趨勢，優先考慮動能延續（強趨勢中的「超買/超跌」較常是趨勢確認訊號而非反轉訊號，
但仍有約3成機率會反轉，非必然）；若判斷為盤整或訊號紊亂，優先考慮均值回歸或維持觀望。
若近期已大幅上漲或下跌（例如超過10%），需明確說出這在你判斷的市場狀態下對未來
{horizon} 個交易日的方向含義是什麼，不要只是複述數字。

步驟3（新聞面推理）：判斷新聞內容是否直接與公司基本面（營收、訂單、法說、產業動能）相關，
還是多為周邊消息（人事、廠房進度、政治發言等）；新聞面的訊號強度是強、中、弱。

步驟4（綜合結論）：綜合步驟1-3，給出最終方向與幅度。可參考以下區間刻度輔助定位幅度
（僅供你推理時參考，不必在輸出中提及）：{magnitude_buckets}

請只輸出 JSON，不要其他文字：
{"market_regime": "步驟1判斷：強趨勢或盤整，1句", "technical_reasoning": "步驟2的推理，1-2句", "news_reasoning": "步驟3的推理，1-2句", "change_pct": 預估總漲跌幅數字（例如 2.5 代表漲 2.5%，-1.8 代表跌 1.8%）}"""


_PLACEHOLDER_RE = re.compile(r"\{(" + "|".join(PROMPT_PLACEHOLDERS) + r")\}")


def _format_safe(template: str, **fields) -> str:
    """只替換 PROMPT_PLACEHOLDERS 內的佔位符，其他大括號原樣保留。
    不用 str.format：LLM 產出的 template 常含 JSON 範例的零散大括號，str.format 會直接炸。"""
    return _PLACEHOLDER_RE.sub(lambda m: str(fields[m.group(1)]), template)


def build_prediction_prompt(stock_id: str, as_of: str, horizon: int, context_block: str,
                            template: str | None = None) -> str:
    """組出預測 prompt。template=None 時用現行 DEFAULT_PROMPT_TEMPLATE（輸出與舊版 f-string 完全相同）。"""
    name = STOCK_NAMES.get(stock_id, stock_id)
    return _format_safe(
        template if template is not None else DEFAULT_PROMPT_TEMPLATE,
        as_of=as_of, name=name, stock_id=stock_id, horizon=horizon,
        context_block=context_block, magnitude_buckets=_MAGNITUDE_BUCKETS,
    )


_BAD_ESCAPE_RE = re.compile(r'\\(?!["\\/bfnrtu])')


def _extract_change_pct(raw: str) -> float | None:
    """最後手段：直接從文字裡撈 "change_pct": <數字>。"""
    m = re.search(r'"change_pct"\s*:\s*(-?\d+(?:\.\d+)?)', raw)
    return float(m.group(1)) if m else None


def parse_prediction_json(raw: str) -> dict:
    """從 LLM 回應抽出預測 JSON：去 <think>、取第一個 {...}、驗證 change_pct 可轉 float。
    回傳 parsed dict（change_pct 已轉 float）。任何一步失敗都拋例外，由呼叫端決定重試。

    對 JSON 內裸反斜線（模型把 LaTeX 帶進理由欄）做兩段容錯：先原樣 loads，
    失敗則把非法 \\x 轉成 \\\\x 再 loads，再失敗才回退純 regex 撈 change_pct。
    """
    raw = re.sub(r"<think>.*?</think>\s*", "", (raw or "").strip(), flags=re.DOTALL)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        raise ValueError(f"no JSON in response: {raw[:200]}")
    blob = m.group()
    parsed = None
    for candidate in (blob, _BAD_ESCAPE_RE.sub(r"\\\\", blob)):
        try:
            parsed = json.loads(candidate)
            break
        except json.JSONDecodeError:
            continue
    if parsed is None:
        cp = _extract_change_pct(blob)
        if cp is None:
            raise ValueError(f"unparseable JSON: {blob[:200]}")
        return {"change_pct": cp, "market_regime": "", "technical_reasoning": "",
                "news_reasoning": "", "_parse": "regex_fallback"}
    if "change_pct" not in parsed or parsed["change_pct"] is None:
        raise ValueError(f"missing change_pct: {str(parsed)[:200]}")
    if isinstance(parsed["change_pct"], bool):
        raise ValueError("change_pct must be numeric")
    parsed["change_pct"] = float(parsed["change_pct"])
    if not math.isfinite(parsed["change_pct"]):
        raise ValueError("change_pct must be finite")
    return parsed


def predict_change_pct(client, model_name: str, stock_id: str, as_of: str, horizon: int,
                        context_block: str, provider: str,
                        prompt_template: str | None = None) -> float | None:
    """呼叫 LLM 預測未來 horizon 交易日的總漲跌幅（%）。失敗重試 1 次，仍失敗回 None。

    prompt_template=None 時沿用現行 A_v1 prompt（DEFAULT_PROMPT_TEMPLATE）；
    傳入學到的 template 時，只要它保留 PROMPT_OUTPUT_KEYS 的 JSON 輸出契約，
    這裡的解析與下游 classify()/decisions.csv 完全不用改。
    """
    prompt = build_prediction_prompt(stock_id, as_of, horizon, context_block, prompt_template)

    def _call():
        kwargs = dict(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3, max_tokens=500, stream=False,
        )
        if provider == "h200":
            kwargs["extra_body"] = DIGEST_EXTRA_BODY
        resp = client.chat.completions.create(**kwargs)
        parsed = parse_prediction_json(resp.choices[0].message.content)
        if os.environ.get("DEBUG_COT"):
            print(f"      [CoT] 市場狀態：{parsed.get('market_regime', '')}")
            print(f"      [CoT] 技術面：{parsed.get('technical_reasoning', '')}")
            print(f"      [CoT] 新聞面：{parsed.get('news_reasoning', '')}")
        return parsed["change_pct"]

    for attempt in range(2):
        try:
            return _call()
        except Exception as e:
            print(f"Prediction failed (attempt {attempt + 1}, {type(e).__name__})")
            if attempt == 0:
                time.sleep(2.0)
    return None


def actual_from_rows(rows: list[tuple[str, float]], as_of: str, horizon: int):
    """純函數：從 (date_str, close) 排序列表算 as_of 之後第 horizon 個交易日漲跌幅。資料不足回 None。"""
    i0 = None
    for i, (d, _) in enumerate(rows):
        if d <= as_of:
            i0 = i
    if i0 is None or i0 + horizon >= len(rows):
        return None
    p0 = rows[i0][1]
    pn = rows[i0 + horizon][1]
    if not p0:
        return None
    return round((pn - p0) / p0 * 100, 2)


def classify(pct: float, band: float) -> str:
    if abs(pct) < band:
        return "flat"
    return "up" if pct > 0 else "down"


def _mcnemar_p(b_wins: int, a_wins: int) -> float:
    """符號檢定（近似 McNemar，小樣本用二項分配精確 p 值，雙尾）。"""
    n = a_wins + b_wins
    if n == 0:
        return 1.0
    from math import comb
    k = min(a_wins, b_wins)
    p = sum(comb(n, i) * (0.5 ** n) for i in range(0, k + 1)) * 2
    return min(1.0, round(p, 4))


def default_band_grid(band: float) -> tuple[float, ...]:
    """中性帶敏感度用的帶寬格點：以主帶寬為中心，h20（±3%）用 1.5/2/3/4，h5（±1%）用 0.5/1/1.5。"""
    if band >= 2.0:
        return (1.5, 2.0, 3.0, 4.0)
    return (0.5, 1.0, 1.5)


def compute_metrics(decisions: list[dict], arm_names: tuple[str, str] = ("A", "B"),
                    band: float = 3.0, seed: int = 42, config: dict | None = None,
                    n_decision_points: int | None = None,
                    band_grid: tuple[float, ...] | None = None) -> dict:
    """由 decisions 列（同 decisions.csv schema）算出 metrics.json 的內容。

    arm_names=(基準臂, 對照臂)：基準臂通常是現行 prompt A，對照臂是 B（疊加摘要）或 L（學到的 prompt）。
    只統計「兩臂皆有效」的 as_of（成對排除，維持配對比較公平）。

    verdict records an exploratory directional screen, not a deployment gate:
      cond1：命中率 − always_up > 0（有比無腦猜漲好）
      cond2：McNemar 成對比較中 對照臂勝次數 ≥ 1.5 × 基準臂勝次數
    Overlapping return windows are not independent; this function cannot certify robustness.
    """
    base_arm, cmp_arm = arm_names
    valid_as_of = set.intersection(*({d["as_of"] for d in decisions
        if d["arm"] == arm and d["skipped_reason"] is None}
        for arm in arm_names))
    by_arm = {}
    for arm in arm_names:
        rows = [d for d in decisions if d["arm"] == arm and d["as_of"] in valid_as_of]
        n = len(rows)
        hits = sum(1 for r in rows if r["hit"])
        mae = sum(r["abs_err"] for r in rows) / n if n else None
        by_arm[arm] = {"n": n, "hit_rate": round(hits / n, 4) if n else None,
                       "hits": hits, "mae": round(mae, 4) if mae is not None else None}

    # 基準線：always_up / always_down / random（seed）
    actuals = [d["actual_dir"] for d in decisions if d["arm"] == base_arm and d["as_of"] in valid_as_of]
    n_valid = len(actuals)
    always_up_hits = sum(1 for a in actuals if a == "up")
    always_down_hits = sum(1 for a in actuals if a == "down")
    rng = random.Random(seed)
    dirs = ["up", "down", "flat"]
    random_preds = [rng.choice(dirs) for _ in range(n_valid)]
    random_hits = sum(1 for p, a in zip(random_preds, actuals) if p == a)
    always_up_rate = round(always_up_hits / n_valid, 4) if n_valid else None
    baselines = {
        "always_up": {"n": n_valid, "hit_rate": always_up_rate},
        "always_down": {"n": n_valid, "hit_rate": round(always_down_hits / n_valid, 4) if n_valid else None},
        f"random_seed{seed}": {"n": n_valid, "hit_rate": round(random_hits / n_valid, 4) if n_valid else None,
                               "expected_hit_rate_note": "理論期望值視 up/down/flat 類別分佈而定，此為單次模擬結果"},
    }

    # McNemar / 符號檢定：對照臂對基準臂的配對比較（只用兩臂皆有效的 as_of）
    cmp_wins = base_wins = 0
    for ao in valid_as_of:
        base_row = next(d for d in decisions if d["arm"] == base_arm and d["as_of"] == ao)
        cmp_row = next(d for d in decisions if d["arm"] == cmp_arm and d["as_of"] == ao)
        if base_row["hit"] and not cmp_row["hit"]:
            base_wins += 1
        elif cmp_row["hit"] and not base_row["hit"]:
            cmp_wins += 1
    mcnemar_p = _mcnemar_p(cmp_wins, base_wins)

    # 中性帶敏感度：重新用不同 band 分類（不重打 LLM，用快取的 predicted_pct）
    band_sensitivity = {}
    for alt_band in (band_grid or default_band_grid(band)):
        alt_by_arm = {}
        for arm in arm_names:
            rows = [d for d in decisions if d["arm"] == arm and d["as_of"] in valid_as_of and d["skipped_reason"] is None]
            hits = sum(1 for r in rows if classify(r["predicted_pct"], alt_band) == classify(r["actual_pct"], alt_band))
            alt_by_arm[arm] = round(hits / len(rows), 4) if rows else None
        band_sensitivity[f"band_{alt_band}"] = alt_by_arm

    n_digests_dist = {}
    for d in decisions:
        if d["arm"] == base_arm:
            n_digests_dist[d["n_digests_used"]] = n_digests_dist.get(d["n_digests_used"], 0) + 1
    n_llm_failed = len({d["as_of"] for d in decisions if d["skipped_reason"] == "llm_failed"})

    # 相對 always_up 的差距 + 雙條件 verdict
    relative = {}
    for arm in arm_names:
        hr = by_arm[arm]["hit_rate"]
        relative[arm] = round(hr - always_up_rate, 4) if (hr is not None and always_up_rate is not None) else None
    cond1 = relative[cmp_arm] is not None and relative[cmp_arm] > 0
    cond2 = cmp_wins >= 1.5 * base_wins and cmp_wins > 0
    verdict = {
        "cmp_arm": cmp_arm, "base_arm": base_arm,
        "cond1_beats_always_up": cond1,
        "cond2_wins_ratio": cond2,
        "passed": False,
        "exploratory_directional_signal": bool(cond1 and cond2),
        "evidence_status": "exploratory_only",
        "note": (f"cond1：{cmp_arm} 命中率 − always_up > 0；cond2：{cmp_arm} 勝 ≥ 1.5×{base_arm} 勝。"
                 "此為探索性篩選；未驗證獨立樣本、重疊報酬視窗及多重選擇偏差，不能判定穩健改善。"),
    }

    metrics = {
        "config": dict(config or {}, neutral_band=band, seed=seed),
        "arms": by_arm,
        "baselines": baselines,
        "relative_to_always_up": relative,
        "mcnemar_sign_test": {"b_wins": cmp_wins, "a_wins": base_wins, "p_value": mcnemar_p,
                              "cmp_arm": cmp_arm, "base_arm": base_arm,
                              "note": f"雙尾符號檢定；b_wins={cmp_arm} 勝、a_wins={base_arm} 勝；p 值假設配對樣本彼此獨立，重疊報酬視窗可能違反假設"},
        "verdict": verdict,
        "band_sensitivity": band_sensitivity,
        "coverage": {
            "n_decision_points": n_decision_points if n_decision_points is not None else len({d["as_of"] for d in decisions}),
            "n_valid_as_of": n_valid,
            "n_llm_failed_as_of": n_llm_failed,
            "n_digests_used_distribution": n_digests_dist,
        },
    }
    try:
        import subprocess
        sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent).decode().strip()
        metrics["config"]["git_sha"] = sha
    except Exception:
        pass
    return metrics
