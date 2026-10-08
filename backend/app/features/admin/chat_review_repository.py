from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models.chat_audit import ChatValidationRun
from app.db.models.user import User


def review_list(db: Session, *, since: datetime, outcome: str | None, reason: str,
                query: str, limit: int, offset: int):
    run = ChatValidationRun
    filters = [run.created_at >= since]
    if outcome == "attention":
        filters.append(run.outcome.in_(["fallback", "error", "interrupted"]))
    elif outcome:
        filters.append(run.outcome == outcome)
    if reason:
        # At most one repair is allowed. Match either rejection, not just the last one.
        filters.append(or_(run.reason == reason,
                           run.data["attempts"][0]["reason"].as_string() == reason,
                           run.data["attempts"][1]["reason"].as_string() == reason))
    if query:
        filters.append(or_(*(func.lower(column).contains(query.lower(), autoescape=True)
                             for column in (run.query, User.email, run.id, run.conversation_id, run.turn_id))))
    # Read only list fields; the potentially large draft/source snapshots are fetched on demand.
    fields = [run.id, run.created_at, run.user_id, User.email.label("user_email"),
              run.conversation_id, run.turn_id, run.outcome, run.reason,
              func.substr(run.query, 1, 160).label("query_preview"),
              run.data["reasons"].label("reasons"),
              run.data["model"].as_string().label("model"),
              run.data["duration_ms"].as_integer().label("duration_ms"),
              run.data["attempt_count"].as_integer().label("attempt_count"),
              run.data["source_count"].as_integer().label("source_count"),
              run.data["publication_completed"].as_boolean().label("publication_completed")]
    listing = select(*fields).outerjoin(User, User.id == run.user_id).where(*filters)
    count = select(func.count()).select_from(run).outerjoin(User, User.id == run.user_id).where(*filters)
    rows = db.execute(listing.order_by(run.created_at.desc(), run.id.desc()).limit(limit).offset(offset)).mappings()
    return [dict(row) for row in rows], db.scalar(count) or 0


def review_by_id(db: Session, run_id: str, *, since: datetime):
    return db.execute(select(ChatValidationRun, User.email).outerjoin(
        User, User.id == ChatValidationRun.user_id).where(
            ChatValidationRun.id == run_id, ChatValidationRun.created_at >= since)).first()
