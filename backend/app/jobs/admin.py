"""Explicit administrator bootstrap against this environment's configured database."""
import argparse
import json


def main(argv=None):
    parser = argparse.ArgumentParser(description="Grant administrator access to an existing active account")
    parser.add_argument("--email", required=True)
    args = parser.parse_args(argv)
    from app.core.config import get_settings
    from app.db.engine import make_engine, make_session_factory
    from app.features.admin.service import bootstrap_administrator

    engine = make_engine(get_settings())
    try:
        with make_session_factory(engine)() as db:
            user_id = bootstrap_administrator(db, args.email)
        print(json.dumps({"message": "Administrator granted", "user_id": user_id}))
    finally:
        engine.dispose()
    return 0
