from pathlib import Path

from stock_behavior.prompt_templates import (
    TEXT_BRIEF_PROMPT_VERSION,
    TEXT_BRIEF_SYSTEM_PROMPT,
)


ORCHESTRATOR_TEXT = (
    Path(__file__).resolve().parents[1] / "stock_behavior" / "orchestrator.py"
).read_text(encoding="utf-8-sig")
TOOLS_TEXT = (
    Path(__file__).resolve().parents[1] / "stock_behavior" / "tools.py"
).read_text(encoding="utf-8-sig")


def test_prompt_keeps_news_as_background_only():
    assert TEXT_BRIEF_PROMPT_VERSION == "v7-chip-summary-01"
    # 新聞是被分析的素材，不能單獨撐起方向性結論。
    assert (
        "不得單獨用新聞推導價格結論" in TEXT_BRIEF_SYSTEM_PROMPT
    )
    assert "新聞與市場資料方向相反時以市場資料為準" in TEXT_BRIEF_SYSTEM_PROMPT


def test_prompt_has_no_projection_leftovers():
    """/ai 情境推演已移除，提示詞不該再要求輸出波形或價格節點。"""
    for term in ("projection", "波形", "relative_price", "predicted_close"):
        assert term not in TEXT_BRIEF_SYSTEM_PROMPT


def test_rag_news_context_is_capped_as_secondary_material():
    # text-first-v2：回溯 60 天、上限 50 則（RAG 實測單次約 20 則，等同全數帶入），
    # 並與 tools 的政策上限對齊。
    # RAG 端的 /api/analyze 仍寫死 30 天，尚未跟上（見 repo 根目錄 TODO.txt）。
    assert "MAX_LLM_NEWS_SOURCES = 50" in ORCHESTRATOR_TEXT
    assert "RAG_DEFAULT_NEWS_LOOKBACK_DAYS = 60" in ORCHESTRATOR_TEXT
    assert "RAG_DEFAULT_MAX_NEWS_EVENTS = 50" in ORCHESTRATOR_TEXT
    assert "max_news_events: int = 50" in TOOLS_TEXT
