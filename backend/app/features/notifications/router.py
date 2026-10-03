from fastapi import APIRouter

from app.features.auth.router import CurrentUser, Database
from app.features.notifications import service
from app.features.notifications.schemas import DeviceToken, NotificationInbox, NotificationPreferences, RegisterDevice


router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("/preferences", response_model=NotificationPreferences)
def get_preferences(user: CurrentUser, db: Database):
    return service.get_preferences(db, user)


@router.put("/preferences", response_model=NotificationPreferences)
def update_preferences(body: NotificationPreferences, user: CurrentUser, db: Database):
    return service.update_preferences(db, user, body)


@router.post("/devices", status_code=204)
def register_device(body: RegisterDevice, user: CurrentUser, db: Database):
    service.register_device(db, user, body)


@router.delete("/devices", status_code=204)
def remove_device(body: DeviceToken, user: CurrentUser, db: Database):
    service.remove_device(db, user, body.token)


@router.get("/inbox", response_model=NotificationInbox)
def inbox(user: CurrentUser, db: Database):
    return service.get_inbox(db, user)
