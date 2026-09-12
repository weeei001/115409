"""Compare executable OpenAPI and MySQL mappings; documentation is ignored."""
import json
from pathlib import Path
import re
import subprocess
import sys

import pytest

from app.db.session import Base
from app.main import create_app
from legacy_probe import model_contract

ROOT = Path(__file__).resolve().parents[2]
PROBE = Path(__file__).with_name("legacy_probe.py")
METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}
SOURCE_PROVENANCE_FIELDS = {
    "article_id", "chunk_id", "chunk_index", "char_start", "char_end", "content_hash",
    "revision", "index_version", "embedding_model", "stock_ids",
}


def legacy_source_response(schema):
    """Ignore only explicitly additive source fields in response comparisons."""
    if not isinstance(schema, dict):
        return schema
    properties = schema.get("properties", {})
    if {"title", "url", "publisher", "summary", "timestamp", "kind"} <= properties.keys():
        fields = SOURCE_PROVENANCE_FIELDS
    elif {"title", "url", "source", "source_name", "content", "score", "stock_id"} <= properties.keys():
        fields = SOURCE_PROVENANCE_FIELDS | {"citation_id", "in_time_range"}
    else:
        fields = set()
    result = {}
    for key, value in schema.items():
        if key == "properties":
            result[key] = {name: legacy_source_response(item) for name, item in value.items() if name not in fields}
        elif isinstance(value, dict):
            result[key] = legacy_source_response(value)
        elif isinstance(value, list):
            result[key] = [legacy_source_response(item) for item in value]
        else:
            result[key] = value
    return result


