from contextlib import nullcontext
from types import SimpleNamespace

import pytest
from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine

from app.jobs import data_publish as publish
from app.jobs.data_rebuild import PUBLIC_DATA_TABLES


@pytest.fixture
def planning(monkeypatch):
    state = SimpleNamespace(version="8.4.6", keys=[], triggers=[], archive_tables=[],
        engine_name="InnoDB", missing=None, foreign_keys={}, statements=[], filtered_bad=False)

    class Result:
        def __init__(self, value):
            self.value = value
        def scalar_one(self):
            return self.value
        def mappings(self):
            return iter(self.value)

    class Connection:
        def begin(self):
            return nullcontext()
        def execute(self, statement, parameters=None):
            sql = str(statement)
            state.statements.append(sql)
            assert sql.startswith("SELECT"), "Planning must never execute mutations"
            if "VERSION()" in sql:
                return Result(state.version)
            if "KEY_COLUMN_USAGE" in sql:
                return Result(state.keys)
            if "TRIGGERS" in sql:
                return Result(state.triggers)
            raise AssertionError(sql)

    class Inspector:
        def get_schema_names(self):
            return ["stage", "prod", "archive"]
        def get_table_names(self, schema):
            if schema == "archive":
                return state.archive_tables
            return [name for name in PUBLIC_DATA_TABLES if name != state.missing] + ["users"]
        def get_view_names(self, schema):
            return []
        def get_table_options(self, name, schema):
            return {"mysql_engine": state.engine_name}
        def get_foreign_keys(self, name, schema):
            return state.foreign_keys.get((schema, name), [])

    table_maps = {database: {name: Table(name, MetaData(), Column("id", String(64), primary_key=True))
                           for name in (*PUBLIC_DATA_TABLES, "users")}
                  for database in ("stage", "prod")}

    def tables(connection, database, names):
        return {name: table_maps[database][name] for name in names}

    def manifest(connection, tables, *, filtered=False, batch_size=500):
        return {name: {"rows": 1, "sha256": "different" if filtered and state.filtered_bad else "hash",
                       "schema_sha256": "schema"} for name in tables}

    monkeypatch.setattr(publish, "inspect", lambda connection: Inspector())
    monkeypatch.setattr(publish, "_tables", tables)
    monkeypatch.setattr(publish, "_manifest", manifest)
    state.table_maps = table_maps
    state.engine = SimpleNamespace(dialect=SimpleNamespace(name="mysql"),
                                   connect=lambda: nullcontext(Connection()))
    state.report = dict.fromkeys(publish.REQUIRED_VALIDATIONS, True)
    state.plan = lambda **kwargs: publish.prepare_publish_plan(state.engine,
        stage_database="stage", target_database="prod", archive_database="archive",
        validation_report=state.report, **kwargs)
    return state


def test_plan_swaps_all_public_tables_in_one_statement_and_builds_inverse(planning):
    plan = planning.plan()
    assert not plan["executed"] and plan["tables"] == list(PUBLIC_DATA_TABLES)
    for sql in (plan["sql"], plan["rollback_sql"]):
        assert sql.count("RENAME TABLE") == 1 and sql.count(" TO ") == 2 * len(PUBLIC_DATA_TABLES)
        assert "users" not in sql and "llm_responses" not in sql
    for name in PUBLIC_DATA_TABLES:
        assert f"`prod`.`{name}` TO `archive`.`{name}`" in plan["sql"]
        assert f"`stage`.`{name}` TO `prod`.`{name}`" in plan["sql"]
        assert f"`prod`.`{name}` TO `stage`.`{name}`" in plan["rollback_sql"]
        assert f"`archive`.`{name}` TO `prod`.`{name}`" in plan["rollback_sql"]
    assert plan["sql"].index("`stage`.`stock_info`") > plan["sql"].index("`prod`.`news_event_impacts`")
    assert set(plan["private_snapshot"]) == {"users"}
    assert all(statement.startswith("SELECT") for statement in planning.statements)


@pytest.mark.parametrize("flag", publish.REQUIRED_VALIDATIONS)
@pytest.mark.parametrize("value", [False, None, 1, "true"])
def test_validation_requires_explicit_complete_results_before_connecting(planning, flag, value):
    planning.report[flag] = value
    with pytest.raises(ValueError, match="validation report"):
        planning.plan()
    assert planning.statements == []


@pytest.mark.parametrize("name", ["prod;DROP", "prod-name", "prod.name", "`prod`", "", "正式"])
def test_rejects_unsafe_database_identifiers(planning, name):
    with pytest.raises(ValueError, match="identifiers"):
        publish.prepare_publish_plan(planning.engine, stage_database=name, target_database="prod",
                                     archive_database="archive", validation_report=planning.report)
    assert planning.statements == []


