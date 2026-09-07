"""
模擬下單引擎：讓 LLM 在每個交易日做一次買/賣/持有決定
====================================================
單次即時模擬（v3）：simulate_trading_stream() 是一個 generator，逐日呼叫 LLM，
每算完一天就 yield 一則結果，供 API 層轉成 SSE 事件即時推給前端。

放棄過的設計（v2，見 git 歷史/計畫檔）：曾嘗試「決策層預跑一次＋帳務層任意參數重演」
的兩層分離，靠 LLM 只輸出「比例」讓決策與初始資金脫鉤、可快取重演。但前端後來加了
「信心程度」(confidence, 1-10) 輸入，且要求直接寫進 prompt 讓 LLM 現場調整風格——
這使決策不再能脫鉤（換一個信心分數＝換一次完整的 LLM 決策序列），兩層分離失去意義，
故改回單次逐日模擬，僅在 (symbol, start, end, initial_cash, confidence) 五參數完全相同
時走結果快取（見 api_server.py 的 /api/simulate_trading_stream）。

比例制（buy_pct/sell_pct）本身保留：LLM 只負責「判斷」，用比例表達進出場規模，
不自己換算股數（LLM 做算術不可靠），股數由程式依當日收盤價換算，零頭留在現金。

沿用 backtest_digest_eval.py 的資料層（load_price_frame、fetch_recent_digests）
與 digest_core.py 的技術面（fetch_prices、compute_technical）。
新聞面：因 nvidia/nv-embedqa-e5-v5 已於 2026-08-25 下架，fetch_pit_articles() 打不通，
暫時改用最新一週 digest 快照的 news_json（週頻，本自然週內每日相同）。

用法：
    QDRANT_HOST=localhost python simulate_trading.py --stock 2330 \
        --start 2025-01-01 --end 2026-09-03 --initial-cash 1000000 --confidence 5 --provider h200

    # dry-run（只跑前5個交易日）
    python simulate_trading.py --stock 2330 --start 2025-01-01 --end 2026-09-03 --limit 5
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from backtest_digest_eval import (
    fetch_recent_digests, load_price_frame,
)
from digest_core import (
    STOCK_NAMES, make_h200_client, DIGEST_EXTRA_BODY,
    fetch_prices, compute_technical,
)

# 資料有效範圍：股價與 Qdrant 新聞向量檢索的可用下限。前端日期選擇器應鎖在此範圍內。
# 2026-09-02 换用新 embedding nvidia/nemotron-3-embed-1b 並補齊歷史向量後，
# 下界已回溯到 Qdrant 現有資料最早的 2023-05-14；上界為資料目前抓到的最新日期。
# 注意：analysis_digests 表目前只有到 2025-02-14 的資料（之後未再預建），
# fetch_recent_digests() 對更晚的 as_of 會持續拿到這份過時快照，是獨立於此範圍的
# 另一個資料新鮮度問題，需另外重跑 build_analysis_digests.py 補齊（見 bob 確認）。
DATA_START = "2023-05-14"
DATA_END = "2026-09-03"

# 2026-08-25 nvidia/nv-embedqa-e5-v5 已下架（NIM端 410 Gone），fetch_pit_articles() 的語意檢索
# 目前完全打不通（全專案共6個檔案受影響，見計畫檔）。本腳本暫時繞過：新聞面改用
# fetch_recent_digests() 抓到的最新一週 digest 快照裡的 news_json，退化為週頻快照
# （本自然週內每日相同），待替代 embedding 模型確認後再改回逐日即時檢索。

load_dotenv()

FEE_RATE = 0.001425      # 買賣手續費（台股實務費率，未打折）
TAX_RATE = 0.003         # 賣出證交稅


# ---------------- 持倉狀態 ----------------

@dataclass
class PortfolioState:
    cash: float
    shares: int = 0
    avg_cost: float = 0.0
    realized_pnl: float = 0.0
    trade_count: int = 0
    win_count: int = 0

    def apply_trade(self, action: str, buy_pct: float, sell_pct: float, price: float) -> dict:
        """執行一筆交易，回傳這筆交易的落地紀錄。

        LLM 只負責「判斷」，用比例表達規模（LLM 做算術不可靠，也不該綁定初始資金）：
          - 買進：buy_pct = 動用現金餘額的比例（0~1，1 代表全押）
                  amount = cash × buy_pct；shares = floor(amount / (price × (1+FEE_RATE)))，零頭留現金
          - 賣出：sell_pct = 賣出目前持股的比例（0~1，1 代表清倉）
                  shares = round(持股 × sell_pct)
        """
        buy_pct = min(1.0, max(0.0, float(buy_pct or 0)))
        sell_pct = min(1.0, max(0.0, float(sell_pct or 0)))
        actual_shares = 0
        cash_flow = 0.0

        if action == "buy" and buy_pct > 0:
            amount = self.cash * buy_pct
            actual_shares = int(amount / (price * (1 + FEE_RATE))) if price > 0 else 0
            if actual_shares > 0:
                cost = actual_shares * price
                fee = cost * FEE_RATE
                total_cost = cost + fee
                new_shares = self.shares + actual_shares
                # 加權平均成本（含手續費攤入成本）
                self.avg_cost = (
                    (self.avg_cost * self.shares + total_cost) / new_shares
                    if new_shares > 0 else 0.0
                )
                self.cash -= total_cost
                self.shares = new_shares
                self.trade_count += 1
                cash_flow = total_cost
            else:
                action = "hold"  # 現金不足，實際上無法買進

        elif action == "sell" and sell_pct > 0 and self.shares > 0:
            actual_shares = int(round(self.shares * sell_pct))
            if actual_shares > 0:
                proceeds = actual_shares * price
                fee = proceeds * FEE_RATE
                tax = proceeds * TAX_RATE
                net_proceeds = proceeds - fee - tax
                cost_basis = actual_shares * self.avg_cost
                pnl = net_proceeds - cost_basis
                self.realized_pnl += pnl
                self.cash += net_proceeds
                self.shares -= actual_shares
                self.trade_count += 1
                cash_flow = -net_proceeds
                if pnl > 0:
                    self.win_count += 1
                if self.shares == 0:
                    self.avg_cost = 0.0
            else:
                action = "hold"  # 沒有持股，實際上無法賣出
        else:
            action = "hold"
            actual_shares = 0

        return {
            "executed_action": action,      # buy/sell/hold（若 LLM 要買但現金不足換不到整股 → 降為 hold）
            "buy_pct": buy_pct,              # LLM 決定動用現金的比例
            "sell_pct": sell_pct,            # LLM 決定賣出持股的比例
            "executed_shares": actual_shares,
            # 當日現金流出（買進為正＝花費含手續費；賣出為負＝實收現金；hold 為 0）
            "cost": round(cash_flow, 2),
        }

    def portfolio_value(self, price: float) -> float:
        return self.cash + self.shares * price


# ---------------- 每日 context 組裝 ----------------

def _price_trend_desc_from_closes(closes: list[float]) -> str:
    if not closes:
        return "（無足夠股價資料）"
    tech = compute_technical(closes)
    if not tech.get("available"):
        return "（無足夠股價資料）"
    return (
        f"近 {tech['n_days']} 個交易日收盤 {tech['first_close']} → {tech['last_close']} 元"
        f"（{tech['change_pct']:+.2f}%），加權迴歸斜率每日 {tech['slope_per_day']:+.3f} 元，"
        f"MA20={tech['ma20']}（現價相對 MA20 {tech['vs_ma20_pct']:+.2f}%）。"
    )


def _news_block_from_digest_snapshot(as_of: str, recent_digests: list[dict]) -> str:
    """embedding模型下架期間的繞過方案：改用最新一週digest快照裡的news_json
    （與 context_A/context_B 同樣的資料來源），而非逐日即時PIT檢索。
    只取pub_time<=as_of的項目維持防洩漏。"""
    if not recent_digests:
        return "## 新聞\n（無可用新聞，尚無digest快照）"
    latest = recent_digests[-1]
    items = [n for n in latest.get("news_json", []) if str(n.get("pub_time", ""))[:10] <= as_of]
    if not items:
        return "## 新聞\n（無新聞，最新digest快照日期晚於或等於當日）"
    lines = []
    for n in items:
        content = (n.get("content", "") or n.get("page_content", "")).strip()
        lines.append(f"- [{str(n.get('pub_time',''))[:10]}] {n.get('title','')}｜{content}")
    return f"## 新聞（來自 {latest['as_of_date']} 週digest快照，非逐日即時更新）\n" + "\n".join(lines)


def _portfolio_block(portfolio: PortfolioState, current_price: float) -> str:
    """持倉狀態快照：寫絕對金額（不再需要與初始資金脫鉤——每次模擬只服務單一
    initial_cash，直接告訴 LLM 真實現金/持股，判斷更貼近實際帳戶情境）。"""
    if portfolio.shares > 0 and portfolio.avg_cost > 0:
        unrealized_pct = (current_price - portfolio.avg_cost) / portfolio.avg_cost * 100
        pos_line = (f"持股 {portfolio.shares} 股，平均成本 {portfolio.avg_cost:,.2f} 元／股，"
                    f"未實現損益 {unrealized_pct:+.1f}%")
    else:
        pos_line = "目前空手（無持股）"
    return (
        f"## 目前持倉狀態\n"
        f"現金餘額 {portfolio.cash:,.0f} 元。{pos_line}。\n"
        f"買進計手續費 {FEE_RATE*100:.4f}%；賣出計手續費 {FEE_RATE*100:.4f}% + 證交稅 {TAX_RATE*100:.2f}%。\n"
        f"你不需要換算股數，只需決定進出場的「比例」："
        f"buy_pct = 動用目前現金的幾成（0~1，1 為全押）、"
        f"sell_pct = 賣出目前持股的幾成（0~1，1 為清倉）。股數由系統依當日收盤價換算為整股。"
    )


def build_daily_context(stock_id: str, as_of: str, recent_digests: list[dict],
                          portfolio: PortfolioState, current_price: float,
                          confidence: int = 5) -> str:
    """組裝當日完整 context：新聞（digest快照，embedding模型下架期間的繞過方案）
    + 週頻摘要疊加（沿用 context_B 邏輯）+ 當日技術面 + 持倉狀態 + 風險偏好設定。"""
    closes = fetch_prices(stock_id, as_of, lookback_days=60)
    tech_desc = _price_trend_desc_from_closes(closes)

    news_block = _news_block_from_digest_snapshot(as_of, recent_digests)

    base = f"## 近期價格趨勢\n{tech_desc}\n\n{news_block}"

    # 沿用 context_B 的「近4週趨勢脈絡」邏輯：把 base 包成 context_A 期待的 rec 形狀較繁瑣，
    # 這裡直接複刻同樣的濃縮格式，避免動 backtest_digest_eval.py。
    digest_block = _trend_digest_block(as_of, recent_digests)

    portfolio_block = _portfolio_block(portfolio, current_price)
    style_block = _risk_style_block(confidence)

    return f"{base}\n\n{digest_block}\n\n{portfolio_block}\n\n{style_block}"


def _risk_style_block(confidence: int) -> str:
    """使用者設定的風險偏好（1~10 分），寫進 prompt 讓 LLM 現場調整保守/激進風格。"""
    confidence = min(10, max(1, int(confidence or 5)))
    return (
        f"## 你的風險偏好設定\n"
        f"目前設定為 {confidence}/10 分（1=非常保守、10=非常激進）。"
        f"分數越低，越傾向少動作、保留現金、只在訊號明確時小量進出場；"
        f"分數越高，越敢大比例動用現金或大比例出清持股、對趨勢訊號反應更積極。"
        f"請讓你的 buy_pct/sell_pct 幅度符合這個風險偏好。"
    )


def _trend_digest_block(as_of: str, recent_digests: list[dict]) -> str:
    """複刻 context_B 的「近4週趨勢脈絡」濃縮格式（v2設計），供每日模擬沿用同一套邏輯。"""
    valid = [d for d in recent_digests if d["as_of_date"] <= as_of]
    if not valid:
        return "## 近4週趨勢脈絡\n（無可用歷史摘要）"

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
    )
    latest_overall = valid[-1]["digest_json"].get("overall", "")
    return (
        f"## 近4週趨勢脈絡（週頻摘要，本自然週內每日皆相同）\n{trend_note}\n\n"
        f"最新一週（{valid[-1]['as_of_date']}）綜合研判原文：{latest_overall}"
    )


# ---------------- prompt：輸出交易指令（比例制） ----------------

def _norm_pct(v) -> float:
    """容錯：LLM 可能把比例寫成百分比（50 而非 0.5）。>1 視為百分比除以 100，夾在 [0,1]。"""
    try:
        x = float(v or 0)
    except (TypeError, ValueError):
        return 0.0
    if x > 1:
        x = x / 100.0
    return min(1.0, max(0.0, x))


def predict_trade_action(client, model_name: str, stock_id: str, as_of: str,
                          context_block: str, provider: str) -> dict | None:
    """呼叫 LLM 決定今日交易動作（用比例表達規模）。失敗重試1次，仍失敗回 None。"""
    name = STOCK_NAMES.get(stock_id, stock_id)
    prompt = f"""你是台股交易員，正在管理一個帳戶。根據以下截至 {as_of} 的資訊，決定今天要對
{name}（{stock_id}）採取的動作：買進(buy)、賣出(sell)、或不動作(hold)。
只能用下方資訊，不得引入 {as_of} 之後才知道的事。

