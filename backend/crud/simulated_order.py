from decimal import Decimal, ROUND_HALF_UP
from datetime import date
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from crud import daily_price as crud_price
from models.daily_price import DailyPrice
from models.simulated_order import SimulatedOrder
from schemas.simulated_order import SimulatedOrderCreate


def calculate_estimated_amount(order: SimulatedOrderCreate, reference_price: Decimal) -> int:
    amount = (reference_price * Decimal(order.quantity) * Decimal(1000)).quantize(
        Decimal("1"), rounding=ROUND_HALF_UP
    )
    return int(amount)


def create_simulated_order(
    db: Session,
    order: SimulatedOrderCreate,
    estimated_amount: int,
) -> SimulatedOrder:
    db_order = SimulatedOrder(
        user_id=order.user_id,
        symbol=order.symbol,
        side=order.side,
        trade_date=order.trade_date or date.today(),
        quantity=order.quantity,
        sell_plan=order.sell_plan,
        planned_sell_date=(
            order.planned_sell_date if order.side == "buy" and order.sell_plan == "by_date" else None
        ),
        # Current behavior: simulated orders are treated as immediately filled.
        # Pending/partial-fill workflows can be introduced later if needed.
        status="filled",
        estimated_amount=estimated_amount,
    )
    db.add(db_order)
    db.commit()
    db.refresh(db_order)
    return db_order


def list_simulated_orders(db: Session, user_id: str, limit: int = 100) -> List[SimulatedOrder]:
    return (
        db.query(SimulatedOrder)
        .filter(SimulatedOrder.user_id == user_id)
        .order_by(desc(SimulatedOrder.created_at))
        .limit(limit)
        .all()
    )


def check_trade_chronology_for_create(
    db: Session,
    user_id: str,
    symbol: str,
    side: str,
    trade_date: date,
) -> Optional[str]:
    """
    同一使用者、同一標的：賣出日不得早於首筆買進日；
    買進後「首筆買進日」不得晚於既有最早賣出日（避免先有賣單、後補更早買單的矛盾）。
    通過則回傳 None，否則回傳錯誤說明字串。
    """
    mb_before = (
        db.query(func.min(SimulatedOrder.trade_date))
        .filter(
            SimulatedOrder.user_id == user_id,
            SimulatedOrder.symbol == symbol,
            SimulatedOrder.side == "buy",
        )
        .scalar()
    )
    ms = (
        db.query(func.min(SimulatedOrder.trade_date))
        .filter(
            SimulatedOrder.user_id == user_id,
            SimulatedOrder.symbol == symbol,
            SimulatedOrder.side == "sell",
        )
        .scalar()
    )

    if side == "sell":
        if mb_before is not None and trade_date < mb_before:
            return f"賣出日不可早於首筆買進日（{mb_before}）"
        return None

    # buy
    if ms is None:
        return None
    new_min_buy = trade_date if mb_before is None else min(mb_before, trade_date)
    if ms < new_min_buy:
        return (
            f"已有賣出委託日 {ms} 早於此筆買進後之首筆買進日（{new_min_buy}），"
            "無法建立更早日期之買進；請先調整或刪除相關賣單"
        )
    return None


def available_lots_for_symbol(
    db: Session, user_id: str, symbol: str, as_of: Optional[date] = None
) -> int:
    """
    目前可賣張數（後端統一推算）：
    - 買進 long_term：全數計入持倉
    - 買進 by_date：僅當 planned_sell_date >= as_of（預設今日）仍視為持有；已過預計賣出日則視為已賣出、不計入
    - 賣出：自持倉扣減
    """
    as_of = as_of or date.today()
    rows = (
        db.query(SimulatedOrder)
        .filter(SimulatedOrder.user_id == user_id, SimulatedOrder.symbol == symbol)
        .all()
    )
    buy_contrib = 0
    sell_sum = 0
    for o in rows:
        if o.side == "sell":
            sell_sum += o.quantity
            continue
        if o.sell_plan == "by_date" and o.planned_sell_date is not None:
            if o.planned_sell_date >= as_of:
                buy_contrib += o.quantity
        else:
            buy_contrib += o.quantity
    return max(0, buy_contrib - sell_sum)


