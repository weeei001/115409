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
                     horizon_max: int = HORIZON_MAX,
                     period: str = "week") -> list[str]:
    """訓練期錨點（period="week" 取週五、"day" 取每日），且其 h20 實現日 <= train_end。

    做法：把價格列截到 <= train_end，只保留 actual_from_rows(rows, as_of, horizon_max) 不為 None 的錨點。
    period="day" 時非交易日自然被 actual_from_rows 濾掉（該日無 <= as_of 的新價格點時仍會沿用前一交易日，
    故實際過濾靠的是「未來第 horizon 根 K 棒是否存在」）。
    以 2024-12-31 為界、h20 而言，最後一個合格錨點約在 2024-11-29。
    """
    anchors = [d.isoformat() for d in anchor_dates(
        date.fromisoformat(train_start), date.fromisoformat(train_end), period)]
    if price_rows is None:
        price_rows = load_price_frame(stock_id, train_start, train_end, horizon_max)
    rows_capped = [(d, c) for d, c in price_rows if d <= train_end]
    trading_days = {d for d, _ in rows_capped}
    kept = []
    for a in anchors:
        if a > train_end:
            continue
        # 日頻：只保留真正的交易日，避免週末/假日沿用前一交易日產生重複錨點
        if period == "day" and a not in trading_days:
            continue
        if actual_from_rows(rows_capped, a, horizon_max) is not None:
            kept.append(a)
        elif period != "day":
            # 週頻/月頻：一旦某錨點的 h20 實現日超過 train_end，其後的錨點也都不合格 → 提早停
            break
    return kept


def build_cases(stock_id: str, train_start: str, train_end: str,
                qdrant_client, embeddings, window_days: int = 14,
                limit: int | None = None, period: str = "week",
                out_path: Path | None = None) -> list[TrainingCase]:
    """為每個訓練錨點組一份 TrainingCase（會打 Qdrant + yfinance）。

    out_path 給定時（.jsonl）逐筆 append 落地，中斷可續傳：已存在的 case_id 直接跳過。
    日頻 ~481 個錨點下，這讓 Qdrant/yfinance 不必因中斷而全部重打。
    """
    price_rows = load_price_frame(stock_id, train_start, train_end, HORIZON_MAX)
    anchors = training_anchors(stock_id, train_start, train_end, price_rows, period=period)
    if limit:
        anchors = anchors[:limit]

    done: dict[str, TrainingCase] = {}
    if out_path is not None and out_path.exists():
        for c in _read_cases_jsonl(out_path):
            done[c.as_of] = c
        if done:
            print(f"  續傳：已有 {len(done)} 個 case，跳過重建")

    cases: list[TrainingCase] = []
    for as_of in anchors:
        if as_of in done:
            cases.append(done[as_of])
            continue
        analyst, news = fetch_pit_articles(
            qdrant_client, embeddings, stock_id, as_of, window_days=window_days)
        closes = fetch_prices(stock_id, as_of, lookback_days=60)
        technical = compute_technical(closes)
        ctx = build_context_from_pit(analyst, news, technical, as_of)
        a5 = actual_from_rows(price_rows, as_of, 5)
        a20 = actual_from_rows(price_rows, as_of, 20)
        case = TrainingCase(
            case_id=f"{stock_id}_{as_of}", as_of=as_of,
            analyst=analyst, news=news, technical=technical, context_block=ctx,
            actual_h5=a5, actual_h20=a20,
            dir_h5=classify(a5, H5_BAND) if a5 is not None else None,
            dir_h20=classify(a20, H20_BAND) if a20 is not None else None,
            n_news=len(analyst) + len(news),
        )
        cases.append(case)
        if out_path is not None:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with out_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(asdict(case), ensure_ascii=False) + "\n")
        print(f"  case {as_of}｜新聞 {len(analyst)+len(news)}｜h5={a5} h20={a20}")
        time.sleep(0.2)
    return cases