{context_block}

請根據你的判斷決定動作與規模。你不需要換算股數，也不需要知道帳戶的絕對金額——只需給「比例」：
- 若判斷應買進：action="buy"，buy_pct 為要動用「目前現金」的比例（0~1 的小數，1 代表全押）
- 若判斷應賣出：action="sell"，sell_pct 為要賣出「目前持股」的比例（0~1 的小數，1 代表清倉）
- 若判斷應觀望：action="hold"，buy_pct 與 sell_pct 皆填 0

請只輸出 JSON，不要其他文字：
{{"action": "buy"|"sell"|"hold", "buy_pct": 小數, "sell_pct": 小數, "reason": "決策理由，1-2句"}}"""

    def _call():
        kwargs = dict(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3, max_tokens=250, stream=False,
        )
        if provider == "h200":
            kwargs["extra_body"] = DIGEST_EXTRA_BODY
        resp = client.chat.completions.create(**kwargs)
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"<think>.*?</think>\s*", "", raw, flags=re.DOTALL)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            raise ValueError(f"no JSON in response: {raw[:200]}")
        parsed = json.loads(m.group())
        action = parsed.get("action", "hold")
        if action not in ("buy", "sell", "hold"):
            action = "hold"
        return {
            "action": action,
            "buy_pct": _norm_pct(parsed.get("buy_pct", 0)),
            "sell_pct": _norm_pct(parsed.get("sell_pct", 0)),
            "reason": parsed.get("reason", ""),
        }

    for attempt in range(2):
        try:
            return _call()
        except Exception as e:
            print(f"      ⚠️ 決策失敗（第 {attempt+1} 次）：{e}")
            if attempt == 0:
                time.sleep(2.0)
    return None


# ---------------- 主流程 ----------------

def make_nim_client():
    from openai import OpenAI
    api_key = os.environ.get("NVIDIA_API_KEY", "")
    if not api_key:
        return None, None
    client = OpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=api_key, timeout=60.0)
    # 2026-09：meta/llama chat 模型在 NIM 全 EOL，改用還在架上的 gemma-4-31b-it
    return client, os.environ.get("NIM_MODEL", "google/gemma-4-31b-it")


# ---------------- 單次逐日模擬：generator，逐日 yield，供 CLI 或 API(SSE) 消費 ----------------

def simulate_trading_stream(stock_id: str, start: str, end: str, initial_cash: float,
                             confidence: int, provider: str, limit: int | None = None):
    """逐日呼叫 LLM 並模擬下單，每算完一天就 yield 一則事件。

    事件序列：
      {"type": "init", "stock_id", "n_trading_days", "initial_cash", "confidence", "model"}
      {"type": "day", "date", "action", "buy_pct", "sell_pct", "executed_shares", "cost",
       "price", "cash_after", "shares_after", "portfolio_value", "reason"} × N
      {"type": "done", "metrics": {...}, "records": [...]}
      {"type": "error", "message": "..."}（provider 未設定時，取代 init 直接結束）

    confidence（1~10，1=保守、10=激進）寫進 build_daily_context() 的風險偏好區塊，
    現場影響 LLM 的 buy_pct/sell_pct 幅度 → 決策與 confidence 綁定，無法脫鉤快取，
    故本函式在單一 initial_cash 下對整段區間跑一次「真實」模擬（非比例快照）。
    """
    if provider == "h200":
        client, model_name = make_h200_client()
    else:
        client, model_name = make_nim_client()
    if client is None:
        yield {"type": "error", "message": f"{provider} 未設定（.env 缺對應 API key）"}
        return

    price_rows = load_price_frame(stock_id, start, end, horizon=0)
    trading_days = [d for d, _ in price_rows if start <= d <= end]
    if limit:
        trading_days = trading_days[:limit]
    price_by_date = dict(price_rows)

    if not trading_days:
        yield {"type": "error", "message": f"{start}~{end} 區間內查無交易日（股價資料缺漏）"}
        return

    portfolio = PortfolioState(cash=initial_cash)
    yield {
        "type": "init", "stock_id": stock_id, "n_trading_days": len(trading_days),
        "initial_cash": initial_cash, "confidence": confidence,
        "provider": provider, "model": model_name,
    }

    records: list[dict] = []
    for as_of in trading_days:
        price = price_by_date[as_of]
        recent_digests = fetch_recent_digests(stock_id, as_of, "week", n=4)
        ctx = build_daily_context(stock_id, as_of, recent_digests, portfolio, price, confidence)
        decision = predict_trade_action(client, model_name, stock_id, as_of, ctx, provider)
        if decision is None:
            decision = {"action": "hold", "buy_pct": 0.0, "sell_pct": 0.0, "reason": "決策失敗，跳過"}

        result = portfolio.apply_trade(
            decision["action"], decision.get("buy_pct", 0), decision.get("sell_pct", 0), price
        )
        cash_after = round(portfolio.cash, 2)
        close_price = round(price, 2)
        record = {
            "date": as_of, "action": result["executed_action"],
            "buy_pct": result["buy_pct"], "sell_pct": result["sell_pct"],
            "executed_shares": result["executed_shares"], "cost": result["cost"],
            "price": close_price, "cash_after": cash_after, "shares_after": portfolio.shares,
            # 由已四捨五入的欄位算，確保 pv == cash_after + shares × price 對得上
            "portfolio_value": round(cash_after + portfolio.shares * close_price, 2),
            "reason": decision.get("reason", ""),
        }
        records.append(record)
        yield {"type": "day", **record}

        time.sleep(0.5 if provider == "h200" else 1.6)

    metrics = compute_metrics(records, initial_cash, portfolio)
    metrics["note"] = (
        "決策受使用者設定的風險偏好 confidence 影響，寫進 prompt 現場調整風格，"
        "非數學縮放。新聞面為最新一週 digest 快照的 news_json（e5-v5 embedding 下架的繞過方案，"
        "週頻，本自然週內每日相同）。前視偏誤（已知，未修正）：LLM 看到的收盤序列與成交價"
        "都用 as_of 當天收盤價。"
    )
    yield {"type": "done", "metrics": metrics, "records": records}


def compute_metrics(records: list[dict], initial_cash: float, portfolio: PortfolioState) -> dict:
    if not records:
        return {"error": "no trading days in range"}
    final_pv = records[-1]["portfolio_value"]
    total_return = (final_pv - initial_cash) / initial_cash if initial_cash else 0.0
    n_days = len(records)
    annualized = (1 + total_return) ** (252 / n_days) - 1 if n_days > 0 else 0.0

    pv_series = [initial_cash] + [r["portfolio_value"] for r in records]
    peak, max_dd = pv_series[0], 0.0
    for v in pv_series:
        peak = max(peak, v)
        max_dd = max(max_dd, (peak - v) / peak if peak > 0 else 0)

    # buy-and-hold 基準：第一個交易日以全部現金（扣手續費）買進，持有到最後一天
    first_price = records[0]["price"]
    bh_shares = int(initial_cash / (first_price * (1 + FEE_RATE))) if first_price > 0 else 0
    bh_cash_left = initial_cash - bh_shares * first_price * (1 + FEE_RATE)
    bh_final = bh_cash_left + bh_shares * records[-1]["price"]
    bh_return = (bh_final - initial_cash) / initial_cash if initial_cash else 0.0

    return {
        "n_trading_days": n_days,
        "initial_cash": initial_cash,
        "final_portfolio_value": round(final_pv, 2),
        "total_return_pct": round(total_return * 100, 2),
        "annualized_return_pct": round(annualized * 100, 2),
        "max_drawdown_pct": round(max_dd * 100, 2),
        "trade_count": portfolio.trade_count,
        "win_count": portfolio.win_count,
        "win_rate_pct": (round(portfolio.win_count / portfolio.trade_count * 100, 2)
                         if portfolio.trade_count else None),
        "realized_pnl": round(portfolio.realized_pnl, 2),
        "baseline_buy_and_hold": {
            "shares": bh_shares,
            "final_value": round(bh_final, 2),
            "total_return_pct": round(bh_return * 100, 2),
        },
    }


# ---------------- CLI：逐日消化 simulate_trading_stream()，落地 trades.csv 供人工檢視 ----------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stock", default="2330")
    ap.add_argument("--start", default=DATA_START)
    ap.add_argument("--end", default=DATA_END)
    ap.add_argument("--initial-cash", type=float, default=1_000_000.0)
    ap.add_argument("--confidence", type=int, default=5, help="風險偏好 1(保守)~10(激進)")
    ap.add_argument("--provider", choices=["nim", "h200"], default="h200")
    ap.add_argument("--limit", type=int, default=None, help="只跑前 N 個交易日（dry-run用）")
    args = ap.parse_args()

    records: list[dict] = []
    metrics: dict | None = None
    for event in simulate_trading_stream(
        args.stock, args.start, args.end, args.initial_cash, args.confidence, args.provider, args.limit
    ):
        if event["type"] == "error":
            print(f"❌ {event['message']}")
            return
        if event["type"] == "init":
            print(f"模擬下單：{args.stock}｜{args.start}~{args.end}｜{event['n_trading_days']}個交易日｜"
                  f"起始本金 {args.initial_cash:,.0f}｜信心程度 {args.confidence}/10｜"
                  f"provider={args.provider}｜模型 {event['model']}")
        elif event["type"] == "day":
            print(f"  [{event['date']}] price={event['price']:.1f} {event['action']} "
                  f"{event['executed_shares']}股 | cash={event['cash_after']:,.0f} "
                  f"shares={event['shares_after']} pv={event['portfolio_value']:,.0f}")
        elif event["type"] == "done":
            records = event["records"]
            metrics = event["metrics"]

    if not records or metrics is None:
        print("無交易紀錄")
        return

    out_dir = (Path(__file__).parent / "backtest_results"
               / f"{args.stock}_simulate_{args.start}_{args.end}_conf{args.confidence}_cash{int(args.initial_cash)}")
    out_dir.mkdir(parents=True, exist_ok=True)
    import csv
    fieldnames = ["date", "action", "buy_pct", "sell_pct", "executed_shares",
                  "cost", "price", "cash_after", "shares_after", "portfolio_value", "reason"]
    with (out_dir / "trades.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(records)
    (out_dir / "simulation_metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2))

    print("\n" + "=" * 60)
    print(f"最終資產：{metrics['final_portfolio_value']:,.0f} 元｜"
          f"總報酬率：{metrics['total_return_pct']:+.2f}%｜年化：{metrics['annualized_return_pct']:+.2f}%")
    print(f"最大回撤：{metrics['max_drawdown_pct']:.2f}%｜交易次數：{metrics['trade_count']}｜"
          f"勝率：{metrics['win_rate_pct']}%")
    print(f"buy-and-hold 基準：{metrics['baseline_buy_and_hold']['total_return_pct']:+.2f}%")
    print(f"\n輸出：{out_dir}")


if __name__ == "__main__":
    main()
