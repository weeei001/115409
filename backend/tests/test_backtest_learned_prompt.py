"""Offline coverage for held-out prompt evaluation and artifact compatibility."""

import csv
import json
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.jobs.research import backtest_learned_prompt as blp


@pytest.fixture
def methodology_dir(tmp_path):
    directory = tmp_path / "methodology"
    directory.mkdir()
    (directory / "best.json").write_text(json.dumps({
        "version": 2, "train_end": "2024-12-31", "stock": "2330",
    }), encoding="utf-8")
    (directory / "prompt_v2.txt").write_text("Learned {context_block}", encoding="utf-8")
    (directory / "prompt_v1.txt").write_text("Previous {context_block}", encoding="utf-8")
    return directory


def _args(directory, **overrides):
    values = dict(stock="2330", start="2025-01-01", end="2025-12-31", horizon=20,
                  neutral_band=None, provider="h200", period="week", window_days=14,
                  methodology_dir=str(directory), prompt_version=None,
                  limit=3, out_dir=str(directory.parent / "out"), seed=42)
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.fixture
def services(monkeypatch):
    rows = []
    day = date(2024, 12, 1)
    while day <= date(2026, 3, 1):
        if day.weekday() < 5:
            rows.append((day.isoformat(), 100 + len(rows) * 0.4))
        day += timedelta(days=1)
    monkeypatch.setattr(blp, "load_price_frame", lambda *a: rows)
    monkeypatch.setattr(blp, "fetch_prices", lambda *a, **kw: [100.0] * 20)
    monkeypatch.setattr(blp, "compute_technical", lambda closes: {"available": False})
    monkeypatch.setattr(blp, "fetch_pit_articles", lambda *a, **kw: ([], []))
    monkeypatch.setattr(blp, "build_qdrant_embeddings", lambda: (None, None))
    monkeypatch.setattr(blp, "make_h200_client", lambda: (object(), "test-model"))
    monkeypatch.setattr(blp, "make_nim_client", lambda: (object(), "test-model"))
    monkeypatch.setattr(blp.time, "sleep", lambda *_: None)
    calls = []

    def predict(*a, prompt_template=None, **kw):
        calls.append((a, prompt_template))
        return 5.0 if prompt_template is None else 1.0

    monkeypatch.setattr(blp, "predict_change_pct", predict)
    return calls


def test_methodology_versions(methodology_dir):
    assert blp.load_methodology(methodology_dir, None) == (
        "Learned {context_block}", 2, "2024-12-31")
    assert blp.load_methodology(methodology_dir, 1)[0] == "Previous {context_block}"


@pytest.mark.parametrize("overrides", [
    {"start": "2024-06-01"}, {"start": "invalid"}, {"end": "2024-12-31"},
    {"horizon": 0}, {"window_days": -1}, {"limit": 0}, {"prompt_version": -1},
    {"neutral_band": float("nan")}, {"neutral_band": float("inf")}, {"neutral_band": -1},
])
def test_invalid_configuration_rejected_before_services(methodology_dir, overrides):
    with pytest.raises(ValueError):
        blp.run(_args(methodology_dir, **overrides))


def test_end_to_end_artifacts_and_relative_methodology(methodology_dir, services, monkeypatch):
    monkeypatch.chdir(methodology_dir.parent)
    args = _args(methodology_dir, methodology_dir="methodology", limit=6)
    result = blp.run(args)
    metrics = json.loads((result / "metrics.json").read_text(encoding="utf-8"))
    with (result / "decisions.csv").open(encoding="utf-8", newline="") as stream:
        decisions = list(csv.DictReader(stream))
    assert len(services) == len(decisions) == 12
    assert set(metrics["arms"]) == {"A", "L"}
    assert metrics["arms"]["A"]["hit_rate"] == 1.0
    assert metrics["arms"]["L"]["hit_rate"] == 0.0
    assert metrics["mcnemar_sign_test"]["a_wins"] == 6
    assert metrics["mcnemar_sign_test"]["b_wins"] == 0
    assert metrics["verdict"]["passed"] is False
    assert metrics["config"]["prompt_version"] == 2
    assert {row["prompt_version"] for row in decisions} == {blp.DEFAULT_PROMPT_VERSION, "L_v2"}


def test_cache_tracks_prompt_context_provider_model(methodology_dir, services, monkeypatch):
    args = _args(methodology_dir, limit=1)
    blp.run(args)
    assert len(services) == 2
    blp.run(args)
    assert len(services) == 2
    (methodology_dir / "prompt_v2.txt").write_text("Updated {context_block}", encoding="utf-8")
    blp.run(args)
    assert len(services) == 3
    monkeypatch.setattr(blp, "build_context_from_pit", lambda *a: "Changed evidence")
    blp.run(args)
    assert len(services) == 5
    args.provider = "nim"
    blp.run(args)
    assert len(services) == 7
    monkeypatch.setattr(blp, "make_nim_client", lambda: (object(), "new-model"))
    blp.run(args)
    assert len(services) == 9


def test_day_anchors_filter_nontrading_days_before_limit(methodology_dir, services, monkeypatch):
    monkeypatch.setattr(blp, "load_price_frame", lambda *a: [
        ("2025-01-03", 100.0), ("2025-01-06", 101.0), ("2025-01-07", 102.0),
    ])
    out = blp.run(_args(methodology_dir, start="2025-01-03", end="2025-01-06",
                        period="day", horizon=1, limit=2))
    metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert {call[0][3] for call in services} == {"2025-01-03", "2025-01-06"}
    assert metrics["config"]["period"] == "day"
    assert metrics["coverage"]["n_valid_as_of"] == 2


def test_empty_anchors_write_artifacts_without_clients(methodology_dir, monkeypatch):
    monkeypatch.setattr(blp, "load_price_frame", lambda *a: [])
    out = blp.run(_args(methodology_dir, start="2025-01-04", end="2025-01-05"))
    metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["coverage"]["n_valid_as_of"] == 0
    assert metrics["arms"]["A"]["hit_rate"] is None
    assert json.loads((out / "predictions_cache.json").read_text(encoding="utf-8")) == {}


def test_failed_predictions_are_paired_exclusions_and_retried(methodology_dir, services, monkeypatch):
    calls = []

    def predict(*a, prompt_template=None, **kw):
        calls.append(prompt_template)
        return None if prompt_template is not None else 5.0

    monkeypatch.setattr(blp, "predict_change_pct", predict)
    args = _args(methodology_dir, limit=1)
    out = blp.run(args)
    metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["coverage"]["n_valid_as_of"] == 0
    with (out / "decisions.csv").open(encoding="utf-8", newline="") as stream:
        decisions = list(csv.DictReader(stream))
    assert len(decisions) == 2
    assert all(row["skipped_reason"] == "llm_failed" for row in decisions)
    blp.run(args)
    assert len(calls) == 3


def test_main_forwards_arguments_and_returns_success(methodology_dir, monkeypatch):
    seen = []
    monkeypatch.setattr(blp, "run", lambda args: seen.append(args))
    assert blp.main(["--methodology-dir", str(methodology_dir), "--horizon", "5"]) == 0
    assert seen[0].horizon == 5
    with pytest.raises(SystemExit) as exc:
        blp.main(["--methodology-dir", str(methodology_dir), "--horizon", "0"])
    assert exc.value.code == 2
