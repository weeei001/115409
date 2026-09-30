"""Dry-run eligibility audit of an exported JSON snapshot list. No DB or network access."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.features.news.eligibility import contains_simulation


def audit_snapshots(rows: list[dict]) -> list[dict]:
    findings = []
    for row in rows:
        reasons = []
        response = row.get("response_json", row.get("response", {}))
        config = row.get("config_json", {})
        try:
            response = json.loads(response) if isinstance(response, str) else response
            config = json.loads(config) if isinstance(config, str) else config
            if not isinstance(response, dict) or not isinstance(config, dict):
                raise ValueError("invalid export")
        except (ValueError, TypeError):
            findings.append({"id": row.get("id", row.get("selected_snapshot_id")), "reasons": ["invalid_export"]})
            continue
        if contains_simulation(response):
            reasons.append("simulation_source")
        if config.get("purpose") != "production":
            reasons.append("production_purpose_not_established_in_export")
        if reasons:
            findings.append({"id": row.get("id", row.get("selected_snapshot_id")),
                             "symbol": row.get("symbol"), "reasons": reasons})
    return findings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    args = parser.parse_args()
    rows = json.loads(args.input.read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list):
        parser.error("input must be a JSON list of exported snapshots")
    print(json.dumps({"dry_run": True, "scanned": len(rows), "findings": audit_snapshots(rows),
                      "scope": "export_only; config/source freshness not checked"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
