import asyncio
import json
from types import SimpleNamespace

from schemas.stock_behavior import StockBehaviorAiRequest
from stock_behavior import llm
from stock_behavior.llm import (
    StockBehaviorLlmService,
    _load_json_object,
    _thinking_extra_body,
)
from stock_behavior.normalizer import FALLBACK_SUMMARY
from stock_behavior.orchestrator import StockBehaviorOrchestrator
from stock_behavior import orchestrator as orchestrator_module
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
        '{"summary":"分析中","projection":{"points":['
        '{"day":5,"direction":"up","reason":"完整單點"},'
        '{"day":10,"direction":"down"'
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
    raw = '{"projection":{"points":[{"day":5}],"summary":"截斷中"'

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
        StockBehaviorLlmService(_settings()).generate_analysis_from_evidence(
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


def test_truncated_orchestrator_result_creates_fallback_snapshot(monkeypatch):
    captured = {}

    class FakeLlm:
        model_name = "deepseek-ai/deepseek-v4-pro"

        async def generate_analysis_from_evidence(self, *, task_packet):
            return (
                {},
                '{"summary":"截斷中"',
                {
                    "finish_reason": "length",
                    "completion_tokens": 8192,
                    "truncated": True,
                },
            )

    db = SimpleNamespace(rollback=lambda: None)
    service = StockBehaviorOrchestrator(db=db, settings=_settings(NIM_API_KEY=""))
    service._llm = FakeLlm()
    service._collect_llm_evidence_from_crud = lambda **kwargs: {
        "price_window": {"data": []},
        "chip_window": {"data": []},
        "technical_window": {"data": []},
    }
    monkeypatch.setattr(
        orchestrator_module,
        "create_snapshot",
        lambda db, **fields: captured.update(fields),
    )

    response = asyncio.run(
        service.generate_llm_analysis(StockBehaviorAiRequest(symbol="2330"))
    )

    assert response.summary == FALLBACK_SUMMARY
    assert captured["is_fallback"] is True
    assert captured["raw_llm_text"] == '{"summary":"截斷中"'
    config = json.loads(captured["config_json"])
    assert config["max_completion_tokens"] == 8192
    assert config["response_format"] == "json_object"
    assert config["parser_version"] == "strict-root-v1"
