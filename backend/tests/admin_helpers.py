from uuid import uuid4

from app.db.models.admin import AdminAccount
from app.db.models.user import User
from app.features.auth.service import create_access_token


def credentials(db, settings, *, admin=False, active=True):
    user = User(email=f"{uuid4().hex}@example.com", is_active=active)
    db.add(user)
    db.flush()
    if admin:
        db.add(AdminAccount(user_id=user.id))
    db.commit()
    token, _ = create_access_token(user.id, settings)
    return user, {"Authorization": f"Bearer {token}"}
