from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, timedelta

from database import get_db
from schemas.daily_price import (
    DailyPriceResponse,
    DateRangeResponse,
    HistoricalPriceList,
    PriceStatistics,
    MultiStockResponse,
    MultiStockData,
    CandlestickWithMAResponse,
    VolumeAnalysisResponse,
    PriceChangeResponse,
    ChipsVolumeChartResponse,
    IntegratedChartResponse,
)
from schemas.institutional_trade import InstitutionalTradeListResponse
from schemas.technical_indicator import TechnicalIndicatorListResponse
from crud import daily_price as crud_price
from crud import chart_helper
from crud import institutional_trade as crud_institutional
from crud import technical_indicator as crud_technical

router = APIRouter(prefix="/stocks", tags=["股價查詢"])


def _to_float(value):
    return float(value) if value is not None else None


def _to_int(value):
    return int(value) if value is not None else None


def _build_volume_with_chips_rows(prices, trades):
    trade_dict = {trade.date: trade for trade in trades}
    data = []
    for price in prices:
        trade = trade_dict.get(price.date)
        if not trade:
            continue
        data.append({
            "date": price.date.isoformat(),
            "close": _to_float(price.close),
            "volume": _to_int(price.volume_shares),
            "foreign_net": _to_int(trade.foreign_net),
            "investment_trust_net": _to_int(trade.investment_trust_net),
            "dealer_net": _to_int(trade.dealer_net),
            "total_institutional_net": _to_int(trade.total_institutional_net),
        })
    return data


def _build_price_volume_rows(prices):
    return [
        {
            "date": price.date.isoformat(),
            "close": _to_float(price.close),
            "volume": _to_int(price.volume_shares),
            "volume_shares": _to_int(price.volume_shares),
            "amount": _to_int(price.amount),
            "change": _to_float(price.change),
        }
        for price in prices
    ]


def _build_institutional_rows(trades):
    return [
        {
            "date": trade.date.isoformat(),
            "symbol": trade.symbol,
            "foreign_net": _to_int(trade.foreign_net),
            "investment_trust_net": _to_int(trade.investment_trust_net),
            "trust_net": _to_int(trade.investment_trust_net),
            "dealer_net": _to_int(trade.dealer_net),
            "total_institutional_net": _to_int(trade.total_institutional_net),
            "total_net": _to_int(trade.total_institutional_net),
        }
        for trade in trades
    ]


def _build_technical_rows(indicators):
    return [
        {
            "date": item.date.isoformat(),
            "symbol": item.symbol,
            "close": _to_float(item.close),
            "ma5": _to_float(item.ma5),
            "ma10": _to_float(item.ma10),
            "ma20": _to_float(item.ma20),
            "ma60": _to_float(item.ma60),
            "rsi5": _to_float(item.rsi5),
            "rsi10": _to_float(item.rsi10),
            "rsv9": _to_float(item.rsv9),
            "kd_k9": _to_float(item.kd_k9),
            "kd_d9": _to_float(item.kd_d9),
            "kd_j9": _to_float(item.kd_j9),
            "ema12": _to_float(item.ema12),
            "ema26": _to_float(item.ema26),
            "macd_dif": _to_float(item.macd_dif),
            "macd_dea": _to_float(item.macd_dea),
            "macd_signal": _to_float(item.macd_signal),
            "macd_hist": _to_float(item.macd_hist),
            "volume_ma5": _to_float(item.volume_ma5),
        }
        for item in indicators
    ]


@router.get(
    "/symbols",
    response_model=List[str],
    summary="獲取所有股票代號",
    description="""
    獲取資料庫中所有可用的股票代號列表。

    **使用場景**：
    - 獲取系統中所有股票的清單
    - 用於前端下拉選單或自動完成功能

    **返回**：
    - 按字母順序排列的股票代號陣列
    """,
    responses={
        200: {
            "description": "成功返回股票代號列表",
            "content": {
                "application/json": {
                    "example": ["2317", "2330", "2454", "2881"]
                }
            }
        }
    }
)
def get_available_symbols(db: Session = Depends(get_db)):
    """獲取所有可用的股票代號"""
    return crud_price.get_available_symbols(db)


