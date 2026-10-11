import httpx
import ssl

import pytest

from app.core import http as http_module

from app.core.http import make_http_client, make_sync_http_client


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


@pytest.mark.parametrize("trust_env", [False, True])
def test_sync_http_preserves_request_options_and_settings_policy(settings, monkeypatch, trust_env):
    captured = {}
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: captured.update(kwargs))
    configured = settings.model_copy(update={"OUTBOUND_HTTP_TRUST_ENV": trust_env,
                                             "OUTBOUND_HTTP_PROXY": " http://proxy.test:8080 "})
    transport = httpx.MockTransport(lambda request: httpx.Response(200))
    make_sync_http_client(configured, timeout=12, follow_redirects=True, transport=transport,
                          headers={"User-Agent": "Test worker"})
    context = captured.pop("verify")
    assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
    assert captured == {"proxy": "http://proxy.test:8080", "trust_env": trust_env,
                        "timeout": 12, "follow_redirects": True, "transport": transport,
                        "headers": {"User-Agent": "Test worker"}}


def test_sync_http_accepts_explicit_proxy_and_environment_overrides(settings, monkeypatch):
    captured = {}
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: captured.update(kwargs))
    make_sync_http_client(settings, proxy="http://override.test:8080", trust_env=True)
    assert captured["proxy"] == "http://override.test:8080" and captured["trust_env"] is True
    with pytest.raises(ValueError, match="TLS verification"):
        make_sync_http_client(settings, verify=False)


def test_sync_http_uses_windows_system_trust(settings, monkeypatch):
    calls, captured = [], {}
    class Context:
        def load_default_certs(self, purpose):
            calls.append(purpose)
    context = Context()
    monkeypatch.setattr(http_module.sys, "platform", "win32")
    monkeypatch.setattr(httpx, "create_ssl_context", lambda **kwargs: context)
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: captured.update(kwargs))
    make_sync_http_client(settings)
    assert captured["verify"] is context and calls == [ssl.Purpose.SERVER_AUTH]


def test_market_request_diagnostic_omits_credentials_query_and_response_body():
    from app.jobs.market_history import OfficialClient, OfficialRequestError
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(
            503, text="private server response"))) as http:
        with pytest.raises(OfficialRequestError) as caught:
            OfficialClient(http, interval=0, retries=0).json(
                "GET", "https://user:secret@example.test/official/report?token=secret")
    assert str(caught.value) == "stage=official_request path=/official/report status=503 error=HTTPStatusError"
