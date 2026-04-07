from decimal import Decimal
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from crud import daily_price as crud_price
from crud import simulated_order as crud_order
from database import get_db
from models.simulated_order import SimulatedOrder
from schemas.simulated_order import (
    SimulatedOrderCategoryProfitResponse,
    SimulatedOrderCreate,
    SimulatedOrderListResponse,
    SimulatedOrderResponse,
)

router = APIRouter(prefix="/simulated-orders", tags=["模擬下單"])


def _format_order_id(order_id: int) -> str:
    return f"ORD-{order_id:06d}"


def _serialize_order(order: SimulatedOrder) -> SimulatedOrderResponse:
    return SimulatedOrderResponse(
        id=_format_order_id(order.id),
        user_id=order.user_id,
        symbol=order.symbol,
        side=order.side,
        order_type=order.order_type,
        price=order.limit_price,
        trade_date=order.trade_date,
        quantity=order.quantity,
        sell_plan=order.sell_plan,
        planned_sell_date=order.planned_sell_date,
        status=order.status,
        estimated_amount=order.estimated_amount,
        created_at=order.created_at,
    )


@router.post(
    "/",
    response_model=SimulatedOrderResponse,
    summary="建立模擬委託",
)
def create_simulated_order(payload: SimulatedOrderCreate, db: Session = Depends(get_db)):
    trade_date = payload.trade_date or date.today()
    trade_day_price = crud_price.get_daily_price(
        db=db,
        symbol=payload.symbol,
        date=trade_date,
    )
    if trade_day_price is None or trade_day_price.close is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"找不到股票 {payload.symbol} 在 {trade_date} 的日線資料，請改選交易日",
        )

    estimated_amount = crud_order.calculate_estimated_amount(
        order=payload,
        reference_price=Decimal(trade_day_price.close),
    )
    created = crud_order.create_simulated_order(
        db=db,
        order=payload,
        estimated_amount=estimated_amount,
    )
    return _serialize_order(created)


@router.get(
    "/",
    response_model=SimulatedOrderListResponse,
    summary="查詢模擬委託列表",
)
def get_simulated_orders(
    user_id: str = Query(..., min_length=1, max_length=128, description="使用者識別（前端匿名 user id）"),
    limit: int = Query(100, ge=1, le=200, description="查詢筆數上限"),
    db: Session = Depends(get_db),
):
    records = crud_order.list_simulated_orders(db=db, user_id=user_id.strip(), limit=limit)
    return {
        "user_id": user_id.strip(),
        "total": len(records),
        "data": [_serialize_order(order) for order in records],
    }


@router.get(
    "/profit-by-category",
    response_model=SimulatedOrderCategoryProfitResponse,
    summary="依股票代號彙總模擬收益",
)
def get_profit_by_category(
    user_id: str = Query(..., min_length=1, max_length=128, description="使用者識別（前端匿名 user id）"),
    db: Session = Depends(get_db),
):
    normalized_user_id = user_id.strip()
    total_orders, priced_orders, unpriced_orders, data = crud_order.summarize_profit_by_category(
        db=db, user_id=normalized_user_id
    )
    return {
        "user_id": normalized_user_id,
        "total_orders": total_orders,
        "priced_orders": priced_orders,
        "unpriced_orders": unpriced_orders,
        "data": data,
    }