class _FifoLot:
    """FIFO 庫存：一筆買進委託剩餘張數與成本。"""

    __slots__ = ("qty", "cost", "sell_plan", "planned_sell_date")

    def __init__(
        self,
        qty: int,
        cost: Decimal,
        sell_plan: Optional[str],
        planned_sell_date: Optional[date],
    ):
        self.qty = qty
        self.cost = cost
        self.sell_plan = sell_plan
        self.planned_sell_date = planned_sell_date


def _lot_valid_on_trade_date(lot: _FifoLot, d: date) -> bool:
    """與可賣張數一致：by_date 且預計賣出日早於當日則庫存已清空。"""
    if lot.sell_plan != "by_date" or lot.planned_sell_date is None:
        return True
    return lot.planned_sell_date >= d


def build_fifo_sell_cost_cache(db: Session, user_id: str) -> Dict[int, Decimal]:
    """
    依 symbol、trade_date、id 排序做 FIFO，為每筆賣單計算配對買進成本（實現損益分母）。
    """
    orders = (
        db.query(SimulatedOrder)
        .filter(SimulatedOrder.user_id == user_id)
        .order_by(SimulatedOrder.symbol, SimulatedOrder.trade_date, SimulatedOrder.id)
        .all()
    )
    lots_by_symbol: Dict[str, List[_FifoLot]] = {}
    out: Dict[int, Decimal] = {}

    for o in orders:
        sym = o.symbol
        if sym not in lots_by_symbol:
            lots_by_symbol[sym] = []
        lots = lots_by_symbol[sym]
        d = o.trade_date
        lots[:] = [lot for lot in lots if _lot_valid_on_trade_date(lot, d)]

        if o.side == "buy":
            lots.append(
                _FifoLot(
                    qty=o.quantity,
                    cost=Decimal(o.estimated_amount),
                    sell_plan=o.sell_plan,
                    planned_sell_date=o.planned_sell_date,
                )
            )
            continue

        need = o.quantity
        allocated = Decimal("0")
        while need > 0 and lots:
            front = lots[0]
            if not _lot_valid_on_trade_date(front, d):
                lots.pop(0)
                continue
            take = min(need, front.qty)
            part = (front.cost * Decimal(take) / Decimal(front.qty)).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
            allocated += part
            front.qty -= take
            front.cost -= part
            need -= take
            if front.qty == 0:
                lots.pop(0)

        if need == 0:
            out[o.id] = allocated

    return out


