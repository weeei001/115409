"""The impact CLI preserves bounded execution with an optional fixed start date."""
from contextlib import nullcontext, asynccontextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from app.jobs.impact import cli


@pytest.mark.parametrize('flags,failed,expected', [
    (['--since', '2026-01-01'], 0, 0),
    (['--since', '2026-01-01'], 1, 1),
    ([], 0, 0),
])
def test_cli_fixed_start_default_window_and_failed_exit(flags, failed, expected, monkeypatch, settings):
    seen = {}
    @asynccontextmanager
    async def http(_):
        yield object()
    class Runner:
        def __init__(self, **kwargs):
            seen.update(kwargs)
        async def run(self, *, since):
            seen['since'] = since
            return {'failed': failed, 'stopped_reason': None}
    monkeypatch.setattr(cli, 'get_settings', lambda: settings)
    monkeypatch.setattr(cli, 'load_catalog', lambda: {'2330': {'name': 'TSMC'}})
    monkeypatch.setattr(cli, 'worker_lock', lambda *_: nullcontext())
    monkeypatch.setattr(cli, 'make_engine', lambda _: SimpleNamespace(dispose=lambda: None))
    monkeypatch.setattr(cli, 'make_session_factory', lambda _: lambda: nullcontext(object()))
    monkeypatch.setattr(cli, 'make_http_client', http)
    monkeypatch.setattr(cli, 'ImpactBatchRunner', Runner)
    before = datetime.now(cli.TAIPEI_TZ).replace(tzinfo=None) - timedelta(days=30)
    assert cli.main(flags) == expected
    if flags:
        assert seen['since'] == datetime(2026, 1, 1)
    else:
        after = datetime.now(cli.TAIPEI_TZ).replace(tzinfo=None) - timedelta(days=30)
        assert before <= seen['since'] <= after
    assert seen['limit'] == 100 and seen['max_cost_usd'] == 0.5 and seen['execute'] is False


@pytest.mark.parametrize('flags', [
    ['--since', 'invalid'], ['--since', '2026-01-01', '--backfill-days', '10'],
])
def test_cli_rejects_ambiguous_window_before_loading_settings(flags, monkeypatch):
    monkeypatch.setattr(cli, 'get_settings', lambda: pytest.fail('No external initialization'))
    with pytest.raises(SystemExit) as error:
        cli.main(flags)
    assert error.value.code == 2