def _read_cases_jsonl(path: Path) -> list[TrainingCase]:
    cases = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            cases.append(TrainingCase(**json.loads(line)))
    return cases


def load_or_build_cases(cache_path: Path, stock_id: str, train_start: str, train_end: str,
                        qdrant_client, embeddings, window_days: int = 14,
                        limit: int | None = None, rebuild: bool = False,
                        period: str = "week") -> list[TrainingCase]:
    """載入或建立 cases。

    日頻資料量大（~481 筆、~8MB），改用 JSON Lines（cases.jsonl）逐筆 append 以支援續傳；
    仍相容舊格式 cases.json（整份 JSON，含 config/cases 兩鍵）。
    """
    jsonl_path = cache_path.with_suffix(".jsonl")

    if not rebuild:
        if jsonl_path.exists():
            cases = _read_cases_jsonl(jsonl_path)
            if cases and (not limit or len(cases) >= limit):
                if limit:
                    cases = cases[:limit]
                _assert_cases_no_leak(cases, train_end)
                print(f"從快取載入 {len(cases)} 個 case：{jsonl_path}")
                return cases
        elif cache_path.exists():  # 舊格式回溯相容
            raw = json.loads(cache_path.read_text())
            cases = [TrainingCase(**c) for c in raw["cases"]]
            _assert_cases_no_leak(cases, train_end)
            print(f"從舊格式快取載入 {len(cases)} 個 case：{cache_path}")
            return cases

    if qdrant_client is None or embeddings is None:
        raise RuntimeError(
            f"{jsonl_path.name} 不存在且未提供 Qdrant client，無法建 case（先跑一次含 --rebuild-cases）")
    if rebuild and jsonl_path.exists():
        jsonl_path.unlink()
    cases = build_cases(stock_id, train_start, train_end, qdrant_client, embeddings,
                        window_days, limit, period=period, out_path=jsonl_path)
    _assert_cases_no_leak(cases, train_end)
    (jsonl_path.parent / "cases_meta.json").write_text(json.dumps({
        "stock": stock_id, "train_start": train_start, "train_end": train_end,
        "window_days": window_days, "period": period, "n_cases": len(cases),
    }, ensure_ascii=False, indent=2))
    print(f"已建並快取 {len(cases)} 個 case：{jsonl_path}")
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


_LATEX_RE = re.compile(r"\$?\\(rightarrow|le|ge|to|Rightarrow|approx|times|leq|geq)\$?")
_LATEX_MAP = {"rightarrow": "→", "Rightarrow": "→", "to": "→", "le": "≤", "leq": "≤",
              "ge": "≥", "geq": "≥", "approx": "≈", "times": "×"}


def sanitize_template(template: str) -> str:
    """把 LLM 愛用的 LaTeX（$\\rightarrow$ / $\\le$ …）換成 unicode，
    再清掉殘留的裸反斜線——這些反斜線之後會讓模型把它們帶進回應 JSON、炸 json.loads。"""
    t = _LATEX_RE.sub(lambda m: _LATEX_MAP.get(m.group(1), "→"), template)
    t = re.sub(r'\\(?!["\\/bfnrtu])', "", t)  # 剩下的裸反斜線直接刪
    return t


def validate_prompt_template(template: str) -> None:
    """佔位符齊全 + 套上假值後能經 parse_prediction_json round-trip。失敗拋 ValueError。
    呼叫前應先過 sanitize_template。"""
    if not isinstance(template, str) or not template.strip():
        raise ValueError("prompt_template 不是非空字串")
    missing = [p for p in PROMPT_REQUIRED_PLACEHOLDERS if "{" + p + "}" not in template]
    if missing:
        raise ValueError(f"prompt_template 缺少佔位符：{missing}")
    if re.search(r'\\(?!["\\/bfnrtu])', template):
        raise ValueError("prompt_template 仍含裸反斜線（sanitize_template 未處理乾淨）")
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
            template = sanitize_template(parsed["prompt_template"])
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
    """batch_1（歸納用）= 偶數 index；batch_2（held-out）= 奇數 index。

    僅適用週頻：週頻錨點間隔 5 個交易日，h20 標籤雖仍有重疊但奇偶交錯尚可接受。
    日頻請改用 split_batches_temporal（見該函式說明）。
    """
    b1 = [c for i, c in enumerate(cases) if i % 2 == 0]
    b2 = [c for i, c in enumerate(cases) if i % 2 == 1]
    return b1, b2


