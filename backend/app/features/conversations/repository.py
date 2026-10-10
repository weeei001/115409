from sqlalchemy import delete, exists, func, inspect, or_, select, update

from app.db.models.chat_feedback import ChatMessageFeedback
from app.db.models.conversation import Conversation, ConversationMessage
from app.features.chat.audit_repository import delete_conversation_records


def conversation(db, user_id, conversation_id, *, lock=False):
    statement = select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user_id)
    return db.scalar(statement.with_for_update() if lock else statement)


def list_conversations(db, user_id, query, offset, limit):
    statement = select(Conversation).where(Conversation.user_id == user_id)
    if query:
        pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        matching_message = exists(select(ConversationMessage.id).where(
            ConversationMessage.conversation_id == Conversation.id,
            ConversationMessage.content.ilike(pattern, escape="\\")))
        statement = statement.where(or_(Conversation.title.ilike(pattern, escape="\\"), matching_message))
    return db.scalars(statement.order_by(Conversation.updated_at.desc(), Conversation.id.desc())
                      .offset(offset).limit(limit + 1)).all()


def messages(db, conversation_id):
    return db.scalars(select(ConversationMessage).where(ConversationMessage.conversation_id == conversation_id)
                      .order_by(ConversationMessage.position)).all()


def history(db, conversation_id):
    complete_turns = select(ConversationMessage.turn_id).where(
        ConversationMessage.conversation_id == conversation_id,
        ConversationMessage.role == "assistant", ConversationMessage.status == "completed")
    rows = db.scalars(select(ConversationMessage).where(
        ConversationMessage.conversation_id == conversation_id,
        ConversationMessage.turn_id.in_(complete_turns))
        .order_by(ConversationMessage.position.desc()).limit(8)).all()
    return list(reversed(rows))


def acquire(db, user_id, conversation_id, turn_id, now, lease_until):
    return db.execute(update(Conversation).where(
        Conversation.id == conversation_id, Conversation.user_id == user_id,
        or_(Conversation.active_turn.is_(None), Conversation.lease_until <= now))
        .values(active_turn=turn_id, lease_until=lease_until, updated_at=now)).rowcount == 1


def renew(db, conversation_id, turn_id, lease_until):
    return db.execute(update(Conversation).where(Conversation.id == conversation_id, Conversation.active_turn == turn_id)
                      .values(lease_until=lease_until)).rowcount == 1


def interrupt_stale(db, conversation_id):
    db.execute(update(ConversationMessage).where(ConversationMessage.conversation_id == conversation_id,
                                               ConversationMessage.status == "streaming").values(status="interrupted"))


def next_position(db, conversation_id):
    return (db.scalar(select(func.max(ConversationMessage.position)).where(
        ConversationMessage.conversation_id == conversation_id)) or 0) + 1


def finish(db, conversation_id, turn_id, content, status, extra, now):
    owned = db.execute(update(Conversation).where(Conversation.id == conversation_id, Conversation.active_turn == turn_id)
                       .values(active_turn=None, lease_until=None, updated_at=now)).rowcount
    if not owned:
        return None
    assistant = (ConversationMessage.conversation_id == conversation_id,
                 ConversationMessage.turn_id == turn_id, ConversationMessage.role == "assistant")
    db.execute(update(ConversationMessage).where(*assistant).values(content=content, status=status, extra=extra))
    return db.scalar(select(ConversationMessage.id).where(*assistant))


def delete_conversation(db, user_id, conversation_id):
    # Explicit deletion also works with SQLite connections that do not enable FK cascades.
    owned = select(Conversation.id).where(Conversation.id == conversation_id, Conversation.user_id == user_id)
    delete_conversation_records(db, user_id, conversation_id)
    if feedback_ready(db):
        db.execute(delete(ChatMessageFeedback).where(ChatMessageFeedback.conversation_id.in_(owned)))
    db.execute(delete(ConversationMessage).where(ConversationMessage.conversation_id.in_(owned)))
    db.execute(delete(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user_id))


def feedback_ready(db):
    # Conversations keep working during a rollout before init-schema has created the table.
    return inspect(db.connection()).has_table(ChatMessageFeedback.__tablename__)


def feedback_ratings(db, conversation_id):
    if not feedback_ready(db):
        return {}
    return dict(db.execute(select(ChatMessageFeedback.message_id, ChatMessageFeedback.rating)
                           .where(ChatMessageFeedback.conversation_id == conversation_id)).all())


def rateable_message(db, conversation_id, message_id):
    return db.scalar(select(ConversationMessage).where(
        ConversationMessage.id == message_id, ConversationMessage.conversation_id == conversation_id,
        ConversationMessage.role == "assistant", ConversationMessage.status == "completed"))


def set_feedback(db, *, user_id, conversation_id, message_id, rating, now):
    row = db.get(ChatMessageFeedback, message_id)
    if row is None:
        db.add(ChatMessageFeedback(message_id=message_id, conversation_id=conversation_id, user_id=user_id,
                                   rating=rating, created_at=now, updated_at=now))
    else:
        row.rating, row.updated_at = rating, now


def clear_feedback(db, message_id):
    db.execute(delete(ChatMessageFeedback).where(ChatMessageFeedback.message_id == message_id))
