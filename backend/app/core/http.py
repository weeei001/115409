"""Shared outbound HTTP clients with explicit proxy and verified TLS trust."""
import ssl
import sys
from typing import Any

import httpx


def _client_options(settings: Any, **kwargs) -> dict:
    trust_env = kwargs.pop("trust_env", getattr(settings, "OUTBOUND_HTTP_TRUST_ENV", False))
    proxy = kwargs.pop("proxy", getattr(settings, "OUTBOUND_HTTP_PROXY", "").strip() or None)
    if "verify" in kwargs:
        raise ValueError("TLS verification is managed by the shared HTTP client")
    context = httpx.create_ssl_context(trust_env=trust_env)
    if sys.platform == "win32":
        # Retain bundled CAs and add Windows trust for verified HTTPS inspection.
        # Certificate-chain and hostname verification remain mandatory.
        context.load_default_certs(ssl.Purpose.SERVER_AUTH)
    return {**kwargs, "verify": context, "proxy": proxy, "trust_env": trust_env}


def make_http_client(settings: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(**_client_options(settings))


def make_sync_http_client(settings: Any, **kwargs) -> httpx.Client:
    """Preserve caller timeouts/transports while sharing proxy and TLS policy."""
    return httpx.Client(**_client_options(settings, **kwargs))
