from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any


class PolicyViolationError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "policy_violation",
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.context = context or {}

    def to_detail(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "context": to_jsonable(self.context),
        }

    def __str__(self) -> str:
        return self.message


def date_to_str(d: date) -> str:
    return d.isoformat()


def to_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_jsonable(v) for v in value]
    if isinstance(value, tuple):
        return [to_jsonable(v) for v in value]
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def start_date_by_lookback(*, as_of_date: date, lookback_days: int) -> date:
    return as_of_date - timedelta(days=lookback_days)


def stable_hash(payload: Any) -> str:
    normalized = json.dumps(to_jsonable(payload), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
