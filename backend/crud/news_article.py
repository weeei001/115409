from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from models.news_article import NewsArticle


# `pub_time` 是 VARCHAR，各來源格式不一致（'2025-10-18T22:03:55+08:00' 或
# '2025-10-18 22:03:55'）。直接做字串比較時 'T'(0x54) > ' '(0x20)，區間查詢的
# 結束邊界會誤刪同一天的 ISO 格式資料，因此統一正規化成 'YYYY-MM-DD HH:MM:SS'
# 後再比較與排序（代價是這個條件用不到 idx_pub_time 索引）。
_PUB_TIME_NORMALIZED = func.left(func.replace(NewsArticle.pub_time, "T", " "), 19)

_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def get_by_article_id(db: Session, article_id: str) -> Optional[NewsArticle]:
    """依主鍵 article_id 查詢單筆新聞"""
    return (
        db.query(NewsArticle)
        .filter(NewsArticle.article_id == article_id)
        .first()
    )


def build_filter_conditions(
    article_id: Optional[str] = None,
    keyword: Optional[str] = None,
    stock: Optional[str] = None,
    source: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
):
    conditions = []

    if article_id:
        conditions.append(NewsArticle.article_id == article_id)
    if keyword:
        like_pattern = f"%{keyword}%"
        conditions.append(
            or_(
                NewsArticle.title.like(like_pattern),
                NewsArticle.content.like(like_pattern),
            )
        )
    if stock:
        # 主要關聯股票放 stock_id，其餘關聯股票放在 tags（逗號分隔）
        conditions.append(
            or_(
                NewsArticle.stock_id == stock,
                NewsArticle.tags.like(f"%{stock}%"),
            )
        )
    if source:
        conditions.append(NewsArticle.source == source)
    if start_time:
        conditions.append(_PUB_TIME_NORMALIZED >= start_time.strftime(_TIME_FORMAT))
    if end_time:
        conditions.append(_PUB_TIME_NORMALIZED <= end_time.strftime(_TIME_FORMAT))

    if not conditions:
        return None
    return and_(*conditions)


def get_list(
    db: Session,
    *,
    page: int,
    page_size: int,
    article_id: Optional[str] = None,
    keyword: Optional[str] = None,
    stock: Optional[str] = None,
    source: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    sort_by: str = "pub_time",
    sort_order: str = "desc",
) -> Tuple[int, List[NewsArticle]]:
    """
    依多條件查詢新聞列表，回傳 (total, items)
    """
    query = db.query(NewsArticle)

    conditions = build_filter_conditions(
        article_id=article_id,
        keyword=keyword,
        stock=stock,
        source=source,
        start_time=start_time,
        end_time=end_time,
    )
    if conditions is not None:
        query = query.filter(conditions)

    # 統計總數
    total = query.count()

    # 排序
    sort_column = {
        "pub_time": _PUB_TIME_NORMALIZED,
        "created_at": NewsArticle.created_at,
    }.get(sort_by, _PUB_TIME_NORMALIZED)

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
    article_id: Optional[str] = None,
    keyword: Optional[str] = None,
    stock: Optional[str] = None,
    source: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
) -> int:
    """
    取得符合條件的新聞總筆數
    """
    query = db.query(NewsArticle)
    conditions = build_filter_conditions(
        article_id=article_id,
        keyword=keyword,
        stock=stock,
        source=source,
        start_time=start_time,
        end_time=end_time,
    )
    if conditions is not None:
        query = query.filter(conditions)

    return query.count()
