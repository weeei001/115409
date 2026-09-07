"""
準確度對照實驗：疊加多週 digest 有沒有提升方向命中率
==============================================
對每個決策點（as_of），用同一個 LLM 預測「未來 N 個交易日漲跌幅」，兩種輸入：
  A（完整新聞版）：≤as_of 當週 digest 紀錄裡 news_json 的完整新聞內容 ＋技術面
  B（新聞+摘要疊加版）：同一批完整新聞內容 ＋ 額外疊加最近 4 週（含當週）的 analysis_digests 週摘要 ＋技術面
B 是 A 的超集，測的是「多給一份消化過的多週摘要有沒有幫助」，而非「有沒有給內容」。

再用 yfinance 抓「as_of 之後 N 個交易日的實際漲跌」當標準答案，
以「方向命中率」（含中性帶）比較 A、B 哪個準，並輸出 decisions.csv / metrics.json / predictions_cache.json。

用法：
    QDRANT_HOST=localhost python backtest_digest_eval.py --stock 2330 --period week \
        --start 2024-01-01 --end 2024-12-31 --horizon 20 --neutral-band 3.0 --provider nim

    # dry-run（先驗證輸出格式，不打滿量 LLM）
    python backtest_digest_eval.py --stock 2330 --start 2024-01-01 --end 2024-12-31 --limit 2
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv

import digest_store
from digest_core import STOCK_NAMES, make_h200_client, DIGEST_EXTRA_BODY

load_dotenv()


def make_nim_client():
    from openai import OpenAI
    api_key = os.environ.get("NVIDIA_API_KEY", "")
    if not api_key:
        return None, None
    client = OpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=api_key, timeout=60.0)
    # 2026-09：meta/llama chat 模型在 NIM 全 EOL，改用還在架上的 gemma-4-31b-it
    return client, os.environ.get("NIM_MODEL", "google/gemma-4-31b-it")


def list_digests(stock_id: str, period: str, start: str, end: str) -> list[dict]:
    conn = digest_store._get_conn()
    with conn.cursor() as c:
        c.execute(
            "SELECT stock_id, as_of_date, period, news_json, technical_json, digest_json "
            "FROM analysis_digests WHERE stock_id=%s AND period=%s AND as_of_date BETWEEN %s AND %s "
            "ORDER BY as_of_date",
            (stock_id, period, start, end),
        )
        rows = c.fetchall()
    conn.close()
    def _load(v):
        return json.loads(v) if isinstance(v, str) else v
    for r in rows:
        r["as_of_date"] = r["as_of_date"].isoformat() if hasattr(r["as_of_date"], "isoformat") else str(r["as_of_date"])
        r["news_json"] = _load(r["news_json"]) or []
        r["technical_json"] = _load(r["technical_json"]) or {}
        r["digest_json"] = _load(r["digest_json"]) or {}
    return rows


def fetch_recent_digests(stock_id: str, as_of: str, period: str = "week", n: int = 4) -> list[dict]:
    """取 as_of_date <= as_of（含當週）最近 n 筆同 period 的 digest，按時間升冪排序回傳（PIT：不含未來資料）。"""
    conn = digest_store._get_conn()
    with conn.cursor() as c:
        c.execute(
            """
            SELECT stock_id, as_of_date, period, news_json, technical_json, digest_json
            FROM analysis_digests
            WHERE stock_id=%s AND period=%s AND as_of_date <= %s
            ORDER BY as_of_date DESC LIMIT %s
            """,
            (stock_id, period, as_of[:10], n),
        )
        rows = list(c.fetchall())  # pymysql 查無資料時回傳空 tuple，list() 統一成可變 list
    conn.close()
    def _load(v):
        return json.loads(v) if isinstance(v, str) else v
    for r in rows:
        r["as_of_date"] = r["as_of_date"].isoformat() if hasattr(r["as_of_date"], "isoformat") else str(r["as_of_date"])
        r["news_json"] = _load(r["news_json"]) or []
        r["technical_json"] = _load(r["technical_json"]) or {}
        r["digest_json"] = _load(r["digest_json"]) or {}
    rows.reverse()  # 升冪：t-3 ... t
    return rows


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


def context_A(rec: dict) -> str:
    as_of = rec["as_of_date"]
    news_block = _news_full_text_block(rec["news_json"], as_of)
    return f"## 近期價格趨勢\n{price_trend_desc(rec['technical_json'])}\n\n## 近期新聞（完整內文）\n{news_block}"


def context_B(rec: dict, recent_digests: list[dict]) -> str:
    """B組：A組 + 疊加4週摘要，但改為「趨勢延續天數」濃縮格式（v2 修正）。

    v1（逐週全文貼上technical_read/news_summary/overall/key_points）在 2024-07-05 這類
    連續多週單邊行情的案例中，會讓模型看到4週份「持續看多」的重複文字，反而加重動能延續偏見、
    蓋掉CoT該做的均值回歸判斷（見 backtest_results 交叉驗證：B組完全沒吃到CoT的+3.9pt改善）。
    v2 只萃取每週 overall 的方向關鍵詞，濃縮成一行「連續N週同方向」的結構化訊號，
    讓疊加的資訊服務於「這段趨勢是否已經延續過久」的判斷，而非重複灌輸單邊敘事。
    """
    as_of = rec["as_of_date"]
    base = context_A(rec)
    valid = [d for d in recent_digests if d["as_of_date"] <= as_of]  # 防洩漏雙保險
    if not valid:
        return f"{base}\n\n## 近4週趨勢脈絡\n（無可用歷史摘要）"

    def _direction(overall: str) -> str:
        bullish_kw = ("創新高", "動能強勁", "看多", "強勁", "買超", "多頭", "上漲", "走揚")
        bearish_kw = ("下跌", "賣超", "轉弱", "空頭", "回檔", "跌破", "疲弱")
        b_score = sum(1 for k in bullish_kw if k in overall)
        s_score = sum(1 for k in bearish_kw if k in overall)
        if b_score > s_score:
            return "偏多"
        if s_score > b_score:
            return "偏空"
        return "中性"

    dirs = [_direction(d["digest_json"].get("overall", "")) for d in valid]
    n = len(dirs)
    same_as_latest = 0
    for d in reversed(dirs):
        if d == dirs[-1]:
            same_as_latest += 1
        else:
            break
    trend_note = (
        f"近 {n} 週研判方向序列（由舊到新）：{' → '.join(dirs)}。"
        f"最新方向「{dirs[-1]}」已連續 {same_as_latest} 週未變。"
        f"提醒：連續同向不必然代表即將反轉——研究顯示強趨勢中的「超買」訊號約 7 成機率仍是延續、"
        f"約 3 成機率反轉，動能策略在盤整期會失準、均值回歸策略在強趨勢中也會失準，"
        f"兩種解讀都有可能，須綜合下方技術面數據（斜率是否仍一致、乖離幅度）與新聞面基本面訊號強度判斷，"
        f"不要僅因為連續同向就預設會回檔。"
    )
    latest_overall = valid[-1]["digest_json"].get("overall", "")
    digest_block = f"{trend_note}\n\n最新一週（{valid[-1]['as_of_date']}）綜合研判原文：{latest_overall}"
    return f"{base}\n\n## 近4週趨勢脈絡（已消化，服務於動能/均值回歸判斷）\n{digest_block}"


# 離散區間錨點（參考 FinGPT U1-U5+/D1-D5+ 設計）：只當作 prompt 裡的推理輔助刻度，
# 不改變輸出介面，模型仍輸出連續數字，避免牽動 classify()/decisions.csv 的 schema。
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


# ---- 預測 prompt：template 化，讓「學到的 prompt」能替換現行 prompt，但輸出契約不變 ----
DEFAULT_PROMPT_VERSION = "A_v2"
PROMPT_PLACEHOLDERS = ("as_of", "name", "stock_id", "horizon", "context_block", "magnitude_buckets")
PROMPT_REQUIRED_PLACEHOLDERS = ("as_of", "name", "stock_id", "horizon", "context_block")
PROMPT_OUTPUT_KEYS = ("market_regime", "technical_reasoning", "news_reasoning", "change_pct")

# 現行（A_v2）prompt。設計依 2026-08 對照公開研究（FinGPT/FinCoT）診斷出的三項修正，v2 之後再依技術分析
# 業界文獻（ADX 趨勢強度分層、RSI 超買訊號約7成延續3成反轉的實證、momentum-vs-mean-reversion
# 的適用場域區分）修正過度武斷的均值回歸假設：
# 1. CoT：要求先分別輸出技術面、新聞面的推理文字，再給結論，避免模型跳過推理直接猜安全值。
# 2. 市場狀態優先：先判斷「強趨勢」或「盤整」，再決定套用動能延續還是均值回歸邏輯——
#    不預設連續同向就該反轉（v1修正版曾犯這個錯，實測讓B組在2024多頭年系統性誤判偏空/持平，
#    71.4%的疊加樣本被判flat，遠高於實際flat佔比28.8%）。強趨勢中的「超買」較常是趨勢確認
#    訊號而非反轉訊號，但仍承認約3成機率會反轉，不下武斷結論。
# 3. 離散區間錨點：在推理階段提供區間刻度輔助定位幅度，降低模型收斂到單一「安全值」的傾向；
#    最終輸出仍是連續數字，不改變下游 schema。
# 注意：這是「純字串 template」而非 f-string，大括號不需跳脫；只有 PROMPT_PLACEHOLDERS 列出的
# 佔位符會被 _format_safe 替換，其餘大括號（含結尾的 JSON 範例）原樣保留。
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


def parse_prediction_json(raw: str) -> dict:
    """從 LLM 回應抽出預測 JSON：去 <think>、取第一個 {...}、驗證 change_pct 可轉 float。
    回傳 parsed dict（change_pct 已轉 float）。任何一步失敗都拋例外，由呼叫端決定重試。"""
    raw = re.sub(r"<think>.*?</think>\s*", "", (raw or "").strip(), flags=re.DOTALL)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        raise ValueError(f"no JSON in response: {raw[:200]}")
    parsed = json.loads(m.group())
    if "change_pct" not in parsed or parsed["change_pct"] is None:
        raise ValueError(f"missing change_pct: {str(parsed)[:200]}")
    parsed["change_pct"] = float(parsed["change_pct"])
    return parsed


def predict_change_pct(client, model_name: str, stock_id: str, as_of: str, horizon: int,
                        context_block: str, provider: str,
                        prompt_template: str | None = None) -> float | None:
    """呼叫 LLM 預測未來 horizon 交易日的總漲跌幅（%）。失敗重試 1 次，仍失敗回 None。

    prompt_template=None 時沿用現行 A_v2 prompt（DEFAULT_PROMPT_TEMPLATE）；
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
            print(f"      ⚠️ 預測失敗（第 {attempt+1} 次）：{e}")
            if attempt == 0:
                time.sleep(2.0)
    return None


