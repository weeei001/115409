from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from crud import institutional_trade as crud_inst
from database import get_db
from schemas.institutional_trade import (
    InstitutionalTradeListResponse,
    InstitutionalTradeResponse,
)

router = APIRouter(prefix="/stocks", tags=["三大法人"])


@router.get(
    "/{symbol}/institutional",
    response_model=InstitutionalTradeListResponse,
    summary="查詢三大法人買賣超區間資料",
)
def get_institutional_range(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    records = crud_inst.get_by_symbol_range(
        db=db, symbol=symbol, start_date=start_date, end_date=end_date
    )
    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的三大法人資料",
        )

    return {
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "total": len(records),
        "data": records,
    }


@router.get(
    "/{symbol}/institutional/latest",
    response_model=InstitutionalTradeResponse,
    summary="查詢最新三大法人買賣超",
)
def get_latest_institutional(symbol: str, db: Session = Depends(get_db)):
    symbol = symbol.upper()
    record = crud_inst.get_latest(db=db, symbol=symbol)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"找不到股票 {symbol} 的三大法人資料",
        )
    return record
