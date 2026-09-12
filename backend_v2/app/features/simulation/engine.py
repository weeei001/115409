"""Cash-only, whole-share simulation at the same day's closing price."""
from dataclasses import dataclass
from decimal import Decimal

FEE_RATE = Decimal("0.001425")
TAX_RATE = Decimal("0.003")


def rounded(value):
    return float(round(value, 2))


@dataclass
class Portfolio:
    cash: Decimal
    shares: int = 0
    avg_cost: Decimal = Decimal(0)
    realized_pnl: Decimal = Decimal(0)
    trade_count: int = 0
    sell_count: int = 0
    win_count: int = 0

    def apply(self, decision, price):
        action, shares, flow = decision.action, 0, Decimal(0)
        if action == "buy":
            shares = int(self.cash * Decimal(str(decision.buy_pct)) / (price * (1 + FEE_RATE)))
            if shares:
                flow = shares * price * (1 + FEE_RATE)
                self.avg_cost = (self.avg_cost * self.shares + flow) / (self.shares + shares)
                self.shares += shares
        elif action == "sell":
            shares = int(round(self.shares * Decimal(str(decision.sell_pct))))
            if shares:
                flow = -shares * price * (1 - FEE_RATE - TAX_RATE)
                pnl = -flow - shares * self.avg_cost
                self.realized_pnl += pnl
                self.sell_count += 1
                self.win_count += int(pnl > 0)
                self.shares -= shares
                if not self.shares:
                    self.avg_cost = Decimal(0)
        if shares:
            self.cash -= flow
            self.trade_count += 1
        else:
            action = "hold"
        cash = round(self.cash, 2)
        return {"action": action, "buy_pct": decision.buy_pct, "sell_pct": decision.sell_pct,
                "executed_shares": shares, "cost": rounded(flow), "close_price": rounded(price),
                "cash_after": float(cash), "shares_after": self.shares,
                "portfolio_value": rounded(cash + self.shares * price), "reason": decision.reason}


def compute_metrics(records, initial_cash, portfolio):
    initial = float(initial_cash)
    final = records[-1]["portfolio_value"]
    total_return = final / initial - 1
    peak, drawdown = initial, 0.0
    for row in records:
        value = row["portfolio_value"]
        peak = max(peak, value)
        drawdown = max(drawdown, (peak - value) / peak)
    first_price = Decimal(str(records[0]["close_price"]))
    bh_shares = int(initial_cash / (first_price * (1 + FEE_RATE)))
    bh_final = initial_cash - bh_shares * first_price * (1 + FEE_RATE) + bh_shares * Decimal(str(records[-1]["close_price"]))
    try:
        annualized = round(((1 + total_return) ** (252 / len(records)) - 1) * 100, 2)
    except OverflowError:
        annualized = None
    return {"n_trading_days": len(records), "initial_cash": initial,
            "final_portfolio_value": final, "total_return_pct": round(total_return * 100, 2),
            "annualized_return_pct": annualized, "max_drawdown_pct": round(drawdown * 100, 2),
            "trade_count": portfolio.trade_count, "sell_count": portfolio.sell_count,
            "win_count": portfolio.win_count,
            "win_rate_pct": round(portfolio.win_count / portfolio.sell_count * 100, 2) if portfolio.sell_count else None,
            "realized_pnl": rounded(portfolio.realized_pnl),
            "baseline_buy_and_hold": {"shares": bh_shares, "final_value": rounded(bh_final),
                                      "total_return_pct": round((float(bh_final) / initial - 1) * 100, 2)},
            "note": "Same-day close signals and fills introduce look-ahead bias. News uses weekly digest snapshots; "
                    "check digest_as_of_date for freshness. Confidence is a prompt-level risk preference, not a guarantee. "
                    "Win rate counts profitable sell executions / all sell executions. No slippage or dividends modeled."}
