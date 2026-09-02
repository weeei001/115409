"""
模擬下單引擎：讓 LLM 在一整年的每個交易日做一次買/賣/持有決定
====================================================
沿用 backtest_digest_eval.py 的資料層（context_B、load_price_frame、fetch_recent_digests）
與 digest_core.py 的新聞 PIT 檢索（fetch_pit_articles），只換掉「輸出格式」——
不再是連續漲跌幅預測，而是 LLM 直接輸出可執行的交易指令（action + shares），
在本金限制下逐日模擬，最終看總報酬而非方向命中率。

範圍：只做 B 組（疊加4週摘要）+ v1 版 prompt（無 CoT），只測 2330、2024全年。
digest摘要沿用現有週頻資料（不補建日頻），新聞面逐日即時呼叫 fetch_pit_articles 更新。

用法：
    QDRANT_HOST=localhost python simulate_trading.py --stock 2330 \
        --start 2024-01-01 --end 2024-12-31 --provider h200

    # dry-run（只跑前5個交易日）
    python simulate_trading.py --stock 2330 --start 2024-01-01 --end 2024-12-31 --limit 5
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from dataclasses import dataclass, field, asdict
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv

from backtest_digest_eval import (
    fetch_recent_digests, context_B, load_price_frame, actual_from_rows,
)
from digest_core import (
    STOCK_NAMES, make_h200_client, DIGEST_EXTRA_BODY,
    fetch_prices, compute_technical,
)

# 2026-08-25 nvidia/nv-embedqa-e5-v5 已下架（NIM端 410 Gone），fetch_pit_articles() 的語意檢索
# 目前完全打不通，全專案共6個檔案受影響（見計畫檔記錄）。本腳本暫時繞過：新聞面改用
# fetch_recent_digests() 抓到的最新一週 digest 快照裡的 news_json（與 context_A/B 同樣做法），
# 放棄「新聞逐日即時更新」的原始設計，退化為與摘要面同步的週頻快照，待替代 embedding 模型
# 確認後再改回逐日即時檢索。

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

    def apply_trade(self, action: str, amount: float, sell_pct: float, price: float) -> dict:
        """執行一筆交易，回傳這筆交易的落地紀錄（含是否被截斷）。

        LLM 只負責「判斷」：買進給想投入的金額 amount（元）、賣出給想賣的持股比例 sell_pct（0~1）。
        股數換算交給程式（LLM 做算術不可靠）：
          - 買進：shares = floor(min(amount, cash) / (price × (1+FEE_RATE)))，零頭留在現金
          - 賣出：shares = round(持股 × sell_pct)
        amount 超過現金即視為梭哈（全部現金買進），不另設單日投入上限。
        """
        amount = max(0.0, float(amount or 0))
        sell_pct = min(1.0, max(0.0, float(sell_pct or 0)))
        clamped = False
        actual_shares = 0
        cash_flow = 0.0

        if action == "buy" and amount > 0:
            if amount > self.cash:
                amount = self.cash
                clamped = True   # 想投入的金額 > 現金餘額 → 以全部現金買進（梭哈，視為正常情況）
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

        elif action == "sell" and sell_pct > 0:
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
            "executed_action": action,
            "requested_amount": round(amount, 2),   # LLM 想投入的金額（買進）
            "requested_sell_pct": sell_pct,          # LLM 想賣出的持股比例（賣出）
            "executed_shares": actual_shares,
            "clamped": clamped,
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


def build_daily_context(stock_id: str, as_of: str, recent_digests: list[dict],
                          portfolio: PortfolioState, current_price: float) -> str:
    """組裝當日完整 context：新聞（digest快照，embedding模型下架期間的繞過方案）
    + 週頻摘要疊加（沿用 context_B 邏輯）+ 當日技術面 + 持倉狀態。"""
    closes = fetch_prices(stock_id, as_of, lookback_days=60)
    tech_desc = _price_trend_desc_from_closes(closes)

    news_block = _news_block_from_digest_snapshot(as_of, recent_digests)

    base = f"## 近期價格趨勢\n{tech_desc}\n\n{news_block}"

    # 沿用 context_B 的「近4週趨勢脈絡」邏輯：把 base 包成 context_A 期待的 rec 形狀較繁瑣，
    # 這裡直接複刻同樣的濃縮格式，避免動 backtest_digest_eval.py。
    digest_block = _trend_digest_block(as_of, recent_digests)

    portfolio_block = (
        f"## 目前持倉狀態\n"
        f"現金餘額：{portfolio.cash:,.0f} 元\n"
        f"持股數：{portfolio.shares} 股\n"
        f"持股平均成本：{portfolio.avg_cost:,.2f} 元／股（若持股為0則無意義）\n"
        f"今日參考價（前一交易日收盤）：{current_price:,.2f} 元\n"
        f"買進時將額外計手續費 {FEE_RATE*100:.4f}%；賣出時額外計手續費 {FEE_RATE*100:.4f}% "
        f"+ 證交稅 {TAX_RATE*100:.2f}%。\n"
        f"你只需決定買進金額或賣出比例，股數由系統依當日價格換算（整股，零頭留在現金）；"
        f"買進金額超過現金餘額時視為全部現金投入。"
    )

    return f"{base}\n\n{digest_block}\n\n{portfolio_block}"


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


# ---------------- v1 風格 prompt：輸出交易指令 ----------------

def predict_trade_action(client, model_name: str, stock_id: str, as_of: str,
                          context_block: str, provider: str) -> dict | None:
    """呼叫 LLM 決定今日交易動作。失敗重試1次，仍失敗回 None。"""
    name = STOCK_NAMES.get(stock_id, stock_id)
    prompt = f"""你是台股交易員，正在管理一個實際帳戶。根據以下截至 {as_of} 的資訊，決定今天要對
{name}（{stock_id}）採取的動作：買進(buy)、賣出(sell)、或不動作(hold)。
只能用下方資訊，不得引入 {as_of} 之後才知道的事。

