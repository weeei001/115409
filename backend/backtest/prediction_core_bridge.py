from __future__ import annotations

import sys
from pathlib import Path


RAG_DEPLOY_DIR = Path(__file__).resolve().parents[2] / "rag_deploy"
if RAG_DEPLOY_DIR.exists() and str(RAG_DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(RAG_DEPLOY_DIR))

try:
    from prediction_core import StrategyConfig, generate_prediction
except ImportError as exc:
    raise ImportError("找不到 prediction_core；請確認 repo 的 rag_deploy 目錄存在。") from exc


__all__ = ["StrategyConfig", "generate_prediction"]
