import asyncio
from typing import Annotated
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Body, Depends, Path, Query, Request

from app.core.config import application_environment, require_development_names
from app.db.models.user import User
from app.features.admin import service
from app.features.admin.schemas import ActionResponse, GrantAdministratorRequest, JobActionRequest
from app.features.auth.router import CurrentUser, Database


router = APIRouter(prefix="/admin", tags=["後台管理"])


def get_administrator(request: Request, user: CurrentUser, db: Database) -> User:
    try:
        service.require_admin(db, user)
    except service.AppError:
        if request.method in {"POST", "DELETE"}:
            # Only record the route; never record request bodies, passwords or bearer tokens.
            service.record_denied(db, user, request.url.path)
        raise
    return user


Administrator = Annotated[User, Depends(get_administrator)]


@router.get("/me")
def me(user: Administrator):
    return {"user_id": user.id, "email": user.email}


@router.get("/overview")
async def overview(request: Request, user: Administrator, db: Database):
    settings = request.app.state.settings
    data = await asyncio.to_thread(service.overview, db, getattr(request.app.state, "jobs", None),
                                   getattr(request.app.state, "environment", application_environment()))
    base = (settings.QDRANT_URL or (f"http://{settings.QDRANT_HOST}:{settings.QDRANT_PORT}"
                                   if settings.QDRANT_HOST else "")).rstrip("/")
    status, detail = "not_configured", None
    if base:
        try:
            require_development_names(settings, "QDRANT_COLLECTION")
            collection = quote(settings.QDRANT_COLLECTION, safe="")
            headers = {"api-key": settings.QDRANT_API_KEY} if settings.QDRANT_API_KEY else {}
            response = await request.app.state.http.get(f"{base}/collections/{collection}", headers=headers, timeout=3)
            response.raise_for_status()
            status = "healthy"
        except (httpx.HTTPError, httpx.InvalidURL, ValueError) as exc:
            status, detail = "unhealthy", type(exc).__name__
    data["services"].append({"name": "qdrant", "status": status, "detail": detail})
    return data


@router.get("/runs")
def runs(request: Request, user: Administrator, db: Database, limit: int = Query(20, ge=1, le=100),
         offset: int = Query(0, ge=0), job_name: str | None = Query(None, max_length=80)):
    return service.list_runs(db, limit, offset, job_name, getattr(request.app.state, "jobs", None))


@router.get("/runs/{run_id}")
def run(request: Request, user: Administrator, db: Database, run_id: int = Path(..., gt=0, le=2147483647)):
    return service.get_run(db, run_id, getattr(request.app.state, "jobs", None))


@router.get("/audit")
def audit(user: Administrator, db: Database, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
    return service.list_audit(db, limit, offset)


@router.get("/administrators")
def administrators(user: Administrator, db: Database):
    return service.list_administrators(db)


@router.post("/administrators", response_model=ActionResponse)
def grant_administrator(body: GrantAdministratorRequest, user: Administrator, db: Database):
    return service.grant_administrator(db, user, str(body.email))


@router.delete("/administrators/{user_id}", response_model=ActionResponse)
def revoke_administrator(user: Administrator, db: Database, user_id: int = Path(..., gt=0)):
    return service.revoke_administrator(db, user, user_id)


@router.post("/jobs/{job_name}/{action}", response_model=ActionResponse)
def job_action(request: Request, user: Administrator, db: Database,
               job_name: str = Path(..., min_length=1, max_length=80),
               action: str = Path(..., min_length=1, max_length=20),
               body: JobActionRequest | None = Body(None)):
    return service.perform_job(db, user, getattr(request.app.state, "jobs", None), job_name,
                               action, body.run_id if body else None)
