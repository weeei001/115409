import httpx

from app.core.http import make_http_client


def test_outbound_http_defaults_to_direct_connections(settings, monkeypatch):
    captured = {}

    class StubAsyncClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", StubAsyncClient)
    make_http_client(settings)

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

    assert captured == {"proxy": "http://proxy.test:8080", "trust_env": False}
