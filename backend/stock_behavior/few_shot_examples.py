from __future__ import annotations

import hashlib
import json
from typing import Any, TypedDict


class FewShotExample(TypedDict):
    scenario: str
    input_payload: dict[str, Any]
    output_brief: dict[str, Any]


# 由人工蒸餾流程 curate 後填入；順序即注入順序，最典型的放最後、定案後不得重排。
FEW_SHOT_EXAMPLES: list[FewShotExample] = []


def example_set_version() -> str:
    if not FEW_SHOT_EXAMPLES:
        return "none"
    canonical = json.dumps(FEW_SHOT_EXAMPLES, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]
