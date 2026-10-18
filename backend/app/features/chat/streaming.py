"""以 SSE 逐段送出 AI 對話回答；完成時送出與一般 JSON 回應相同的結果。"""
import asyncio
import logging
from contextlib import suppress

from app.core.errors import AppError

FAILED_MESSAGE = "伺服器無法完成回覆，請稍後再試。"


def _error_event(exc: Exception) -> dict:
    if isinstance(exc, AppError):
        detail = exc.detail
        message = detail.get("message") if isinstance(detail, dict) else str(detail)
        return {"type": "error", "status": exc.status_code, "message": message or FAILED_MESSAGE}
    logging.getLogger(__name__).exception("Chat stream failed")
    return {"type": "error", "status": 500, "message": FAILED_MESSAGE}


async def answer_events(run):
    """run(on_delta) 回傳最終回應；回答文字產生時以 delta 事件送出，最後送出 done 或 error。"""
    queue: asyncio.Queue[dict] = asyncio.Queue()

    async def on_delta(text: str) -> None:
        queue.put_nowait({"type": "delta", "text": text})

    async def worker() -> None:
        try:
            result = await run(on_delta)
            queue.put_nowait({"type": "done", "response": result.model_dump(mode="json")})
        except Exception as exc:
            queue.put_nowait(_error_event(exc))

    task = asyncio.create_task(worker())
    try:
        while True:
            event = await queue.get()
            yield event
            if event["type"] != "delta":
                return
    finally:
        # 使用者中斷連線時停止生成，對話服務會把這一輪標成中斷。
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
