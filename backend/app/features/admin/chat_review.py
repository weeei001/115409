import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import NotFound, ServiceUnavailable
from app.features.admin import chat_review_repository as repository
from app.features.admin.chat_review_schemas import ChatReviewDetail, ChatReviewList, ChatReviewSummary
from app.features.chat.audit import RETENTION_DAYS


def _cutoff(days: int = RETENTION_DAYS) -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)


def _unavailable(exc: SQLAlchemyError) -> ServiceUnavailable:
    # Never return SQL parameters, database connection details, or captured prose.
    original = getattr(exc, "orig", None)
    args = getattr(original, "args", ())
    message = str(original).lower()
    missing = (bool(args) and args[0] == 1146) or (
        "no such table" in message and "chat_validation_runs" in message)
    logging.getLogger(__name__).warning("AI conversation review unavailable: %s", type(exc).__name__)
    return ServiceUnavailable(
        "AI 對話檢核資料表尚未初始化，請完成資料庫更新後再試。" if missing else
        "AI 對話檢核資料目前無法讀取，請稍後再試。")


def _summary(data: dict) -> ChatReviewSummary:
    # Old or incomplete diagnostic rows should show unknown/default metrics, not a broken list.
    for key, default in (("reasons", []), ("duration_ms", 0), ("attempt_count", 0),
                         ("source_count", 0), ("publication_completed", False)):
        if data.get(key) is None:
            data[key] = default
    return ChatReviewSummary.model_validate(data)


def list_reviews(db: Session, *, days: int, outcome: str | None, reason: str,
                 query: str, limit: int, offset: int) -> ChatReviewList:
    try:
        rows, total = repository.review_list(db, since=_cutoff(days), outcome=outcome,
                                            reason=reason.strip(), query=query.strip(), limit=limit, offset=offset)
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc
    return ChatReviewList(items=[_summary(row) for row in rows], total=total, retention_days=RETENTION_DAYS)


def get_review(db: Session, run_id: str) -> ChatReviewDetail:
    try:
        pair = repository.review_by_id(db, run_id, since=_cutoff())
    except SQLAlchemyError as exc:
        raise _unavailable(exc) from exc
    if pair is None:
        raise NotFound("找不到此 AI 對話檢核紀錄，可能已超過保留期限或原對話已刪除。")
    row, email = pair
    data = row.data if isinstance(row.data, dict) else {}
    summary = _summary({
        **{key: data.get(key) for key in ("reasons", "model", "duration_ms", "attempt_count", "source_count",
                                         "publication_completed")},
        "id": row.id, "created_at": row.created_at, "user_id": row.user_id, "user_email": email,
        "conversation_id": row.conversation_id, "turn_id": row.turn_id,
        "outcome": row.outcome, "reason": row.reason, "query_preview": row.query[:160],
    })
    # Explicit response model prevents future internal data fields from leaking into this API.
    return ChatReviewDetail.model_validate({**data, **summary.model_dump(), "query": row.query})