def actual_change_pct(stock_id: str, as_of: str, horizon: int):
    """用 yfinance 算 as_of → 之後第 horizon 個交易日的實際漲跌幅（%）。資料不足回 None。"""
    import yfinance as yf
    start = (date.fromisoformat(as_of) - timedelta(days=7)).strftime("%Y-%m-%d")
    end = (date.fromisoformat(as_of) + timedelta(days=horizon * 2 + 15)).strftime("%Y-%m-%d")
    df = yf.Ticker(f"{stock_id}.TW").history(start=start, end=end, interval="1d")
    if df is None or df.empty:
        return None
    rows = [(str(idx.date()), round(float(r["Close"]), 2)) for idx, r in df.iterrows()]
    return actual_from_rows(rows, as_of, horizon)


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


def load_price_frame(stock_id: str, start: str, end: str, horizon: int):
    """單次 yfinance 呼叫，回傳 (date_str, close) 排序列表，供逐錨點呼叫 actual_from_rows。"""
    import yfinance as yf
    fetch_start = (date.fromisoformat(start) - timedelta(days=7)).strftime("%Y-%m-%d")
    fetch_end = (date.fromisoformat(end) + timedelta(days=horizon * 2 + 15)).strftime("%Y-%m-%d")
    df = yf.Ticker(f"{stock_id}.TW").history(start=fetch_start, end=fetch_end, interval="1d")
    if df is None or df.empty:
        return []
    return [(str(idx.date()), round(float(r["Close"]), 2)) for idx, r in df.iterrows()]


