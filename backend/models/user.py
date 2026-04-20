from sqlalchemy import Boolean, Column, DateTime, Integer, String, func

from database import Base


class User(Base):
    __tablename__ = "users"

    # Integer：SQLite 需 INTEGER PRIMARY KEY 才有自動遞增 id；MySQL 對應 INT AUTO_INCREMENT
    id = Column(Integer, primary_key=True, autoincrement=True, comment="內部主鍵")
    email = Column(String(255), nullable=False, unique=True, index=True, comment="登入 email（正規化小寫）")
    password_hash = Column(String(255), nullable=True, comment="bcrypt；僅 Google 註冊可為 NULL")
    google_sub = Column(String(255), nullable=True, unique=True, index=True, comment="Google OpenID sub")
    display_name = Column(String(255), nullable=True, comment="顯示名稱")
    is_active = Column(Boolean, nullable=False, default=True, comment="是否啟用")
    created_at = Column(DateTime, nullable=False, server_default=func.now(), comment="建立時間")
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新時間")

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email='{self.email}')>"
