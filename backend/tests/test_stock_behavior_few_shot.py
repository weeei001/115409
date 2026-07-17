import asyncio
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

from schemas.stock_behavior import StockBehaviorAiRequest
from stock_behavior import few_shot_examples, llm as llm_module
from stock_behavior.eval_metrics import aggregate_eval_results
from stock_behavior.llm import StockBehaviorLlmService, TEXT_BRIEF_OUTPUT_SCHEMA
from stock_behavior.orchestrator import StockBehaviorOrchestrator
from stock_behavior.prompt_templates import TEXT_BRIEF_SYSTEM_PROMPT


def _settings(**overrides):
    values = {
        "NIM_API_KEY": "token",
        "NIM_BASE_URL": "https://example.test/v1",
        "ADVISOR_LLM_MODEL": "test-model",
        "ADVISOR_LLM_TEMPERATURE": 0.2,
        "ADVISOR_LLM_MAX_COMPLETION_TOKENS": 8192,
        "ADVISOR_LLM_RESPONSE_FORMAT": "json_object",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _example(scenario: str, symbol: str) -> dict:
    return {
        "scenario": scenario,
        "input_payload": {"task": {"symbol": symbol}},
        "output_brief": {"headline": f"{scenario}-{symbol}"},
    }


def test_example_set_version_empty_different_and_stable(monkeypatch):
    monkeypatch.setattr(few_shot_examples, "FEW_SHOT_EXAMPLES", [])
    assert few_shot_examples.example_set_version() == "none"

    first = [_example("偏強一致", "2330")]
    second = [_example("資料稀少", "2317")]
    monkeypatch.setattr(few_shot_examples, "FEW_SHOT_EXAMPLES", first)
    first_version = few_shot_examples.example_set_version()
    monkeypatch.setattr(few_shot_examples, "FEW_SHOT_EXAMPLES", second)
    assert few_shot_examples.example_set_version() != first_version
    monkeypatch.setattr(few_shot_examples, "FEW_SHOT_EXAMPLES", deepcopy(first))
    assert few_shot_examples.example_set_version() == first_version


def test_text_brief_few_shot_rendering_preserves_empty_format_and_order(monkeypatch):
    captured = []

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            pass

        async def ainvoke(self, messages):
            captured.append(messages)
            return SimpleNamespace(
                content='{"headline":"ok"}',
                response_metadata={"finish_reason": "stop", "token_usage": {}},
            )

    monkeypatch.setattr(llm_module, "ChatOpenAI", FakeChatOpenAI)
    task_packet = {"task": {"symbol": "2454"}}
    payload = json.dumps(task_packet, ensure_ascii=False, default=str)
    wave2_prompt = (
        f"<prefetched_evidence_payload>\n{payload}\n</prefetched_evidence_payload>\n\n"
        f"<output_schema>\n{TEXT_BRIEF_OUTPUT_SCHEMA}\n</output_schema>\n\n"
        "請依 system 指示產出文字簡報 JSON。"
    )

    monkeypatch.setattr(few_shot_examples, "FEW_SHOT_EXAMPLES", [])
    service = StockBehaviorLlmService(_settings())
    asyncio.run(service.generate_text_brief_from_evidence(task_packet=task_packet))
    assert captured[-1] == [
        ("system", TEXT_BRIEF_SYSTEM_PROMPT),
        ("human", wave2_prompt),
    ]

    examples = [_example("第一例", "2330"), _example("第二例", "2317")]
    monkeypatch.setattr(few_shot_examples, "FEW_SHOT_EXAMPLES", examples)
    asyncio.run(service.generate_text_brief_from_evidence(task_packet=task_packet))
    user_prompt = captured[-1][1][1]
    first_input = json.dumps(examples[0]["input_payload"], ensure_ascii=False)
    second_input = json.dumps(examples[1]["input_payload"], ensure_ascii=False)
    second_output = json.dumps(examples[1]["output_brief"], ensure_ascii=False)
    assert user_prompt.index(first_input) < user_prompt.index(second_input)
    assert user_prompt.index(second_input) < user_prompt.index("<prefetched_evidence_payload>")
    assert (
        f"<output>\n{second_output}\n</output>\n</example>\n</examples>\n\n"
        "<prefetched_evidence_payload>"
    ) in user_prompt


def test_text_brief_snapshot_config_includes_example_set_version(monkeypatch):
    captured = {}
    examples = [_example("偏強一致", "2330")]
    monkeypatch.setattr(few_shot_examples, "FEW_SHOT_EXAMPLES", examples)

    class FakeLlm:
        model_name = "test-model"

        async def generate_text_brief_from_evidence(self, *, task_packet):
            return {}, "", {"truncated": False}

    service = StockBehaviorOrchestrator(
        db=SimpleNamespace(rollback=lambda: None),
        settings=_settings(),
    )
    service._llm = FakeLlm()
    service._collect_llm_evidence_from_crud = lambda **kwargs: {
        "price_window": {"data": []},
        "chip_window": {"data": []},
        "technical_window": {"data": []},
    }
    service._build_data_inventory = lambda **kwargs: {
        "price_volume": [],
        "chip": [],
        "technical": [],
        "news": [],
        "missing_fields": [],
    }
    monkeypatch.setattr(
        "stock_behavior.orchestrator.create_snapshot",
        lambda db, **fields: captured.update(fields),
    )

    asyncio.run(
        service.generate_text_brief(
            StockBehaviorAiRequest(symbol="2330", as_of_date="2025-03-14")
        )
    )

    config = json.loads(captured["config_json"])
    assert config["example_set_version"] == few_shot_examples.example_set_version()


def _eval_result(
    case: str,
    status: str,
    overall: str | None,
    stances: tuple[str, str, str] | None,
    latency_ms: int,
    *,
    hard: bool = False,
    soft_hits: int = 0,
    downgraded: bool = False,
    simplified: bool = False,
) -> dict:
    brief = None
    if overall and stances:
        brief = {
            "overall_stance": overall,
            "forward_views": [
                {"horizon": horizon, "stance": stance}
                for horizon, stance in zip(
                    ("short_1_5", "swing_6_20", "medium_21_40"),
                    stances,
                )
            ],
        }
    return {
        "case": {"symbol": case, "as_of_date": "2025-03-14"},
        "latency_ms": latency_ms,
        "response": {
            "status": status,
            "brief": brief,
            "verification": {
                "compliance_violations": ["hard"] if hard else [],
                "soft_compliance_hits": ["soft"] * soft_hits,
                "downgraded_view_horizons": ["short_1_5"] if downgraded else [],
                "simplified_chars": ["发"] if simplified else [],
            },
        },
    }


def test_aggregate_eval_results_all_metrics_and_modal_agreement():
    results = [
        _eval_result("A", "verified", "bullish", ("bullish", "mixed", "bullish"), 100),
        _eval_result("A", "limited", "bullish", ("bullish", "mixed", "bearish"), 200, soft_hits=2, downgraded=True),
        _eval_result("A", "verified", "bearish", ("bearish", "mixed", "bearish"), 300, hard=True),
        _eval_result("B", "verified", "neutral", ("neutral", "neutral", "uncertain"), 400, simplified=True),
        _eval_result("B", "limited", "neutral", ("mixed", "neutral", "uncertain"), 500, soft_hits=1, downgraded=True),
        _eval_result("B", "unavailable", None, None, 600),
    ]

    metrics = aggregate_eval_results(results)

    assert metrics["runs_total"] == 6
    assert metrics["status_counts"] == {"verified": 3, "limited": 2, "unavailable": 1}
    assert metrics["unavailable_rate"] == pytest.approx(1 / 6)
    assert metrics["hard_violation_rate"] == pytest.approx(1 / 6)
    assert metrics["soft_hits_avg"] == pytest.approx(0.5)
    assert metrics["downgrade_rate"] == pytest.approx(1 / 3)
    assert metrics["simplified_char_runs"] == 1
    assert metrics["stance_agreement"]["overall_stance"] == pytest.approx(5 / 6)
    assert metrics["stance_agreement"]["forward_views"] == {
        "short_1_5": pytest.approx(7 / 12),
        "swing_6_20": pytest.approx(1.0),
        "medium_21_40": pytest.approx(5 / 6),
    }
    assert metrics["latency_ms_p50"] == 350
    assert metrics["latency_ms_p95"] == 575


@pytest.mark.parametrize("script", ["build_golden_candidates.py", "run_brief_eval.py"])
def test_scripts_import_and_help_without_starting_services(script):
    backend = Path(__file__).resolve().parents[1]
    completed = subprocess.run(
        [sys.executable, str(backend / "scripts" / script), "--help"],
        cwd=backend,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    assert "--cases" in completed.stdout
