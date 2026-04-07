from decimal import Decimal, ROUND_HALF_UP
from datetime import date
from typing import Dict, List, Set, Tuple

from sqlalchemy import desc
from sqlalchemy.orm import Session

from models.daily_price import DailyPrice
from models.simulated_order import SimulatedOrder
from schemas.simulated_order import SimulatedOrderCreate


def calculate_estimated_amount(order: SimulatedOrderCreate, reference_price: Decimal) -> int:
    unit_price = order.price if order.order_type == "limit" else reference_price
    amount = (unit_price * Decimal(order.quantity) * Decimal(1000)).quantize(
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
        order_type=order.order_type,
        limit_price=order.price if order.order_type == "limit" else None,
        trade_date=order.trade_date or date.today(),
        quantity=order.quantity,
        sell_plan=order.sell_plan,
        planned_sell_date=order.planned_sell_date if order.sell_plan == "by_date" else None,
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

    buckets: Dict[str, dict] = {}
    priced_orders = 0
    unpriced_orders = 0

    for order in orders:
        latest_close = latest_close_map.get(order.symbol)
        if latest_close is None:
            unpriced_orders += 1
            continue

        priced_orders += 1
        qty_lot = Decimal(order.quantity) * Decimal(1000)
        cost_amount = Decimal(order.estimated_amount)
        market_amount = (latest_close * qty_lot).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        profit_amount = market_amount - cost_amount if order.side == "buy" else cost_amount - market_amount
        # Group by stock symbol directly instead of heuristic industry buckets.
        category = order.symbol

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
