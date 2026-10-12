from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class ActivateSubscriptionRequest(BaseModel):
    plan: Literal["plus", "pro"]
    billing: Literal["monthly", "yearly"]


class SubscriptionInfo(BaseModel):
    plan: Literal["plus", "pro"]
    billing: Literal["monthly", "yearly"]
    started_on: date = Field(description="開通日（台北時間）")
    renews_on: date = Field(description="下次續訂日：月繳加 1 個月、年繳加 12 個月，目標月沒有那一天時取月底")


class AskQuotaStatus(BaseModel):
    per: Literal["day", "month"] = Field(description="免費版以台北時間每日計，付費版以每月計")
    limit: int
    used: int
    remaining: int
    resets_at: datetime = Field(description="下次歸零的時間（UTC）")
    guest: bool = Field(description="未登入時用訪客額度，依連線來源計算")


class PlanLimitsStatus(BaseModel):
    favorites: int | None = Field(description="收藏股檔數上限；null 表示不限")
    compare: int = Field(description="多股比較一次可選的檔數")
    history_days: int | None = Field(description="歷史對話顯示最近幾天；null 表示不限")
    push: bool = Field(description="可以註冊 Web、Android 推播")


class SubscriptionStatus(BaseModel):
    plan: Literal["free", "plus", "pro"]
    signed_in: bool
    subscription: SubscriptionInfo | None = Field(description="付費方案的開通資料；免費版是 null")
    ask: AskQuotaStatus
    limits: PlanLimitsStatus
    favorites_used: int | None = Field(description="目前收藏檔數；未登入是 null")
