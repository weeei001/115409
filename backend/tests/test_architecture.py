import ast
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def test_runtime_dependency_boundaries():
    errors = []
    for path in (ROOT / "app").rglob("*.py"):
        relative = path.relative_to(ROOT).as_posix()
        tree = ast.parse(path.read_text(encoding="utf-8"))
        imports = [name for node in ast.walk(tree)
                   for name in ([node.module or ""] if isinstance(node, ast.ImportFrom)
                                else [item.name for item in node.names] if isinstance(node, ast.Import) else [])]
        for name in imports:
            if name.split(".")[0] in {"backend", "rag", "rag_deploy", "stock_behavior", "crud", "database"}:
                errors.append(f"{relative}: forbidden legacy dependency {name}")
            if name.startswith(("langchain", "langgraph")) and relative != "app/clients/llm.py":
                errors.append(f"{relative}: LangChain escaped the client boundary")
            if "/features/" in relative and path.name != "router.py" and name.startswith("fastapi"):
                errors.append(f"{relative}: domain imports HTTP framework")
            if ("/jobs/" not in relative and (name == "app.jobs" or name.startswith("app.jobs."))
                    and not (relative == "app/main.py" and name == "app.jobs.runtime")):
                errors.append(f"{relative}: application imports a background worker")
            if "/clients/" in relative and name.startswith("app.features.") and name.endswith(("service", "router")):
                errors.append(f"{relative}: client imports a feature service/router")
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                method = node.func.attr
                if method == "create_all" and relative != "app/jobs/schema.py":
                    errors.append(f"{relative}: runtime creates schema")
                if path.name == "repository.py" and method in {"commit", "rollback"}:
                    errors.append(f"{relative}: repository owns a transaction")
                if path.name == "router.py" and method in {"query", "execute", "scalars", "scalar", "commit", "rollback"}:
                    errors.append(f"{relative}: router executes database work")
                if path.name == "service.py" and method in {"execute", "scalars", "scalar"}:
                    errors.append(f"{relative}: service executes SQL instead of using a repository")
    assert errors == []


def test_fresh_import_cannot_create_external_resources_or_load_legacy_code():
    script = r'''
import builtins, importlib.abc, io, pathlib, socket, sys
sys.path.insert(0, sys.argv[1])
class NoLegacy(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'backend', 'rag', 'rag_deploy', 'stock_behavior', 'crud', 'database'}:
            raise AssertionError('Legacy import: ' + fullname)
sys.meta_path.insert(0, NoLegacy())
def fail(*args, **kwargs):
    raise AssertionError('External resource created during import')
socket.socket.connect = fail
import httpx, sqlalchemy, smtplib
httpx.AsyncClient.__init__ = fail
sqlalchemy.create_engine = fail
smtplib.SMTP.connect = fail
def guard(original):
    def read(file, *args, **kwargs):
        if isinstance(file, (str, pathlib.Path)) and pathlib.Path(file).name.startswith('.env'):
            raise AssertionError('Secret environment file read')
        return original(file, *args, **kwargs)
    return read
builtins.open = guard(builtins.open)
io.open = guard(io.open)
from app.core.config import Settings
Settings.model_config['env_file'] = None
from app.main import app, create_app
assert create_app().openapi()['paths']
assert not any(name.startswith('app.jobs') for name in sys.modules)
print('Independent import: passed')
'''
    result = subprocess.run([sys.executable, "-I", "-c", script, str(ROOT)], cwd=ROOT,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "Independent import: passed" in result.stdout


def test_domain_services_import_without_http_frameworks_or_workers():
    script = r'''
import importlib.abc, sys
sys.path.insert(0, sys.argv[1])
class NoHttpFramework(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'fastapi', 'starlette'}:
            raise AssertionError('Domain imports HTTP framework: ' + fullname)
        if fullname == 'app.jobs' or fullname.startswith('app.jobs.'):
            raise AssertionError('Domain imports background worker: ' + fullname)
sys.meta_path.insert(0, NoHttpFramework())
from app.features.auth import service
from app.features.admin import service
from app.features.market import service
from app.features.news import service
from app.features.favorites import service
from app.features.analysis import service
from app.features.chat import service
from app.features.retrieval import service
from app.features.signals import service
from app.features.backtest import service
'''
    result = subprocess.run([sys.executable, "-I", "-c", script, str(ROOT)], cwd=ROOT,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_every_worker_imports_without_asgi_legacy_dependencies_or_external_resources():
    script = r'''
import builtins, importlib, importlib.abc, io, pathlib, socket, subprocess, sys
sys.path.insert(0, sys.argv[1])
class NoRuntimeDependencies(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'backend', 'rag', 'rag_deploy', 'fastapi', 'starlette', 'database', 'crawler'}:
            raise AssertionError('Worker dependency outside v1: ' + fullname)
sys.meta_path.insert(0, NoRuntimeDependencies())
def fail(*args, **kwargs):
    raise AssertionError('Worker import created an external resource or process')
socket.socket.connect = fail
import httpx, sqlalchemy, smtplib
httpx.AsyncClient.__init__ = httpx.Client.__init__ = fail
sqlalchemy.create_engine = smtplib.SMTP.connect = subprocess.Popen = fail
def guard(original):
    def read(file, *args, **kwargs):
        if isinstance(file, (str, pathlib.Path)) and pathlib.Path(file).name.startswith('.env'):
            raise AssertionError('Secret environment file read')
        return original(file, *args, **kwargs)
    return read
builtins.open, io.open = guard(builtins.open), guard(io.open)
root = pathlib.Path(sys.argv[1])
for path in sorted((root / 'app' / 'jobs').rglob('*.py')):
    parts = path.relative_to(root).with_suffix('').parts
    name = '.'.join(parts[:-1] if parts[-1] == '__init__' else parts)
    importlib.import_module(name)
assert 'app.main' not in sys.modules
print('Independent worker imports: passed')
'''
    result = subprocess.run([sys.executable, "-I", "-c", script, str(ROOT)], cwd=ROOT,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "Independent worker imports: passed" in result.stdout
