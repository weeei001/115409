"""Identify explicitly simulated sources without deleting audit/replay records."""
from __future__ import annotations

from typing import Any


def contains_simulation(value: Any) -> bool:
    if isinstance(value, list):
        return any(contains_simulation(item) for item in value)
    if not isinstance(value, dict):
        return False
    if any(str(value.get(key, "")).lower() == "simulation_test" for key in ("publisher", "source")):
        return True
    if str(value.get("url", "")).startswith("https://example.invalid/simulation/"):
        return True
    if str(value.get("article_id", "")).startswith("sim_war_"):
        return True
    if str(value.get("title", "")).startswith("【模擬測試・非真實新聞】"):
        return True
    return any(contains_simulation(item) for item in value.values())
