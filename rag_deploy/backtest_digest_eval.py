"""
準確度對照實驗：digest 有沒有提升方向命中率
==============================================
對每個決策點（as_of），用同一個 LLM 預測「未來 N 個交易日漲跌幅」，兩種輸入：
  A（baseline）：≤as_of 的「原始新聞標題」＋技術面
  B（digest）  ：同一批新聞消化成的「預建 digest」＋技術面
再用 yfinance 抓「as_of 之後 N 個交易日的實際漲跌」當標準答案，
以「方向命中率」（含中性帶）比較 A、B 哪個準。

A、B 用完全同一批新聞（都來自該 as_of 的 digest 紀錄），差別只在「有沒有先消化」。

用法：
    QDRANT_HOST=localhost python backtest_digest_eval.py --stock 2330 --period week \
        --start 2024-01-01 --end 2024-12-31 --horizon 5 --neutral-band 1.0
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta

from dotenv import load_dotenv

import digest_store
from digest_core import STOCK_NAMES, make_h200_client, DIGEST_EXTRA_BODY

load_dotenv()


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


def price_trend_desc(tech: dict) -> str:
    if not tech.get("available"):
        return "（無足夠股價資料）"
    return (f"近 {tech['n_days']} 個交易日收盤 {tech['first_close']} → {tech['last_close']} 元"
            f"（{tech['change_pct']:+.2f}%），迴歸斜率每日 {tech['slope_per_day']:+.3f} 元，MA20={tech['ma20']}。")


def predict_change_pct(client, model_name: str, stock_id: str, as_of: str, horizon: int,
                       context_block: str) -> float:
    """呼叫 LLM 預測未來 horizon 交易日的總漲跌幅（%）。回傳數字，失敗回 0.0。"""
    name = STOCK_NAMES.get(stock_id, stock_id)
    prompt = f"""你是台股分析師。根據以下截至 {as_of} 的資訊，預測 {name}（{stock_id}）未來 {horizon} 個交易日的「總漲跌幅」。
只能用下方資訊，不得引入 {as_of} 之後才知道的事。

{context_block}

請只輸出 JSON，不要其他文字：
{{"change_pct": 預估總漲跌幅數字（例如 2.5 代表漲 2.5%，-1.8 代表跌 1.8%）}}"""
    try:
        resp = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3, max_tokens=200, stream=False,
            extra_body=DIGEST_EXTRA_BODY,
        )
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"<think>.*?</think>\s*", "", raw, flags=re.DOTALL)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            return float(json.loads(m.group()).get("change_pct", 0.0))
    except Exception as e:
        print(f"      ⚠️ 預測失敗：{e}")
    return 0.0


def context_A(rec: dict) -> str:
    titles = "\n".join(f"- {n.get('title','')}" for n in rec["news_json"]) or "（無新聞）"
    return f"## 近期價格趨勢\n{price_trend_desc(rec['technical_json'])}\n\n## 近期新聞（標題）\n{titles}"


def context_B(rec: dict) -> str:
    d = rec["digest_json"]
    kp = "\n".join(f"- {k}" for k in d.get("key_points", []))
    return (f"## 近期價格趨勢\n{price_trend_desc(rec['technical_json'])}\n\n"
            f"## 專業分析總結（已消化）\n"
            f"新聞面：{d.get('news_summary','')}\n技術面：{d.get('technical_read','')}\n"
            f"綜合研判：{d.get('overall','')}\n重點：\n{kp}")


def actual_change_pct(stock_id: str, as_of: str, horizon: int):
    """用 yfinance 算 as_of → 之後第 horizon 個交易日的實際漲跌幅（%）。資料不足回 None。"""
    import yfinance as yf
    start = (date.fromisoformat(as_of) - timedelta(days=7)).strftime("%Y-%m-%d")
    end = (date.fromisoformat(as_of) + timedelta(days=horizon * 2 + 15)).strftime("%Y-%m-%d")
    df = yf.Ticker(f"{stock_id}.TW").history(start=start, end=end, interval="1d")
    if df is None or df.empty:
        return None
    rows = [(str(idx.date()), round(float(r["Close"]), 2)) for idx, r in df.iterrows()]
    # P0 = 最後一個 <= as_of 的交易日收盤
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stock", default="2330")
    ap.add_argument("--period", choices=["week", "month"], default="week")
    ap.add_argument("--start", default="2024-01-01")
    ap.add_argument("--end", default="2024-12-31")
    ap.add_argument("--horizon", type=int, default=5, help="預測未來幾個交易日")
    ap.add_argument("--neutral-band", type=float, default=1.0, help="中性帶（±%，此範圍內算持平）")
    args = ap.parse_args()

    recs = list_digests(args.stock, args.period, args.start, args.end)
    if not recs:
        print("查無 digest，請先跑 build_analysis_digests.py")
        sys.exit(1)

    client, model_name = make_h200_client()
    if client is None:
        print("❌ H200 未設定（.env 需 H200_BASE_URL/H200_API_KEY）")
        sys.exit(1)

    print(f"對照實驗：{args.stock} {args.period} {args.start}~{args.end}｜horizon={args.horizon} 交易日｜中性帶 ±{args.neutral_band}%｜模型 {model_name}")
    print(f"決策點數：{len(recs)}\n")

    rows_out = []
    hitA = hitB = valid = 0
    maeA = maeB = 0.0
    for rec in recs:
        as_of = rec["as_of_date"]
        act = actual_change_pct(args.stock, as_of, args.horizon)
        if act is None:
            print(f"  [{as_of}] 略過（未來股價不足）")
            continue
        pa = predict_change_pct(client, model_name, args.stock, as_of, args.horizon, context_A(rec))
        pb = predict_change_pct(client, model_name, args.stock, as_of, args.horizon, context_B(rec))
        ca, cb, cact = classify(pa, args.neutral_band), classify(pb, args.neutral_band), classify(act, args.neutral_band)
        ha, hb = (ca == cact), (cb == cact)
        valid += 1
        hitA += ha; hitB += hb
        maeA += abs(pa - act); maeB += abs(pb - act)
        rows_out.append((as_of, act, cact, pa, ca, ha, pb, cb, hb))
        print(f"  [{as_of}] 實際{act:+.2f}%({cact})｜A {pa:+.2f}%({ca}){'✅' if ha else '❌'}｜B {pb:+.2f}%({cb}){'✅' if hb else '❌'}")

    if valid == 0:
        print("無有效決策點"); sys.exit(1)
    print("\n" + "=" * 60)
    print(f"有效決策點：{valid}")
    print(f"A（原始新聞）  方向命中率：{hitA}/{valid} = {hitA/valid*100:.1f}%｜幅度 MAE：{maeA/valid:.2f}%")
    print(f"B（digest）    方向命中率：{hitB}/{valid} = {hitB/valid*100:.1f}%｜幅度 MAE：{maeB/valid:.2f}%")
    diff = (hitB - hitA) / valid * 100
    print(f"→ B 相對 A：方向命中率 {diff:+.1f} 個百分點")


if __name__ == "__main__":
    main()
