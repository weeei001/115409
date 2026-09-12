import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import Settings


logger = logging.getLogger(__name__)


def send_password_reset_email(to_email: str, reset_link: str, settings: Settings) -> bool:
    if not settings.SMTP_HOST.strip():
        return False
    sender = (settings.SMTP_FROM or settings.SMTP_USER).strip()
    if not sender:
        return False
    message = MIMEMultipart("alternative")
    message["Subject"] = "重設密碼"
    message["From"] = sender
    message["To"] = to_email
    message.attach(MIMEText(
        f"請在 {settings.PASSWORD_RESET_EXPIRE_MINUTES} 分鐘內點擊以下連結重設密碼：\n\n{reset_link}\n",
        "plain", "utf-8",
    ))
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(sender, [to_email], message.as_string())
    except (OSError, smtplib.SMTPException):
        logger.warning("Password reset email delivery failed")
        return False
    return True
