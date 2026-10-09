import asyncio
import logging
from contextlib import aclosing, suppress
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.core.errors import Conflict, NotFound, ServiceUnavailable
from app.db.models.conversation import Conversation, ConversationMessage
from app.features.chat.schemas import AskResponse, ChatTurn

from . import repository
from .schemas import ConversationDetail, ConversationList, ConversationSummary, SavedMessage


LEASE_SECONDS = 120


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def summary(row):
    return ConversationSummary(id=row.id, title=row.title, updated_at=row.updated_at.replace(tzinfo=timezone.utc))


class ConversationService:
    def __init__(self, session_factory, chat):
        self.session_factory = session_factory
        self.chat = chat

    def _owned(self, db, user_id, conversation_id, *, lock=False):
        row = repository.conversation(db, user_id, conversation_id, lock=lock)
        if row is None:
            raise NotFound("找不到對話")
        return row

    def create(self, user_id):
        with self.session_factory() as db, db.begin():
            row = Conversation(id=str(uuid4()), user_id=user_id, title="", updated_at=utcnow())
            db.add(row)
            return ConversationDetail(**summary(row).model_dump(), messages=[])

    def list(self, user_id, query="", offset=0, limit=30):
        with self.session_factory() as db:
            rows = repository.list_conversations(db, user_id, query.strip(), offset, limit)
            return ConversationList(items=[summary(row) for row in rows[:limit]], has_more=len(rows) > limit)

    def get(self, user_id, conversation_id):
        with self.session_factory() as db:
            row = self._owned(db, user_id, conversation_id)
            stale = row.lease_until is None or row.lease_until <= utcnow()
            messages = [SavedMessage(
                id=message.id, role=message.role, content=message.content,
                timestamp=message.timestamp.replace(tzinfo=timezone.utc),
                status="interrupted" if stale and message.status == "streaming" else message.status,
                **message.extra,
            ) for message in repository.messages(db, conversation_id)]
            return ConversationDetail(**summary(row).model_dump(), messages=messages)

    def delete(self, user_id, conversation_id):
        with self.session_factory() as db, db.begin():
            self._owned(db, user_id, conversation_id, lock=True)
            repository.delete_conversation(db, user_id, conversation_id)

    def begin(self, user_id, conversation_id, request):
        """Claim a turn before returning HTTP headers, so collisions return 409."""
        turn_id, now = str(uuid4()), utcnow()
        with self.session_factory() as db, db.begin():
            # Locking reads avoid a stale REPEATABLE READ snapshot before claiming the turn.
            self._owned(db, user_id, conversation_id, lock=True)
            if not repository.acquire(db, user_id, conversation_id, turn_id, now, now + timedelta(seconds=LEASE_SECONDS)):
                raise Conflict("這段對話正在回覆，請稍候再試")
            repository.interrupt_stale(db, conversation_id)
            history = [ChatTurn(role=message.role, content=message.content[:6000])
                       for message in repository.history(db, conversation_id) if message.content.strip()]
            row = self._owned(db, user_id, conversation_id)
            if not row.title:
                row.title = request.query[:80]
            position = repository.next_position(db, conversation_id)
            db.add_all([
                ConversationMessage(id=str(uuid4()), conversation_id=conversation_id, turn_id=turn_id,
                                    position=position, role="user", content=request.query, timestamp=now, extra={}),
                ConversationMessage(id=str(uuid4()), conversation_id=conversation_id, turn_id=turn_id,
                                    position=position + 1, role="assistant", content="", timestamp=now,
                                    status="streaming", extra={}),
            ])
        trusted_request = request.model_copy(update={"history": history})
        trusted_request._user_id = user_id
        trusted_request._conversation_id = conversation_id
        trusted_request._turn_id = turn_id
        return turn_id, trusted_request

    def _finish(self, conversation_id, turn_id, content, status, extra):
        with self.session_factory() as db, db.begin():
            return repository.finish(db, conversation_id, turn_id, content, status, extra, utcnow())

    async def _heartbeat(self, conversation_id, turn_id, consumer):
        try:
            while True:
                await asyncio.sleep(LEASE_SECONDS / 3)
                with self.session_factory() as db, db.begin():
                    renewed = repository.renew(db, conversation_id, turn_id,
                                               utcnow() + timedelta(seconds=LEASE_SECONDS))
                if not renewed:
                    consumer.cancel()
                    return
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.getLogger(__name__).exception("Conversation lease renewal failed")
            consumer.cancel()

    async def stream_events(self, conversation_id, turn_id, request):
        content, extra, finished = "", {}, False
        heartbeat = asyncio.create_task(self._heartbeat(conversation_id, turn_id, asyncio.current_task()))
        try:
            async with aclosing(self.chat.stream_events(request)) as events:
                async for event in events:
                    if event["type"] == "text":
                        content += event.get("content", "")
                    elif event["type"] == "dashboard":
                        extra.update({key: event[key] for key in ("dashboard", "actions") if key in event})
                    elif event["type"] == "done":
                        content = event.get("answer", content)
                        extra.update({key: event[key] for key in ("dashboard", "actions", "sources") if key in event})
                        finished = self._finish(conversation_id, turn_id, content, "completed", extra)
                        if not finished:
                            return
                    elif event["type"] == "error":
                        extra["error"] = event.get("message", "服務暫時無法回應")
                        finished = self._finish(conversation_id, turn_id, content, "failed", extra)
                        if not finished:
                            return
                    yield event
                    if finished:
                        return
        finally:
            heartbeat.cancel()
            # Synchronous persistence runs even when the response task is cancelled.
            try:
                if not finished:
                    self._finish(conversation_id, turn_id, content, "interrupted", extra)
            finally:
                with suppress(asyncio.CancelledError):
                    await heartbeat

    async def ask(self, conversation_id, turn_id, request):
        async with aclosing(self.stream_events(conversation_id, turn_id, request)) as events:
            async for event in events:
                if event["type"] == "done":
                    return AskResponse.model_validate(event)
                if event["type"] == "error":
                    raise ServiceUnavailable(event["message"])
        raise ServiceUnavailable("對話回覆中斷，請稍後重試")
