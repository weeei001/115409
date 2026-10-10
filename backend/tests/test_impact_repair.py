"""修復資訊須送達模型服務，局部通過與整體失敗都須正確保存。"""
import asyncio
from copy import deepcopy
from datetime import datetime
from decimal import Decimal
import json

import httpx
import pytest

from app.clients.llm import LlmResult
from app.db.models.news_article import NewsArticle
from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
from app.jobs.impact.runner import ImpactBatchRunner


ARTICLE_ID = "repair-case"
SOURCE = "Central bank increased the policy rate by 25 basis points."


def _output():
    evidence = {"field": "content", "quote": SOURCE}
    return {
        "events": [{
            "key": "e1", "summary": "Central bank increased the policy rate",
            "statement_type": "fact", "speaker": "Central bank",
            "topics": ["interest_rates"], "evidence": [evidence],
        }],
        "impacts": [{
            "event_key": "e1", "target_type": "market", "target_id": "TW",
            "direction": "negative", "importance": "medium", "basis": "inferred",
            "reason": "Higher funding costs may affect the equity market",
            "evidence": [deepcopy(evidence)],
        }],
    }


def _seed(db_session):
    db_session.add(NewsArticle(
        article_id=ARTICLE_ID, source="cnyes", title="Policy rate increased",
        content=SOURCE, content_kind="full", pub_time="2026-10-06 13:00:00",
        created_at=datetime(2026, 10, 6, 13),
    ))
    db_session.commit()


