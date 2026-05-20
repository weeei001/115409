from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .orchestrator import StockBehaviorOrchestrator

__all__ = ["StockBehaviorOrchestrator"]


def __getattr__(name: str):
    if name == "StockBehaviorOrchestrator":
        from .orchestrator import StockBehaviorOrchestrator

        return StockBehaviorOrchestrator
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
