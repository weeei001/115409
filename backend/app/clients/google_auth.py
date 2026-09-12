from google.auth.exceptions import TransportError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from app.core.errors import AppError


def verify_google_id_token(token: str, audiences: list[str]) -> dict:
    if not audiences:
        raise AppError("Google OAuth not configured", status_code=503)
    for audience in audiences:
        try:
            return id_token.verify_oauth2_token(token, google_requests.Request(), audience)
        except ValueError:
            continue
        except TransportError:
            raise AppError("Google authentication unavailable", status_code=503) from None
    raise AppError("Invalid Google token", status_code=401)
