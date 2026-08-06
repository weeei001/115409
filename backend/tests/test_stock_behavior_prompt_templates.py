from pathlib import Path

from stock_behavior.prompt_templates import PROMPT_VERSION, STOCK_ANALYST_SYSTEM_PROMPT


ORCHESTRATOR_TEXT = (
    Path(__file__).resolve().parents[1] / "stock_behavior" / "orchestrator.py"
).read_text(encoding="utf-8-sig")
TOOLS_TEXT = (
    Path(__file__).resolve().parents[1] / "stock_behavior" / "tools.py"
).read_text(encoding="utf-8-sig")


def test_prompt_keeps_news_as_background_only():
    assert PROMPT_VERSION == "v2-no-raw-answer"
    assert "raw_answer" not in STOCK_ANALYST_SYSTEM_PROMPT
    assert "新聞只能提供背景脈絡；不得把新聞當作價格節點的唯一或主要原因。" in STOCK_ANALYST_SYSTEM_PROMPT
    assert "不得要求 projection.points 為了引用新聞而引用新聞" in STOCK_ANALYST_SYSTEM_PROMPT
    assert "新聞因果句型" not in STOCK_ANALYST_SYSTEM_PROMPT
    assert "至少 2 個 projection.points" not in STOCK_ANALYST_SYSTEM_PROMPT


def test_rag_news_context_is_capped_as_secondary_material():
    # text-first-v2：回溯 60 天、上限 50 則（RAG 實測單次約 20 則，等同全數帶入），
    # 並與 tools 的政策上限對齊。
    # RAG 端的 /api/analyze 仍寫死 30 天，尚未跟上（見 repo 根目錄 TODO.txt）。
    assert "MAX_LLM_NEWS_SOURCES = 50" in ORCHESTRATOR_TEXT
    assert "RAG_DEFAULT_NEWS_LOOKBACK_DAYS = 60" in ORCHESTRATOR_TEXT
    assert "RAG_DEFAULT_MAX_NEWS_EVENTS = 50" in ORCHESTRATOR_TEXT
    assert "max_news_events: int = 50" in TOOLS_TEXT
