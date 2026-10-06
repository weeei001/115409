"""Adversarial parsing completes in an isolated process with a hard deadline."""
import subprocess
import sys
from pathlib import Path
from time import perf_counter

import pytest

from app.core.text import strip_tags


def test_unit_and_revenue_parsers_reject_long_near_matches_without_backtracking():
    script = """
from types import SimpleNamespace
from app.core.config import Settings
Settings.model_config["env_file"] = None
from app.features.chat.personal_context import paper_draft
from app.features.retrieval.facts import _MONTHLY_REVENUE

request = SimpleNamespace(_user_id=7, _conversation_id=None, history=[])
for side in ("買進", "賣出"):
    query = "模擬" + side + " 2330，投入 10" + " " * 50000 + "結束"
    draft = paper_draft(query, ["2330"], request)
    assert draft.budget is None and draft.quantity is None
assert _MONTHLY_REVENUE.search("2026年8月營收" + "為約" * 5000 + "結束") is None
assert _MONTHLY_REVENUE.search("2026年8月營收" + "1" * 50000 + "結束") is None
"""
    completed = subprocess.run([sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=5)
    assert completed.returncode == 0, completed.stderr


@pytest.mark.parametrize("raw,expected", [
    ("<p>台積電</p>", "台積電"),
    ("<<script>script>alert(1)", "script>alert(1)"),
    ("<<a>b>", "b>"),
    ("尾巴 <script src=x", "尾巴 "),
    ("本益比 < 10 倍", "本益比 < 10 倍"),
    ("a < b 且 c > d", "a < b 且 c > d"),
    ("< <a>b>", "< b>"),
])
def test_strip_tags_leaves_no_tag_opener(raw, expected):
    assert strip_tags(raw) == expected


def test_strip_tags_is_linear_on_nested_and_unterminated_openers():
    started = perf_counter()
    assert strip_tags("<" * 100_000 + "a>" + "b>" * 100_000) == "b>" * 100_000
    assert strip_tags("<" * 200_000 + "1") == "<" * 200_000 + "1"
    assert perf_counter() - started < 1
