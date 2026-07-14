from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from crud import finmind_extra as crud_finmind
from database import get_db
from schemas.finmind_extra import (
    DividendResultListResponse,
    FinancialStatementListResponse,
    ForeignShareholdingListResponse,
    HoldingShareLevelListResponse,
    MarginTradeListResponse,
    MonthlyRevenueListResponse,
    StockDividendListResponse,
    StockValuationListResponse,
)


router = APIRouter(prefix="/stocks", tags=["FinMind 財報籌碼"])


def _response(symbol: str, start_date: date, end_date: date, rows: list, label: str):
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的{label}資料",
        )
    return {
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "total": len(rows),
        "data": rows,
    }


@router.get(
    "/{symbol}/fundamentals/financial-statements",
    response_model=FinancialStatementListResponse,
    summary="查詢三大財報 long-form 明細",
)
def get_financial_statements(
    symbol: str,
    statement: Literal["income", "balance", "cashflow"] = Query(..., description="財報類型"),
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    item_type: Optional[str] = Query(None, description="FinMind type 欄位，例如 EPS"),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    rows = crud_finmind.get_financial_statements(db, symbol, statement, start_date, end_date, item_type)
    return _response(symbol, start_date, end_date, rows, "財報")


@router.get(
    "/{symbol}/fundamentals/monthly-revenues",
    response_model=MonthlyRevenueListResponse,
    summary="查詢月營收",
)
def get_monthly_revenues(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    rows = crud_finmind.get_monthly_revenues(db, symbol, start_date, end_date)
    return _response(symbol, start_date, end_date, rows, "月營收")


@router.get(
    "/{symbol}/fundamentals/valuations",
    response_model=StockValuationListResponse,
    summary="查詢 PER/PBR/殖利率",
)
def get_valuations(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    rows = crud_finmind.get_valuations(db, symbol, start_date, end_date)
    return _response(symbol, start_date, end_date, rows, "估值")


@router.get(
    "/{symbol}/fundamentals/dividends",
    response_model=StockDividendListResponse,
    summary="查詢股利政策",
)
def get_dividends(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    rows = crud_finmind.get_dividends(db, symbol, start_date, end_date)
    return _response(symbol, start_date, end_date, rows, "股利")


@router.get(
    "/{symbol}/fundamentals/dividend-results",
    response_model=DividendResultListResponse,
    summary="查詢除權息結果",
)
def get_dividend_results(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    rows = crud_finmind.get_dividend_results(db, symbol, start_date, end_date)
    return _response(symbol, start_date, end_date, rows, "除權息結果")


@router.get(
    "/{symbol}/chips/margin-trades",
    response_model=MarginTradeListResponse,
    summary="查詢融資融券",
)
def get_margin_trades(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    rows = crud_finmind.get_margin_trades(db, symbol, start_date, end_date)
    return _response(symbol, start_date, end_date, rows, "融資融券")


@router.get(
    "/{symbol}/chips/foreign-shareholding",
    response_model=ForeignShareholdingListResponse,
    summary="查詢外資持股",
)
def get_foreign_shareholding(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    rows = crud_finmind.get_foreign_shareholdings(db, symbol, start_date, end_date)
    return _response(symbol, start_date, end_date, rows, "外資持股")


@router.get(
    "/{symbol}/chips/holding-share-levels",
    response_model=HoldingShareLevelListResponse,
    summary="查詢持股分級",
)
def get_holding_share_levels(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db),
):
    symbol = symbol.upper()
    rows = crud_finmind.get_holding_share_levels(db, symbol, start_date, end_date)
    return _response(symbol, start_date, end_date, rows, "持股分級")