def classify(pct: float, band: float) -> str:
    if abs(pct) < band:
        return "flat"
    return "up" if pct > 0 else "down"


def _cache_key(stock_id: str, as_of: str, arm: str, horizon: int, model_name: str) -> str:
    return f"{stock_id}|{as_of}|{arm}|{horizon}|{model_name}"


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

    verdict 區塊實作已拍板的「雙條件方向制」：對照臂要同時滿足
      cond1：命中率 − always_up > 0（有比無腦猜漲好）
      cond2：McNemar 成對比較中 對照臂勝次數 ≥ 1.5 × 基準臂勝次數（比現行 prompt 好，不是運氣）
    不要求 p<0.05（52 樣本幾乎達不到），p 值照報。
    """
    base_arm, cmp_arm = arm_names
    valid_pairs = [d for d in decisions if d["arm"] == base_arm and d["skipped_reason"] is None]
    valid_as_of = {d["as_of"] for d in valid_pairs}
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
        "passed": bool(cond1 and cond2),
        "note": (f"cond1：{cmp_arm} 命中率 − always_up > 0；cond2：{cmp_arm} 勝 ≥ 1.5×{base_arm} 勝。"
                 "不要求 p<0.05（樣本數不足以達到），p 值僅供參考。"),
    }

    metrics = {
        "config": dict(config or {}, neutral_band=band, seed=seed),
        "arms": by_arm,
        "baselines": baselines,
        "relative_to_always_up": relative,
        "mcnemar_sign_test": {"b_wins": cmp_wins, "a_wins": base_wins, "p_value": mcnemar_p,
                              "cmp_arm": cmp_arm, "base_arm": base_arm,
                              "note": f"雙尾符號檢定；b_wins={cmp_arm} 勝、a_wins={base_arm} 勝；p<0.05 表示配對命中差異顯著"},
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stock", default="2330")
    ap.add_argument("--period", choices=["week", "month"], default="week")
    ap.add_argument("--start", default="2024-01-01")
    ap.add_argument("--end", default="2024-12-31")
    ap.add_argument("--horizon", type=int, default=20, help="預測未來幾個交易日")
    ap.add_argument("--neutral-band", type=float, default=None,
                     help="中性帶（±%）。未指定時 h20 用 3.0、其餘用 1.0")
    ap.add_argument("--provider", choices=["nim", "h200"], default="nim")
    ap.add_argument("--limit", type=int, default=None, help="只跑前 N 個錨點（dry-run 用）")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    band = args.neutral_band if args.neutral_band is not None else (3.0 if args.horizon == 20 else 1.0)

    recs = list_digests(args.stock, args.period, args.start, args.end)
    if not recs:
        print("查無 digest，請先跑 build_analysis_digests.py")
        sys.exit(1)
    if args.limit:
        recs = recs[: args.limit]

    if args.provider == "nim":
        client, model_name = make_nim_client()
        if client is None:
            print("❌ NIM 未設定（.env 需 NVIDIA_API_KEY）")
            sys.exit(1)
    else:
        client, model_name = make_h200_client()
        if client is None:
            print("❌ H200 未設定（.env 需 H200_BASE_URL/H200_API_KEY）")
            sys.exit(1)

    out_dir = Path(args.out_dir) if args.out_dir else Path(__file__).parent / "backtest_results" / \
        f"{args.stock}_{args.period}_{args.start}_{args.end}_h{args.horizon}"
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_path = out_dir / "predictions_cache.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}

    print(f"對照實驗：{args.stock} {args.period} {args.start}~{args.end}｜horizon={args.horizon} 交易日｜"
          f"中性帶 ±{band}%｜provider={args.provider}｜模型 {model_name}")
    print(f"決策點數：{len(recs)}（含 limit）\n")

    price_rows = load_price_frame(args.stock, args.start, args.end, args.horizon)

    decisions = []
    llm_calls = 0
    for rec in recs:
        as_of = rec["as_of_date"]
        act = actual_from_rows(price_rows, as_of, args.horizon)
        if act is None:
            print(f"  [{as_of}] 略過（未來股價不足）")
            continue
        cact = classify(act, band)

        recent_digests = fetch_recent_digests(args.stock, as_of, args.period, n=4)
        ctx_a = context_A(rec)
        ctx_b = context_B(rec, recent_digests)
        n_digests_used = len(recent_digests)
        n_news = len(rec["news_json"])

        arm_results = {}
        for arm, ctx in (("A", ctx_a), ("B", ctx_b)):
            key = _cache_key(args.stock, as_of, arm, args.horizon, model_name)
            if key in cache:
                pred = cache[key]
            else:
                pred = predict_change_pct(client, model_name, args.stock, as_of, args.horizon, ctx, args.provider)
                cache[key] = pred
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2))
                llm_calls += 1
                time.sleep(1.6)  # NIM 40rpm 節流
            arm_results[arm] = pred

        skipped_reason = None
        if arm_results["A"] is None or arm_results["B"] is None:
            skipped_reason = "llm_failed"

        for arm in ("A", "B"):
            pred = arm_results[arm]
            if skipped_reason:
                decisions.append({
                    "as_of": as_of, "arm": arm, "model": model_name,
                    "predicted_pct": pred, "predicted_dir": None,
                    "actual_pct": act, "actual_dir": cact, "hit": None, "abs_err": None,
                    "n_news": n_news, "n_digests_used": n_digests_used,
                    "skipped_reason": skipped_reason,
                })
                continue
            cpred = classify(pred, band)
            hit = cpred == cact
            decisions.append({
                "as_of": as_of, "arm": arm, "model": model_name,
                "predicted_pct": pred, "predicted_dir": cpred,
                "actual_pct": act, "actual_dir": cact, "hit": hit, "abs_err": round(abs(pred - act), 2),
                "n_news": n_news, "n_digests_used": n_digests_used,
                "skipped_reason": None,
            })

        if skipped_reason:
            print(f"  [{as_of}] 略過統計（{skipped_reason}）｜A={arm_results['A']}｜B={arm_results['B']}")
        else:
            pa, pb = arm_results["A"], arm_results["B"]
            ca, cb = classify(pa, band), classify(pb, band)
            print(f"  [{as_of}] 實際{act:+.2f}%({cact})｜A {pa:+.2f}%({ca}){'✅' if ca==cact else '❌'}｜"
                  f"B {pb:+.2f}%({cb}){'✅' if cb==cact else '❌'}｜digests={n_digests_used}")

    # ---- 落地 decisions.csv ----
    import csv
    csv_path = out_dir / "decisions.csv"
    fieldnames = ["as_of", "arm", "model", "predicted_pct", "predicted_dir", "actual_pct",
                  "actual_dir", "hit", "abs_err", "n_news", "n_digests_used", "skipped_reason"]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(decisions)

    # ---- 計算 metrics（與 backtest_learned_prompt.py 共用同一套統計）----
    metrics = compute_metrics(
        decisions, arm_names=("A", "B"), band=band, seed=args.seed,
        config={"stock": args.stock, "period": args.period, "start": args.start, "end": args.end,
                "horizon": args.horizon, "provider": args.provider, "model": model_name},
        n_decision_points=len(recs),
    )
    metrics_path = out_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2))

    by_arm, baselines, mc = metrics["arms"], metrics["baselines"], metrics["mcnemar_sign_test"]
    print("\n" + "=" * 60)
    print(f"有效決策點：{metrics['coverage']['n_valid_as_of']}｜LLM 呼叫次數（本次新打）：{llm_calls}")
    print(f"A（完整新聞）    方向命中率：{by_arm['A']['hit_rate']}｜MAE：{by_arm['A']['mae']}")
    print(f"B（新聞+疊加摘要）方向命中率：{by_arm['B']['hit_rate']}｜MAE：{by_arm['B']['mae']}")
    print(f"always_up 基準線：{baselines['always_up']['hit_rate']}")
    print(f"McNemar 符號檢定：B勝{mc['b_wins']} / A勝{mc['a_wins']}，p={mc['p_value']}")
    print(f"\n輸出：{out_dir}")


if __name__ == "__main__":
    main()
