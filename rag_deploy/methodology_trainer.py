"""
訓練階段：讓 LLM 從歷史案例歸納「預測方法論」＋一份精修的預測 prompt
==============================================================
流程（詳見 ~/.claude/plans/rag-ai-sorted-firefly.md 的 Step 2）：

1. 建 training case：每個訓練期週五錨點 → 前 14 天 PIT 新聞（Qdrant 語意檢索）＋技術面
   ＋【事後實現】的未來 5/20 交易日漲跌幅（label）。快取到 cases.json，LLM 歸納重跑不再打 Qdrant。
2. round 0：把 batch_1（奇數序案例）的摘要餵給 LLM，要它輸出
   methodology（規則清單，每條含 signal/condition/expected_effect/confidence/evidence_case_ids）
   ＋ prompt_template（必須保留 {context_block} 等佔位符與 change_pct JSON 輸出契約）。
3. round k：拿目前 prompt 在 batch_2（held-out）上跑，收集預測錯的案例，連同目前 methodology
   一起回餵要 LLM 修規則。每 round 記 held-out 與 batch_1 的命中率（偵測過擬合）。
4. best = held-out h20 命中率最高的 round（平手看 h5、再看較小 k）。

洩漏防護：見 scan_for_leakage / training_anchors 的斷言；訓練期 2024，任何 as_of 的 h20
實現日必須 <= train_end。

用法：
    QDRANT_HOST=127.0.0.1 python methodology_trainer.py --stock 2330 \
        --train-start 2024-01-01 --train-end 2024-12-31 --provider h200 --rounds 3

    # dry-run（少量錨點、單 round、不落地正式目錄）
    QDRANT_HOST=127.0.0.1 python methodology_trainer.py --stock 2330 --limit 6 --rounds 1 \
        --provider h200 --out-dir /tmp/mt_dry
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict, field
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

from digest_core import (
    STOCK_NAMES, make_h200_client, DIGEST_EXTRA_BODY,
    fetch_pit_articles, fetch_prices, compute_technical,
)
from build_analysis_digests import anchor_dates, build_qdrant_embeddings
from backtest_digest_eval import (
    make_nim_client, load_price_frame, actual_from_rows, classify,
    build_context_from_pit, build_prediction_prompt, predict_change_pct,
    parse_prediction_json,
    PROMPT_REQUIRED_PLACEHOLDERS, PROMPT_OUTPUT_KEYS, DEFAULT_PROMPT_TEMPLATE,
)

load_dotenv()

H5_BAND = 1.0
H20_BAND = 3.0
HORIZON_MAX = 20


# ══════════════════════════════════════════════════════════════════
# 1. Training case 建構
# ══════════════════════════════════════════════════════════════════

@dataclass
class TrainingCase:
    case_id: str
    as_of: str
    analyst: list = field(default_factory=list)      # fetch_pit_articles 的分析師層
    news: list = field(default_factory=list)          # fetch_pit_articles 的一般新聞層
    technical: dict = field(default_factory=dict)     # compute_technical 輸出
    context_block: str = ""                            # build_context_from_pit（完整內文）
    actual_h5: float | None = None
    actual_h20: float | None = None
    dir_h5: str | None = None
    dir_h20: str | None = None
    n_news: int = 0


def training_anchors(stock_id: str, train_start: str, train_end: str,
                     price_rows: list[tuple[str, float]] | None = None,
                     horizon_max: int = HORIZON_MAX) -> list[str]:
    """訓練期週五錨點，且其 h20 實現日 <= train_end（不用未來資料當 label）。

    做法：把價格列截到 <= train_end，只保留 actual_from_rows(rows, as_of, horizon_max) 不為 None 的錨點。
    以 2024-12-31 為界、h20 而言，最後一個合格錨點約在 2024-11-29。
    """
    anchors = [d.isoformat() for d in anchor_dates(
        date.fromisoformat(train_start), date.fromisoformat(train_end), "week")]
    if price_rows is None:
        price_rows = load_price_frame(stock_id, train_start, train_end, horizon_max)
    rows_capped = [(d, c) for d, c in price_rows if d <= train_end]
    kept = []
    for a in anchors:
        if a > train_end:
            continue
        if actual_from_rows(rows_capped, a, horizon_max) is not None:
            kept.append(a)
        else:
            # 一旦某錨點的 h20 實現日超過 train_end，其後的錨點也都不合格 → 提早停
            break
    return kept


def build_cases(stock_id: str, train_start: str, train_end: str,
                qdrant_client, embeddings, window_days: int = 14,
                limit: int | None = None) -> list[TrainingCase]:
    """為每個訓練錨點組一份 TrainingCase（會打 Qdrant + yfinance）。"""
    price_rows = load_price_frame(stock_id, train_start, train_end, HORIZON_MAX)
    anchors = training_anchors(stock_id, train_start, train_end, price_rows)
    if limit:
        anchors = anchors[:limit]

    cases: list[TrainingCase] = []
    for as_of in anchors:
        analyst, news = fetch_pit_articles(
            qdrant_client, embeddings, stock_id, as_of, window_days=window_days)
        closes = fetch_prices(stock_id, as_of, lookback_days=60)
        technical = compute_technical(closes)
        ctx = build_context_from_pit(analyst, news, technical, as_of)
        a5 = actual_from_rows(price_rows, as_of, 5)
        a20 = actual_from_rows(price_rows, as_of, 20)
        cases.append(TrainingCase(
            case_id=f"{stock_id}_{as_of}", as_of=as_of,
            analyst=analyst, news=news, technical=technical, context_block=ctx,
            actual_h5=a5, actual_h20=a20,
            dir_h5=classify(a5, H5_BAND) if a5 is not None else None,
            dir_h20=classify(a20, H20_BAND) if a20 is not None else None,
            n_news=len(analyst) + len(news),
        ))
        print(f"  case {as_of}｜新聞 {len(analyst)+len(news)}｜h5={a5} h20={a20}")
        time.sleep(0.2)
    return cases


def load_or_build_cases(cache_path: Path, stock_id: str, train_start: str, train_end: str,
                        qdrant_client, embeddings, window_days: int = 14,
                        limit: int | None = None, rebuild: bool = False) -> list[TrainingCase]:
    if cache_path.exists() and not rebuild:
        raw = json.loads(cache_path.read_text())
        cases = [TrainingCase(**c) for c in raw["cases"]]
        _assert_cases_no_leak(cases, train_end)
        print(f"從快取載入 {len(cases)} 個 case：{cache_path}")
        return cases
    if qdrant_client is None or embeddings is None:
        raise RuntimeError("cases.json 不存在且未提供 Qdrant client，無法建 case（先跑一次含 --rebuild-cases）")
    cases = build_cases(stock_id, train_start, train_end, qdrant_client, embeddings, window_days, limit)
    _assert_cases_no_leak(cases, train_end)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps({
        "config": {"stock": stock_id, "train_start": train_start, "train_end": train_end,
                   "window_days": window_days},
        "cases": [asdict(c) for c in cases],
    }, ensure_ascii=False, indent=2))
    print(f"已建並快取 {len(cases)} 個 case：{cache_path}")
    return cases


def _assert_cases_no_leak(cases: list[TrainingCase], train_end: str) -> None:
    """洩漏防護：case 的新聞發布日、以及有 label 的錨點都不得晚於 train_end。"""
    for c in cases:
        for item in list(c.analyst) + list(c.news):
            pub = str(item.get("pub_time", ""))[:10]
            assert not pub or pub <= train_end, (
                f"洩漏：{c.case_id} 的新聞 {pub} 晚於 train_end {train_end}")
        assert c.as_of <= train_end, f"洩漏：錨點 {c.as_of} 晚於 train_end {train_end}"


def case_summary(case: TrainingCase, snippet_chars: int = 200, max_items: int = 8) -> str:
    """歸納用的精簡案例：標題＋來源＋日期＋200 字摘要＋技術面一行＋事後實現漲跌幅。"""
    lines = [f"### 案例 {case.case_id}（as_of {case.as_of}）"]
    t = case.technical
    if t.get("available"):
        lines.append(
            f"技術面：近 {t['n_days']} 日 {t['first_close']}→{t['last_close']} 元"
            f"（{t['change_pct']:+.2f}%），迴歸斜率/日 {t['slope_per_day']:+.3f}，"
            f"MA20={t['ma20']}（乖離 {t.get('vs_ma20_pct', 0):+.2f}%）")
    else:
        lines.append("技術面：（無足夠股價資料）")
    items = (list(case.analyst) + list(case.news))[:max_items]
    if items:
        lines.append("新聞：")
        for it in items:
            snip = (it.get("content") or "").strip().replace("\n", " ")[:snippet_chars]
            tier = "分析師" if it in case.analyst else "新聞"
            lines.append(f"  - [{str(it.get('pub_time',''))[:10]}｜{tier}] {it.get('title','')}｜{snip}")
    else:
        lines.append("新聞：（無）")
    lines.append(f"【事後實現】未來 5 交易日 {case.actual_h5:+.2f}%（{case.dir_h5}）、"
                 f"未來 20 交易日 {case.actual_h20:+.2f}%（{case.dir_h20}）")
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════
# 2. 歸納 / 修正 prompt
# ══════════════════════════════════════════════════════════════════

INDUCTION_SYSTEM = "你是嚴謹的台股量化研究員，只根據提供的案例歸納規律，不引入案例以外的任何知識。"

_METHODOLOGY_KEYS = ("summary", "regime_rules", "rules", "anti_patterns")


def build_induction_prompt(stock_id: str, train_start: str, train_end: str,
                           cases: list[TrainingCase]) -> str:
    name = STOCK_NAMES.get(stock_id, stock_id)
    case_blocks = "\n\n".join(case_summary(c) for c in cases)
    contract = ('{"market_regime": "...", "technical_reasoning": "...", '
                '"news_reasoning": "...", "change_pct": 數字}')
    return f"""以下是 {name}（{stock_id}）在 {train_start}~{train_end} 的 {len(cases)} 個週度案例。
