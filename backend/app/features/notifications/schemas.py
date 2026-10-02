from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class NotificationPreferences(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    daily_summary: bool = False
    price_alert: bool = False
    major_news: bool = False
    price_threshold: float = Field(5, ge=1, le=30, allow_inf_nan=False)
    quiet_start: int = Field(22, ge=0, le=23)
    quiet_end: int = Field(8, ge=0, le=23)


class DeviceToken(BaseModel):
    token: str = Field(min_length=1, max_length=4096, pattern=r"^\S+$")


class RegisterDevice(DeviceToken):
    platform: Literal["web", "android"] = "web"


class NotificationItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    title: str
    body: str
    url: str
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


class NotificationInbox(BaseModel):
    items: list[NotificationItem]
