"""共用對外 HTTP client，明確設定代理與 TLS 信任來源。"""
import ssl
import sys
from typing import Any

import httpx


def make_http_client(settings: Any) -> httpx.AsyncClient:
    """預設不繼承環境代理；Windows 額外採用系統已信任的憑證。"""
    context = httpx.create_ssl_context(trust_env=settings.OUTBOUND_HTTP_TRUST_ENV)
    if sys.platform == "win32":
        # 保留原有 CA，加入 Windows 信任存放區以支援端點防護的 HTTPS 檢查。
        # 仍強制驗證憑證鏈與主機名稱，不接受未受信任的自簽憑證。
        context.load_default_certs(ssl.Purpose.SERVER_AUTH)
    return httpx.AsyncClient(
        verify=context,
        proxy=settings.OUTBOUND_HTTP_PROXY.strip() or None,
        trust_env=settings.OUTBOUND_HTTP_TRUST_ENV,
    )
