from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from crud import technical_indicator as crud_indicator
from database import get_db
from schemas.technical_indicator import (
    TechnicalIndicatorListResponse,
    TechnicalIndicatorResponse,
)

router = APIRouter(prefix="/stocks", tags=["技術指標"])


@router.get(
    "/{symbol}/indicators",
    response_model=TechnicalIndicatorListResponse,
    summary="查詢技術指標區間資料",
)
def get_indicator_range(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    records = crud_indicator.get_indicators(
        db=db, symbol=symbol, start_date=start_date, end_date=end_date
    )
    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的技術指標資料",
        )

    return {
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "total": len(records),
        "data": records,
    }


@router.get(
    "/{symbol}/indicators/latest",
    response_model=TechnicalIndicatorResponse,
    summary="查詢最新技術指標",
)
def get_latest_indicator(symbol: str, db: Session = Depends(get_db)):
    symbol = symbol.upper()
    record = crud_indicator.get_latest_indicator(db=db, symbol=symbol)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"找不到股票 {symbol} 的技術指標資料",
        )
    return record
