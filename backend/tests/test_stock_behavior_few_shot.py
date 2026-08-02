import asyncio
from copy import deepcopy
from datetime import date
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

from schemas.stock_behavior import StockBehaviorTextBriefRequest
from stock_behavior import few_shot_examples, llm as llm_module
from stock_behavior.eval_metrics import aggregate_eval_results
from stock_behavior.evidence import EvidenceBundle
from stock_behavior.llm import (
    StockBehaviorLlmService,
    build_text_brief_system_prompt,
    build_text_brief_user_message,
    select_few_shot_examples,
)
from stock_behavior.orchestrator import StockBehaviorOrchestrator


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


def test_text_brief_few_shot_is_rendered_as_ordered_conversation_turns(monkeypatch):
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

    monkeypatch.setattr(few_shot_examples, "FEW_SHOT_EXAMPLES", [])
    service = StockBehaviorLlmService(_settings())
    asyncio.run(service.generate_text_brief_from_evidence(task_packet=task_packet))
    assert captured[-1] == [
        ("system", build_text_brief_system_prompt()),
        ("human", build_text_brief_user_message(task_packet)),
    ]

    examples = [_example("第一例", "2330"), _example("第二例", "2317")]
    monkeypatch.setattr(few_shot_examples, "FEW_SHOT_EXAMPLES", examples)
    asyncio.run(service.generate_text_brief_from_evidence(task_packet=task_packet))
    messages = captured[-1]

    assert [role for role, _ in messages] == [
        "system",
        "human",
        "ai",
        "human",
        "ai",
        "human",
    ]
    assert messages[1][1] == build_text_brief_user_message(examples[0]["input_payload"])
    assert messages[2][1] == json.dumps(
        examples[0]["output_brief"], ensure_ascii=False
    )
    assert messages[3][1] == build_text_brief_user_message(examples[1]["input_payload"])
    assert messages[-1][1] == build_text_brief_user_message(task_packet)


def _dated_example(scenario: str, symbol: str, as_of_date: str) -> dict:
    return {
        "scenario": scenario,
        "input_payload": {"task": {"symbol": symbol, "as_of_date": as_of_date}},
        "output_brief": {},
    }


def test_future_dated_examples_are_excluded_regardless_of_symbol():
    """範例帶著當時的真實價量；基準日晚於本次的一律是未來資訊，不分股票。"""
    examples = [
        _dated_example("同檔未來", "2330", "2026-07-13"),
        _dated_example("同檔過去", "2330", "2025-12-01"),
        _dated_example("他檔未來", "2408", "2026-07-13"),
        _dated_example("他檔過去", "2408", "2025-11-27"),
    ]

    kept = select_few_shot_examples(examples, symbol="2330", as_of_date="2026-01-15")

    # 他檔的未來價量同樣洩漏後來的市場狀態，不能因為股票不同就放行
    assert [item["scenario"] for item in kept] == ["同檔過去", "他檔過去"]

    assert (
        select_few_shot_examples(examples, symbol="2330", as_of_date="2026-12-31")
        == examples
    )
    assert select_few_shot_examples(examples, symbol=None, as_of_date=None) == examples


def test_example_on_the_same_day_is_dropped_only_for_the_same_symbol():
    """同檔同日的範例就是這次要產出的答案本身；他檔同日只是當下的橫向資訊。"""
    examples = [
        _dated_example("同檔同日", "2330", "2026-07-31"),
        _dated_example("他檔同日", "2408", "2026-07-31"),
    ]

    kept = select_few_shot_examples(examples, symbol="2330", as_of_date="2026-07-31")

    assert [item["scenario"] for item in kept] == ["他檔同日"]


def test_replaying_earlier_than_every_example_yields_no_few_shot():
    """濾光是允許的結果，但不能靜默——呼叫端要能從 few_shot 計數看出來。"""
    examples = [_dated_example("最早的範例", "2330", "2024-01-29")]

    assert select_few_shot_examples(examples, symbol="2330", as_of_date="2023-06-30") == []


