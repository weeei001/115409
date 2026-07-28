"""stock_behavior 的結構化 log。

原本各處用 print，uvicorn 雖然會收進 stdout，但沒有時間戳——請求從 Swagger 送出後
卡住時，看不出是卡在 RAG、DB 還是 LLM。這裡統一成帶時間戳與耗時的單行 log，
每一段都印 start 與 done，最後一行印到哪裡就是卡在哪裡。

環境變數 STOCK_BEHAVIOR_LOG_LEVEL 可調（預設 INFO；設 DEBUG 會另外印 payload 摘要）。
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import contextmanager
from time import perf_counter
from typing import Any, Iterator


LOGGER_NAME = "stock_behavior"
_LOG_FORMAT = "%(asctime)s %(levelname)-5s [%(name)s] %(message)s"
_DATE_FORMAT = "%H:%M:%S"


def get_logger() -> logging.Logger:
    """取得（必要時初始化）stock_behavior 的 logger。

    uvicorn 不會替應用自己的 logger 掛 handler，所以這裡自己掛一個帶時間戳的；
    若外部已經設定過（例如專案日後導入統一 logging 設定）就沿用，不重複掛。
    """
    logger = logging.getLogger(LOGGER_NAME)
    if not logger.handlers:
        # 一定要掛自己的 handler：uvicorn 的預設 formatter 是 "%(levelprefix)s %(message)s"，
        # 沒有時間戳。請求卡住時就是靠時間戳判斷停在哪一段、停了多久。
        # propagate=False 避免同時被 root handler 印第二次。
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT))
        logger.addHandler(handler)
        logger.propagate = False
    logger.setLevel(os.environ.get("STOCK_BEHAVIOR_LOG_LEVEL", "INFO").upper())
    return logger


def _render(fields: dict[str, Any]) -> str:
    parts = []
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, (list, tuple, set)):
            value = ",".join(str(item) for item in value) or "-"
        text = str(value)
        parts.append(f"{key}={text}")
    return " ".join(parts)


def log_event(event: str, **fields: Any) -> None:
    get_logger().info("%s %s", event, _render(fields))


def log_warn(event: str, **fields: Any) -> None:
    get_logger().warning("%s %s", event, _render(fields))


@contextmanager
def stage(name: str, **fields: Any) -> Iterator[dict[str, Any]]:
    """印出 `<name> start …` 與 `<name> done … ms=…`；例外時印 failed 並往上拋。

    yield 出來的 dict 可以在區塊內塞欄位，會併進 done 那一行
    （例如 timeline 列數、新聞則數這種要跑完才知道的資訊）。
    """
    logger = get_logger()
    extra: dict[str, Any] = {}
    logger.info("%s start %s", name, _render(fields))
    started_at = perf_counter()
    try:
        yield extra
    except Exception as exc:
        logger.warning(
            "%s failed %s",
            name,
            _render(
                {
                    **fields,
                    **extra,
                    "ms": round((perf_counter() - started_at) * 1000),
                    "error_type": type(exc).__name__,
                    "error": str(exc)[:300],
                }
            ),
        )
        raise
    logger.info(
        "%s done %s",
        name,
        _render({**fields, **extra, "ms": round((perf_counter() - started_at) * 1000)}),
    )
