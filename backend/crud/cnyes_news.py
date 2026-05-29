from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc

from models.cnyes_news import CnyesTWStockNews


def get_by_id(db: Session, id_: int) -> Optional[CnyesTWStockNews]:
    """依主鍵 id 查詢單筆新聞"""
    return db.query(CnyesTWStockNews).filter(CnyesTWStockNews.id == id_).first()


def get_by_news_id(db: Session, news_id: int) -> Optional[CnyesTWStockNews]:
    """依 business news_id 查詢單筆新聞"""
    return (
        db.query(CnyesTWStockNews)
        .filter(CnyesTWStockNews.news_id == news_id)
        .first()
    )


def build_filter_conditions(
    news_id: Optional[int] = None,
    id_: Optional[int] = None,
    keyword: Optional[str] = None,
    stock: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
):
    conditions = []

    if news_id is not None:
        conditions.append(CnyesTWStockNews.news_id == news_id)
    if id_ is not None:
        conditions.append(CnyesTWStockNews.id == id_)
    if keyword:
        like_pattern = f"%{keyword}%"
        conditions.append(
            or_(
                CnyesTWStockNews.title.like(like_pattern),
                CnyesTWStockNews.content.like(like_pattern),
            )
        )
    if stock:
        like_pattern = f"%{stock}%"
        conditions.append(CnyesTWStockNews.related_stocks.like(like_pattern))
    if start_time:
        conditions.append(CnyesTWStockNews.publish_time >= start_time)
    if end_time:
        conditions.append(CnyesTWStockNews.publish_time <= end_time)

    if not conditions:
        return None
    return and_(*conditions)


def get_list(
    db: Session,
    *,
    page: int,
    page_size: int,
    news_id: Optional[int] = None,
    id_: Optional[int] = None,
    keyword: Optional[str] = None,
    stock: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    sort_by: str = "publish_time",
    sort_order: str = "desc",
) -> Tuple[int, List[CnyesTWStockNews]]:
    """
    依多條件查詢新聞列表，回傳 (total, items)
    """
    query = db.query(CnyesTWStockNews)

    conditions = build_filter_conditions(
        news_id=news_id,
        id_=id_,
        keyword=keyword,
        stock=stock,
        start_time=start_time,
        end_time=end_time,
    )
    if conditions is not None:
        query = query.filter(conditions)

    # 統計總數
    total = query.count()

    # 排序
    sort_column = {
        "publish_time": CnyesTWStockNews.publish_time,
        "created_at": CnyesTWStockNews.created_at,
    }.get(sort_by, CnyesTWStockNews.publish_time)

    if sort_order.lower() == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    # 分頁
    offset = (page - 1) * page_size
    items = query.offset(offset).limit(page_size).all()

    return total, items


def get_count(
    db: Session,
    *,
    news_id: Optional[int] = None,
    id_: Optional[int] = None,
    keyword: Optional[str] = None,
    stock: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
) -> int:
    """
    取得符合條件的新聞總筆數
    """
    query = db.query(CnyesTWStockNews)
    conditions = build_filter_conditions(
        news_id=news_id,
        id_=id_,
        keyword=keyword,
        stock=stock,
        start_time=start_time,
        end_time=end_time,
    )
    if conditions is not None:
        query = query.filter(conditions)

    return query.count()

