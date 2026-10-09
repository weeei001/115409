from sqlalchemy import delete, exists, insert, inspect, literal, select

from app.db.models.chat_audit import ChatValidationRun
from app.db.models.conversation import Conversation
from app.db.models.user import User


def add_if_owner_exists(db, record):
    # An atomic INSERT ... SELECT closes the gap between a separate existence
    # check and flush, including SQLite installations that do not enforce FKs.
    conditions = []
    if record.user_id is not None:
        conditions.append(exists(select(User.id).where(User.id == record.user_id)))
    if record.conversation_id is not None:
        conditions.append(exists(select(Conversation.id).where(
            Conversation.id == record.conversation_id,
            Conversation.user_id == record.user_id,
        )))
    columns = list(ChatValidationRun.__table__.columns)
    values = select(*(literal(getattr(record, column.name), type_=column.type) for column in columns))
    if conditions:
        values = values.where(*conditions)
    result = db.execute(insert(ChatValidationRun).from_select([column.name for column in columns], values))
    return result.rowcount == 1


def delete_expired(db, cutoff):
    db.execute(delete(ChatValidationRun).where(ChatValidationRun.created_at < cutoff))


def delete_conversation_records(db, user_id, conversation_id):
    # Chat deletion must still work during a rollout before init-schema has run.
    if not inspect(db.connection()).has_table(ChatValidationRun.__tablename__):
        return
    owned = select(Conversation.id).where(Conversation.id == conversation_id, Conversation.user_id == user_id)
    db.execute(delete(ChatValidationRun).where(ChatValidationRun.conversation_id.in_(owned)))
