"""驗證 Google Sign-In 的 id_token（可於測試中 patch）。"""

from __future__ import annotations

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token


def verify_google_id_token(token: str, audiences: list[str]) -> dict:
    """
    使用 Google 公鑰驗證 JWT；audiences 為允許的 client id 清單（逐一嘗試）。
    成功回傳 idinfo dict（含 sub, email, email_verified 等）。
    """
    if not audiences:
        raise ValueError("Google OAuth not configured")
    last_err: Exception | None = None
    for aud in audiences:
        try:
            return id_token.verify_oauth2_token(token, google_requests.Request(), aud)
        except ValueError as e:
            last_err = e
            continue
    raise ValueError(str(last_err) if last_err else "Invalid Google token")
