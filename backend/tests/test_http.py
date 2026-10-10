import httpx
import ssl

import pytest

from app.core import http as http_module

from app.core.http import make_http_client


def test_outbound_http_defaults_to_direct_connections(settings, monkeypatch):
    captured = {}

    class StubAsyncClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", StubAsyncClient)
    make_http_client(settings)

    context = captured.pop("verify")
    assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
    assert captured == {"proxy": None, "trust_env": False}


def test_outbound_http_accepts_explicit_proxy(settings, monkeypatch):
    captured = {}

    class StubAsyncClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", StubAsyncClient)
    configured = settings.model_copy(update={
        "OUTBOUND_HTTP_PROXY": "http://proxy.test:8080",
        "OUTBOUND_HTTP_TRUST_ENV": False,
    })
    make_http_client(configured)

    context = captured.pop("verify")
    assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
    assert captured == {"proxy": "http://proxy.test:8080", "trust_env": False}


@pytest.mark.parametrize("platform", ["win32", "linux"])
@pytest.mark.parametrize("trust_env", [False, True])
def test_system_trust_augments_windows_without_disabling_verification(settings, monkeypatch, platform, trust_env):
    calls = []
    captured = {}

    class Context:
        def load_default_certs(self, purpose):
            calls.append(purpose)

    context = Context()

    def create_context(**kwargs):
        assert kwargs == {"trust_env": trust_env}
        return context

    monkeypatch.setattr(http_module.sys, "platform", platform)
    monkeypatch.setattr(httpx, "create_ssl_context", create_context)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: captured.update(kwargs))
    make_http_client(settings.model_copy(update={"OUTBOUND_HTTP_TRUST_ENV": trust_env}))
    assert captured["verify"] is context
    assert captured["trust_env"] is trust_env
    assert calls == ([ssl.Purpose.SERVER_AUTH] if platform == "win32" else [])
