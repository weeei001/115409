from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models.simulated_order import SimulatedOrder
from app.features.orders import repository
from app.features.orders.schemas import SimulatedOrderCreate, SimulatedOrderResponse


def calculate_estimated_amount(order: SimulatedOrderCreate, reference_price: Decimal) -> int:
    return int((reference_price * Decimal(order.quantity) * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def check_trade_chronology(records: list[SimulatedOrder], side: str, trade_date: date) -> str | None:
    first_buy = min((order.trade_date for order in records if order.side == "buy"), default=None)
    first_sell = min((order.trade_date for order in records if order.side == "sell"), default=None)
    if side == "sell":
        if first_buy is not None and trade_date < first_buy:
            return f"賣出日不可早於首筆買進日（{first_buy}）"
    elif first_sell is not None:
        new_first_buy = min(first_buy, trade_date) if first_buy else trade_date
        if first_sell < new_first_buy:
            return (f"已有賣出委託日 {first_sell} 早於此筆買進後之首筆買進日（{new_first_buy}），"
                    "無法建立更早日期之買進；請先調整或刪除相關賣單")
    return None


def available_lots(records: list[SimulatedOrder], as_of: date | None = None) -> int:
    as_of = as_of or date.today()
    bought = sum(order.quantity for order in records if order.side == "buy" and (
        order.sell_plan != "by_date" or order.planned_sell_date is None or order.planned_sell_date >= as_of
    ))
    sold = sum(order.quantity for order in records if order.side == "sell")
    return max(0, bought - sold)


@dataclass
class _Lot:
    quantity: int
    cost: Decimal
    expires: date | None


def fifo_sell_costs(records: list[SimulatedOrder]) -> dict[int, Decimal]:
    lots_by_symbol = defaultdict(deque)
    result = {}
    for order in sorted(records, key=lambda order: (order.symbol, order.trade_date, order.id)):
        # ponytail: per-symbol linear expiry scan; add an expiry index if account histories make it costly.
        lots = deque(lot for lot in lots_by_symbol[order.symbol] if lot.expires is None or lot.expires >= order.trade_date)
        lots_by_symbol[order.symbol] = lots
        if order.side == "buy":
            lots.append(_Lot(order.quantity, Decimal(order.estimated_amount),
                             order.planned_sell_date if order.sell_plan == "by_date" else None))
            continue
        needed, allocated = order.quantity, Decimal("0")
        while needed and lots:
            lot = lots[0]
            taken = min(needed, lot.quantity)
            part = (lot.cost * Decimal(taken) / Decimal(lot.quantity)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            allocated += part
            lot.quantity -= taken
            lot.cost -= part
            needed -= taken
            if not lot.quantity:
                lots.popleft()
        if needed == 0:
            result[order.id] = allocated
    return result


def _rate(profit: Decimal, cost: Decimal) -> float:
    return float((profit / cost * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)) if cost > 0 else 0.0


def markup_fields(order: SimulatedOrder, fifo: dict, latest: dict, planned: dict) -> dict:
    empty = dict(markup_basis=None, reference_date=None, reference_close=None, markup_amount=None, markup_rate=None)
    cost = Decimal(order.estimated_amount)
    shares = Decimal(order.quantity) * 1000
    if order.side == "sell":
        allocated = fifo.get(order.id)
        if allocated is None or allocated <= 0:
            return empty
        profit = cost - allocated
        return dict(
            markup_basis="fifo_realized", reference_date=order.trade_date,
            reference_close=float((cost / shares).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
            markup_amount=int(profit.quantize(Decimal("1"), rounding=ROUND_HALF_UP)),
            markup_rate=_rate(profit, allocated),
        )
    if order.sell_plan == "by_date" and order.planned_sell_date is not None:
        empty["markup_basis"] = "planned_sell"
        if order.planned_sell_date > date.today():
            return empty
        row = planned.get((order.symbol, order.planned_sell_date))
        basis = "planned_sell"
    else:
        row = latest.get(order.symbol)
        basis = "latest"
    if row is None or row.close is None:
        return empty
    close = Decimal(row.close)
    profit = (close * shares).quantize(Decimal("1"), rounding=ROUND_HALF_UP) - cost
    return dict(markup_basis=basis, reference_date=row.date, reference_close=float(close),
                markup_amount=int(profit), markup_rate=_rate(profit, cost))


def _serialize(order: SimulatedOrder, fifo: dict, latest: dict, planned: dict) -> SimulatedOrderResponse:
    return SimulatedOrderResponse(
        id=f"ORD-{order.id:06d}", user_id=order.user_id, symbol=order.symbol, side=order.side,
        trade_date=order.trade_date, quantity=order.quantity, sell_plan=order.sell_plan,
        planned_sell_date=order.planned_sell_date, status=order.status,
        estimated_amount=order.estimated_amount, created_at=order.created_at,
        **markup_fields(order, fifo, latest, planned),
    )


def create_order(db: Session, payload: SimulatedOrderCreate) -> SimulatedOrderResponse:
    trade_date = payload.trade_date or date.today()
    price = repository.trade_price(db, payload.symbol, trade_date)
    if price is None or price.close is None:
        raise AppError(f"找不到股票 {payload.symbol} 在 {trade_date} 的日線資料，請改選交易日", status_code=404)
    records = repository.orders(db, payload.user_id, lock=True)
    same_symbol = [order for order in records if order.symbol == payload.symbol]
    chronology_error = check_trade_chronology(same_symbol, payload.side, trade_date)
    if chronology_error:
        raise AppError(chronology_error, status_code=400)
    if payload.side == "sell":
        available = available_lots(same_symbol)
        if payload.quantity > available:
            raise AppError(f"持股不足：此標的目前可賣 {available} 張，無法賣出 {payload.quantity} 張", status_code=400)
    created = SimulatedOrder(
        **payload.model_dump(exclude={"trade_date"}), trade_date=trade_date, status="filled",
        estimated_amount=calculate_estimated_amount(payload, Decimal(price.close)),
    )
    try:
        db.add(created)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    db.refresh(created)
    fifo = fifo_sell_costs(records + [created])
    latest, planned = repository.valuation_prices(db, [created])
    return _serialize(created, fifo, latest, planned)


def list_orders(db: Session, user_id: str, limit: int):
    user_id = user_id.strip()
    records = repository.orders(db, user_id)
    visible = records[:limit]
    fifo = fifo_sell_costs(records)
    latest, planned = repository.valuation_prices(db, visible)
    return {"user_id": user_id, "total": len(visible), "data": [_serialize(order, fifo, latest, planned) for order in visible]}


def get_available_lots(db: Session, user_id: str, symbol: str):
    user_id, symbol = user_id.strip(), symbol.strip().upper()
    if not symbol:
        raise AppError("symbol 不可為空", status_code=400)
    return dict(user_id=user_id, symbol=symbol, available_lots=available_lots(repository.orders(db, user_id, symbol)))


def profit_by_category(db: Session, user_id: str):
    user_id = user_id.strip()
    records = repository.orders(db, user_id)
    latest, planned = repository.valuation_prices(db, records, non_null_latest=True)
    fifo = fifo_sell_costs(records)
    buckets, priced = {}, 0
    for order in records:
        if order.side == "sell":
            cost = fifo.get(order.id)
            if cost is None:
                continue
            market = Decimal(order.estimated_amount)
        else:
            if order.sell_plan == "by_date" and order.planned_sell_date is not None and order.planned_sell_date <= date.today():
                row = planned.get((order.symbol, order.planned_sell_date))
            else:
                row = latest.get(order.symbol)
            if row is None or row.close is None:
                continue
            cost = Decimal(order.estimated_amount)
            market = Decimal(calculate_estimated_amount(order, Decimal(row.close)))
        priced += 1
        bucket = buckets.setdefault(order.symbol, dict(
            category=order.symbol, order_count=0, symbols=[order.symbol],
            cost_amount=0, market_amount=0, profit_amount=0,
        ))
        bucket["order_count"] += 1
        bucket["cost_amount"] += int(cost)
        bucket["market_amount"] += int(market)
        bucket["profit_amount"] += int(market - cost)
    for bucket in buckets.values():
        bucket["profit_rate"] = _rate(Decimal(bucket["profit_amount"]), Decimal(bucket["cost_amount"]))
    return dict(user_id=user_id, total_orders=len(records), priced_orders=priced,
                unpriced_orders=len(records) - priced,
                data=sorted(buckets.values(), key=lambda bucket: bucket["profit_amount"], reverse=True))
