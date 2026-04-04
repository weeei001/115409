from datetime import datetime, timedelta, timezone

import jwt

from config import get_settings


def create_access_token(user_id: int) -> tuple[str, int]:
    """回傳 (jwt 字串, expires_in 秒)。"""
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expire}
    token = jwt.encode(
        payload,
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
    if isinstance(token, bytes):
        token = token.decode("ascii")
    expires_in = int(settings.JWT_EXPIRE_MINUTES * 60)
    return token, expires_in


def decode_access_token(token: str) -> int:
    """成功時回傳 user id；失敗拋出 jwt.PyJWTError。"""
    settings = get_settings()
    payload = jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[settings.JWT_ALGORITHM],
    )
    sub = payload.get("sub")
    if sub is None:
        raise jwt.InvalidTokenError("missing sub")
    return int(sub)