@router.get(
    "/{symbol}/latest",
    response_model=DailyPriceResponse,
    summary="獲取最新股價",
    description="""
    獲取指定股票的最新交易日價格數據。

    **參數**：
    - `symbol`: 股票代號（例如：2330、2317）

    **返回**：
    - 包含開盤價、最高價、最低價、收盤價、成交量等完整資訊
    """,
    responses={
        200: {"description": "成功返回最新股價"},
        404: {"description": "找不到該股票的數據"}
    }
)
def get_latest_price(symbol: str, db: Session = Depends(get_db)):
    """獲取指定股票的最新價格"""
    price = crud_price.get_latest_price(db, symbol=symbol.upper())
    if not price:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"找不到股票 {symbol} 的價格數據"
        )
    return price

@router.get(
    "/{symbol}/history",
    response_model=HistoricalPriceList,
    summary="查詢歷史股價列表",
    description=(
        "查詢指定股票在日期區間內的日線資料，支援分頁。"
        "未提供日期時，預設查詢最近 30 天。"
    ),
    responses={
        200: {"description": "成功返回歷史股價列表"},
        422: {"description": "日期格式、skip 或 limit 驗證失敗"},
    },
)
def get_historical_prices(
    symbol: str,
    start_date: Optional[date] = Query(None, description="開始日期"),
    end_date: Optional[date] = Query(None, description="結束日期"),
    skip: int = Query(0, ge=0, description="跳過的記錄數"),
    limit: int = Query(100, ge=1, le=1000, description="返回的記錄數"),
    db: Session = Depends(get_db)
):
    """獲取指定股票的歷史價格數據"""
    symbol = symbol.upper()

    # 如果沒有指定日期範圍，獲取最近30天
    if not start_date and not end_date:
        end_date = date.today()
        start_date = end_date - timedelta(days=30)

    prices = crud_price.get_price_by_symbol(
        db,
        symbol=symbol,
        start_date=start_date,
        end_date=end_date,
        skip=skip,
        limit=limit
    )

    total = crud_price.get_price_count(
        db,
        symbol=symbol,
        start_date=start_date,
        end_date=end_date
    )

    return {
        "symbol": symbol,
        "start_date": start_date or date.min,
        "end_date": end_date or date.today(),
        "total": total,
        "data": prices
    }

@router.get(
    "/{symbol}/statistics",
    response_model=PriceStatistics,
    summary="查詢股價統計數據",
    description="依指定日期區間計算最高價、最低價、平均收盤價、總成交量、總成交金額與交易天數。",
    responses={
        200: {"description": "成功返回統計數據"},
        404: {"description": "指定日期範圍內無交易資料"},
        422: {"description": "日期格式驗證失敗"},
    },
)
def get_statistics(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db)
):
    """獲取指定時間範圍的統計數據"""
    symbol = symbol.upper()
    stats = crud_price.get_price_statistics(db, symbol=symbol, start_date=start_date, end_date=end_date)

    if stats['trading_days'] == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的數據"
        )

    return stats


@router.get(
    "/compare/multiple",
    response_model=MultiStockResponse,
    summary="多股票價格比較",
    description="""
    比較多支股票在同一時間範圍內的價格走勢。

    **適用場景**：
    - 繪製多條折線圖比較不同股票
    - 分析股票間的相關性
    - 投資組合績效對比

    **參數**：
    - `symbols`: 股票代號列表，用逗號分隔
      - 範例：`2330,2317,2454`
      - 最多支援 10 支股票同時比較
    - `start_date`: 開始日期（YYYY-MM-DD）
    - `end_date`: 結束日期（YYYY-MM-DD）

    **返回數據格式**：
    ```json
    {
      "symbols": ["2330", "2317"],
      "data": [
        {
          "date": "2024-03-10",
          "prices": {
            "2330": 593.0,
            "2317": 520.0
          }
        }
      ]
    }
    ```

    **注意**：
    - 如某支股票在某日無交易，該日價格為 null
    - 建議查詢時間不超過 6 個月以提升效能
    """,
    responses={
        200: {"description": "成功返回多股票比較數據"},
        400: {"description": "參數錯誤（超過10支股票）"},
        404: {"description": "找不到任何股票數據"}
    }
)
def compare_multiple_stocks(
    symbols: str = Query(..., description="股票代號，用逗號分隔，例如: 2330,2317,2454"),
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db)
):
    """比較多支股票的價格走勢（用於繪製多條線圖）"""
    symbol_list = [s.strip().upper() for s in symbols.split(',')]

    if len(symbol_list) > 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="最多只能同時比較10支股票"
        )

    prices = crud_price.get_multi_stock_prices(db, symbols=symbol_list, start_date=start_date, end_date=end_date)

    if not prices:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="找不到任何股票數據"
        )

    # 組織數據：按日期分組
    date_prices = {}
    for price in prices:
        date_str = price.date.isoformat()
        if date_str not in date_prices:
            date_prices[date_str] = {}
        date_prices[date_str][price.symbol] = float(price.close) if price.close else None

    # 轉換為前端格式
    data = []
    for date_str in sorted(date_prices.keys()):
        prices_dict = date_prices[date_str]
        # 確保所有股票都有對應的值（可能為 None）
        for symbol in symbol_list:
            if symbol not in prices_dict:
                prices_dict[symbol] = None

        data.append({
            "date": date_str,
            "prices": prices_dict
        })

    return {
        "start_date": start_date,
        "end_date": end_date,
        "symbols": symbol_list,
        "data": data
    }


