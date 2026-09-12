"""Read legacy contracts/tests in an isolated process without its .env or lifespan."""
import builtins
import io
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def isolate_legacy():
    sys.dont_write_bytecode = True
    original_open = builtins.open
    original_io_open = io.open

    def guarded_open(original):
        def read(file, *args, **kwargs):
            if isinstance(file, (str, bytes, os.PathLike)):
                path = Path(os.fsdecode(file))
                if path.name == ".env" or path.name.startswith(".env.") and path.name != ".env.example":
                    raise AssertionError("Reading secret environment files is forbidden")
            return original(file, *args, **kwargs)
        return read

    builtins.open = guarded_open(original_open)
    io.open = guarded_open(original_io_open)
    sys.path.insert(0, str(ROOT / "backend"))
    import config

    config.Settings.model_config["env_file"] = None
    for name in config.Settings.model_fields:
        os.environ.pop(name, None)

    import sqlalchemy.engine
    original_connect = sqlalchemy.engine.Engine.connect

    def connect(engine, *args, **kwargs):
        if engine.dialect.name != "sqlite":
            raise AssertionError("Legacy probe attempted an external database connection")
        return original_connect(engine, *args, **kwargs)

    sqlalchemy.engine.Engine.connect = connect


def model_contract(metadata):
    from sqlalchemy.dialects import mysql

    return {
        table.name: {
            "columns": {
                c.name: {"type": c.type.compile(dialect=mysql.dialect()), "nullable": c.nullable,
                         "primary_key": c.primary_key, "autoincrement": c.autoincrement,
                         "server_default": str(c.server_default.arg) if c.server_default else None,
                         "foreign_keys": sorted(f.target_fullname for f in c.foreign_keys)}
                for c in table.columns
            },
            "indexes": sorted((i.name, tuple(c.name for c in i.columns), bool(i.unique)) for i in table.indexes),
        }
        for table in metadata.tables.values()
    }


if __name__ == "__main__":
    isolate_legacy()
    if sys.argv[1] == "rag-openapi":
        import dotenv
        import socket
        def no_connection(*args, **kwargs):
            raise AssertionError("RAG probe attempted an external connection")
        socket.socket.connect = no_connection
        dotenv.load_dotenv = lambda *args, **kwargs: False
        sys.path.insert(0, str(ROOT / "rag_deploy"))
        import api_server
        document = api_server.app.openapi()
        # The legacy ask route lacks response_model, but constructs AskResponse at runtime.
        response = api_server.AskResponse.model_json_schema(ref_template="#/components/schemas/{model}")
        document["components"]["schemas"].update(response.pop("$defs", {}))
        document["components"]["schemas"]["AskResponse"] = response
        print(json.dumps(document, ensure_ascii=True))
    elif sys.argv[1] == "openapi":
        from main import app
        print(json.dumps(app.openapi(), ensure_ascii=True))
    elif sys.argv[1] == "models":
        import models
        from database import Base
        print(json.dumps(model_contract(Base.metadata)))
    elif sys.argv[1] == "runtime":
        from fastapi.testclient import TestClient
        from sqlalchemy import create_engine
        from sqlalchemy.ext.compiler import compiles
        from sqlalchemy.orm import Session
        from sqlalchemy.pool import StaticPool
        from sqlalchemy.sql.functions import Function

        @compiles(Function, "sqlite")
        def sqlite_function(function, compiler, **kwargs):
            # MySQL LEFT(text, n) has the same semantics as SQLite substr(text, 1, n).
            if function.name.lower() == "left":
                value, length = function.clauses
                return f"substr({compiler.process(value, **kwargs)}, 1, {compiler.process(length, **kwargs)})"
            return compiler.visit_function(function, **kwargs)

        import models
        from database import Base, get_db
        from main import app
        from runtime_samples import populate, capture

        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            populate(db, models)
            app.dependency_overrides[get_db] = lambda: db
            print(json.dumps(capture(TestClient(app)), ensure_ascii=True))
        engine.dispose()
    elif sys.argv[1] == "tests":
        import pytest
        raise SystemExit(pytest.main([str(ROOT / "backend/tests"), "-q", "-p", "no:cacheprovider", *sys.argv[2:]]))
