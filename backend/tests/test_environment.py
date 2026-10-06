"""Environment selection and resource isolation without external services."""
import argparse
import builtins
import json
from pathlib import Path

import pytest

from app.clients.vector import VectorClient
from app.clients.vector_writer import VectorWriter
from app.core import config
from app.db import engine
from app.features.market import company_catalog
from app.jobs import locking, market_history, scheduler
from app.jobs.impact import cli as impact


@pytest.fixture(autouse=True)
def isolated_configuration(tmp_path, monkeypatch):
    names = {*config.Settings.model_fields, "APP_ENV"}
    names.update(alias for field in config.Settings.model_fields.values()
                 for alias in getattr(field.validation_alias, "choices", []))
    for name in names:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(config, "BACKEND_DIR", tmp_path)
    config.get_settings.cache_clear()
    yield
    config.get_settings.cache_clear()


def development_file(directory, **overrides):
    fields = dict(DATABASE_NAME="topic_stock_dev", DATABASE_USER="stock_app_dev",
                  QDRANT_COLLECTION="news_chunks_dev")
    fields.update(overrides)
    (directory / ".env.development").write_text(
        "\n".join(f"{name}={value}" for name, value in fields.items()), encoding="utf-8")


@pytest.mark.parametrize("environment", [None, "production"])
def test_production_preserves_existing_dotenv_and_disabled_file_seam(tmp_path, monkeypatch, environment):
    if environment is not None:
        monkeypatch.setenv("APP_ENV", environment)
    path = tmp_path / ".env"
    path.write_text("DATABASE_NAME=production_fixture\n", encoding="utf-8")
    monkeypatch.setitem(config.Settings.model_config, "env_file", path)
    assert config.get_settings().DATABASE_NAME == "production_fixture"
    assert config.Settings(_env_file=None).DATABASE_NAME == "topic_stock"
    assert config.Settings(_env_file=None).SIMULATION_CACHE_DIR == tmp_path / ".state" / "simulation"


def test_development_reads_only_its_file_and_fails_when_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    production = tmp_path / ".env"
    production.write_text("DATABASE_NAME=production_fixture\n", encoding="utf-8")
    monkeypatch.setitem(config.Settings.model_config, "env_file", production)
    original_open = builtins.open

    def guarded_open(file, *args, **kwargs):
        if isinstance(file, (str, Path)) and Path(file) == production:
            pytest.fail("Development must not read production dotenv")
        return original_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", guarded_open)
    with pytest.raises(ValueError, match="Development configuration is missing"):
        config.get_settings()
    development_file(tmp_path)
    settings = config.get_settings()
    assert settings.DATABASE_NAME == "topic_stock_dev"
    assert settings.DATABASE_USER == "stock_app_dev"
    assert settings.QDRANT_COLLECTION == "news_chunks_dev"
    assert settings.SIMULATION_CACHE_DIR == tmp_path / ".state" / "development" / "simulation"
    assert config.Settings(_env_file=None).DATABASE_NAME == "topic_stock"


@pytest.mark.parametrize("environment", ["", "developement", "Production"])
def test_unknown_environment_fails_before_loading_settings(monkeypatch, environment):
    monkeypatch.setenv("APP_ENV", environment)
    with pytest.raises(ValueError, match="APP_ENV must be production or development"):
        config.get_settings()


@pytest.mark.parametrize("field", ["DATABASE_NAME", "DATABASE_USER", "QDRANT_COLLECTION"])
def test_development_rejects_unsafe_names_in_files_and_inherited_environment(tmp_path, monkeypatch, field):
    monkeypatch.setenv("APP_ENV", "development")
    development_file(tmp_path, **{field: "production_fixture"})
    with pytest.raises(ValueError, match=field):
        config.get_settings()
    development_file(tmp_path)
    alias = {"DATABASE_NAME": "MYSQL_DATABASE", "DATABASE_USER": "MYSQL_USER"}.get(field, field)
    monkeypatch.setenv(alias, "production_fixture")
    with pytest.raises(ValueError, match=field):
        config.get_settings()


def test_resource_boundaries_reject_unvalidated_model_copy_overrides(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    development_file(tmp_path)
    settings = config.get_settings()
    calls = []
    monkeypatch.setattr(engine, "create_engine", lambda url, **kwargs: calls.append(url) or "engine")
    for field in ("DATABASE_NAME", "DATABASE_USER"):
        with pytest.raises(ValueError, match=field):
            engine.make_engine(settings.model_copy(update={field: "production_fixture"}))
    assert not calls
    assert engine.make_engine(settings) == "engine"
    assert calls[0].database == "topic_stock_dev" and calls[0].username == "stock_app_dev"
    unsafe = settings.model_copy(update={"QDRANT_COLLECTION": "production_fixture"})
    for client in (VectorClient, VectorWriter):
        with pytest.raises(ValueError, match="QDRANT_COLLECTION"):
            client(None, unsafe)
        assert client(None, settings).settings is settings


@pytest.mark.parametrize("environment", ["production", "development"])
def test_catalog_locks_simulation_and_worker_defaults_are_isolated(tmp_path, monkeypatch, environment):
    monkeypatch.setenv("APP_ENV", environment)
    root = tmp_path / ".state"
    selected = root / "development" if environment == "development" else root
    for directory, symbol in ((root, "production"), (root / "development", "development")):
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "company_catalog.json").write_text(json.dumps({symbol: {}}), encoding="utf-8")
    assert company_catalog.load_catalog() == market_history._load_catalog() == {environment: {}}
    assert config.Settings(_env_file=None).SIMULATION_CACHE_DIR == selected / "simulation"
    with locking.worker_lock("isolation-test"):
        assert (selected / "isolation-test.lock").is_file()

    class ParsedDefaults(Exception):
        pass

    defaults = []

    def capture(parser, *args, **kwargs):
        defaults.append((parser.get_default("out"), parser.get_default("work_dir")))
        raise ParsedDefaults

    monkeypatch.setattr(argparse.ArgumentParser, "parse_args", capture)
    for entry in (scheduler.main, impact.main, market_history.main):
        with pytest.raises(ParsedDefaults):
            entry([])
    historical = selected if environment == "development" else Path(".state")
    assert defaults == [(selected / "market", None), (None, selected),
                        (historical / "market" / "history_2y.json", None)]
