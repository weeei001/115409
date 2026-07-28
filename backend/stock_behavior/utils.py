from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any


SIMPLIFIED_CHINESE_CHARS = frozenset(
    "门为说经开关证买卖风险机会亿万点涨势后头复资达预测币价业东个产众优体债"
    "仅从仓传伤伦伪侧侦兑兰兴冲决况净击则刚创删别剂务动劳华协单卫压历县叶号叹"
    "吗吨听启员响图场坏块坚坛坝壮声处备够夹夺奖妇妈孙学宁宝实审写导层岁师帐带"
    "帮库应废广庄庆异弃张弯归录当彻径忆怀态总恋恶惊惯戏户执扩扫扬扰护报担拟拣"
)


def detect_simplified_chinese(text: str) -> list[str]:
    return list(dict.fromkeys(char for char in text if char in SIMPLIFIED_CHINESE_CHARS))


class UpstreamModelError(RuntimeError):
    """上游模型服務（NVIDIA NIM）回傳錯誤或連線失敗。

    與 PolicyViolationError 分開：後者代表請求本身或設定有問題（422），
    這個代表我們這邊沒問題、是對方掛了（503），前端應該提示稍後重試而不是修改請求。
    實測 NIM 對 deepseek-v4-pro 的長請求會在十幾分鐘後回 504。
    """

    def __init__(self, message: str, *, context: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.context = context or {}

    def to_detail(self) -> dict[str, Any]:
        return {
            "code": "upstream_model_error",
            "message": self.message,
            "context": to_jsonable(self.context),
        }


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
