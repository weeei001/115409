from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.db.models.admin import AdminAccount, AdminAuditLog, AdminJobRun
from app.db.models.user import User
from app.db.models.stock_info import StockInfo


def supported_stocks(db: Session):
    return list(db.scalars(select(StockInfo).order_by(StockInfo.symbol)))


def add_stock(db: Session, symbol: str, company: dict) -> None:
    db.add(StockInfo(symbol=symbol, name=company["name"], industry=company.get("industry_name")))


def is_admin(db: Session, user_id: int) -> bool:
    return db.scalar(select(AdminAccount.user_id).where(AdminAccount.user_id == user_id)) is not None


def administrators(db: Session, *, lock: bool = False):
    query = select(AdminAccount, User).join(User, User.id == AdminAccount.user_id).order_by(AdminAccount.user_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return db.execute(query).all()


def account_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.strip().lower()))


def runs(db: Session, limit: int, offset: int = 0, job_name: str | None = None):
    query = select(AdminJobRun)
    count = select(func.count()).select_from(AdminJobRun)
    if job_name:
        query = query.where(AdminJobRun.job_name == job_name)
        count = count.where(AdminJobRun.job_name == job_name)
    return list(db.scalars(query.order_by(AdminJobRun.id.desc()).limit(limit).offset(offset))), db.scalar(count)


def run_by_id(db: Session, run_id: int):
    return db.get(AdminJobRun, run_id)


def job_results(db: Session, job_name: str):
    terminal = select(AdminJobRun).where(AdminJobRun.job_name == job_name,
        AdminJobRun.status.in_(["succeeded", "failed", "interrupted"]))
    latest = lambda status: db.scalar(terminal.where(AdminJobRun.status == status).order_by(AdminJobRun.id.desc()).limit(1))
    boundary = db.scalar(select(func.max(AdminJobRun.id)).where(AdminJobRun.job_name == job_name,
        AdminJobRun.status.in_(["succeeded", "interrupted"]))) or 0
    streak = db.scalar(select(func.count()).select_from(AdminJobRun).where(AdminJobRun.job_name == job_name,
        AdminJobRun.status == "failed", AdminJobRun.id > boundary))
    total = db.scalar(select(func.count()).select_from(terminal.subquery()))
    return latest("succeeded"), latest("failed"), streak, total


def audit_logs(db: Session, limit: int, offset: int = 0):
    return (list(db.scalars(select(AdminAuditLog).order_by(AdminAuditLog.id.desc()).limit(limit).offset(offset))),
            db.scalar(select(func.count()).select_from(AdminAuditLog)))


def ping(db: Session) -> None:
    db.execute(text("SELECT 1"))
