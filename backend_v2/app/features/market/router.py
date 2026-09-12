from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.features.market import schemas as s, service


router = APIRouter(prefix="/stocks", tags=["Market"])


@router.get("/symbols", response_model=list[str])
def get_available_symbols(db: Session = Depends(get_db)):
    return service.symbols(db)


@router.get("/{symbol}/latest", response_model=s.DailyPriceResponse, responses={404: {"description": "Not found"}})
def get_latest_price(symbol: str, db: Session = Depends(get_db)):
    return service.latest(db, symbol)


@router.get("/{symbol}/history", response_model=s.HistoricalPriceList)
def get_historical_prices(
    symbol: str, start_date: date | None = Query(None), end_date: date | None = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=1000), db: Session = Depends(get_db),
):
    return service.history(db, symbol, start_date, end_date, skip, limit)


@router.get("/{symbol}/statistics", response_model=s.PriceStatistics, responses={404: {"description": "Not found"}})
def get_statistics(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.statistics(db, symbol, start_date, end_date)


@router.get("/compare/multiple", response_model=s.MultiStockResponse,
            responses={400: {"description": "Invalid parameters"}, 404: {"description": "Not found"}})
def compare_multiple_stocks(
    symbols: str = Query(...), start_date: date = Query(...), end_date: date = Query(...),
    db: Session = Depends(get_db),
):
    return service.compare(db, symbols, start_date, end_date)


@router.get("/{symbol}/date-range", response_model=s.DateRangeResponse, responses={404: {"description": "Not found"}})
def get_symbol_date_range(symbol: str, db: Session = Depends(get_db)):
    return service.date_range(db, symbol)


@router.get("/{symbol}/chart/candlestick-ma", response_model=s.CandlestickWithMAResponse,
            responses={400: {"description": "Invalid periods"}, 404: {"description": "Not found"}})
def get_candlestick_with_ma(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...),
    ma_periods: str = Query("5,10,20"), db: Session = Depends(get_db),
):
    return service.candlestick(db, symbol, start_date, end_date, ma_periods)


@router.get("/{symbol}/chart/volume", response_model=s.VolumeAnalysisResponse, responses={404: {"description": "Not found"}})
def get_volume_analysis(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.volume(db, symbol, start_date, end_date)


@router.get("/{symbol}/chart/price-change", response_model=s.PriceChangeResponse, responses={404: {"description": "Not found"}})
def get_price_change(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.price_change(db, symbol, start_date, end_date)


@router.get("/{symbol}/institutional-trades", response_model=s.InstitutionalTradeListResponse,
            responses={404: {"description": "Not found"}})
def get_institutional_trades(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.institutional_trades(db, symbol, start_date, end_date)


@router.get("/{symbol}/chart/chips-volume", response_model=s.ChipsVolumeChartResponse,
            responses={404: {"description": "Not found"}})
def get_chips_volume_chart(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.volume_with_chips(db, symbol, start_date, end_date)


@router.get("/{symbol}/volume-with-chips", response_model=s.ChipsVolumeChartResponse,
            responses={404: {"description": "Not found"}})
def get_volume_with_chips(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.volume_with_chips(db, symbol, start_date, end_date)


@router.get("/{symbol}/technical-indicators", response_model=s.TechnicalIndicatorListResponse,
            responses={404: {"description": "Not found"}})
def get_technical_indicators(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.technical_indicators(db, symbol, start_date, end_date)


@router.get("/{symbol}/integrated-chart", response_model=s.IntegratedChartResponse,
            responses={404: {"description": "Not found"}})
def get_integrated_chart(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.integrated_chart(db, symbol, start_date, end_date)


@router.get("/{symbol}/fundamentals/financial-statements", response_model=s.FinancialStatementListResponse)
def get_financial_statements(
    symbol: str, statement: Literal["income", "balance", "cashflow"] = Query(...),
    start_date: date = Query(...), end_date: date = Query(...),
    item_type: str | None = Query(None), db: Session = Depends(get_db),
):
    return service.financial_statements(db, symbol, statement, start_date, end_date, item_type)


@router.get("/{symbol}/fundamentals/monthly-revenues", response_model=s.MonthlyRevenueListResponse)
def get_monthly_revenues(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.dataset(db, "monthly_revenues", symbol, start_date, end_date)


@router.get("/{symbol}/fundamentals/valuations", response_model=s.StockValuationListResponse)
def get_valuations(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.dataset(db, "valuations", symbol, start_date, end_date)


@router.get("/{symbol}/fundamentals/dividends", response_model=s.StockDividendListResponse)
def get_dividends(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.dataset(db, "dividends", symbol, start_date, end_date)


@router.get("/{symbol}/fundamentals/dividend-results", response_model=s.DividendResultListResponse)
def get_dividend_results(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.dataset(db, "dividend_results", symbol, start_date, end_date)


@router.get("/{symbol}/chips/margin-trades", response_model=s.MarginTradeListResponse)
def get_margin_trades(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.dataset(db, "margin_trades", symbol, start_date, end_date)


@router.get("/{symbol}/chips/foreign-shareholding", response_model=s.ForeignShareholdingListResponse)
def get_foreign_shareholding(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.dataset(db, "foreign_shareholding", symbol, start_date, end_date)


@router.get("/{symbol}/chips/holding-share-levels", response_model=s.HoldingShareLevelListResponse)
def get_holding_share_levels(
    symbol: str, start_date: date = Query(...), end_date: date = Query(...), db: Session = Depends(get_db),
):
    return service.dataset(db, "holding_share_levels", symbol, start_date, end_date)
