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


OBSOLETE_ENVIRONMENT_VALUES = {
    "ANALYSIS_LLM_API_KEY": "obsolete-analysis-key",
    "ANALYSIS_LLM_BASE_URL": "https://obsolete-analysis.test/v1",
    "ANALYSIS_LLM_MODEL": "obsolete-analysis-model",
    "STREAM_LLM_API_KEY": "obsolete-stream-key",
    "STREAM_LLM_BASE_URL": "https://obsolete-stream.test/v1",
    "STREAM_LLM_MODEL": "obsolete-stream-model",
    "SSE_LLM_API_KEY": "obsolete-sse-key",
    "SSE_LLM_BASE_URL": "https://obsolete-sse.test/v1",
    "SSE_LLM_MODEL": "obsolete-sse-model",
    "CHAT_LLM_MODEL": "obsolete-chat-model",
    "H200_API_KEY": "obsolete-h200-key",
    "H200_BASE_URL": "https://obsolete-h200.test/v1",
    "H200_MODEL": "obsolete-h200-model",
    "RAG_LLM_API_KEY": "obsolete-rag-key",
    "RAG_LLM_BASE_URL": "https://obsolete-rag.test/v1",
    "RAG_LLM_MODEL": "obsolete-rag-model",
    "NIM_MODEL": "obsolete-nim-model",
    "NVIDIA_API_KEY": "obsolete-nvidia-key",
    "MYSQL_HOST": "obsolete-database.test",
    "MYSQL_PORT": "1234",
    "MYSQL_USER": "obsolete-user",
    "MYSQL_PASSWORD": "obsolete-password",
    "MYSQL_DATABASE": "obsolete-database",
}


@pytest.fixture(autouse=True)
def isolated_configuration(tmp_path, monkeypatch):
    names = {*config.Settings.model_fields, *OBSOLETE_ENVIRONMENT_VALUES, "APP_ENV"}
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


@pytest.mark.parametrize("source", ["environment", "dotenv"])
def test_shared_llm_ignores_obsolete_provider_settings(tmp_path, monkeypatch, source):
    values = {
        **OBSOLETE_ENVIRONMENT_VALUES,
        "LLM_API_KEY": "shared-key",
        "LLM_BASE_URL": "https://shared.test/v1",
        "LLM_MODEL": "shared-model",
        "EMBED_API_KEY": "embedding-key",
    }
    if source == "environment":
        for name, value in values.items():
            monkeypatch.setenv(name, value)
        settings = config.Settings(_env_file=None)
    else:
        path = tmp_path / ".env"
        path.write_text("\n".join(f"{name}={value}" for name, value in values.items()), encoding="utf-8")
        settings = config.Settings(_env_file=path)

    assert (settings.LLM_API_KEY, settings.LLM_BASE_URL, settings.LLM_MODEL) == (
        "shared-key", "https://shared.test/v1", "shared-model")
    assert settings.EMBED_API_KEY == "embedding-key"
    for name in ("STREAM_LLM_API_KEY", "STREAM_LLM_BASE_URL", "STREAM_LLM_MODEL", "CHAT_LLM_MODEL"):
        assert not hasattr(settings, name)


@pytest.mark.parametrize("source", ["environment", "dotenv"])
def test_obsolete_environment_aliases_do_not_supply_missing_settings(tmp_path, monkeypatch, source):
    if source == "environment":
        for name, value in OBSOLETE_ENVIRONMENT_VALUES.items():
            monkeypatch.setenv(name, value)
        settings = config.Settings(_env_file=None)
    else:
        path = tmp_path / ".env"
        path.write_text("\n".join(f"{name}={value}" for name, value in OBSOLETE_ENVIRONMENT_VALUES.items()),
                        encoding="utf-8")
        settings = config.Settings(_env_file=path)

    assert settings.LLM_API_KEY == settings.LLM_MODEL == settings.EMBED_API_KEY == ""
    assert settings.LLM_BASE_URL == "https://integrate.api.nvidia.com/v1"
    assert (settings.DATABASE_HOST, settings.DATABASE_PORT, settings.DATABASE_USER,
            settings.DATABASE_PASSWORD, settings.DATABASE_NAME) == ("localhost", 3306, "root", "", "topic_stock")


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
    monkeypatch.setenv(field, "production_fixture")
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
