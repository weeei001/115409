"""Opt-in live NIM smoke benchmark; reads app data and writes local results only."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import sys
from time import perf_counter
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.clients.llm import LlmClient
from app.core.config import Settings
from app.core.errors import AppError
from app.core.http import make_http_client
from app.db.engine import make_engine, make_session_factory
from app.features.chat.prompts import ANSWER_PROMPT, INSUFFICIENT_EVIDENCE_ANSWER, answer_system_prompt
from app.features.chat.schemas import AskRequest, SourceChunk
from app.features.chat.service import ChatService, _checked_answer, taipei_now


MODELS = ["deepseek-ai/deepseek-v4-flash-0731", "nvidia/nemotron-3-super-120b-a12b",
          "deepseek-ai/deepseek-v4-pro-0813"]
LIVE_CASES = [
    ("concept", "用白話解釋 KD 指標，K 大於 D 就代表今天出現黃金交叉嗎？請簡短回答。"),
    ("recent_news", "整理台積電最近一週的重要新聞，說明消息日期、利多與風險，請簡短回答。"),
    ("stock_comparison", "比較台積電與鴻海最近一個月的股價表現與風險，標明資料日期，請簡短回答。"),
]
FIXED_CASES = [
    {"id": "insufficient", "query": "根據提供資料，告訴我台積電明天精確收盤價。",
     "sources": [], "review": "Must return the exact insufficient-evidence answer."},
    {"id": "numeric_conflict", "query": "用這份測試資料說明營收、股價變化與風險。現在是否能保證上漲？",
     "sources": [
         ("Synthetic company disclosure", "測試資料，非真實行情：台積電 2026-09-10 公告八月營收為新台幣 3,000 億元，年增 20%，月減 5%。"),
         ("Synthetic daily observations", "測試資料，非真實行情：台積電 2026-09-10 收盤 1,000 元，2026-09-11 收盤 980 元，區間價格報酬 -2%。價格為日收盤，非即時報價。"),
         ("Synthetic risk disclosure", "測試資料，非真實行情：公司表示匯率升值與海外廠成本可能壓縮毛利率；尚未提供下季財測，不保證未來報酬。"),
     ], "review": "Preserve 3,000 億元, annual +20%, monthly -5%, price -2%; no guaranteed rise or invented forecast."},
]


class MeasuredLlm(LlmClient):
    def __init__(self, settings, http):
        super().__init__(settings, http)
        self.calls = []

    def _model(self, streaming=None):
        model = super()._model(streaming)
        if self.model_name.startswith("nvidia/nemotron-3-"):
            # Benchmark-only override: compare non-thinking interactive workloads.
            model.extra_body = {"chat_template_kwargs": {"enable_thinking": False}}
        return model

    async def _measure(self, method, **kwargs):
        started = perf_counter()
        record = {"operation": method}
        self.calls.append(record)
        try:
            result = await getattr(super(), method)(**kwargs)
            record.update(metadata=result.metadata, payload=result.payload, raw_text=result.raw_text)
            return result
        except Exception as exc:
            record.update(error_type=type(exc).__name__, upstream_status=getattr(exc, "upstream_status_code", None))
            raise
        finally:
            record["seconds"] = round(perf_counter() - started, 4)

    async def generate(self, **kwargs):
        return await self._measure("generate", **kwargs)

    async def text(self, **kwargs):
        return await self._measure("text", **kwargs)


class MeasuredChat(ChatService):
    async def _prepare(self, request):
        started = perf_counter()
        self.prepared = await super()._prepare(request)
        self.prepare_seconds = perf_counter() - started
        return self.prepared


def sources_for(case):
    return [SourceChunk(title=title, source="synthetic_benchmark", source_name="Synthetic benchmark",
                        pub_time="2026-09-11", url="", stock_id="2330", content=content,
                        score=1, citation_id=f"S{i}")
            for i, (title, content) in enumerate(case["sources"], 1)]


async def live_case(case, llm, http, settings, factory):
    case_id, query = case
    service = MeasuredChat(http=http, settings=settings, llm=llm, session_factory=factory)
    result = {"case": case_id, "kind": "live_service", "query": query, "events": []}
    started = perf_counter()
    async for event in service.stream_events(AskRequest(query=query, stream=True, answer_detail="plain")):
        elapsed = round(perf_counter() - started, 4)
        result["events"].append({"type": event["type"], "seconds": elapsed})
        if event["type"] == "dashboard":
            result["dashboard_seconds"] = elapsed
        elif event["type"] == "text":
            result["first_answer_seconds"] = elapsed
        elif event["type"] == "done":
            result.update(ok=True, response=event)
        elif event["type"] == "error":
            result.update(ok=False, error=event["message"])
    result["total_seconds"] = round(perf_counter() - started, 4)
    if hasattr(service, "prepared"):
        response, prompt, warning = service.prepared
        result.update(prepare_seconds=round(service.prepare_seconds, 4), prompt=prompt,
                      warning=warning, sources=[s.model_dump(mode="json") for s in response.sources])
    result["semantic_review"] = "pending_manual_review"
    return result


async def fixed_case(case, llm):
    sources = sources_for(case)
    prompt = ANSWER_PROMPT.format(current_time="2026年09月12日 12:00", time_focus="Synthetic benchmark.",
        context="\n\n".join(f"[{s.citation_id}] {s.title}\n{s.content}" for s in sources) or "No evidence supplied.",
        history="[]", resolved_query=case["query"], query=case["query"])
    result = {"case": case["id"], "kind": "fixed_synthetic", "query": case["query"],
              "prompt": prompt, "sources": [s.model_dump(mode="json") for s in sources],
              "review_criteria": case["review"], "semantic_review": "pending_manual_review"}
    started = perf_counter()
    response = await llm.text(system_prompt=answer_system_prompt("plain"), prompt=prompt)
    answer = _checked_answer(response.raw_text, response.metadata, sources)
    result.update(ok=True, total_seconds=round(perf_counter() - started, 4), answer=answer)
    if case["id"] == "insufficient":
        result["exact_abstention_pass"] = response.raw_text.strip() == INSUFFICIENT_EVIDENCE_ANSWER
    return result


async def run(args):
    settings = Settings()
    endpoint = urlsplit(settings.LLM_BASE_URL)
    if endpoint.scheme != "https" or endpoint.hostname != "integrate.api.nvidia.com":
        raise SystemExit("This benchmark only sends credentials to the configured NVIDIA endpoint.")
    if not settings.LLM_API_KEY:
        raise SystemExit("NVIDIA credentials are not configured.")
    settings = settings.model_copy(update={"LLM_STREAMING": False, "LLM_MAX_RETRIES": 0,
                                           "LLM_TIMEOUT_SECONDS": args.timeout})
    output = Path(args.output)
    if output.exists():
        raise SystemExit("Output already exists; choose a new path to preserve the earlier run.")
    output.parent.mkdir(parents=True, exist_ok=True)
    engine = make_engine(settings)
    factory = make_session_factory(engine)
    try:
        with output.open("x", encoding="utf-8") as sink:
            def save(record):
                sink.write(json.dumps(record, ensure_ascii=False) + "\n")
                sink.flush()

            save({"kind": "run", "started_at": taipei_now().isoformat(), "models": args.models,
                  "temperature": settings.LLM_TEMPERATURE, "max_tokens": settings.LLM_MAX_TOKENS,
                  "thinking": False, "provider_streaming": False, "retries": 0,
                  "timeout_seconds": args.timeout, "configured_model": settings.LLM_MODEL,
                  "measurement": "Backend ChatService through validated SSE text, excluding browser/network transport.",
                  "limits": "Small smoke sample, sequential calls; structural validation is not semantic accuracy. Synthetic cases are not market facts."})
            async with make_http_client(settings) as http:
                cases = [("live", case) for case in LIVE_CASES] + [("fixed", case) for case in FIXED_CASES]
                for index, (kind, case) in enumerate(cases):
                    # Rotate order to avoid always measuring one model on cold connections.
                    models = args.models[index % len(args.models):] + args.models[:index % len(args.models)]
                    for model in models:
                        candidate = settings.model_copy(update={"LLM_MODEL": model})
                        llm = MeasuredLlm(candidate, http)
                        case_id = case[0] if kind == "live" else case["id"]
                        print(json.dumps({"event": "start", "model": model, "case": case_id}), flush=True)
                        started = perf_counter()
                        try:
                            result = (await live_case(case, llm, http, candidate, factory) if kind == "live"
                                      else await fixed_case(case, llm))
                        except Exception as exc:
                            result = {"case": case_id, "kind": kind, "ok": False,
                                      "error_type": type(exc).__name__,
                                      "total_seconds": round(perf_counter() - started, 4)}
                        result.update(model=model, calls=llm.calls)
                        save(result)
                        print(json.dumps({"event": "complete", "model": model, "case": case_id,
                                          "ok": result.get("ok", False), "seconds": result["total_seconds"],
                                          "calls": len(llm.calls)}), flush=True)
            print(f"Results saved to {output}", flush=True)
    finally:
        engine.dispose()


def self_check():
    source = sources_for(FIXED_CASES[1])[0]
    assert _checked_answer(INSUFFICIENT_EVIDENCE_ANSWER, {"finish_reason": "stop"}, []) == INSUFFICIENT_EVIDENCE_ANSWER
    try:
        _checked_answer("Unsupported claim [S99]", {"finish_reason": "stop"}, [source])
    except AppError:
        pass
    else:
        raise AssertionError("Unknown citations must be rejected.")
    print("Benchmark self-check passed; no network calls.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Authorize this bounded live provider run.")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--models", nargs="+", choices=MODELS, default=MODELS)
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--output", default=f"backend/.state/nim_benchmark_{taipei_now():%Y%m%d_%H%M%S}.jsonl")
    args = parser.parse_args()
    if args.self_check:
        self_check()
    elif args.execute:
        asyncio.run(run(args))
    else:
        print(f"Preview: {len(args.models)} models; at most {len(args.models) * 8} generation requests; no database/vector writes. Use --execute to run.")