def _completion(payload):
    return {
        "id": "impact-repair-test", "object": "chat.completion", "created": 1,
        "model": "test-model",
        "choices": [{"index": 0, "message": {
            "role": "assistant", "content": json.dumps(payload, ensure_ascii=False),
        }, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 100, "total_tokens": 200},
    }


def _run_with_completions(db_session, settings, tmp_path, payloads, *, max_cost_usd=0.50, preceding_failures=0):
    requests = []

    def handler(request):
        assert request.url == "https://llm.test/v1/chat/completions"
        requests.append(json.loads(request.content))
        assert len(requests) <= len(payloads), "不應發出額外模型請求"
        return httpx.Response(200, json=_completion(payloads[len(requests) - 1]))

    async def run():
        configured = settings.model_copy(update={
            "LLM_API_KEY": "test-only-token", "LLM_BASE_URL": "https://llm.test/v1",
            "LLM_MODEL": "test-model",
        })
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            runner = ImpactBatchRunner(
                db_session=db_session, settings=configured, catalog={}, http=http,
                execute=True, work_dir=tmp_path, max_cost_usd=max_cost_usd,
            )
            runner.consecutive_failures = preceding_failures
            return await runner.run(since=datetime(2026, 1, 1))

    return asyncio.run(run()), requests


@pytest.mark.parametrize("failure, expected_path", [
    ("missing_field", "events[0].statement_type"),
    ("invalid_quote", "events[0].evidence[0].quote"),
    ("invalid_structure", "impacts"),
])
def test_provider_receives_located_feedback_and_previous_output_before_success(
        db_session, settings, tmp_path, failure, expected_path):
    _seed(db_session)
    invalid = _output()
    if failure == "missing_field":
        del invalid["events"][0]["statement_type"]
    elif failure == "invalid_quote":
        invalid["events"][0]["evidence"][0]["quote"] = "A fabricated policy announcement"
    else:
        invalid["impacts"] = {}

    summary, requests = _run_with_completions(
        db_session, settings, tmp_path, [invalid, _output()],
    )

    assert summary["success"] == 1 and summary["failed"] == 0
    assert summary["api_calls"] == len(requests) == 2
    first_input = json.loads(requests[0]["messages"][-1]["content"])
    repair_input = json.loads(requests[1]["messages"][-1]["content"])
    assert "previous_output" not in first_input
    assert expected_path in repair_input["validation_feedback"]
    assert json.loads(repair_input["previous_output"]) == invalid
    repair_prompt = requests[1]["messages"][0]["content"]
    assert repair_prompt != requests[0]["messages"][0]["content"]
    assert "validation_feedback" in repair_prompt and "previous_output" in repair_prompt
    assert "response_format" not in requests[1]
    assert db_session.get(NewsEventAnalysis, ARTICLE_ID).status == "success"
    stored = db_session.query(NewsEventImpact).filter_by(article_id=ARTICLE_ID).one()
    assert json.loads(stored.evidence) == [{"field": "content", "quote": SOURCE}]


def test_second_fabricated_quote_remains_failed_without_more_requests(
        db_session, settings, tmp_path):
    _seed(db_session)
    invalid = _output()
    invalid["events"][0]["evidence"][0]["quote"] = "A fabricated policy announcement"

    summary, requests = _run_with_completions(
        db_session, settings, tmp_path, [invalid, invalid],
    )

    assert summary["failed"] == 1 and summary["success"] == 0
    assert summary["api_calls"] == len(requests) == 2
    assert summary["failure_reasons"] == {"validation_failed": 1}
    repair_input = json.loads(requests[1]["messages"][-1]["content"])
    assert "events[0].evidence[0].quote" in repair_input["validation_feedback"]
    assert json.loads(repair_input["previous_output"]) == invalid
    record = db_session.get(NewsEventAnalysis, ARTICLE_ID)
    assert record.status == "failed" and record.error_code == "validation_failed"
    assert db_session.query(NewsEventImpact).filter_by(article_id=ARTICLE_ID).count() == 0


def test_previous_output_is_bounded_by_utf8_bytes(db_session, settings, tmp_path):
    _seed(db_session)
    invalid = {**_output(), "untrusted_note": "\u4e2d" * 4000}
    del invalid["events"][0]["statement_type"]
    calls = []

    class StubLlm:
        async def generate(self, **kwargs):
            calls.append(deepcopy(kwargs))
            payload = invalid if len(calls) == 1 else _output()
            return LlmResult(payload, json.dumps(payload, ensure_ascii=False), {
                "prompt_tokens": 100, "completion_tokens": 100,
            })

    runner = ImpactBatchRunner(
        db_session=db_session, settings=settings, catalog={}, llm=StubLlm(),
        execute=True, work_dir=tmp_path,
    )
    summary = asyncio.run(runner.run(since=datetime(2026, 1, 1)))

    assert summary["success"] == 1 and len(calls) == 2
    repair_input = calls[1]["payload"]
    previous = repair_input["previous_output"]
    assert isinstance(previous, str) and previous
    assert len(previous.encode("utf-8")) <= 8000
    assert repair_input["previous_output_truncated"] is True
    assert "events[0].statement_type" in repair_input["validation_feedback"]


@pytest.mark.parametrize("preceding_failures", [0, 2])
def test_repair_context_reservation_blocks_request_when_only_base_budget_remains(
        db_session, settings, tmp_path, preceding_failures):
    _seed(db_session)
    configured = settings.model_copy(update={
        "LLM_INPUT_PRICE_PER_M": 1.0, "LLM_OUTPUT_PRICE_PER_M": 1.0,
        "LLM_MAX_TOKENS": 1000,
    })
    invalid = {**_output(), "untrusted_note": "\u4e2d" * 2000}
    del invalid["events"][0]["statement_type"]
    budget = Decimal("0.0093")

    summary, requests = _run_with_completions(
        db_session, configured, tmp_path, [invalid], max_cost_usd=float(budget),
        preceding_failures=preceding_failures,
    )

    assert summary["api_calls"] == len(requests) == 1
    # 首次呼叫後，剩餘預算仍足夠支付原有的 8,000 個輸入與 1,000 個輸出 token 預留費用。
    assert budget - Decimal(str(summary["budget_spent_usd"])) >= Decimal("0.009")
    assert summary["stopped_reason"] == "budget_exhausted"
    assert summary["failed"] == 1 and summary["success"] == 0
    assert summary["failure_reasons"] == {"validation_failed": 1}
    record = db_session.get(NewsEventAnalysis, ARTICLE_ID)
    assert record.status == "failed" and record.error_code == "validation_failed"
    assert db_session.query(NewsEventImpact).filter_by(article_id=ARTICLE_ID).count() == 0


def test_exact_duplicate_target_is_saved_once_without_repair(db_session, settings, tmp_path):
    _seed(db_session)
    duplicated = _output()
    duplicated["impacts"].append(deepcopy(duplicated["impacts"][0]))

    summary, requests = _run_with_completions(db_session, settings, tmp_path, [duplicated])

    assert summary["success"] == 1 and summary["api_calls"] == len(requests) == 1
    assert db_session.query(NewsEventImpact).filter_by(article_id=ARTICLE_ID).count() == 1


def test_invalid_impact_is_discarded_while_valid_event_is_saved_without_repair(
        db_session, settings, tmp_path):
    _seed(db_session)
    invalid_impact = _output()
    invalid_impact["impacts"][0]["evidence"][0]["quote"] = "A fabricated policy announcement"

    summary, requests = _run_with_completions(db_session, settings, tmp_path, [invalid_impact])

    assert summary["success"] == 1 and summary["failed"] == 0
    assert summary["api_calls"] == len(requests) == 1
    assert summary["failure_reasons"] == {} and summary["stopped_reason"] is None
    record = db_session.get(NewsEventAnalysis, ARTICLE_ID)
    assert record.status == "success" and record.error_code is None
    assert json.loads(record.events_json) == _output()["events"]
    assert db_session.query(NewsEventImpact).filter_by(article_id=ARTICLE_ID).count() == 0
    audit = [json.loads(line) for line in next(tmp_path.glob("news_impact_*.jsonl")).read_text(
        encoding="utf-8").splitlines()]
    assert len(audit) == 1 and audit[0]["error"] is None
    assert "impacts[0].evidence[0].quote" in audit[0]["validation_feedback"]
