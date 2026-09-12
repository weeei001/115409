import logging
from typing import Any

from sqlalchemy.exc import SQLAlchemyError


class AppError(Exception):
    def __init__(self, detail: Any, status_code: int = 400, headers: dict | None = None):
        super().__init__(str(detail))
        self.detail = detail
        self.status_code = status_code
        self.headers = headers


class NotFound(AppError):
    def __init__(self, detail: Any = "Not found"):
        super().__init__(detail, 404)


class AuthenticationFailed(AppError):
    def __init__(self, detail: Any = "Authentication failed"):
        super().__init__(detail, 401, {"WWW-Authenticate": "Bearer"})


class Conflict(AppError):
    def __init__(self, detail: Any = "Conflict"):
        super().__init__(detail, 409)


class ServiceUnavailable(AppError):
    def __init__(self, detail: Any = "Service unavailable"):
        super().__init__(detail, 503)


class UpstreamTimeout(AppError):
    def __init__(self, detail: Any = "Upstream service timed out"):
        super().__init__(detail, 504)


class ModelUnavailable(ServiceUnavailable):
    def __init__(self, detail: Any, *, upstream_status_code: int | None = None,
                 upstream_code: str | None = None):
        super().__init__(detail)
        # Worker control flow only. HTTP handlers serialize detail, never these attributes.
        self.upstream_status_code = upstream_status_code
        self.upstream_code = upstream_code


def install_error_handlers(app) -> None:
    from fastapi import Request
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse

    @app.exception_handler(AppError)
    async def application_error(request: Request, exc: AppError):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Input values can contain passwords or bearer tokens.
        errors = [{k: v for k, v in error.items() if k in {"type", "loc", "msg"}}
                  for error in exc.errors()]
        return JSONResponse({"detail": errors}, status_code=422)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError):
        logging.getLogger(__name__).error("Database operation failed: %s", type(exc).__name__)
        return JSONResponse({"detail": "Database service unavailable"}, status_code=503)

    @app.exception_handler(Exception)
    async def internal_error(request: Request, exc: Exception):
        logging.getLogger(__name__).error("Unhandled application error: %s", type(exc).__name__)
        return JSONResponse({"detail": "Internal server error"}, status_code=500)