def test_rejects_database_alias_by_case(planning):
    with pytest.raises(ValueError, match="distinct"):
        publish.prepare_publish_plan(planning.engine, stage_database="PROD", target_database="prod",
                                     archive_database="archive", validation_report=planning.report)


@pytest.mark.parametrize("version", ["5.7.44", "10.11.7-MariaDB", "unknown"])
def test_rejects_servers_without_mysql_atomic_ddl_contract(planning, version):
    planning.version = version
    with pytest.raises(ValueError, match="MySQL 8"):
        planning.plan()


@pytest.mark.parametrize("kind,message", [("archive", "Archive database must be empty"),
    ("missing", "Missing public tables"), ("engine", "InnoDB"), ("trigger", "triggers"),
    ("schema", "schema mismatch"), ("news", "non-Cnyes"), ("manifest", "no longer matches")])
def test_rejects_unpublishable_stage_before_returning_sql(planning, kind, message):
    if kind == "archive":
        planning.archive_tables = ["old_backup"]
    elif kind == "missing":
        planning.missing = "news_chunks"
    elif kind == "engine":
        planning.engine_name = "MyISAM"
    elif kind == "trigger":
        planning.triggers = [{"TRIGGER_SCHEMA": "stage", "EVENT_OBJECT_TABLE": "stock_info"}]
    elif kind == "schema":
        planning.table_maps["stage"]["stock_info"].append_column(Column("extra", String))
    elif kind == "news":
        planning.filtered_bad = True
    elif kind == "manifest":
        planning.report["tables"] = {}
    with pytest.raises(ValueError, match=message):
        planning.plan()


def key(owner_schema, owner_table, referred_schema, referred_table, name="fk_article"):
    return {"TABLE_SCHEMA": owner_schema, "TABLE_NAME": owner_table, "CONSTRAINT_NAME": name,
            "REFERENCED_TABLE_SCHEMA": referred_schema, "REFERENCED_TABLE_NAME": referred_table}


@pytest.mark.parametrize("foreign_key", [
    key("prod", "users", "prod", "news_articles"),
    key("other", "saved_news", "prod", "news_articles"),
    key("stage", "news_event_analyses", "prod", "news_articles"),
    key("stage", "news_articles", "stage", "users"),
])
def test_rejects_foreign_keys_across_public_boundary(planning, foreign_key):
    planning.keys = [foreign_key]
    with pytest.raises(ValueError, match="crosses the public-table boundary"):
        planning.plan()


def test_allows_internal_news_foreign_keys(planning):
    planning.keys = [key(database, "news_event_analyses", database, "news_articles")
                     for database in ("stage", "prod")]
    definition = {"constrained_columns": ["article_id"], "referred_table": "news_articles",
                  "referred_columns": ["article_id"], "options": {}}
    for database in ("stage", "prod"):
        planning.foreign_keys[(database, "news_event_analyses")] = [definition]
    assert planning.plan()["executed"] is False


def test_rejects_internal_foreign_key_definition_drift(planning):
    planning.foreign_keys[("stage", "news_event_analyses")] = [{
        "constrained_columns": ["article_id"], "referred_table": "news_articles",
        "referred_columns": ["article_id"], "options": {"ondelete": "CASCADE"}}]
    with pytest.raises(ValueError, match="foreign key schema mismatch"):
        planning.plan()


def test_rejects_private_constraint_name_collision(planning):
    planning.keys = [key("stage", "news_event_analyses", "stage", "news_articles", "shared_name"),
                     key("prod", "saved_news", "prod", "users", "SHARED_NAME")]
    with pytest.raises(ValueError, match="collide"):
        planning.plan()


def test_private_snapshot_contains_only_counts_hashes_and_detects_change():
    engine = create_engine("sqlite://")
    metadata = MetaData()
    private = Table("users", metadata, Column("id", Integer, primary_key=True), Column("email", String))
    public = Table("stock_info", metadata, Column("id", Integer, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(private.insert(), {"id": 1, "email": "private@example.com"})
        connection.execute(public.insert(), {"id": 1})
    before = publish.private_data_snapshot(engine, "main", batch_size=1)
    assert set(before) == {"users"}
    assert set(before["users"]) == {"rows", "sha256", "schema_sha256"}
    assert before["users"]["rows"] == 1 and "private@example.com" not in str(before)
    publish.assert_private_data_unchanged(before, publish.private_data_snapshot(engine, "main"))
    with engine.begin() as connection:
        connection.execute(private.update().values(email="changed@example.com"))
    with pytest.raises(ValueError, match="Private table verification failed: users"):
        publish.assert_private_data_unchanged(before, publish.private_data_snapshot(engine, "main"))
    engine.dispose()
