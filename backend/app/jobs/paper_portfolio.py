"""Settle paper orders and create due reviews after daily market imports."""
import argparse
import json


def run_cycle(session_factory):
    from app.features.paper_portfolio.service import reconcile

    with session_factory() as db:
        return reconcile(db)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Settle pending paper orders using stored daily prices")
    parser.add_argument("--execute", action="store_true", help="Write fills, account balances and due reviews")
    args = parser.parse_args(argv)
    if not args.execute:
        parser.print_help()
        return 0

    from app.core.config import get_settings
    from app.db.engine import make_engine, make_session_factory
    from app.jobs.locking import worker_lock

    with worker_lock("paper-portfolio"):
        engine = make_engine(get_settings())
        try:
            result = run_cycle(make_session_factory(engine))
            print(json.dumps(result, default=str, sort_keys=True))
        finally:
            engine.dispose()
    return 0
