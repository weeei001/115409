import asyncio
from contextlib import nullcontext
from datetime import timedelta
import hashlib
import json
from pathlib import Path
import random
import subprocess
import sys

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from app.clients.llm import LlmClient, LlmResult
from app.core.errors import ModelUnavailable, UpstreamTimeout
from app.db.models.news_article import NewsArticle
from app.db.models.news_sentiment import NewsSentiment
from app.features.market import company_catalog
from app.features.news import service as news_service
from app.features.news.sentiment import SentimentOutput, active_config_hash, article_input_hash
from app.jobs.locking import JobAlreadyRunning, worker_lock
from app.jobs.sentiment import cli
from app.jobs.sentiment.rules import clean_text, compute_input_hash, extract_candidate_stocks, parse_news_pub_time, validate_sentiment_payload
from app.jobs.sentiment.runner import SentimentBatchRunner


@pytest.fixture(autouse=True)
def listed_companies(monkeypatch):
    names = {"2330": "台積電", "2317": "鴻海", "2454": "聯發科", "2408": "南亞科", "2881": "富邦金", "2615": "萬海"}
    monkeypatch.setattr(company_catalog, "load_catalog",
        lambda: {symbol: {"symbol": symbol, "name": name, "market": "TWSE", "aliases": []}
                 for symbol, name in names.items()})


def config(settings, **updates):
    return settings.model_copy(update={"LLM_MODEL": "shared-test-model", "LLM_API_KEY": "mock-only",
        "LLM_BASE_URL": "https://llm.test/v1", "LLM_MAX_TOKENS": 1024, **updates})


def add_article(db, identifier="article", **updates):
    article = NewsArticle(**{"article_id": identifier, "stock_id": "2330", "title": "台積電營運強勁",
        "content": "台積電本季營收與毛利皆優於預期。", "pub_time": "2026-08-05 10:00:00", **updates})
    db.add(article)
    db.commit()
    return article


def output(**updates):
    payload = {"label": "positive", "reason": "公司本季營收與毛利皆優於預期。",
               "evidence": [{"field": "content", "quote": "台積電本季營收與毛利皆優於預期"}], **updates}
    payload.setdefault("related", True)
    return LlmResult(payload, json.dumps(payload, ensure_ascii=False),
                     {"prompt_tokens": 500, "completion_tokens": 80, "reasoning_tokens": 5})


class FakeLlm:
    def __init__(self, results=None):
        self.results = list(results or [output()])
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        result = self.results[min(len(self.calls) - 1, len(self.results) - 1)]
        if isinstance(result, Exception):
            raise result
        return result


def runner(db, settings, tmp_path, **updates):
    return SentimentBatchRunner(db_session=db, settings=config(settings), work_dir=tmp_path, **updates)


def run(worker, items=None):
    return asyncio.run(worker.run_manifest(items or [{"article_id": "article", "symbol": "2330"}]))


