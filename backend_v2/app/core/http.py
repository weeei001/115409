"""Shared outbound HTTP client with an explicit proxy policy."""
from typing import Any

import httpx


def make_http_client(settings: Any) -> httpx.AsyncClient:
    """Build the app-wide async client without inheriting ambient proxy state by default."""
    return httpx.AsyncClient(
        proxy=settings.OUTBOUND_HTTP_PROXY.strip() or None,
        trust_env=settings.OUTBOUND_HTTP_TRUST_ENV,
    )
