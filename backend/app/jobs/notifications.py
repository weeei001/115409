"""Explicit notification generation and FCM dispatch worker."""
import argparse
import json


def run_cycle(settings, session_factory):
    from app.clients.fcm import FCMClient
    from app.features.market.company_catalog import load_catalog
    from app.features.news.impact import config_hash
    from app.features.notifications.delivery import dispatch_notifications
    from app.features.notifications.engine import generate_notifications

    if not settings.NOTIFICATIONS_ENABLED:
        return {"enabled": False, "created": 0, "sent": 0}
    catalog = load_catalog()
    with session_factory() as db:
        created = generate_notifications(db, impact_config_hash=config_hash(settings, catalog) if catalog else None)
        result = (dispatch_notifications(db, FCMClient(settings)) if settings.FCM_ENABLED
                  else {"sent": 0, "retry": 0, "invalid": 0})
    return {"enabled": True, "created": created, **result}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate favorite-stock notifications and send via FCM")
    parser.add_argument("--execute", action="store_true", help="Write notification records and send enabled FCM notifications")
    args = parser.parse_args(argv)
    if not args.execute:
        parser.print_help()
        return 0
    from app.core.config import get_settings
    from app.db.engine import make_engine, make_session_factory
    from app.jobs.locking import worker_lock

    settings = get_settings()
    if not settings.NOTIFICATIONS_ENABLED:
        print(json.dumps({"enabled": False, "created": 0, "sent": 0}))
        return 0
    with worker_lock("notifications"):
        engine = make_engine(settings)
        try:
            print(json.dumps(run_cycle(settings, make_session_factory(engine))))
        finally:
            engine.dispose()
    return 0
