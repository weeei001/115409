"""Build frontend reset URL with token query param."""

from urllib.parse import quote, urlsplit, urlunsplit


def build_password_reset_link(base_url: str, raw_token: str) -> str:
    """
    base_url: FRONTEND_PASSWORD_RESET_URL，例 https://app.com/reset-password
    若 base 已含 query，則用 &token= 串接。
    """
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return ""
    tok = quote(raw_token, safe="")
    parts = urlsplit(base)
    q = parts.query
    if q:
        new_q = f"{q}&token={tok}"
    else:
        new_q = f"token={tok}"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, new_q, parts.fragment))