每個案例含：截至 as_of 的技術面摘要、前 14 天新聞摘要、以及【事後實現】的未來 5/20 交易日漲跌幅。

{case_blocks}

任務：歸納一份「預測方法論」——哪些新聞訊號 / 技術狀態與後續走勢相關、何時該用動能延續、
何時該用均值回歸、哪些是無效訊號（anti-pattern）。每條規則必須引用支持它的案例 id 作證據。
嚴格限制：不得引用上述案例以外的任何日期、價格或事件。

接著寫出一份「預測 prompt template」，內嵌上述方法論，供之後對新的 as_of 做預測用。
這個 template 是純字串，其中這些佔位符會被系統替換：{{as_of}} {{name}} {{stock_id}} {{horizon}} {{context_block}}。
template 結尾必須要求模型「只輸出 JSON」且格式固定為：{contract}
（change_pct 為預估總漲跌幅數字，正為漲、負為跌。這個輸出契約不可更動。）

只輸出一個 JSON，不要其他文字：
{{
  "methodology": {{
    "summary": "1-2 句總結這套方法論的核心",
    "regime_rules": ["判斷『強趨勢 vs 盤整』的具體準則，2-4 條"],
    "rules": [
      {{"id": "R1", "signal": "訊號描述", "condition": "在什麼技術/市場狀態下",
        "expected_effect": "對 h20 或 h5 方向與幅度的預期，如『h20 偏多 +2~4%』",
        "confidence": 0.6, "evidence_case_ids": ["{stock_id}_2024-03-08"]}}
    ],
    "anti_patterns": ["被證明無效或會誤導的訊號，2-4 條"]
  }},
  "prompt_template": "完整的預測 prompt 字串（含上述佔位符與 JSON 輸出契約）"
}}"""


def build_refine_prompt(methodology: dict, template: str,
                        misses: list[dict], train_end: str) -> str:
    """misses：[{summary, predicted_pct, predicted_dir, actual_pct, actual_dir, horizon}]"""
    miss_blocks = []
    for m in misses:
        miss_blocks.append(
            f"{m['summary']}\n  → 目前方法論預測 h{m['horizon']} {m['predicted_pct']:+.2f}%"
            f"（{m['predicted_dir']}），實際 {m['actual_pct']:+.2f}%（{m['actual_dir']}）")
    contract = ('{"market_regime": "...", "technical_reasoning": "...", '
                '"news_reasoning": "...", "change_pct": 數字}')
    return f"""這是目前的預測方法論與 prompt template：

