import pytest

from app.jobs import paper_portfolio, scheduler
from datetime import date


@pytest.mark.parametrize("args", [[], ["--help"]])
def test_worker_requires_explicit_execution_before_loading_settings(args, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config, "get_settings", lambda: pytest.fail("Must not load local settings"))
    if args:
        with pytest.raises(SystemExit) as result:
            paper_portfolio.main(args)
        assert result.value.code == 0
    else:
        assert paper_portfolio.main(args) == 0


@pytest.mark.parametrize("failure", ["market-import", "market-backfill"])
def test_missing_market_inputs_prevent_settlement(tmp_path, failure):
    commands = []

    def run(command):
        commands.append(command[0])
        return 1 if command[0] == failure else 0

    assert scheduler.run_pipeline("market", start=date(2026, 1, 1), symbols=None,
                                  output=tmp_path, run=run) == 1
    assert "paper-reconcile" not in commands
