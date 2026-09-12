from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.features.orders import service
from app.features.orders.schemas import (
    AvailableLotsResponse, SimulatedOrderCategoryProfitResponse, SimulatedOrderCreate,
    SimulatedOrderListResponse, SimulatedOrderResponse,
)


router = APIRouter(prefix="/simulated-orders", tags=["模擬下單"])


@router.post("/", response_model=SimulatedOrderResponse, responses={400: {}, 404: {}, 422: {}})
def create_simulated_order(payload: SimulatedOrderCreate, db: Session = Depends(get_db)):
    return service.create_order(db, payload)


@router.get("/available-lots", response_model=AvailableLotsResponse, responses={400: {}, 422: {}})
def get_available_lots(
    user_id: str = Query(..., min_length=1, max_length=128),
    symbol: str = Query(..., min_length=1, max_length=12),
    db: Session = Depends(get_db),
):
    return service.get_available_lots(db, user_id, symbol)


@router.get("/", response_model=SimulatedOrderListResponse, responses={422: {}})
def get_simulated_orders(
    user_id: str = Query(..., min_length=1, max_length=128),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return service.list_orders(db, user_id, limit)


@router.get("/profit-by-category", response_model=SimulatedOrderCategoryProfitResponse, responses={422: {}})
def get_profit_by_category(
    user_id: str = Query(..., min_length=1, max_length=128),
    db: Session = Depends(get_db),
):
    return service.profit_by_category(db, user_id)