def split_batches_temporal(cases: list[TrainingCase], heldout_frac: float = 0.4,
                           embargo: int = HORIZON_MAX
                           ) -> tuple[list[TrainingCase], list[TrainingCase]]:
    """時間連續切分：前段歸納、後段 held-out，中間挖掉 embargo 個錨點。

    為何需要：日頻錨點的 h20 標籤高度重疊（相鄰兩日的未來 20 交易日有 19 天相同）。
    若用奇偶 index 切分，held-out 的每一筆在歸納批次裡幾乎都有一個「只差一天」的雙胞胎，
    等於把答案洩漏給歸納階段。改成時間連續切分 + 20 錨點 embargo，可確保
    歸納批次最後一筆的 h20 實現期完全早於 held-out 第一筆的 as_of。
    """
    ordered = sorted(cases, key=lambda c: c.as_of)
    n = len(ordered)
    n_heldout = max(1, int(round(n * heldout_frac)))
    cut = n - n_heldout
    b1 = ordered[:max(0, cut - embargo)]
    b2 = ordered[cut:]
    return b1, b2


def stratified_sample(cases: list[TrainingCase], k: int,
                      horizon: int = 20, seed: int = 42) -> list[TrainingCase]:
    """依 h{horizon} 標籤分層抽樣 k 筆，維持 up/flat/down 的母體比例。

    歸納 prompt 塞不下 481 個案例摘要（遠超 context），但抽樣必須保住類別分佈，
    否則 LLM 會因為看到的樣本偏多頭而學出偏多規則。回傳結果依 as_of 排序。
    """
    import random as _random
    if k >= len(cases):
        return sorted(cases, key=lambda c: c.as_of)
    key = f"dir_h{horizon}"
    buckets: dict[str, list[TrainingCase]] = {}
    for c in cases:
        buckets.setdefault(getattr(c, key) or "unknown", []).append(c)

    rng = _random.Random(seed)
    picked: list[TrainingCase] = []
    # 依比例配額（floor），餘額再依「剩餘數量最多」的桶補齊
    quotas = {}
    for lab, items in buckets.items():
        quotas[lab] = int(len(items) * k / len(cases))
    for lab, items in buckets.items():
        take = min(quotas[lab], len(items))
        picked.extend(rng.sample(items, take))
    remaining = k - len(picked)
    if remaining > 0:
        pool = [c for c in cases if c not in picked]
        picked.extend(rng.sample(pool, min(remaining, len(pool))))
    return sorted(picked, key=lambda c: c.as_of)