def test_shipped_examples_are_isomorphic_with_the_real_task_packet():
    """範例輸入與正式 payload 的鍵必須一致，否則模型看到的示範格式跟真實請求不同。"""
    expected_keys = {
        "task",
        "daily_timeline",
        "long_term_anchor",
        "fundamental",
        "news",
        "missing_fields",
    }
    for example in few_shot_examples.FEW_SHOT_EXAMPLES:
        assert set(example["input_payload"]) == expected_keys
        assert set(example["input_payload"]["task"]) == {
            "type",
            "symbol",
            "as_of_date",
            "timeline_trading_days",
            "analysis_language",
        }


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

    async def fake_news(*, symbol, as_of_date):
        return [], False

    service._fetch_text_brief_news = fake_news
    monkeypatch.setattr(
        "stock_behavior.orchestrator.build_evidence_bundle",
        lambda db, **kwargs: EvidenceBundle(symbol="2330", as_of_date=date(2025, 3, 14)),
    )
    monkeypatch.setattr(
        "stock_behavior.orchestrator.get_cached_llm_response",
        lambda db, **kwargs: None,
    )
    monkeypatch.setattr(
        "stock_behavior.orchestrator.create_llm_response",
        lambda db, **fields: captured.update(fields),
    )

    asyncio.run(
        service.generate_text_brief(
            StockBehaviorTextBriefRequest(symbol="2330", as_of_date="2025-03-14")
        )
    )

    config = json.loads(captured["config_json"])
    assert config["example_set_version"] == few_shot_examples.example_set_version()


def _eval_result(
    case: str,
    status: str,
    overall: str | None,
    latency_ms: int,
    *,
    hard: bool = False,
    soft_hits: int = 0,
    simplified: bool = False,
    filtered: bool = False,
    undercount: bool = False,
    positives: int = 1,
    key_day_text: str = "下跌 2.03%，成交量放大 19%。",
    unverified: int = 0,
    forward: str = "neutral",
) -> dict:
    brief = (
        {
            "overall_stance": overall,
            "positive_factors": [{"id": "pos_01"}] * positives,
            "negative_factors": [{"id": "neg_01"}],
            "key_days": [{"id": "kd_01", "what": key_day_text}],
            "forward_views": {
                "short_1_5": {"stance": forward},
                "swing_6_20": {"stance": forward},
                "medium_21_40": {"stance": forward},
            },
        }
        if overall
        else None
    )
    return {
        "case": {"symbol": case, "as_of_date": "2025-03-14"},
        "latency_ms": latency_ms,
        "response": {
            "status": status,
            "brief": brief,
            "verification": {
                "compliance_violations": ["hard"] if hard else [],
                "soft_compliance_hits": ["soft"] * soft_hits,
                "simplified_chars": ["发"] if simplified else [],
                "filtered_evidence_ids": ["d_99"] if filtered else [],
                "undercount_sections": ["key_days<3"] if undercount else [],
                "unverified_numbers": ["kd_01: 7.7%"] * unverified,
            },
        },
    }


def test_aggregate_eval_results_all_metrics_and_modal_agreement():
    results = [
        _eval_result("A", "verified", "bullish", 100),
        _eval_result("A", "limited", "bullish", 200, soft_hits=2),
        _eval_result("A", "verified", "bearish", 300, hard=True),
        _eval_result("B", "verified", "neutral", 400, simplified=True),
        _eval_result("B", "limited", "neutral", 500, soft_hits=1),
        _eval_result("B", "unavailable", None, 600),
    ]

    metrics = aggregate_eval_results(results)

    assert metrics["runs_total"] == 6
    assert metrics["status_counts"] == {"verified": 3, "limited": 2, "unavailable": 1}
    assert metrics["unavailable_rate"] == pytest.approx(1 / 6)
    assert metrics["hard_violation_rate"] == pytest.approx(1 / 6)
    assert metrics["soft_hits_avg"] == pytest.approx(0.5)
    assert metrics["simplified_char_runs"] == 1
    assert metrics["stance_agreement"]["overall_stance"] == pytest.approx(5 / 6)
    assert metrics["stance_agreement"]["forward_views"]["short_1_5"] == pytest.approx(1.0)
    assert metrics["latency_ms_p50"] == 350
    assert metrics["latency_ms_p95"] == 575
    assert metrics["both_sides_coverage"] == pytest.approx(1.0)
    assert metrics["clean_evidence_rate"] == pytest.approx(1.0)
    assert metrics["undercount_rate"] == pytest.approx(0.0)
    assert metrics["key_day_number_accuracy"] == pytest.approx(1.0)


def test_aggregate_eval_results_flags_v2_specific_quality_gaps():
    results = [
        _eval_result("A", "limited", "bullish", 100, positives=0, filtered=True),
        _eval_result("A", "limited", "bullish", 200, undercount=True, unverified=1),
    ]

    metrics = aggregate_eval_results(results)

    # 第一筆沒有正面因素 → 雙邊覆蓋率只剩一半
    assert metrics["both_sides_coverage"] == pytest.approx(0.5)
    assert metrics["clean_evidence_rate"] == pytest.approx(0.5)
    assert metrics["undercount_rate"] == pytest.approx(0.5)
    # 兩筆 key_days 各寫 2 個百分比，其中 1 個對不上 → 3/4
    assert metrics["key_day_number_accuracy"] == pytest.approx(0.75)


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