## 目前 methodology
{json.dumps(methodology, ensure_ascii=False, indent=2)}

## 目前 prompt_template
{template}

## 用它預測錯誤的案例（held-out，未參與歸納）
{chr(10).join(miss_blocks)}

任務：檢視這些錯誤，修正 methodology 的規則（可新增、刪除、調整 condition/expected_effect/confidence），
並據此更新 prompt_template。不要為了擬合個別案例而過度細分規則；優先找出系統性的偏誤
（例如：是否總是低估幅度、是否在強趨勢中錯誤地預期回檔）。
嚴格限制：不得引用提供案例以外的日期、價格或事件（train_end={train_end}）。
prompt_template 必須保留佔位符 {{as_of}} {{name}} {{stock_id}} {{horizon}} {{context_block}}，
且結尾維持輸出契約：{contract}

只輸出一個 JSON（結構同前）：
{{"methodology": {{...}}, "prompt_template": "..."}}"""


# ── prompt template 驗證 ──

_DATE_RE = re.compile(r"(20\d{2})[-/年.](\d{1,2})")
_QUARTER_RE = re.compile(r"20\d{2}\s*Q[1-4]")


def scan_for_leakage(text: str, train_end: str) -> list[str]:
    """在 LLM 產出的文件裡找晚於 train_end 的日期字樣（含 YYYYQn）。回傳問題字串清單。"""
    end_ym = train_end[:7]
    hits = []
    for m in _DATE_RE.finditer(text or ""):
        y, mo = m.group(1), int(m.group(2))
        if not (1 <= mo <= 12):
            continue
        ym = f"{y}-{mo:02d}"
        if ym > end_ym:
            hits.append(m.group(0))
    for m in _QUARTER_RE.finditer(text or ""):
        yr = m.group(0)[:4]
        if yr > train_end[:4]:
            hits.append(m.group(0))
    return sorted(set(hits))


def validate_prompt_template(template: str) -> None:
    """佔位符齊全 + 套上假值後能經 parse_prediction_json round-trip。失敗拋 ValueError。"""
    if not isinstance(template, str) or not template.strip():
        raise ValueError("prompt_template 不是非空字串")
    missing = [p for p in PROMPT_REQUIRED_PLACEHOLDERS if "{" + p + "}" not in template]
    if missing:
        raise ValueError(f"prompt_template 缺少佔位符：{missing}")
    rendered = build_prediction_prompt("2330", "2024-06-07", 20, "（測試 context）", template=template)
    if "{context_block}" in rendered or "（測試 context）" not in rendered:
        raise ValueError("prompt_template 的 {context_block} 未被正確替換")
    # 模擬一個合法回應能被解析
    stub = ('{"market_regime": "強趨勢", "technical_reasoning": "x", '
            '"news_reasoning": "y", "change_pct": 2.5}')
    parse_prediction_json(stub)


def validate_methodology(methodology: dict) -> None:
    if not isinstance(methodology, dict):
        raise ValueError("methodology 不是 dict")
    missing = [k for k in _METHODOLOGY_KEYS if k not in methodology]
    if missing:
        raise ValueError(f"methodology 缺少欄位：{missing}")
    if not isinstance(methodology.get("rules"), list) or not methodology["rules"]:
        raise ValueError("methodology.rules 必須是非空清單")


def call_induction_llm(client, model_name: str, provider: str, prompt: str,
                       system: str = INDUCTION_SYSTEM, max_tokens: int = 2400) -> dict:
    """呼叫 LLM 產 {methodology, prompt_template}；失敗（含驗證失敗）重試 1 次，附錯誤訊息。"""
    last_err = None
    for attempt in range(2):
        try:
            kwargs = dict(
                model=model_name,
                messages=[{"role": "system", "content": system},
                          {"role": "user", "content": prompt if attempt == 0
                           else prompt + f"\n\n（上一次輸出有誤：{last_err}，請修正後重新輸出完整 JSON）"}],
                temperature=0.5, max_tokens=max_tokens, stream=False,
            )
            if provider == "h200":
                kwargs["extra_body"] = DIGEST_EXTRA_BODY
            resp = client.chat.completions.create(**kwargs)
            raw = re.sub(r"<think>.*?</think>\s*", "",
                         (resp.choices[0].message.content or "").strip(), flags=re.DOTALL)
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            if not m:
                raise ValueError(f"回應中找不到 JSON：{raw[:200]}")
            parsed = json.loads(m.group())
            methodology = parsed["methodology"]
            template = parsed["prompt_template"]
            validate_methodology(methodology)
            validate_prompt_template(template)
            return {"methodology": methodology, "prompt_template": template}
        except Exception as e:
            last_err = str(e)[:300]
            print(f"    ⚠️ 歸納失敗（第 {attempt+1} 次）：{last_err}")
            if attempt == 0:
                time.sleep(2.0)
    raise RuntimeError(f"歸納連續失敗：{last_err}")


# ══════════════════════════════════════════════════════════════════
# 3. 在案例上評估一版 prompt
# ══════════════════════════════════════════════════════════════════

def evaluate_prompt_on_cases(client, model_name: str, provider: str, stock_id: str,
                             cases: list[TrainingCase], template: str,
                             version_tag: str, cache: dict,
                             horizons=(5, 20)) -> dict:
    """對每個 case 用 template 預測 h5/h20，回傳 {case_id: {h5: pred, h20: pred, hit_h5, hit_h20}}。
    cache key = f"{case_id}|h{h}|{version_tag}"，命中則不重打 LLM。"""
    out: dict = {}
    for c in cases:
        rec: dict = {}
        for h in horizons:
            band = H5_BAND if h == 5 else H20_BAND
            actual = c.actual_h5 if h == 5 else c.actual_h20
            act_dir = c.dir_h5 if h == 5 else c.dir_h20
            key = f"{c.case_id}|h{h}|{version_tag}"
            if key in cache:
                pred = cache[key]
            else:
                pred = predict_change_pct(client, model_name, stock_id, c.as_of, h,
                                          c.context_block, provider, prompt_template=template)
                cache[key] = pred
                time.sleep(0.5 if provider == "h200" else 1.6)
            rec[f"h{h}"] = pred
            rec[f"dir_h{h}"] = classify(pred, band) if pred is not None else None
            rec[f"hit_h{h}"] = (classify(pred, band) == act_dir) if (pred is not None and act_dir) else None
            rec[f"actual_h{h}"] = actual
            rec[f"actual_dir_h{h}"] = act_dir
        out[c.case_id] = rec
    return out


def hit_rate(evals: dict, horizon: int) -> tuple[float | None, int]:
    hits = [v[f"hit_h{horizon}"] for v in evals.values() if v.get(f"hit_h{horizon}") is not None]
    if not hits:
        return None, 0
    return round(sum(1 for h in hits if h) / len(hits), 4), len(hits)


def always_up_rate(cases: list[TrainingCase], horizon: int) -> float | None:
    dirs = [(c.dir_h5 if horizon == 5 else c.dir_h20) for c in cases]
    dirs = [d for d in dirs if d]
    if not dirs:
        return None
    return round(sum(1 for d in dirs if d == "up") / len(dirs), 4)


def collect_misses(cases: list[TrainingCase], evals: dict, horizon: int,
                   max_misses: int = 12) -> list[dict]:
    misses = []
    for c in cases:
        e = evals.get(c.case_id, {})
        if e.get(f"hit_h{horizon}") is False:
            misses.append({
                "summary": case_summary(c, snippet_chars=140, max_items=5),
                "predicted_pct": e[f"h{horizon}"], "predicted_dir": e[f"dir_h{horizon}"],
                "actual_pct": e[f"actual_h{horizon}"], "actual_dir": e[f"actual_dir_h{horizon}"],
                "horizon": horizon,
            })
    return misses[:max_misses]


# ══════════════════════════════════════════════════════════════════
# 4. 訓練主流程
# ══════════════════════════════════════════════════════════════════

def split_batches(cases: list[TrainingCase]) -> tuple[list[TrainingCase], list[TrainingCase]]:
    """batch_1（歸納用）= 偶數 index；batch_2（held-out）= 奇數 index。"""
    b1 = [c for i, c in enumerate(cases) if i % 2 == 0]
    b2 = [c for i, c in enumerate(cases) if i % 2 == 1]
    return b1, b2


def train(args) -> Path:
    stock_id = args.stock
    out_dir = Path(args.out_dir) if args.out_dir else (
        Path(__file__).parent / "methodology" / f"{stock_id}_{args.train_start}_{args.train_end}")
    out_dir.mkdir(parents=True, exist_ok=True)
    cases_path = out_dir / "cases.json"
    eval_cache_path = out_dir / "eval_cache.json"
    eval_cache = json.loads(eval_cache_path.read_text()) if eval_cache_path.exists() else {}

    # LLM client
    if args.provider == "h200":
        client, model_name = make_h200_client()
        if client is None:
            print("❌ H200 未設定（.env 需 H200_BASE_URL/H200_API_KEY）"); sys.exit(1)
    else:
        client, model_name = make_nim_client()
        if client is None:
            print("❌ NIM 未設定（.env 需 NVIDIA_API_KEY）"); sys.exit(1)

    # cases（可能要打 Qdrant）
    need_qdrant = not cases_path.exists() or args.rebuild_cases
    qdrant_client = embeddings = None
    if need_qdrant:
        qdrant_client, embeddings = build_qdrant_embeddings()
    cases = load_or_build_cases(cases_path, stock_id, args.train_start, args.train_end,
                                qdrant_client, embeddings, window_days=args.window_days,
                                limit=args.limit, rebuild=args.rebuild_cases)
    if len(cases) < 4:
        print(f"❌ 只有 {len(cases)} 個 case，不足以訓練"); sys.exit(1)

    b1, b2 = split_batches(cases)
    print(f"\n案例分批：歸納用 batch_1={len(b1)}、held-out batch_2={len(b2)}")

    rounds_log = []

    # ── round 0：歸納 ──
    print("\n── round 0：從 batch_1 歸納方法論 ──")
    prompt = build_induction_prompt(stock_id, args.train_start, args.train_end, b1)
    v0 = call_induction_llm(client, model_name, args.provider, prompt)
    leak = scan_for_leakage(json.dumps(v0, ensure_ascii=False), args.train_end)
    if leak:
        print(f"    ⚠️ round 0 文件疑似洩漏未來日期：{leak}（已記錄，未阻擋 v0）")
    _write_version(out_dir, 0, v0)
    versions = {0: v0}

    for k in range(0, args.rounds + 1):
        template = versions[k]["prompt_template"]
        tag = f"train_v{k}"
        ev_b2 = evaluate_prompt_on_cases(client, model_name, args.provider, stock_id, b2, template, tag, eval_cache)
        ev_b1 = evaluate_prompt_on_cases(client, model_name, args.provider, stock_id, b1, template, tag, eval_cache)
        eval_cache_path.write_text(json.dumps(eval_cache, ensure_ascii=False, indent=2))

        hr_b2_h5, n_b2_h5 = hit_rate(ev_b2, 5)
        hr_b2_h20, n_b2_h20 = hit_rate(ev_b2, 20)
        hr_b1_h5, _ = hit_rate(ev_b1, 5)
        hr_b1_h20, _ = hit_rate(ev_b1, 20)
        au_b2_h20 = always_up_rate(b2, 20)
        au_b2_h5 = always_up_rate(b2, 5)
        misses20 = collect_misses(b2, ev_b2, 20)
        misses5 = collect_misses(b2, ev_b2, 5)
        rounds_log.append({
            "k": k, "heldout_h5": hr_b2_h5, "heldout_h20": hr_b2_h20,
            "heldout_n_h5": n_b2_h5, "heldout_n_h20": n_b2_h20,
            "batch1_h5": hr_b1_h5, "batch1_h20": hr_b1_h20,
            "always_up_h20_heldout": au_b2_h20, "always_up_h5_heldout": au_b2_h5,
            "n_misses_h20": len(misses20), "n_misses_h5": len(misses5),
        })
        print(f"  v{k}｜held-out h20={hr_b2_h20}（n={n_b2_h20}, always_up={au_b2_h20}）"
              f"｜h5={hr_b2_h5}｜batch_1 h20={hr_b1_h20}（過擬合檢查）")

        if k == args.rounds:
            break

        # ── round k+1：修正 ──
        print(f"\n── round {k+1}：依 {len(misses20)} 個 h20 miss + {len(misses5)} 個 h5 miss 修正 ──")
        combined = (misses20 + misses5)[:16]
        refine_prompt = build_refine_prompt(versions[k]["methodology"], template, combined, args.train_end)
        try:
            vk = call_induction_llm(client, model_name, args.provider, refine_prompt)
        except RuntimeError as e:
            print(f"    ⚠️ round {k+1} 修正失敗，沿用 v{k}：{e}")
            versions[k + 1] = versions[k]
            _write_version(out_dir, k + 1, versions[k + 1])
            continue
        leak = scan_for_leakage(json.dumps(vk, ensure_ascii=False), args.train_end)
        if leak:
            print(f"    ⚠️ v{k+1} 疑似洩漏：{leak}")
        versions[k + 1] = vk
        _write_version(out_dir, k + 1, vk)

    # ── 選 best：held-out h20 最高 → h5 → 較小 k ──
    def _score(entry):
        return (entry["heldout_h20"] or -1, entry["heldout_h5"] or -1, -entry["k"])
    best = max(rounds_log, key=_score)
    best_k = best["k"]

    (out_dir / "train_log.json").write_text(json.dumps({
        "config": {
            "stock": stock_id, "train_start": args.train_start, "train_end": args.train_end,
            "provider": args.provider, "model": model_name, "rounds": args.rounds,
            "window_days": args.window_days, "n_cases": len(cases),
            "n_batch1": len(b1), "n_batch2": len(b2),
            "h20_band": H20_BAND, "h5_band": H5_BAND,
        },
        "rounds": rounds_log,
        "best": best_k,
    }, ensure_ascii=False, indent=2))
    (out_dir / "best.json").write_text(json.dumps({
        "version": best_k,
        "prompt": f"prompt_v{best_k}.txt",
        "methodology": f"methodology_v{best_k}.json",
        "heldout_h20": best["heldout_h20"], "heldout_h5": best["heldout_h5"],
        "train_end": args.train_end, "stock": stock_id,
    }, ensure_ascii=False, indent=2))

    print(f"\n{'='*60}\nbest = v{best_k}（held-out h20={best['heldout_h20']}、h5={best['heldout_h5']}）")
    print(f"輸出：{out_dir}")
    return out_dir


def _write_version(out_dir: Path, k: int, version: dict) -> None:
    (out_dir / f"methodology_v{k}.json").write_text(
        json.dumps(version["methodology"], ensure_ascii=False, indent=2))
    (out_dir / f"prompt_v{k}.txt").write_text(version["prompt_template"])


def main():
    ap = argparse.ArgumentParser(description="訓練階段：LLM 歸納預測方法論 + 精修 prompt")
    ap.add_argument("--stock", default="2330")
    ap.add_argument("--train-start", default="2024-01-01")
    ap.add_argument("--train-end", default="2024-12-31")
    ap.add_argument("--provider", choices=["nim", "h200"], default="h200")
    ap.add_argument("--window-days", type=int, default=14, help="PIT 新聞回溯天數")
    ap.add_argument("--rounds", type=int, default=3, help="修正輪數（round 0 歸納後再修 N 輪）")
    ap.add_argument("--limit", type=int, default=None, help="只用前 N 個錨點（dry-run）")
    ap.add_argument("--rebuild-cases", action="store_true", help="重新建 cases.json（重打 Qdrant）")
    ap.add_argument("--out-dir", default=None)
    args = ap.parse_args()
    train(args)


if __name__ == "__main__":
    main()