def run_iterations(client, model_name: str, args, stock_id: str,
                   induction_pool: list[TrainingCase], heldout: list[TrainingCase],
                   eval_cache: dict, eval_cache_path: Path, out_dir: Path,
                   tag_prefix: str = "train", n_induction_cases: int = 40,
                   write_versions: bool = True) -> tuple[dict, list[dict]]:
    """跑一輪完整的「歸納 → 迭代修正」流程，回傳 (versions, rounds_log)。

    induction_pool：可供歸納的案例（會分層抽樣 n_induction_cases 筆送 LLM）。
    heldout：評估用，不參與歸納。tag_prefix 讓學習曲線各檔位的 cache key 不互撞。
    """
    sampled = stratified_sample(induction_pool, n_induction_cases, horizon=20)
    print(f"\n── {tag_prefix} round 0：從 {len(induction_pool)} 筆中分層抽樣 {len(sampled)} 筆歸納 ──")
    prompt = build_induction_prompt(stock_id, args.train_start, args.train_end, sampled)
    v0 = call_induction_llm(client, model_name, args.provider, prompt)
    leak = scan_for_leakage(json.dumps(v0, ensure_ascii=False), args.train_end)
    if leak:
        print(f"    ⚠️ round 0 文件疑似洩漏未來日期：{leak}（已記錄，未阻擋 v0）")
    if write_versions:
        _write_version(out_dir, 0, v0)
    versions = {0: v0}
    rounds_log: list[dict] = []

    for k in range(0, args.rounds + 1):
        template = versions[k]["prompt_template"]
        tag = f"{tag_prefix}_v{k}"
        ev_b2 = evaluate_prompt_on_cases(client, model_name, args.provider, stock_id,
                                         heldout, template, tag, eval_cache)
        ev_b1 = evaluate_prompt_on_cases(client, model_name, args.provider, stock_id,
                                         sampled, template, tag, eval_cache)
        eval_cache_path.write_text(json.dumps(eval_cache, ensure_ascii=False, indent=2))

        hr_b2_h5, n_b2_h5 = hit_rate(ev_b2, 5)
        hr_b2_h20, n_b2_h20 = hit_rate(ev_b2, 20)
        hr_b1_h5, _ = hit_rate(ev_b1, 5)
        hr_b1_h20, _ = hit_rate(ev_b1, 20)
        au_b2_h20 = always_up_rate(heldout, 20)
        au_b2_h5 = always_up_rate(heldout, 5)
        misses20 = collect_misses(heldout, ev_b2, 20)
        misses5 = collect_misses(heldout, ev_b2, 5)
        rounds_log.append({
            "k": k, "heldout_h5": hr_b2_h5, "heldout_h20": hr_b2_h20,
            "heldout_n_h5": n_b2_h5, "heldout_n_h20": n_b2_h20,
            "batch1_h5": hr_b1_h5, "batch1_h20": hr_b1_h20,
            "always_up_h20_heldout": au_b2_h20, "always_up_h5_heldout": au_b2_h5,
            "n_misses_h20": len(misses20), "n_misses_h5": len(misses5),
        })
        print(f"  v{k}｜held-out h20={hr_b2_h20}（n={n_b2_h20}, always_up={au_b2_h20}）"
              f"｜h5={hr_b2_h5}｜歸納批 h20={hr_b1_h20}（過擬合檢查）")

        if k == args.rounds:
            break

        # ── round k+1：修正 ──
        print(f"\n── {tag_prefix} round {k+1}：依 {len(misses20)} 個 h20 miss + {len(misses5)} 個 h5 miss 修正 ──")
        combined = (misses20 + misses5)[:16]
        refine_prompt = build_refine_prompt(versions[k]["methodology"], template, combined, args.train_end)
        try:
            vk = call_induction_llm(client, model_name, args.provider, refine_prompt)
        except RuntimeError as e:
            print(f"    ⚠️ round {k+1} 修正失敗，沿用 v{k}：{e}")
            versions[k + 1] = versions[k]
            if write_versions:
                _write_version(out_dir, k + 1, versions[k + 1])
            continue
        leak = scan_for_leakage(json.dumps(vk, ensure_ascii=False), args.train_end)
        if leak:
            print(f"    ⚠️ v{k+1} 疑似洩漏：{leak}")
        versions[k + 1] = vk
        if write_versions:
            _write_version(out_dir, k + 1, vk)
    return versions, rounds_log


