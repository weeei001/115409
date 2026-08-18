import asyncio
import json
from types import SimpleNamespace

from stock_behavior import llm
from stock_behavior.llm import (
    StockBehaviorLlmService,
    _load_json_object,
    _thinking_extra_body,
)
from stock_behavior.orchestrator import build_llm_runtime_config, compute_config_hash
from stock_behavior.utils import detect_simplified_chinese


def _settings(**overrides):
    values = {
        "NIM_API_KEY": "token",
        "NIM_BASE_URL": "https://example.test/v1",
        "ADVISOR_LLM_MODEL": "deepseek-ai/deepseek-v4-pro",
        "ADVISOR_LLM_TEMPERATURE": 0.2,
        "ADVISOR_LLM_MAX_COMPLETION_TOKENS": 8192,
        "ADVISOR_LLM_RESPONSE_FORMAT": "json_object",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_thinking_extra_body_maps_model_families():
    assert _thinking_extra_body("deepseek-ai/deepseek-v4-pro") == {
        "chat_template_kwargs": {"thinking": False}
    }
    assert _thinking_extra_body("qwen/qwen3") == {
        "chat_template_kwargs": {"enable_thinking": False}
    }
    assert _thinking_extra_body("meta/llama-3.3") == {}


def test_load_json_object_accepts_complete_fenced_and_think_json():
    assert _load_json_object('{"summary": "完整"}') == {"summary": "完整"}
    assert _load_json_object(
        '<think>internal</think>\n```json\n{"summary": "完整"}\n```'
    ) == {"summary": "完整"}


def test_load_json_object_rejects_truncated_root_with_complete_inner_object():
    truncated = (
        '{"headline":"分析中","key_days":['
        '{"id":"kd_01","date":"2025-07-02","what":"完整單筆"},'
        '{"id":"kd_02","date":"2025-07-03"'
    )
    assert _load_json_object(truncated) is None


def test_load_json_object_allows_trailing_noise_from_root_start():
    assert _load_json_object('{"summary": "完整"}\nmodel footer') == {
        "summary": "完整"
    }


def test_load_json_object_repairs_numeric_expression():
    assert _load_json_object('{"relative_price": 121 / 110}') == {
        "relative_price": 1.1
    }


def test_length_finish_reason_skips_parsing(monkeypatch):
    """finish_reason=length 代表輸出被截斷，這時解析半截 JSON 只會拿到假結果。"""
    raw = '{"key_days":[{"id":"kd_01"}],"headline":"截斷中"'

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            pass

        async def ainvoke(self, messages):
            return SimpleNamespace(
                content=raw,
                response_metadata={
                    "finish_reason": "length",
                    "token_usage": {"completion_tokens": 8192},
                },
            )

    monkeypatch.setattr(llm, "ChatOpenAI", FakeChatOpenAI)
    parsed, raw_text, meta = asyncio.run(
        StockBehaviorLlmService(_settings()).generate_text_brief_from_evidence(
            task_packet={"task": {}}
        )
    )

    assert parsed == {}
    assert raw_text == raw
    assert meta == {
        "finish_reason": "length",
        "completion_tokens": 8192,
        "truncated": True,
    }


def test_detect_simplified_chinese_uses_simplified_only_characters():
    assert detect_simplified_chinese("臺灣股票市場投資分析，留意買賣風險。") == []
    assert detect_simplified_chinese("股價下跌後盤整，跌幅收斂。") == []
    assert set(detect_simplified_chinese("买卖风险")) == {"买", "卖", "风", "险"}
    assert detect_simplified_chinese("公司股票市場分析") == []


def test_runtime_config_carries_model_settings_into_config_hash():
    """config_hash 要能反映模型與檢索設定，改設定就得讓既有快照失效。"""
    config = build_llm_runtime_config(_settings(), "deepseek-ai/deepseek-v4-pro")

    assert config["model_name"] == "deepseek-ai/deepseek-v4-pro"
    assert config["max_completion_tokens"] == 8192
    assert config["response_format"] == "json_object"
    assert config["rag_lookback_days"] == 60
    # /ai 移除後不該再有情境推演的殘留設定
    assert "projection_days" not in config
    assert "horizon_days" not in config

    other = build_llm_runtime_config(_settings(), "qwen/qwen3")
    assert compute_config_hash(config) != compute_config_hash(other)