@router.get(
    "/{symbol}/date-range",
    response_model=DateRangeResponse,
    summary="查詢股票資料日期範圍",
    description="取得指定股票目前在資料庫中可查詢的最早與最新交易日，可用於前端日期選擇器限制範圍。",
    responses={
        200: {"description": "成功返回日期範圍"},
        404: {"description": "找不到該股票資料"},
    },
)
def get_symbol_date_range(symbol: str, db: Session = Depends(get_db)):
    """獲取指定股票的日期範圍"""
    date_range = crud_price.get_date_range_for_symbol(db, symbol=symbol.upper())
    if not date_range:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"找不到股票 {symbol} 的數據"
        )

    return {
        "symbol": symbol.upper(),
        "min_date": date_range[0],
        "max_date": date_range[1]
    }


# ==================== 進階繪圖 API ====================

@router.get(
    "/{symbol}/chart/candlestick-ma",
    response_model=CandlestickWithMAResponse,
    summary="K線圖 + 移動平均線",
    description="""
    獲取K線圖數據並自動計算移動平均線（MA）。

    **適用場景**：
    - 專業股票技術分析
    - 繪製 K線圖 + 多條 MA 線
    - 成交量區間柱狀圖

    **參數**：
    - `symbol`: 股票代號（例如：2330）
    - `start_date`: 開始日期（YYYY-MM-DD）
    - `end_date`: 結束日期（YYYY-MM-DD）
    - `ma_periods`: 移動平均線周期，用逗號分隔
      - 預設：`5,10,20`
      - 常用：`5,10,20,60,120`
      - 最多支援 5 條 MA 線

    **返回數據包含**：
    - `candlestick`: 每日K線數據（OHLC + 成交量）
    - `moving_averages`: 移動平均線數據
      - MA5: 5日平均
      - MA10: 10日平均
      - MA20: 20日平均
    - `dates`: 日期陣列（方便繪圖）

    **使用範例**：
    ```
    GET /api/v1/stocks/2330/chart/candlestick-ma?start_date=2024-01-01&end_date=2024-03-10&ma_periods=5,10,20
    ```

    **前端圖表庫推薦**：
    - ECharts（推薦）
    - TradingView Lightweight Charts
    - Chart.js with chartjs-chart-financial
    """,
    responses={
        200: {"description": "成功返回K線 + MA 數據"},
        400: {"description": "MA 周期格式錯誤或超過5條"},
        404: {"description": "指定日期範圍內無數據"}
    }
)
def get_candlestick_with_ma(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    ma_periods: str = Query("5,10,20", description="移動平均線週期，用逗號分隔，例如: 5,10,20"),
    db: Session = Depends(get_db)
):
    """獲取K線圖數據 + 移動平均線（MA5, MA10, MA20等）

    適合前端繪製：
    - 蠟燭圖（K線圖）
    - 多條移動平均線
    - 成交量柱狀圖
    """
    symbol = symbol.upper()

    # 解析移動平均線週期
    try:
        periods = [int(p.strip()) for p in ma_periods.split(',')]
        if len(periods) > 5:
            raise ValueError("最多支援5條移動平均線")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"移動平均線週期格式錯誤: {str(e)}"
        )

    data = chart_helper.get_candlestick_with_ma(
        db,
        symbol=symbol,
        start_date=start_date,
        end_date=end_date,
        ma_periods=periods
    )

    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的數據"
        )

    return data


