from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .core_mode_types import (
    CORE_MODE_PARAM_SCHEMA,
    CoreModeParams,
    DEFAULT_CORE_MODE_PARAMS,
    normalize_core_mode_params,
    params_to_dict,
)


@dataclass
class CoreModePreset:
    id: str
    name: str
    description: str
    category: str
    params: CoreModeParams
    source: str
    created_at: str
    updated_at: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CoreModePresetStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file()

    def _ensure_file(self) -> None:
        if self.path.exists():
            return

        now = _now_iso()
        presets = [
            {
                "id": "core-stable-default",
                "name": "穩健核心（預設）",
                "description": "偏重穩定度與回撤控制，適合日常趨勢判斷。",
                "category": "穩定型",
                "params": params_to_dict(DEFAULT_CORE_MODE_PARAMS),
                "source": "system",
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "core-balanced-default",
                "name": "平衡核心",
                "description": "在報酬、準確度與穩定性之間取得平衡。",
                "category": "平衡型",
                "params": params_to_dict(
                    CoreModeParams(
                        breakout_lookback=28,
                        momentum_window=18,
                        state_threshold=0.14,
                        shape_threshold=0.14,
                        trend_threshold=0.17,
                        max_pullback_depth=0.13,
                        hard_stop_pct=0.08,
                        trailing_stop_pct=0.09,
                    )
                ),
                "source": "system",
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "core-return-default",
                "name": "報酬優先核心",
                "description": "偏重趨勢推進，回撤容忍較高。",
                "category": "高報酬型",
                "params": params_to_dict(
                    CoreModeParams(
                        breakout_lookback=35,
                        momentum_window=26,
                        state_threshold=0.13,
                        shape_threshold=0.12,
                        trend_threshold=0.16,
                        max_pullback_depth=0.16,
                        hard_stop_pct=0.10,
                        trailing_stop_pct=0.12,
                    )
                ),
                "source": "system",
                "created_at": now,
                "updated_at": now,
            },
        ]

        payload = {
            "active_preset_id": "core-stable-default",
            "presets": presets,
            "updated_at": now,
        }
        self._write(payload)

    def _read(self) -> dict[str, Any]:
        # Use utf-8-sig to tolerate accidental BOM from external editors.
        with self.path.open("r", encoding="utf-8-sig") as f:
            return json.load(f)

    def _write(self, payload: dict[str, Any]) -> None:
        with self.path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

    def list_presets(self) -> dict[str, Any]:
        data = self._read()
        active_id = data.get("active_preset_id")
        presets = [self._normalize_preset_item(item) for item in data.get("presets", [])]

        if not presets:
            self._ensure_file()
            data = self._read()
            active_id = data.get("active_preset_id")
            presets = [self._normalize_preset_item(item) for item in data.get("presets", [])]

        active = next((p for p in presets if p["id"] == active_id), None)
        if active is None and presets:
            active = presets[0]
            active_id = active["id"]
            data["active_preset_id"] = active_id
            self._write(data)

        return {
            "active_preset_id": active_id,
            "active_preset": active,
            "presets": presets,
        }

    def _normalize_preset_item(self, item: dict[str, Any]) -> dict[str, Any]:
        params = normalize_core_mode_params(item.get("params") or {})
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "description": item.get("description") or "",
            "category": item.get("category") or "未分類",
            "params": params_to_dict(params),
            "source": item.get("source") or "system",
            "created_at": item.get("created_at") or _now_iso(),
            "updated_at": item.get("updated_at") or _now_iso(),
        }

    def create_or_update_preset(self, *, name: str, description: str, params: dict[str, Any], preset_id: str | None = None) -> dict[str, Any]:
        data = self._read()
        now = _now_iso()
        normalized = params_to_dict(normalize_core_mode_params(params))

        target_id = preset_id or f"user-{int(datetime.now().timestamp())}"
        updated = False
        for item in data.get("presets", []):
            if item.get("id") == target_id:
                item["name"] = name
                item["description"] = description
                item["category"] = item.get("category") or "自訂"
                item["params"] = normalized
                item["source"] = item.get("source") or "user"
                item["updated_at"] = now
                updated = True
                break

        if not updated:
            data.setdefault("presets", []).append(
                {
                    "id": target_id,
                    "name": name,
                    "description": description,
                    "category": "自訂",
                    "params": normalized,
                    "source": "user",
                    "created_at": now,
                    "updated_at": now,
                }
            )

        data["updated_at"] = now
        self._write(data)
        return self.list_presets()

    def activate(self, preset_id: str) -> dict[str, Any]:
        data = self._read()
        exists = any(item.get("id") == preset_id for item in data.get("presets", []))
        if not exists:
            raise ValueError("找不到指定的 preset")

        data["active_preset_id"] = preset_id
        data["updated_at"] = _now_iso()
        self._write(data)
        return self.list_presets()

    def get_active_params(self) -> tuple[str, CoreModeParams, str]:
        listed = self.list_presets()
        active = listed.get("active_preset")
        if not active:
            return "core-stable-default", DEFAULT_CORE_MODE_PARAMS, "穩健核心（預設）"
        params = normalize_core_mode_params(active.get("params") or {})
        return active["id"], params, active.get("name") or "未命名 preset"

    def replace_system_candidates(
        self,
        *,
        best_return: dict[str, Any],
        best_stable: dict[str, Any],
        best_balanced: dict[str, Any],
        top_candidates: list[dict[str, Any]],
    ) -> dict[str, Any]:
        data = self._read()
        now = _now_iso()

        user_presets = [item for item in data.get("presets", []) if (item.get("source") or "") == "user"]

        system_presets = [
            {
                "id": "core-best-stable",
                "name": "最佳穩健參數",
                "description": "穩定型：偏重 fold 一致性與回撤控制，作為預設 active 的首選。",
                "category": "穩定型",
                "params": best_stable["params"],
                "source": "system",
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "core-best-balanced",
                "name": "最佳平衡參數",
                "description": "平衡型：同時考慮 AC、expectancy、profit factor、趨勢品質、回撤與穩定性。",
                "category": "平衡型",
                "params": best_balanced["params"],
                "source": "system",
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "core-best-return",
                "name": "最佳報酬參數",
                "description": "高報酬型：偏重累積報酬與 expectancy；不建議直接作為預設 active。",
                "category": "高報酬型",
                "params": best_return["params"],
                "source": "system",
                "created_at": now,
                "updated_at": now,
            },
        ]

        for idx, candidate in enumerate(top_candidates, start=1):
            if idx > 2:
                break
            system_presets.append(
                {
                    "id": f"core-refine-top-{idx}",
                    "name": f"精修候選參數 {idx}",
                    "description": "由 coarse + local refinement 產生的高分候選，可作為進一步人工驗證的備選。",
                    "category": "候選型",
                    "params": candidate["params"],
                    "source": "system",
                    "created_at": now,
                    "updated_at": now,
                }
            )

        data["presets"] = system_presets[:5] + user_presets

        active_id = data.get("active_preset_id")
        valid_ids = {item["id"] for item in data["presets"]}
        if active_id not in valid_ids:
            data["active_preset_id"] = "core-best-stable"

        if data["active_preset_id"] == "core-best-return":
            data["active_preset_id"] = "core-best-balanced"

        data["updated_at"] = now
        self._write(data)
        return self.list_presets()


def build_core_mode_schema_payload() -> dict[str, Any]:
    return {
        "mode": "core_mode",
        "title": "核心模式參數設定",
        "description": "先用 8 個核心參數做穩健調參，避免高維度過度擬合。",
        "params": CORE_MODE_PARAM_SCHEMA,
        "default_params": params_to_dict(DEFAULT_CORE_MODE_PARAMS),
        "default_active_policy": "優先啟用 best_stable 或 best_balanced",
    }
