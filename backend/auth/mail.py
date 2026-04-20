"""Optional SMTP email for password reset (plaintext TLS)."""

from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import get_settings

logger = logging.getLogger(__name__)


def send_password_reset_email(to_email: str, reset_link: str) -> bool:
    """
    寄送重設密碼信。若未設定 SMTP_HOST 則不寄送；
    DEBUG=True 時會在 log 記錄連結（僅開發用）。
    """
    settings = get_settings()
    if not (settings.SMTP_HOST or "").strip():
        if settings.DEBUG:
            logger.info(
                "Password reset email skipped (SMTP not configured). Link (dev only): %s",
                reset_link,
            )
        return False

    from_addr = (settings.SMTP_FROM or settings.SMTP_USER or "").strip()
    if not from_addr:
        logger.warning("SMTP_FROM / SMTP_USER empty; cannot send password reset email")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "重設密碼"
    msg["From"] = from_addr
    msg["To"] = to_email
    text = f"請在 {settings.PASSWORD_RESET_EXPIRE_MINUTES} 分鐘內點擊以下連結重設密碼：\n\n{reset_link}\n"
    msg.attach(MIMEText(text, "plain", "utf-8"))

    try:
        if settings.SMTP_USE_TLS:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
                server.starttls()
                if settings.SMTP_USER:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(from_addr, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
                if settings.SMTP_USER:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(from_addr, [to_email], msg.as_string())
    except OSError as e:
        logger.exception("SMTP send failed: %s", e)
        return False
    return True