@pytest.fixture(scope="module")
def old_openapi():
    result = subprocess.run([sys.executable, str(PROBE), "openapi"], cwd=ROOT,
                            capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(result.stdout)


def shape(schema, document):
    if "$ref" in schema:
        return shape(document["components"]["schemas"][schema["$ref"].rsplit("/", 1)[1]], document)
    return {k: ({name: shape(value, document) for name, value in v.items()} if k == "properties"
                else shape(v, document) if isinstance(v, dict)
                else [shape(x, document) if isinstance(x, dict) else x for x in v] if isinstance(v, list)
                else v)
            for k, v in schema.items()
            if k not in {"description", "summary", "title", "example", "examples", "deprecated"}}


def operation_contract(operation, document):
    return {
        "parameters": sorted([
            {"name": p["name"], "in": p["in"], "required": p.get("required", False),
             "schema": shape(p.get("schema", {}), document)}
            for p in operation.get("parameters", [])
        ], key=lambda p: (p["in"], p["name"])),
        "request": {
            "required": operation.get("requestBody", {}).get("required", False),
            "content": {media: shape(value.get("schema", {}), document)
                        for media, value in operation.get("requestBody", {}).get("content", {}).items()},
        },
        "responses": {code: {media: shape(value.get("schema", {}), document)
                             for media, value in response.get("content", {}).items()}
                      for code, response in operation["responses"].items()},
        "status_codes": sorted(operation["responses"]),
        "security": operation.get("security", []),
    }


def frontend_inventory():
    inventory = []
    directory = ROOT / "frontend/topictest/lib/api"
    for source in sorted(directory.glob("*.ts")):
        text = source.read_text(encoding="utf-8")
        pattern = r"apiClient\.(get|post|put|patch|delete)(?:<[^;]*?>)?\(\s*([`'\"])(.*?)\2"
        for match in re.finditer(pattern, text, re.DOTALL):
            raw_path = match.group(3)
            path = re.sub(r"\$\{encodeURIComponent\(articleId\)\}", "{article_id}", raw_path)
            path = re.sub(r"\$\{([^}]+)\}", r"{\1}", path)
            preceding = list(re.finditer(r"export (?:async )?function (\w+)", text[:match.start()]))
            inventory.append({"method": match.group(1), "path": path,
                              "file": str(source.relative_to(ROOT)).replace("\\", "/"),
                              "caller": preceding[-1].group(1) if preceding else None})
        if source.name == "ragAsk.ts":
            assert "`${CHAT_BASE}/api/ask`" in text and "fetch(RAG_ASK_URL" in text
            inventory.append({"method": "post", "path": "/api/ask", "base": "CHAT_BASE",
                              "legacy_fallback": "RAG_BASE",
                              "file": str(source.relative_to(ROOT)).replace("\\", "/"), "caller": "ragAskStream"})
    return inventory


def test_all_legacy_operations_have_compatible_contracts(old_openapi):
    current = create_app().openapi()
    differences = []
    for path, operations in old_openapi["paths"].items():
        for method, old in operations.items():
            if method not in METHODS:
                continue
            new = current["paths"].get(path, {}).get(method)
            if new is None:
                differences.append(f"Missing {method.upper()} {path}")
                continue
            a, b = operation_contract(old, old_openapi), operation_contract(new, current)
            for code, response in old["responses"].items():
                if "content" not in response:
                    # A description-only legacy response does not specify a body schema.
                    # Still compare its status code, and compare populated HTTP samples below.
                    a["responses"].pop(code, None)
                    b["responses"].pop(code, None)
            for key in a:
                if a[key] != b[key]:
                    differences.append(f"{method.upper()} {path} {key}:\n{a[key]}\n!=\n{b[key]}")
    assert not differences, "\n\n".join(differences)


def test_every_frontend_request_targets_a_compatible_runtime_route(old_openapi):
    current = create_app().openapi()
    inventory = frontend_inventory()
    assert len(inventory) >= 28
    assert inventory == json.loads((ROOT / "backend_v2/frontend_api_inventory.json").read_text(encoding="utf-8"))
    for item in inventory:
        if item["path"] != "/api/ask":
            assert item["method"] in old_openapi["paths"].get(item["path"], {}), item
        assert item["method"] in current["paths"].get(item["path"], {}), item


def test_migrated_rag_contracts():
    result = subprocess.run([sys.executable, str(PROBE), "rag-openapi"], cwd=ROOT,
                            capture_output=True, text=True, encoding="utf-8", check=True)
    old, new = json.loads(result.stdout), create_app().openapi()
    for path in ("/api/ask", "/api/analyze"):
        a = operation_contract(old["paths"][path]["post"], old)
        b = operation_contract(new["paths"][path]["post"], new)
        b["responses"] = legacy_source_response(b["responses"])
        for code, response in old["paths"][path]["post"]["responses"].items():
            if "content" not in response or response.get("content", {}).get("application/json", {}).get("schema") == {}:
                a["responses"].pop(code, None)
                b["responses"].pop(code, None)
        assert a == b, path
    a = shape(old["components"]["schemas"]["AskResponse"], old)
    b = shape(new["components"]["schemas"]["AskResponse"], new)
    b = legacy_source_response(b)
    # Pydantic default_factory and literal [] have the same missing-field behavior.
    a["properties"]["actions"].pop("default", None)
    assert a == b


def test_source_provenance_is_additive_optional_and_typed():
    from app.features.chat.schemas import SourceChunk
    from app.features.retrieval.schemas import NewsSource

    for model in (SourceChunk, NewsSource):
        schema = model.model_json_schema()
        fields = SOURCE_PROVENANCE_FIELDS | ({"citation_id", "in_time_range"} if model is SourceChunk else set())
        assert fields.isdisjoint(schema.get("required", []))
        for field in fields:
            prop = schema["properties"][field]
            expected = ("integer" if field in {"chunk_index", "char_start", "char_end"} else
                        "boolean" if field == "in_time_range" else "array" if field == "stock_ids" else "string")
            assert expected in {item.get("type") for item in prop.get("anyOf", [prop])}


def test_mysql_tables_columns_keys_and_indexes_are_unchanged():
    import app.db.models

    result = subprocess.run([sys.executable, str(PROBE), "models"], cwd=ROOT,
                            capture_output=True, text=True, encoding="utf-8", check=True)
    assert json.loads(json.dumps(model_contract(Base.metadata))) == json.loads(result.stdout)


def test_populated_api_responses_match_legacy(client, db_session):
    import app.db.models as models
    from runtime_samples import populate, capture

    result = subprocess.run([sys.executable, str(PROBE), "runtime"], cwd=ROOT,
                            capture_output=True, text=True, encoding="utf-8", check=True)
    populate(db_session, models)
    old, new = json.loads(result.stdout), capture(client)
    differences = [{"old": a, "new": b} for a, b in zip(old, new) if a != b]
    assert len(old) == len(new)
    assert not differences, json.dumps(differences, indent=2, ensure_ascii=False)