{context_block}

請根據你的判斷決定動作與規模。你不需要自己換算股數，系統會依當日價格換算成整股：
- 若判斷應買進：action="buy"，amount 為你想投入的金額（新台幣元，整數）。可以全部投入。
- 若判斷應賣出：action="sell"，sell_pct 為你想賣出的持股比例（0~1 的小數，1 代表全部賣出）
- 若判斷應觀望：action="hold"，amount 與 sell_pct 皆填 0

請只輸出 JSON，不要其他文字：
{{"action": "buy"|"sell"|"hold", "amount": 整數, "sell_pct": 小數, "reason": "決策理由，1-2句"}}"""

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
        amount = float(parsed.get("amount", 0) or 0)
        sell_pct = float(parsed.get("sell_pct", 0) or 0)
        # LLM 有時把比例寫成百分比（50 而非 0.5），或把賣出量寫在 shares：容錯處理
        if sell_pct > 1:
            sell_pct = sell_pct / 100.0
        sell_pct = min(1.0, max(0.0, sell_pct))
        return {
            "action": action,
            "amount": max(0.0, amount),
            "sell_pct": sell_pct,
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
    return client, "meta/llama-3.3-70b-instruct"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stock", default="2330")
    # 2026-09：e5-v5 embedding 下架後，僅 2025-01 以後的新聞/digest 有重新向量化，
    # 因此回測範圍改為 2025-01-01 起至今（見 CLAUDE.md「規劃中:架構拆分」與計畫檔）。
    ap.add_argument("--start", default="2025-01-01")
    ap.add_argument("--end", default="2026-09-03")
    ap.add_argument("--initial-cash", type=float, default=1_000_000.0)
    ap.add_argument("--provider", choices=["nim", "h200"], default="h200")
    ap.add_argument("--limit", type=int, default=None, help="只跑前 N 個交易日（dry-run用）")
    ap.add_argument("--out-dir", default=None)
    args = ap.parse_args()

    if args.provider == "h200":
        client, model_name = make_h200_client()
        if client is None:
            print("❌ H200 未設定")
            return
    else:
        client, model_name = make_nim_client()
        if client is None:
            print("❌ NIM 未設定")
            return

    # 逐日交易日序列：借用 load_price_frame 拿到的 (date, close) 排序列表，horizon 參數在此無意義填0
    price_rows = load_price_frame(args.stock, args.start, args.end, horizon=0)
    trading_days = [d for d, _ in price_rows if args.start <= d <= args.end]
    if args.limit:
        trading_days = trading_days[: args.limit]

    out_dir = Path(args.out_dir) if args.out_dir else (
        Path(__file__).parent / "backtest_results"
        / f"{args.stock}_simulate_{args.start}_{args.end}_B_v1"
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_path = out_dir / "predictions_cache.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}

    portfolio = PortfolioState(cash=args.initial_cash)
    price_by_date = dict(price_rows)

    print(f"模擬下單：{args.stock}｜{args.start}~{args.end}｜{len(trading_days)}個交易日｜"
          f"起始本金 {args.initial_cash:,.0f}｜provider={args.provider}｜模型 {model_name}")

    records = []
    for i, as_of in enumerate(trading_days):
        price = price_by_date[as_of]
        recent_digests = fetch_recent_digests(args.stock, as_of, "week", n=4)

        # sim_v2：prompt 由「LLM 出股數」改為「LLM 出金額/賣出比例、程式換算股數」，舊快取不可用
        cache_key = f"{args.stock}|{as_of}|B|v1|sim_v2|{model_name}"
        if cache_key in cache:
            decision = cache[cache_key]
        else:
            ctx = build_daily_context(args.stock, as_of, recent_digests, portfolio, price)
            decision = predict_trade_action(client, model_name, args.stock, as_of, ctx, args.provider)
            cache[cache_key] = decision
            cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2))
            time.sleep(0.5 if args.provider == "h200" else 1.6)

        if decision is None:
            records.append({"date": as_of, "action": "hold",
                             "requested_amount": 0.0, "requested_sell_pct": 0.0,
                             "executed_shares": 0, "clamped": False, "cost": 0.0, "price": price,
                             "cash_after": round(portfolio.cash, 2), "shares_after": portfolio.shares,
                             "portfolio_value": round(portfolio.portfolio_value(price), 2),
                             "reason": "決策失敗，跳過"})
            continue

        result = portfolio.apply_trade(
            decision["action"], decision.get("amount", 0), decision.get("sell_pct", 0), price
        )
        pv = portfolio.portfolio_value(price)
        records.append({
            "date": as_of, "action": result["executed_action"],
            "requested_amount": result["requested_amount"],
            "requested_sell_pct": result["requested_sell_pct"],
            "executed_shares": result["executed_shares"],
            "clamped": result["clamped"], "cost": result["cost"], "price": price,
            "cash_after": round(portfolio.cash, 2), "shares_after": portfolio.shares,
            "portfolio_value": round(pv, 2), "reason": decision.get("reason", ""),
        })
        tag = f"{'💰梭哈 ' if result['clamped'] else ''}{result['executed_action']}"
        print(f"  [{as_of}] price={price:.1f} {tag} {result['executed_shares']}股 | "
              f"cash={portfolio.cash:,.0f} shares={portfolio.shares} pv={pv:,.0f}")

    # ---- 落地 trades.csv ----
    import csv
    csv_path = out_dir / "trades.csv"
    fieldnames = ["date", "action", "requested_amount", "requested_sell_pct", "executed_shares",
                  "clamped", "cost", "price", "cash_after", "shares_after", "portfolio_value", "reason"]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(records)

    # ---- 績效指標 ----
    if not records:
        print("無交易紀錄")
        return
    final_pv = records[-1]["portfolio_value"]
    total_return = (final_pv - args.initial_cash) / args.initial_cash
    n_days = len(records)
    annualized = (1 + total_return) ** (252 / n_days) - 1 if n_days > 0 else 0.0

    pv_series = [args.initial_cash] + [r["portfolio_value"] for r in records]
    peak = pv_series[0]
    max_dd = 0.0
    for v in pv_series:
        peak = max(peak, v)
        dd = (peak - v) / peak if peak > 0 else 0
        max_dd = max(max_dd, dd)

    # buy-and-hold 基準：起始現金全數（扣手續費）買進，持有到最後一天
    first_price = records[0]["price"]
    bh_shares = int(args.initial_cash / (first_price * (1 + FEE_RATE)))
    bh_cash_left = args.initial_cash - bh_shares * first_price * (1 + FEE_RATE)
    bh_final_value = bh_cash_left + bh_shares * records[-1]["price"]
    bh_return = (bh_final_value - args.initial_cash) / args.initial_cash

    metrics = {
        "config": {
            "stock": args.stock, "start": args.start, "end": args.end,
            "initial_cash": args.initial_cash, "provider": args.provider, "model": model_name,
            "arm": "B", "prompt_version": "v2_amount",
            "fee_rate": FEE_RATE, "tax_rate": TAX_RATE,
            "note": "新聞與digest摘要皆為週頻快照（本自然週內每日相同）——原設計是新聞逐日即時PIT檢索，"
                    "但embedding模型nvidia/nv-embedqa-e5-v5已於2026-08-25下架導致無法即時檢索，"
                    "暫時繞過改用最新一週digest快照的news_json；交易單位為任意股數（非強制1000股一張），"
                    "此為簡化假設。"
                    "decision輸入：LLM只輸出買進金額(amount)或賣出比例(sell_pct)，股數由程式依當日收盤價換算"
                    "（LLM做算術不可靠），零頭留在現金；amount超過現金餘額時以全部現金買進。"
                    "前視偏誤(已知，未修正)：LLM看到的收盤序列與成交價都用as_of當天收盤價，"
                    "等於「看到當天收盤才決定當天以收盤價買賣」，嚴謹作法應為T日決策、T+1開盤成交。",
        },
        "performance": {
            "n_trading_days": n_days,
            "initial_cash": args.initial_cash,
            "final_portfolio_value": round(final_pv, 2),
            "total_return_pct": round(total_return * 100, 2),
            "annualized_return_pct": round(annualized * 100, 2),
            "max_drawdown_pct": round(max_dd * 100, 2),
            "trade_count": portfolio.trade_count,
            "win_count": portfolio.win_count,
            "win_rate_pct": round(portfolio.win_count / portfolio.trade_count * 100, 2) if portfolio.trade_count else None,
            "realized_pnl": round(portfolio.realized_pnl, 2),
        },
        "baseline_buy_and_hold": {
            "shares": bh_shares,
            "final_value": round(bh_final_value, 2),
            "total_return_pct": round(bh_return * 100, 2),
        },
    }
    (out_dir / "simulation_metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2))

    print("\n" + "=" * 60)
    print(f"最終資產：{final_pv:,.0f} 元｜總報酬率：{total_return*100:+.2f}%｜年化：{annualized*100:+.2f}%")
    print(f"最大回撤：{max_dd*100:.2f}%｜交易次數：{portfolio.trade_count}｜勝率：{metrics['performance']['win_rate_pct']}%")
    print(f"buy-and-hold 基準：{bh_return*100:+.2f}%（{bh_shares}股）")
    print(f"\n輸出：{out_dir}")


if __name__ == "__main__":
    main()
