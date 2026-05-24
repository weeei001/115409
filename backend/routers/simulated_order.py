from decimal import Decimal
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Any, Dict, Optional

from crud import daily_price as crud_price
from crud import simulated_order as crud_order
from database import get_db
from models.simulated_order import SimulatedOrder
from schemas.simulated_order import (
    AvailableLotsResponse,
    SimulatedOrderCategoryProfitResponse,
    SimulatedOrderCreate,
    SimulatedOrderListResponse,
    SimulatedOrderResponse,
)

router = APIRouter(prefix="/simulated-orders", tags=["模擬下單"])


def _format_order_id(order_id: int) -> str:
    return f"ORD-{order_id:06d}"


def _serialize_order(
    db: Session,
    order: SimulatedOrder,
    fifo_sell_cost_cache: Optional[Dict[int, Any]] = None,
) -> SimulatedOrderResponse:
    markup: Dict[str, Any] = crud_order.markup_fields_for_order(
        db, order, fifo_sell_cost_cache=fifo_sell_cost_cache
    )
    return SimulatedOrderResponse(
        id=_format_order_id(order.id),
        user_id=order.user_id,
        symbol=order.symbol,
        side=order.side,
        trade_date=order.trade_date,
        quantity=order.quantity,
        sell_plan=order.sell_plan,
        planned_sell_date=order.planned_sell_date,
        status=order.status,
        estimated_amount=order.estimated_amount,
        created_at=order.created_at,
        **markup,
    )


@router.post(
    "/",
    response_model=SimulatedOrderResponse,
    summary="建立模擬委託",
    description=(
        "依指定交易日收盤價建立買進或賣出模擬委託。"
        "買進可選擇長期持有或指定預計賣出日；賣出會依使用者既有委託推算可賣張數，避免超賣。"
    ),
    responses={
        200: {"description": "模擬委託建立成功"},
        400: {"description": "委託時間順序錯誤、持股不足或欄位邏輯不合法"},
        404: {"description": "指定股票在交易日沒有日線資料"},
        422: {"description": "請求欄位格式驗證失敗"},
    },
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

    chrono = crud_order.check_trade_chronology_for_create(
        db, payload.user_id, payload.symbol, payload.side, trade_date
    )
    if chrono:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=chrono)

    if payload.side == "sell":
        available = crud_order.available_lots_for_symbol(db, payload.user_id, payload.symbol)
        if payload.quantity > available:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"持股不足：此標的目前可賣 {available} 張，無法賣出 {payload.quantity} 張",
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
    fifo_cache = crud_order.build_fifo_sell_cost_cache(db, created.user_id)
    return _serialize_order(db, created, fifo_sell_cost_cache=fifo_cache)


@router.get(
    "/available-lots",
    response_model=AvailableLotsResponse,
    summary="查詢可賣張數（依委託推算）",
    description=(
        "依指定使用者與股票代號，從既有買進/賣出委託推算目前可賣張數。"
        "`sell_plan=by_date` 且已過預計賣出日的買進單不計入持倉。"
    ),
    responses={
        200: {"description": "成功返回可賣張數"},
        400: {"description": "股票代號不可為空"},
        422: {"description": "查詢參數驗證失敗"},
    },
)
def get_available_lots(
    user_id: str = Query(..., min_length=1, max_length=128, description="使用者識別"),
    symbol: str = Query(..., min_length=1, max_length=12, description="股票代號"),
    db: Session = Depends(get_db),
):
    sym = symbol.strip().upper()
    if not sym:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="symbol 不可為空")
    n = crud_order.available_lots_for_symbol(db, user_id.strip(), sym)
    return AvailableLotsResponse(user_id=user_id.strip(), symbol=sym, available_lots=n)


@router.get(
    "/",
    response_model=SimulatedOrderListResponse,
    summary="查詢模擬委託列表",
    description="依使用者識別查詢最近的模擬委託，並回傳估值、試算損益與參考收盤資訊。",
    responses={
        200: {"description": "成功返回模擬委託列表"},
        422: {"description": "查詢參數驗證失敗"},
    },
)
def get_simulated_orders(
    user_id: str = Query(..., min_length=1, max_length=128, description="使用者識別（前端匿名 user id）"),
    limit: int = Query(100, ge=1, le=200, description="查詢筆數上限"),
    db: Session = Depends(get_db),
):
    uid = user_id.strip()
    records = crud_order.list_simulated_orders(db=db, user_id=uid, limit=limit)
    fifo_cache = crud_order.build_fifo_sell_cost_cache(db, uid)
    return {
        "user_id": uid,
        "total": len(records),
        "data": [_serialize_order(db, order, fifo_sell_cost_cache=fifo_cache) for order in records],
    }


@router.get(
    "/profit-by-category",
    response_model=SimulatedOrderCategoryProfitResponse,
    summary="依股票代號彙總模擬收益",
    description=(
        "依使用者識別彙總各股票的成本、市值、損益金額與收益率。"
        "此 API 的 `category` 代表股票代號，保留名稱是為了相容既有前端。"
    ),
    responses={
        200: {"description": "成功返回股票代號彙總收益"},
        422: {"description": "查詢參數驗證失敗"},
    },
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