def markup_fields_for_order(
    db: Session,
    order: SimulatedOrder,
    fifo_sell_cost_cache: Optional[Dict[int, Decimal]] = None,
) -> dict:
    """
    列表用試算損益：
    - 買進 + long_term：以最新收盤價估值（與彙總邏輯一致）
    - 買進 + by_date：以「預計賣出日」當日（含以前最近交易日）收盤估值；若預計賣出日晚於今天則無法試算
    - 賣出：FIFO 配對買進成本，試算實現損益＝賣出金額−配對成本（依各筆 trade_date，不用最新價）
    """
    qty_lot = Decimal(order.quantity) * Decimal(1000)
    cost = Decimal(order.estimated_amount)

    def _rate(profit: Decimal, base: Decimal) -> float:
        if base <= 0:
            return 0.0
        return float((profit / base * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

    empty = {
        "markup_basis": None,
        "reference_date": None,
        "reference_close": None,
        "markup_amount": None,
        "markup_rate": None,
    }

    if order.side == "sell":
        cache = fifo_sell_cost_cache
        if cache is None:
            cache = build_fifo_sell_cost_cache(db, order.user_id)
        allocated = cache.get(order.id)
        if allocated is None or allocated <= 0:
            return empty
        proceeds = Decimal(order.estimated_amount)
        profit = proceeds - allocated
        sell_px = (proceeds / qty_lot).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return {
            "markup_basis": "fifo_realized",
            "reference_date": order.trade_date,
            "reference_close": float(sell_px),
            "markup_amount": int(profit.quantize(Decimal("1"), rounding=ROUND_HALF_UP)),
            "markup_rate": _rate(profit, allocated),
        }

    if order.sell_plan == "by_date" and order.planned_sell_date is not None:
        if order.planned_sell_date > date.today():
            return {
                **empty,
                "markup_basis": "planned_sell",
            }
        row = crud_price.get_latest_price_on_or_before(db, order.symbol, order.planned_sell_date)
        if row is None or row.close is None:
            return {**empty, "markup_basis": "planned_sell"}
        close = Decimal(row.close)
        market = (close * qty_lot).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        profit = market - cost
        return {
            "markup_basis": "planned_sell",
            "reference_date": row.date,
            "reference_close": float(close),
            "markup_amount": int(profit),
            "markup_rate": _rate(profit, cost),
        }

    latest = crud_price.get_latest_price(db, order.symbol)
    if latest is None or latest.close is None:
        return empty
    close = Decimal(latest.close)
    market = (close * qty_lot).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    profit = market - cost
    return {
        "markup_basis": "latest",
        "reference_date": latest.date,
        "reference_close": float(close),
        "markup_amount": int(profit),
        "markup_rate": _rate(profit, cost),
    }


def _get_latest_close_map(db: Session, symbols: Set[str]) -> Dict[str, Decimal]:
    latest_map: Dict[str, Decimal] = {}
    for symbol in symbols:
        row = (
            db.query(DailyPrice.close)
            .filter(
                DailyPrice.symbol == symbol,
                DailyPrice.close.isnot(None),
            )
            .order_by(desc(DailyPrice.date))
            .first()
        )
        if row and row[0] is not None:
            latest_map[symbol] = Decimal(row[0])
    return latest_map


def summarize_profit_by_category(
    db: Session, user_id: str
) -> Tuple[int, int, int, List[dict]]:
    orders = (
        db.query(SimulatedOrder)
        .filter(SimulatedOrder.user_id == user_id)
        .order_by(desc(SimulatedOrder.created_at))
        .all()
    )
    total_orders = len(orders)
    if total_orders == 0:
        return 0, 0, 0, []

    symbols = {order.symbol for order in orders}
    latest_close_map = _get_latest_close_map(db=db, symbols=symbols)
    fifo_sell_costs = build_fifo_sell_cost_cache(db, user_id)

    buckets: Dict[str, dict] = {}
    priced_orders = 0
    unpriced_orders = 0

    for order in orders:
        category = order.symbol

        if order.side == "sell":
            acost = fifo_sell_costs.get(order.id)
            if acost is None:
                unpriced_orders += 1
                continue
            priced_orders += 1
            proceeds = Decimal(order.estimated_amount)
            profit_amount = proceeds - acost
            cost_amount = acost
            market_amount = proceeds
        else:
            latest_close = latest_close_map.get(order.symbol)
            if latest_close is None:
                unpriced_orders += 1
                continue
            priced_orders += 1
            qty_lot = Decimal(order.quantity) * Decimal(1000)
            cost_amount = Decimal(order.estimated_amount)
            market_amount = (latest_close * qty_lot).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            profit_amount = market_amount - cost_amount

        bucket = buckets.get(category)
        if bucket is None:
            bucket = {
                "category": category,
                "order_count": 0,
                "symbols_set": set(),
                "cost_amount": Decimal("0"),
                "market_amount": Decimal("0"),
                "profit_amount": Decimal("0"),
            }
            buckets[category] = bucket

        bucket["order_count"] += 1
        bucket["symbols_set"].add(order.symbol)
        bucket["cost_amount"] += cost_amount
        bucket["market_amount"] += market_amount
        bucket["profit_amount"] += profit_amount

    result: List[dict] = []
    for bucket in buckets.values():
        cost = bucket["cost_amount"]
        profit = bucket["profit_amount"]
        profit_rate = (profit / cost * Decimal("100")) if cost > 0 else Decimal("0")
        result.append(
            {
                "category": bucket["category"],
                "order_count": bucket["order_count"],
                "symbols": sorted(bucket["symbols_set"]),
                "cost_amount": int(cost),
                "market_amount": int(bucket["market_amount"]),
                "profit_amount": int(profit),
                "profit_rate": float(profit_rate.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
            }
        )

    result.sort(key=lambda item: item["profit_amount"], reverse=True)
    return total_orders, priced_orders, unpriced_orders, result