def test_legacy_cleaning_candidate_and_canonical_input_hash_rules():
    assert extract_candidate_stocks("2330", "2317.TW, 2454, 9999, 2330") == ["2330", "2317", "2454"]
    assert extract_candidate_stocks(None, "2615.tw, 2881") == ["2615", "2881"]
    assert extract_candidate_stocks("9999", "8888") == []
    assert clean_text("<p>台積電 &amp; 鴻海\r\n\r\n  營收  創新高！<br></p>") == "台積電 & 鴻海\n\n營收 創新高！"
    timestamp, canonical = parse_news_pub_time("2026-08-05T06:30:00Z")
    assert timestamp.hour == 14 and timestamp.utcoffset() == timedelta(hours=8)
    assert parse_news_pub_time("2026/08/05 14:30")[1] == canonical
    assert parse_news_pub_time("2026-8-5 14:30")[1] == canonical
    assert parse_news_pub_time("2026-8-5")[1] == "2026-08-05T00:00:00+08:00"
    assert parse_news_pub_time("not-a-date") == (None, "")
    fields = {"cleaned_title": "標題A", "cleaned_content": "內文B", "pub_time_str": canonical,
              "target_stock_id": "2330", "target_stock_name": "台積電"}
    expected = {"title": "標題A", "content": "內文B", "pub_time": canonical, "normalization_version": "norm_v1",
                "target_stock_id": "2330", "target_stock_name": "台積電"}
    assert compute_input_hash(**fields) == hashlib.sha256(json.dumps(expected, ensure_ascii=False,
        sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert compute_input_hash(**fields) != compute_input_hash(**{**fields, "target_stock_id": "2317"})


def test_evidence_mixed_cardinality_exact_quotes_and_no_extra_fields():
    title, content = "台積電營收創新高", "營收成長但海外建廠成本上升帶來毛利壓力。"
    valid = {"label": "mixed", "reason": "營收成長但成本上升。", "evidence": [
        {"field": "title", "quote": "营收"}, {"field": "content", "quote": "成本上升帶來毛利壓力"}]}
    assert not validate_sentiment_payload(valid, cleaned_title=title, cleaned_content=content).is_valid
    valid["evidence"][0]["quote"] = "營收創新高"
    assert validate_sentiment_payload(valid, cleaned_title=title, cleaned_content=content).is_valid
    for invalid in ({**valid, "evidence": valid["evidence"][:1]}, {**valid, "reason": "x" * 81},
                    {**valid, "extra": True}, {**valid, "label": "positive", "evidence": []}):
        assert not validate_sentiment_payload(invalid, cleaned_title=title, cleaned_content=content).is_valid
    assert validate_sentiment_payload({"label": "insufficient", "reason": "缺乏公司資訊", "evidence": []},
                                      cleaned_title=title, cleaned_content=content).is_valid


def test_manifest_sampling_is_balanced_deduplicated_reproducible_without_global_rng_changes(db_session):
    for index in range(9):
        add_article(db_session, str(index), stock_id="2330", tags="2317.TW,2330,2317")
    random_state = random.getstate()
    first = cli.generate_manifest(db_session, stocks=["2330", "2317"], limit=10, seed=123, dev_split=3)
    assert first == cli.generate_manifest(db_session, stocks=["2330", "2317"], limit=10, seed=123, dev_split=3)
    assert random.getstate() == random_state
    assert len({(item["article_id"], item["symbol"]) for item in first}) == 10
    assert sum(item["symbol"] == "2330" for item in first) == 5
    assert sum(item["split"] == "dev" for item in first) == 3


def test_default_preview_has_no_llm_writes_or_audit_log(db_session, settings, tmp_path, monkeypatch):
    add_article(db_session)
    llm = FakeLlm()
    def unexpected_commit():
        raise AssertionError("Preview may not commit")
    monkeypatch.setattr(db_session, "commit", unexpected_commit)
    result = run(runner(db_session, settings, tmp_path, llm=llm))
    assert result["mode"] == "preview" and result["api_calls"] == 0 and not llm.calls
    assert db_session.scalar(select(func.count()).select_from(NewsSentiment)) == 0
    assert not list(tmp_path.iterdir())


def test_success_reuse_duplicate_pair_usage_and_news_attachment(db_session, settings, tmp_path):
    add_article(db_session)
    add_article(db_session, "identical")
    llm = FakeLlm()
    items = [{"article_id": key, "symbol": "2330"} for key in ("article", "article", "identical")]
    result = run(runner(db_session, settings, tmp_path, llm=llm, execute=True), items)
    assert result["success"] == 2 and result["reused"] == 1 and result["api_calls"] == 1
    assert result["skip_reasons"] == {"duplicate_pair": 1}
    assert result["total_cost_usd"] == 0.000196
    assert result["total_input_tokens"] == 500 and result["total_output_tokens"] == 80 and result["total_reasoning_tokens"] == 5
    saved = db_session.get(NewsSentiment, ("article", "2330"))
    assert saved.status == "success" and saved.label == "positive"
    assert db_session.get(NewsSentiment, ("identical", "2330")).estimated_cost_usd == 0
    again = run(runner(db_session, settings, tmp_path, llm=llm, execute=True))
    assert again["reused"] == 1 and again["api_calls"] == 0 and len(llm.calls) == 1
    attached = news_service.news_detail(db_session, "article", settings=config(settings))
    assert attached.sentiments[0].label == "positive"
    assert llm.calls[0]["schema"] is SentimentOutput


def test_config_and_changed_input_invalidate_cache(db_session, settings, tmp_path):
    article = add_article(db_session)
    llm = FakeLlm()
    first = runner(db_session, settings, tmp_path, llm=llm, execute=True)
    run(first)
    assert first.config_hash == active_config_hash(config(settings))
    for key, value in (("LLM_MODEL", "changed"), ("LLM_TEMPERATURE", 0.9), ("LLM_MAX_TOKENS", 8192)):
        assert active_config_hash(config(settings, **{key: value})) != first.config_hash
    article.title = "Updated title"
    db_session.commit()
    assert news_service.news_detail(db_session, "article", settings=config(settings)).sentiments == []
    result = run(runner(db_session, settings, tmp_path, llm=llm, execute=True))
    assert result["api_calls"] == 1 and result["reused"] == 0


def test_incremental_limits_pending_pairs_and_skips_unchanged_attempts(db_session, settings, tmp_path):
    worker = runner(db_session, settings, tmp_path, llm=FakeLlm(), limit=2)
    existing = []
    for index, status in enumerate(("success", "failed", "skipped")):
        article = add_article(db_session, f"done-{index}", pub_time=f"2026-08-0{8-index} 10:00:00")
        worker._save_record(article.article_id, "2330", article_input_hash(article, "2330"), status)
        existing.append(article)
    add_article(db_session, "pending", tags="2317.TW,2330")
    add_article(db_session, "unsupported", stock_id="9999")
    expected = [{"article_id": "pending", "symbol": symbol} for symbol in ("2330", "2317")]
    assert worker.incremental_manifest(["2330", "2317"]) == expected
    changed_config = runner(db_session, settings, tmp_path, llm=FakeLlm(), limit=10)
    changed_config.config_hash = "changed-config"
    assert len(changed_config.incremental_manifest(["2330"])) == 5
    for article, field, value in zip(existing, ("title", "content", "pub_time"),
                                     ("Corrected headline", "Corrected content", "2026-08-09 10:00:00")):
        setattr(article, field, value)
    db_session.commit()
    assert worker.incremental_manifest(["2330"]) == [
        {"article_id": "done-2", "symbol": "2330"}, {"article_id": "done-0", "symbol": "2330"}]


def test_incremental_persists_unusable_inputs_once_and_obeys_budget(db_session, settings, tmp_path):
    add_article(db_session, "long", content="過長內文" * 9000, pub_time="2026-08-08")
    add_article(db_session, "empty", title=None, content=None, pub_time="2026-08-07")
    add_article(db_session, "invalid", pub_time="bad-date")
    llm = FakeLlm()
    worker = runner(db_session, settings, tmp_path, llm=llm, execute=True)
    result = run(worker, worker.incremental_manifest(["2330"]))
    assert result["skipped"] == 3 and not llm.calls
    assert worker.incremental_manifest(["2330"]) == []
    add_article(db_session, "new")
    worker = runner(db_session, settings, tmp_path, llm=llm, execute=True, max_cost_usd=0)
    items = worker.incremental_manifest(["2330"])
    assert items == [{"article_id": "new", "symbol": "2330"}]
    assert run(worker, items)["stopped_reason"] == "budget_exhausted" and not llm.calls
    assert worker.incremental_manifest(["2330"]) == items


def test_incremental_retries_only_transient_failures_after_cooldown(db_session, settings, tmp_path):
    worker = runner(db_session, settings, tmp_path, llm=FakeLlm())
    transient = {"timeout", "rate_limit_429", "upstream_model_error", "client_uninitialized", "auth_error_401", "model_not_found"}
    for code in transient | {"validation_failed: invalid evidence", "truncated_output"}:
        article = add_article(db_session, code)
        worker._save_record(article.article_id, "2330", article_input_hash(article, "2330"), "failed", error_code=code)
    assert worker.incremental_manifest(["2330"]) == []
    for row in db_session.scalars(select(NewsSentiment)):
        row.analyzed_at -= timedelta(hours=2)
    db_session.commit()
    assert {item["article_id"] for item in worker.incremental_manifest(["2330"])} == transient


def test_validation_retry_feedback_then_success(db_session, settings, tmp_path):
    add_article(db_session)
    llm = FakeLlm([output(evidence=[{"field": "content", "quote": "invented evidence"}]), output()])
    summary = run(runner(db_session, settings, tmp_path, llm=llm, execute=True))
    assert summary["success"] == 1 and summary["api_calls"] == 2 and summary["total_cost_usd"] == 0.000392
    assert "Evidence quote does not appear" in llm.calls[1]["payload"]["validation_feedback"]
    audit = [json.loads(line) for line in next(tmp_path.glob("*.jsonl")).read_text(encoding="utf-8").splitlines()]
    assert audit[0]["error"].startswith("validation_failed:") and audit[1]["error"] is None


def test_failed_validation_clears_previously_public_result(db_session, settings, tmp_path):
    article = add_article(db_session)
    run(runner(db_session, settings, tmp_path, llm=FakeLlm(), execute=True))
    article.content = "Different information"
    db_session.commit()
    result = run(runner(db_session, settings, tmp_path, llm=FakeLlm(), execute=True))
    saved = db_session.get(NewsSentiment, ("article", "2330"))
    assert result["failed"] == 1 and result["api_calls"] == 2
    assert saved.status == "failed" and saved.label is None and saved.evidence is None
    assert news_service.news_detail(db_session, "article", settings=config(settings)).sentiments == []


def test_budget_checked_before_each_retry_and_unknown_usage_reserved(db_session, settings, tmp_path):
    add_article(db_session)
    invalid = FakeLlm([output(label="mixed", evidence=[])])
    result = run(runner(db_session, settings, tmp_path, llm=invalid, execute=True, max_cost_usd=0.0029))
    assert result["api_calls"] == 1 and result["failed"] == 1 and result["stopped_reason"] == "budget_exhausted"
    assert len(invalid.calls) == 1
    timeout = runner(db_session, settings, tmp_path, llm=FakeLlm([UpstreamTimeout()]), execute=True)
    result = run(timeout)
    assert result["api_calls"] == 1 and result["budget_spent_usd"] == round(float(timeout.reserved_per_call), 6)
    assert result["total_cost_usd"] == 0
    no_budget = run(runner(db_session, settings, tmp_path, llm=FakeLlm(), execute=True, max_cost_usd=0))
    assert no_budget["api_calls"] == 0 and no_budget["stopped_reason"] == "budget_exhausted"


@pytest.mark.parametrize("status,code", [(401, "auth_error_401"), (404, "model_not_found")])
def test_terminal_upstream_errors_stop_batch_without_retry(db_session, settings, tmp_path, status, code):
    add_article(db_session)
    add_article(db_session, "next")
    llm = FakeLlm([ModelUnavailable("safe error", upstream_status_code=status)])
    summary = run(runner(db_session, settings, tmp_path, llm=llm, execute=True),
                  [{"article_id": key, "symbol": "2330"} for key in ("article", "next")])
    assert summary["api_calls"] == 1 and summary["failed"] == 1 and summary["stopped_reason"] == code
    assert db_session.get(NewsSentiment, ("article", "2330")).error_code == code
    assert db_session.get(NewsSentiment, ("next", "2330")) is None


def test_three_consecutive_failures_stop_and_skips_are_persisted(db_session, settings, tmp_path):
    for name in ("a", "b", "c", "d"):
        add_article(db_session, name)
    llm = FakeLlm([UpstreamTimeout()])
    result = run(runner(db_session, settings, tmp_path, llm=llm, execute=True),
                 [{"article_id": key, "symbol": "2330"} for key in ("a", "b", "c", "d")])
    assert result["failed"] == 3 and result["api_calls"] == 3 and result["stopped_reason"] == "consecutive_failures"
    add_article(db_session, "empty", title=None, content="<br>")
    add_article(db_session, "invalid", pub_time="not-a-date")
    add_article(db_session, "long", content="過長內文" * 9000)
    items = [{"article_id": key, "symbol": "2330"} for key in ("empty", "invalid", "long", "missing")]
    result = run(runner(db_session, settings, tmp_path, llm=FakeLlm(), execute=True), items)
    assert result["skipped"] == 4 and result["api_calls"] == 0
    assert db_session.get(NewsSentiment, ("empty", "2330")).error_code == "skipped_empty_content"
    assert db_session.get(NewsSentiment, ("invalid", "2330")).error_code == "skipped_invalid_date"
    assert db_session.get(NewsSentiment, ("long", "2330")).error_code == "skipped_input_too_long"


def test_commit_failure_rolls_back_without_success_row(db_session, settings, tmp_path, monkeypatch):
    add_article(db_session)
    real_rollback, rolled_back = db_session.rollback, []
    def fail_commit():
        raise OperationalError("test write", {}, RuntimeError("write failed"))
    def rollback():
        rolled_back.append(True)
        real_rollback()
    monkeypatch.setattr(db_session, "commit", fail_commit)
    monkeypatch.setattr(db_session, "rollback", rollback)
    with pytest.raises(OperationalError):
        run(runner(db_session, settings, tmp_path, llm=FakeLlm(), execute=True))
    assert rolled_back and db_session.get(NewsSentiment, ("article", "2330")) is None


def test_shared_worker_lock_blocks_second_process_and_releases(tmp_path):
    script = "from pathlib import Path; from app.jobs.locking import worker_lock, JobAlreadyRunning\ntry:\n with worker_lock('sentiment', Path(__import__('sys').argv[1])): pass\nexcept JobAlreadyRunning:\n raise SystemExit(23)"
    with worker_lock("sentiment", tmp_path):
        result = subprocess.run([sys.executable, "-c", script, str(tmp_path)], cwd=str(Path(__file__).resolve().parents[1]),
                                capture_output=True, timeout=10)
        assert result.returncode == 23, result.stderr.decode(errors="replace")
        with pytest.raises(JobAlreadyRunning):
            with worker_lock("sentiment", tmp_path):
                pass
    with worker_lock("sentiment", tmp_path):
        pass


def test_real_llm_adapter_structured_sentiment_uses_shared_settings(db_session, settings, tmp_path):
    add_article(db_session)
    def handler(request):
        body = json.loads(request.content)
        assert body["model"] == "shared-test-model" and body["max_completion_tokens"] == 1024
        assert body["response_format"] == {"type": "json_object"}
        assert body.get("stream", False) is False
        assert json.loads(body["messages"][-1]["content"])["target_stock_id"] == "2330"
        return httpx.Response(200, json={"id": "completion", "object": "chat.completion", "created": 1,
            "model": "shared-test-model", "choices": [{"index": 0, "finish_reason": "stop", "message": {
                "role": "assistant", "content": output().raw_text}}],
            "usage": {"prompt_tokens": 500, "completion_tokens": 80, "completion_tokens_details": {"reasoning_tokens": 5}}})
    async def execute():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            worker = runner(db_session, settings, tmp_path, http=http, execute=True)
            return await worker.run_manifest([{"article_id": "article", "symbol": "2330"}])
    result = asyncio.run(execute())
    assert result["success"] == 1 and result["total_reasoning_tokens"] == 5


def test_cli_preview_and_manifest_generation_use_only_overridden_database(db_session, settings, tmp_path, monkeypatch, capsys):
    add_article(db_session)
    engine = type("FakeEngine", (), {"dispose": lambda self: None})()
    monkeypatch.setattr(cli, "get_settings", lambda: config(settings))
    monkeypatch.setattr(cli, "make_engine", lambda settings: engine)
    monkeypatch.setattr(cli, "make_session_factory", lambda engine: lambda: nullcontext(db_session))
    manifest = tmp_path / "manifest.json"
    work_dir = str(tmp_path / "work")
    assert cli.main(["--generate-manifest", str(manifest), "--stocks", "2330", "--work-dir", work_dir]) == 0
    assert json.loads(manifest.read_text(encoding="utf-8"))[0]["article_id"] == "article"
    assert cli.main(["--manifest", str(manifest), "--work-dir", work_dir]) == 0
    assert cli.main(["--incremental", "--stocks", "2330", "--work-dir", work_dir]) == 0
    assert '"mode": "preview"' in capsys.readouterr().out
    assert db_session.scalar(select(func.count()).select_from(NewsSentiment)) == 0


def test_rate_limit_retry_is_accounted_and_keeps_original_input(db_session, settings, tmp_path, monkeypatch):
    add_article(db_session)
    delays = []
    async def fake_sleep(seconds):
        delays.append(seconds)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    llm = FakeLlm([ModelUnavailable("safe error", upstream_status_code=429), output()])
    worker = runner(db_session, settings, tmp_path, llm=llm, execute=True)
    result = run(worker)
    assert result["success"] == 1 and result["api_calls"] == 2 and delays == [2]
    assert llm.calls[0]["payload"] == llm.calls[1]["payload"]
    assert result["budget_spent_usd"] == round(float(worker.reserved_per_call) + 0.000196, 6)


def test_cli_rejects_invalid_manifest_before_database_or_llm(tmp_path, monkeypatch):
    manifest = tmp_path / "bad.json"
    manifest.write_text('{"invalid":"shape"}', encoding="utf-8")
    def forbidden(*args):
        raise AssertionError("Invalid input must not initialize resources")
    monkeypatch.setattr(cli, "make_engine", forbidden)
    monkeypatch.setattr(cli, "get_settings", forbidden)
    assert cli.main(["--manifest", str(manifest), "--work-dir", str(tmp_path)]) == 1


def test_invalid_pricing_cannot_bypass_budget_guard(db_session, settings, tmp_path):
    for overrides in ({"LLM_INPUT_PRICE_PER_M": -0.2}, {"LLM_OUTPUT_PRICE_PER_M": float("nan")},
                      {"SENTIMENT_USD_TWD_RATE": float("inf")}):
        with pytest.raises(ValueError):
            SentimentBatchRunner(db_session=db_session, settings=config(settings, **overrides),
                                  work_dir=tmp_path, llm=FakeLlm())


@pytest.mark.parametrize("with_usage", [True, False])
def test_length_finish_exception_preserves_usage_or_reserves_unknown_cost(db_session, settings, tmp_path, monkeypatch, with_usage):
    from openai import LengthFinishReasonError
    from openai.types.chat import ChatCompletion

    add_article(db_session)
    completion = ChatCompletion.model_validate({"id": "length", "object": "chat.completion", "created": 1,
        "model": "shared-test-model", "choices": [{"index": 0, "finish_reason": "length", "message": {
            "role": "assistant", "content": '{"label":"positive"'}}],
        "usage": {"prompt_tokens": 500, "completion_tokens": 80, "total_tokens": 580,
                  "completion_tokens_details": {"reasoning_tokens": 5}} if with_usage else None})
    class TruncatedModel:
        def with_structured_output(self, *args, **kwargs):
            return self
        async def ainvoke(self, messages):
            raise LengthFinishReasonError(completion=completion)
    monkeypatch.setattr(LlmClient, "_model", lambda self, **kwargs: TruncatedModel())
    worker = runner(db_session, settings, tmp_path, execute=True)
    result = run(worker)
    saved = db_session.get(NewsSentiment, ("article", "2330"))
    assert result["failed"] == 1 and result["api_calls"] == 2
    assert saved.error_code == "truncated_output" and saved.label is None and saved.evidence is None
    if with_usage:
        assert result["total_cost_usd"] == 0.000392 and result["total_input_tokens"] == 1000
        assert result["total_output_tokens"] == 160 and result["total_reasoning_tokens"] == 10
    else:
        assert result["total_cost_usd"] == 0 and result["total_input_tokens"] == 0
        assert result["budget_spent_usd"] == round(float(worker.reserved_per_call * 2), 6)


def test_malformed_provider_content_preserves_token_cost_metadata(db_session, settings, tmp_path):
    add_article(db_session)
    def handler(request):
        return httpx.Response(200, json={"id": "malformed", "object": "chat.completion", "created": 1,
            "model": "shared-test-model", "choices": [{"index": 0, "finish_reason": "stop", "message": {
                "role": "assistant", "content": "not valid JSON"}}],
            "usage": {"prompt_tokens": 500, "completion_tokens": 80, "completion_tokens_details": {"reasoning_tokens": 5}}})
    async def execute():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await runner(db_session, settings, tmp_path, http=http, execute=True).run_manifest(
                [{"article_id": "article", "symbol": "2330"}])
    result = asyncio.run(execute())
    assert result["failed"] == 1 and result["api_calls"] == 2 and result["total_cost_usd"] == 0.000392
    assert result["total_reasoning_tokens"] == 10
    assert db_session.get(NewsSentiment, ("article", "2330")).error_code.startswith("validation_failed:")


@pytest.mark.parametrize("status,provider_code,batch_code,attempts", [(401, "invalid_api_key", "auth_error_401", 1),
    (404, "model_not_found", "model_not_found", 1), (429, "rate_limit_exceeded", "rate_limit_429", 2),
    (400, "invalid_api_key", "auth_error_401", 1), (400, "rate_limit_exceeded", "rate_limit_429", 2)])
def test_real_adapter_error_metadata_drives_batch_control_without_secret_leak(db_session, settings, tmp_path,
        monkeypatch, status, provider_code, batch_code, attempts):
    add_article(db_session)
    async def no_wait(seconds):
        pass
    monkeypatch.setattr(asyncio, "sleep", no_wait)
    def handler(request):
        return httpx.Response(status, json={"error": {"message": "private upstream credential",
            "type": "invalid_request_error", "code": provider_code}})
    async def execute():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await runner(db_session, settings, tmp_path, http=http, execute=True).run_manifest(
                [{"article_id": "article", "symbol": "2330"}])
    result = asyncio.run(execute())
    assert result["failed"] == 1 and result["api_calls"] == attempts
    assert db_session.get(NewsSentiment, ("article", "2330")).error_code == batch_code
    assert "private upstream credential" not in next(tmp_path.glob("*.jsonl")).read_text(encoding="utf-8")