def _setup(args, need_llm: bool = True) -> tuple:
    """共用初始化：out_dir、LLM client、cases。need_llm=False 供 --build-cases-only 使用。"""
    stock_id = args.stock
    out_dir = Path(args.out_dir) if args.out_dir else (
        Path(__file__).parent / "methodology" / f"{stock_id}_{args.train_start}_{args.train_end}")
    out_dir.mkdir(parents=True, exist_ok=True)
    cases_path = out_dir / "cases.json"

    client = model_name = None
    if need_llm:
        if args.provider == "h200":
            client, model_name = make_h200_client()
            if client is None:
                print("❌ H200 未設定（.env 需 H200_BASE_URL/H200_API_KEY）"); sys.exit(1)
        else:
            client, model_name = make_nim_client()
            if client is None:
                print("❌ NIM 未設定（.env 需 NVIDIA_API_KEY）"); sys.exit(1)

    jsonl_path = cases_path.with_suffix(".jsonl")
    need_qdrant = (not jsonl_path.exists() and not cases_path.exists()) or args.rebuild_cases
    qdrant_client = embeddings = None
    if need_qdrant:
        qdrant_client, embeddings = build_qdrant_embeddings()
    cases = load_or_build_cases(cases_path, stock_id, args.train_start, args.train_end,
                                qdrant_client, embeddings, window_days=args.window_days,
                                limit=args.limit, rebuild=args.rebuild_cases,
                                period=args.period)
    return stock_id, out_dir, client, model_name, cases


def train(args) -> Path:
    stock_id, out_dir, client, model_name, cases = _setup(args)
    eval_cache_path = out_dir / "eval_cache.json"
    eval_cache = json.loads(eval_cache_path.read_text()) if eval_cache_path.exists() else {}
    if len(cases) < 4:
        print(f"❌ 只有 {len(cases)} 個 case，不足以訓練"); sys.exit(1)

    if args.period == "day":
        b1, b2 = split_batches_temporal(cases, embargo=HORIZON_MAX)
        print(f"\n案例分批（時間連續 + embargo {HORIZON_MAX}）："
              f"歸納池={len(b1)}（~{b1[0].as_of}~{b1[-1].as_of}）、"
              f"held-out={len(b2)}（{b2[0].as_of}~{b2[-1].as_of}）")
    else:
        b1, b2 = split_batches(cases)
        print(f"\n案例分批：歸納用 batch_1={len(b1)}、held-out batch_2={len(b2)}")

    versions, rounds_log = run_iterations(
        client, model_name, args, stock_id, b1, b2,
        eval_cache, eval_cache_path, out_dir,
        tag_prefix="train", n_induction_cases=args.induction_cases)

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


def parse_curve_spec(spec: str, pool_size: int) -> list[int]:
    """"50,150,300,all" → [50,150,300,pool_size]，去重、升冪、剔除超過池大小者。"""
    out = []
    for tok in spec.split(","):
        tok = tok.strip().lower()
        if not tok:
            continue
        n = pool_size if tok == "all" else int(tok)
        if n > pool_size:
            n = pool_size
        out.append(n)
    return sorted(set(out))


