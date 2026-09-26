"""Shared Server-Sent Events encoding and iterator cleanup."""
import json
from collections.abc import AsyncGenerator
from contextlib import aclosing


async def encode_sse(events: AsyncGenerator[object, None], *,
                     allow_nan: bool = True) -> AsyncGenerator[str, None]:
    async with aclosing(events):
        async for event in events:
            yield f"data: {json.dumps(event, ensure_ascii=False, allow_nan=allow_nan)}\n\n"
