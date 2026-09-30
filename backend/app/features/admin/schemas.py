from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class GrantAdministratorRequest(BaseModel):
    email: EmailStr


class JobActionRequest(BaseModel):
    run_id: int | None = Field(None, gt=0)


class ActionResponse(BaseModel):
    message: str
    run_id: int | None = None


class RunPublic(BaseModel):
    id: int
    job_name: str
    status: str
    trigger: str
    actor_id: int | None
    retry_of: int | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    exit_code: int | None
    error: str | None
    duration_seconds: float | None = None
    model_config = ConfigDict(from_attributes=True)

    @field_validator("created_at", "started_at", "finished_at")
    @classmethod
    def utc_timestamps(cls, value):
        return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


class AuditPublic(BaseModel):
    id: int
    actor_id: int | None
    actor_email: str | None
    action: str
    target: str
    status: str
    created_at: datetime
    details: dict | None
    model_config = ConfigDict(from_attributes=True)

    @field_validator("created_at")
    @classmethod
    def utc_timestamps(cls, value):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