def run_learning_curve(args) -> Path:
    """學習曲線：在同一個 held-out 集合上，用遞增的歸納池大小各跑一次完整迭代。

    核心設計：四個檔位共用同一個 held-out（時間連續 + embargo），否則曲線不可比。
    歸納池取「最靠近 held-out 的 n 筆」（時間上最相關），而非隨機抽，
    以免不同檔位的訓練資料落在不同市場狀態而混淆樣本量效應。
    """
    stock_id, out_dir, client, model_name, cases = _setup(args)
    eval_cache_path = out_dir / "eval_cache.json"
    eval_cache = json.loads(eval_cache_path.read_text()) if eval_cache_path.exists() else {}
    if len(cases) < 8:
        print(f"❌ 只有 {len(cases)} 個 case，不足以跑學習曲線"); sys.exit(1)

    if args.period == "day":
        pool, heldout = split_batches_temporal(cases, embargo=HORIZON_MAX)
    else:
        pool, heldout = split_batches(cases)
    sizes = parse_curve_spec(args.curve, len(pool))
    print(f"\n學習曲線：歸納池={len(pool)}、held-out={len(heldout)}"
          f"（{heldout[0].as_of}~{heldout[-1].as_of}）｜檔位 {sizes}")

    curve_dir = out_dir / "curve"
    curve_dir.mkdir(parents=True, exist_ok=True)
    points = []
    for n in sizes:
        sub = pool[-n:]  # 取時間上最靠近 held-out 的 n 筆
        print(f"\n{'='*60}\n檔位 n_train={n}（{sub[0].as_of}~{sub[-1].as_of}）")
        versions, rounds_log = run_iterations(
            client, model_name, args, stock_id, sub, heldout,
            eval_cache, eval_cache_path, curve_dir,
            tag_prefix=f"curve{n}", n_induction_cases=args.induction_cases,
            write_versions=False)
        best = max(rounds_log, key=lambda e: (e["heldout_h20"] or -1, e["heldout_h5"] or -1, -e["k"]))
        au = best["always_up_h20_heldout"]
        points.append({
            "n_train": n, "best_k": best["k"],
            "heldout_h20": best["heldout_h20"], "heldout_h5": best["heldout_h5"],
            "always_up_h20": au,
            "delta_vs_always_up": (round(best["heldout_h20"] - au, 4)
                                   if best["heldout_h20"] is not None and au is not None else None),
            "rounds": rounds_log,
        })
        # 每個檔位跑完就落地，中斷不致全毀
        (curve_dir / f"best_n{n}.json").write_text(
            json.dumps(versions[best["k"]], ensure_ascii=False, indent=2))
        (out_dir / "learning_curve.json").write_text(json.dumps({
            "stock": stock_id, "period": args.period,
            "train_start": args.train_start, "train_end": args.train_end,
            "pool_n": len(pool), "held_out_n": len(heldout),
            "heldout_range": [heldout[0].as_of, heldout[-1].as_of],
            "always_up_h20": always_up_rate(heldout, 20),
            "always_up_h5": always_up_rate(heldout, 5),
            "induction_cases_per_round": args.induction_cases,
            "embargo": HORIZON_MAX, "model": model_name, "rounds": args.rounds,
            "points": points,
        }, ensure_ascii=False, indent=2))
        print(f"  ✅ n={n}：held-out h20={best['heldout_h20']}（always_up={au}）")

    print(f"\n{'='*60}\n學習曲線完成：{out_dir / 'learning_curve.json'}")
    for p in points:
        print(f"  n={p['n_train']:>4}｜h20={p['heldout_h20']}｜"
              f"相對 always_up {p['delta_vs_always_up']:+}")
    return out_dir


def main():
    ap = argparse.ArgumentParser(description="訓練階段：LLM 歸納預測方法論 + 精修 prompt")
    ap.add_argument("--stock", default="2330")
    ap.add_argument("--train-start", default="2024-01-01")
    ap.add_argument("--train-end", default="2024-12-31")
    ap.add_argument("--provider", choices=["nim", "h200"], default="h200")
    ap.add_argument("--period", choices=["week", "day"], default="week",
                    help="錨點頻率；day 會啟用時間連續切分 + embargo")
    ap.add_argument("--window-days", type=int, default=14, help="PIT 新聞回溯天數")
    ap.add_argument("--rounds", type=int, default=3, help="修正輪數（round 0 歸納後再修 N 輪）")
    ap.add_argument("--limit", type=int, default=None, help="只用前 N 個錨點（dry-run）")
    ap.add_argument("--rebuild-cases", action="store_true", help="重新建 cases（重打 Qdrant）")
    ap.add_argument("--induction-cases", type=int, default=40,
                    help="每輪送進歸納 prompt 的案例數（分層抽樣，受 context 長度限制）")
    ap.add_argument("--build-cases-only", action="store_true",
                    help="只建 cases 就結束（不呼叫 LLM）")
    ap.add_argument("--curve", default=None,
                    help='學習曲線檔位，如 "50,150,300,all"；給定時跑曲線模式')
    ap.add_argument("--out-dir", default=None)
    args = ap.parse_args()

    if args.build_cases_only:
        _stock, out_dir, _c, _m, cases = _setup(args, need_llm=False)
        print(f"✅ cases 建置完成：{len(cases)} 筆 → {out_dir / 'cases.jsonl'}")
        return
    if args.curve:
        run_learning_curve(args)
    else:
        train(args)


if __name__ == "__main__":
    main()
