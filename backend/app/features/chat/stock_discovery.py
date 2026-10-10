"""依系統儲存且附日期的行情，選出限定數量的比較候選股票。"""
from datetime import date

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db.models.daily_price import DailyPrice
from app.db.models.stock_info import StockInfo

from .comparison_context import MAX_COMPARISON_STOCKS


def stock_industries(db: Session) -> list[str]:
    """回傳資料庫股票名單中實際使用的產業名稱。"""
    with db.no_autoflush:
        return list(db.scalars(select(StockInfo.industry).where(
            StockInfo.industry.is_not(None), func.trim(StockInfo.industry) != "",
        ).distinct().order_by(StockInfo.industry)))


def discover_stock_candidates(db: Session, industry_groups: list[list[str]],
                              as_of: date, limit: int = 3) -> dict:
    """唯讀查詢候選股票，不把交易活躍程度當成投資價值。

    各群組使用資料庫的完整產業名稱，不接受 SQL 或模糊比對規則。
    未指定群組代表全部服務股票；明確指定空群組則不匹配任何股票。
    最新一筆價格無法使用時排除該股票，不回補較早的價格。
    """
    if len(industry_groups) > 3:
        raise ValueError("Stock discovery supports at most three industry groups")
    if limit < 1:
        raise ValueError("Stock discovery limit must be positive")
    limit = min(limit, MAX_COMPARISON_STOCKS)
    groups = [list(dict.fromkeys(group)) for group in industry_groups] or [[]]
    unrestricted = not industry_groups
    industries = list(dict.fromkeys(value for group in groups for value in group))
    catalog_query = select(StockInfo.symbol, StockInfo.name, StockInfo.industry)
    if not unrestricted:
        catalog_query = catalog_query.where(StockInfo.industry.in_(industries))
    with db.no_autoflush:
        catalog = list(db.execute(catalog_query).mappings())
        symbols = [row["symbol"] for row in catalog]
        latest_dates = select(
            DailyPrice.symbol, func.max(DailyPrice.date).label("latest_date"),
        ).where(DailyPrice.symbol.in_(symbols), DailyPrice.date <= as_of).group_by(
            DailyPrice.symbol).subquery()
        rows = list(db.execute(select(
            StockInfo.symbol, StockInfo.name, StockInfo.industry,
            DailyPrice.date.label("latest_price_date"), DailyPrice.volume_shares,
        ).join(DailyPrice, DailyPrice.symbol == StockInfo.symbol).join(
            latest_dates, and_(DailyPrice.symbol == latest_dates.c.symbol,
                               DailyPrice.date == latest_dates.c.latest_date),
        ).where(DailyPrice.close > 0).order_by(
            DailyPrice.date.desc(),
            DailyPrice.volume_shares.is_(None), DailyPrice.volume_shares.desc(),
            StockInfo.symbol,
        )).mappings())

    pools = [[row for row in rows if unrestricted or row["industry"] in group] for group in groups]
    selected = []
    selected_symbols = set()
    offsets = [0] * len(groups)
    while len(selected) < limit:
        progressed = False
        for index, pool in enumerate(pools):
            while offsets[index] < len(pool) and pool[offsets[index]]["symbol"] in selected_symbols:
                offsets[index] += 1
            if offsets[index] == len(pool):
                continue
            row = pool[offsets[index]]
            offsets[index] += 1
            selected.append({**row, "latest_price_date": row["latest_price_date"].isoformat()})
            selected_symbols.add(row["symbol"])
            progressed = True
            if len(selected) == limit:
                break
        if not progressed:
            break

    coverage = [{
        "industries": group,
        "matched_count": sum(unrestricted or row["industry"] in group for row in catalog),
        "eligible_count": len(pool),
        "selected_symbols": [row["symbol"] for row in selected
                             if unrestricted or row["industry"] in group],
    } for group, pool in zip(groups, pools)]
    return {
        "as_of_date": as_of.isoformat(),
        "candidates": selected,
        "groups": coverage,
        "missing_groups": [item["industries"] for item in coverage if not item["eligible_count"]],
        "selection_basis": (
            "依系統服務股票名單中的完整產業名稱篩選；截止日以前的最新日資料須有正值收盤價。"
            "各群組依觀測日期由新到舊、成交股數由高到低、股票代碼由小到大排序，"
            "再於各指定群組輪流選取不重複的股票。"
        ),
        "limitations": [
            "這是限定數量的比較候選名單，尚未構成買進建議或投資排名。",
            "服務名單未涵蓋全部台股；未選取的股票尚未評估。",
            "成交股數僅用於選取候選股票，不能據此判斷未來報酬或投資適合度。",
            "儲存的每日股價並非即時報價；各候選股票的觀測日期可能不同或較舊。",
            "有股價資料不保證同時具備財務、技術、法人或新聞資料。",
            f"本次最多選取 {limit} 檔不重複的股票；數量上限較低時可能無法涵蓋所有群組。",
        ],
    }
