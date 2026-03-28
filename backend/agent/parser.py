from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import List, Optional

from agent.llm_client import LLMClient
from agent.prompt_templates import INTENT_PARSING_SYSTEM, INTENT_PARSING_USER
from agent.schemas import ParsedIntent

logger = logging.getLogger(__name__)


def _format_conversation(messages: list[dict]) -> str:
    lines: list[str] = []
    for m in messages[-10:]:
        role = "使用者" if m.get("role") == "user" else "助理"
        lines.append(f"[{role}] {m.get('content', '')}")
    return "\n".join(lines)


async def parse_intent(
    llm: LLMClient,
    messages: list[dict],
    *,
    today: Optional[date] = None,
) -> ParsedIntent:
    if today is None:
        today = date.today()

    default_start = today - timedelta(days=7)

    conversation_text = _format_conversation(messages)
    user_prompt = INTENT_PARSING_USER.format(
        today=today.isoformat(),
        conversation=conversation_text,
    )

    try:
        result = await llm.complete_json(INTENT_PARSING_SYSTEM, user_prompt)
    except Exception:
        logger.exception("Intent parsing LLM call failed, using defaults")
        last_user = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user = m.get("content", "")
                break
        return ParsedIntent(
            symbols=[],
            date_start=default_start,
            date_end=today,
            focus="general",
            original_query=last_user[:200],
        )

    symbols = result.get("symbols") or []
    symbols = [str(s).strip() for s in symbols if s]

    try:
        ds = date.fromisoformat(str(result.get("date_start", "")))
    except (ValueError, TypeError):
        ds = default_start
    try:
        de = date.fromisoformat(str(result.get("date_end", "")))
    except (ValueError, TypeError):
        de = today

    if ds > de:
        ds, de = de, ds

    focus_raw = str(result.get("focus", "general")).lower()
    if focus_raw not in ("technical", "institutional", "news", "general", "pattern"):
        focus_raw = "general"

    return ParsedIntent(
        symbols=symbols,
        date_start=ds,
        date_end=de,
        focus=focus_raw,  # type: ignore[arg-type]
        original_query=str(result.get("original_query", ""))[:200],
    )