@router.get(
    "/{symbol}/chart/volume",
    response_model=VolumeAnalysisResponse,
    summary="成交量分析",
    description="""
    獲取成交量分析數據，包含價格變化資訊。

    **適用場景**：
    - 繪製成交量柱狀圖
    - 分析量價關係
    - 識別異常交易量

    **參數**：
    - `symbol`: 股票代號
    - `start_date`: 開始日期
    - `end_date`: 結束日期

    **返回數據包含**：
    - `volume`: 成交股數
    - `amount`: 成交金額
    - `close`: 收盤價
    - `change`: 漲跌價差

    **繪圖建議**：
    - 上漲日（change ≥ 0）用紅色柱狀
    - 下跌日（change < 0）用綠色柱狀
    - 可與價格走勢圖結合顯示

    **分析指標**：
    - 量增價漲：看漲訊號
    - 量增價跌：看跌訊號
    - 量縮價漲：慰盤訊號
    """,
    responses={
        200: {"description": "成功返回成交量分析數據"},
        404: {"description": "指定日期範圍內無數據"}
    }
)
def get_volume_analysis(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db)
):
    """獲取成交量分析數據

    適合前端繪製：
    - 成交量柱狀圖（上漲紅色，下跌綠色）
    - 成交量與價格對比圖
    """
    symbol = symbol.upper()

    data = chart_helper.get_volume_analysis(
        db,
        symbol=symbol,
        start_date=start_date,
        end_date=end_date
    )

    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的數據"
        )

    return data


@router.get(
    "/{symbol}/chart/price-change",
    response_model=PriceChangeResponse,
    summary="價格變化分析",
    description="""
    獲取價格變化數據，包含漲跌幅百分比。

    **適用場景**：
    - 價格走勢分析
    - 漲跌幅計算與展示
    - 波動率分析

    **參數**：
    - `symbol`: 股票代號
    - `start_date`: 開始日期
    - `end_date`: 結束日期

    **返回數據包含**：
    - `close`: 收盤價
    - `change`: 漲跌價差（與前一日比較）
    - `change_percent`: 漲跌幅百分比（%）

    **計算公式**：
    ```
    漲跌幅% = ((今日收盤 - 昨日收盤) / 昨日收盤) × 100
    ```

    **使用範例**：
    - 繪製漲跌幅柱狀圖
    - 計算累計報酬率
    - 風險評估（標準差、波動率）
    """,
    responses={
        200: {"description": "成功返回價格變化數據"},
        404: {"description": "指定日期範圍內無數據"}
    }
)
def get_price_change(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db)
):
    """獲取價格變化數據（含漲跌幅百分比）

    適合前端繪製：
    - 價格走勢圖
    - 漲跌幅百分比圖
    - 價格變化趨勢分析
    """
    symbol = symbol.upper()

    data = chart_helper.get_price_change_data(
        db,
        symbol=symbol,
        start_date=start_date,
        end_date=end_date
    )

    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的數據"
        )

    return data


# ==================== 籌碼 API ====================

@router.get(
    "/{symbol}/institutional-trades",
    response_model=InstitutionalTradeListResponse,
    summary="獲取三大法人買賣超數據",
    tags=["三大法人"],
    description="""
    獲取指定股票的三大法人（外資、投信、自營）買賣超數據。

    **參數**：
    - `symbol`: 股票代號（例如：2330）
    - `start_date`: 開始日期（YYYY-MM-DD）
    - `end_date`: 結束日期（YYYY-MM-DD）

    **返回數據包含**：
    - `foreign_net`: 外資買賣超股數
    - `investment_trust_net`: 投信買賣超股數
    - `dealer_net`: 自營商買賣超股數
    - `total_institutional_net`: 三大法人買賣超股數合計

    **使用場景**：
    - 籌碼分析圖表
    - 法人動向追蹤
    - 支撐壓力分析
    """,
    responses={
        200: {"description": "成功返回三大法人買賣超數據"},
        404: {"description": "指定日期範圍內無數據"}
    }
)
def get_institutional_trades(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db)
):
    """獲取三大法人買賣超數據"""
    symbol = symbol.upper()

    trades = crud_institutional.get_by_symbol_range(
        db,
        symbol=symbol,
        start_date=start_date,
        end_date=end_date
    )

    if not trades:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的三大法人數據"
        )

    return {
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "total": len(trades),
        "data": trades
    }


@router.get(
    "/{symbol}/chart/chips-volume",
    response_model=ChipsVolumeChartResponse,
    summary="籌碼與成交量圖表數據",
    tags=["三大法人"],
    description="""
    獲取籌碼與成交量組合數據，用於繪製整合圖表。

    **參數**：
    - `symbol`: 股票代號
    - `start_date`: 開始日期
    - `end_date`: 結束日期

    **返回數據格式**：
    ```json
    {
      "symbol": "2330",
      "data": [
        {
          "date": "2024-03-10",
          "close": 593.0,
          "volume": 12345678,
          "foreign_net": 100000,
          "investment_trust_net": 50000,
          "dealer_net": -30000,
          "total_institutional_net": 120000
        }
      ]
    }
    ```

    **圖表設計**：
    - 主軸（左）：股價走勢線
    - 副軸（右）：三大法人買賣超柱狀圖（3色）
    - 工具提示：顯示5項數據（外資、投信、自營、股價、合計）
    """,
    responses={
        200: {"description": "成功返回籌碼與成交量數據"},
        404: {"description": "指定日期範圍內無數據"}
    }
)
def get_chips_volume_chart(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db)
):
    """獲取籌碼與成交量組合數據用於圖表展示"""
    symbol = symbol.upper()

    prices = crud_price.get_price_range(
        db,
        symbol=symbol,
        start_date=start_date,
        end_date=end_date
    )

    # 獲取籌碼數據
    trades = crud_institutional.get_by_symbol_range(
        db,
        symbol=symbol,
        start_date=start_date,
        end_date=end_date
    )

    if not prices or not trades:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的完整數據"
        )

    data = _build_volume_with_chips_rows(prices, trades)

    return {
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "data": data
    }


@router.get(
    "/{symbol}/volume-with-chips",
    response_model=ChipsVolumeChartResponse,
    summary="成交量與三大法人整合數據",
    tags=["三大法人"],
    description=(
        "取得成交量、收盤價與三大法人買賣超整合資料。"
        "此端點回傳格式與 `/stocks/{symbol}/chart/chips-volume` 相同，供前端既有呼叫相容使用。"
    ),
    responses={
        200: {"description": "成功返回成交量與三大法人整合資料"},
        404: {"description": "指定日期範圍內無完整資料"},
        422: {"description": "日期格式驗證失敗"},
    },
)
def get_volume_with_chips(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db)
):
    """獲取成交量、收盤價與三大法人買賣超整合數據。"""
    return get_chips_volume_chart(symbol, start_date, end_date, db)


@router.get(
    "/{symbol}/technical-indicators",
    response_model=TechnicalIndicatorListResponse,
    summary="獲取技術指標數據",
    tags=["技術指標"],
    description=(
        "查詢指定股票於日期區間內的技術指標資料，包含均線、RSI、KD、MACD、布林通道與成交量均線。"
    ),
    responses={
        200: {"description": "成功返回技術指標資料"},
        404: {"description": "指定日期範圍內無技術指標資料"},
        422: {"description": "日期格式驗證失敗"},
    },
)
def get_technical_indicators(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db)
):
    """獲取 MACD、KD、RSI 與均線等技術指標。"""
    symbol = symbol.upper()
    indicators = crud_technical.get_indicators(
        db,
        symbol=symbol,
        start_date=start_date,
        end_date=end_date,
    )

    if not indicators:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的技術指標數據"
        )

    return {
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "total": len(indicators),
        "data": indicators,
    }


@router.get(
    "/{symbol}/integrated-chart",
    response_model=IntegratedChartResponse,
    summary="整合股票圖表數據",
    tags=["進階繪圖"],
    description=(
        "一次返回價量、三大法人、籌碼成交量與技術指標資料，適合前端頁面初始化或快取後切換不同圖表。"
        "若某類資料不存在，該陣列會為空；只有全部資料皆不存在時才回傳 404。"
    ),
    responses={
        200: {"description": "成功返回整合圖表資料"},
        404: {"description": "指定日期範圍內沒有任何圖表資料"},
        422: {"description": "日期格式驗證失敗"},
    },
)
def get_integrated_chart(
    symbol: str,
    start_date: date = Query(..., description="開始日期"),
    end_date: date = Query(..., description="結束日期"),
    db: Session = Depends(get_db)
):
    """一次返回價量、三大法人、成交量整合與技術指標資料，供前端快取切換。"""
    symbol = symbol.upper()
    prices = crud_price.get_price_range(db, symbol=symbol, start_date=start_date, end_date=end_date)
    trades = crud_institutional.get_by_symbol_range(db, symbol=symbol, start_date=start_date, end_date=end_date)
    indicators = crud_technical.get_indicators(db, symbol=symbol, start_date=start_date, end_date=end_date)

    if not prices and not trades and not indicators:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"在指定日期範圍內找不到股票 {symbol} 的圖表數據"
        )

    return {
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "price_volume": _build_price_volume_rows(prices),
        "institutional_trades": _build_institutional_rows(trades),
        "volume_with_chips": _build_volume_with_chips_rows(prices, trades),
        "technical_indicators": _build_technical_rows(indicators),
    }
