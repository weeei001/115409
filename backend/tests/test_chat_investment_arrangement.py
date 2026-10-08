"""Fixed investment evidence through validation, streaming and private audit reads.

Preparation is fixed here so these tests exercise answer publication rather than
external retrieval or nondeterministic model quality.
"""
import asyncio
import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import sessionmaker

from app.clients.llm import LlmResult, LlmTextChunk
from app.features.admin import chat_review_repository
from app.features.chat.audit import utcnow
from app.features.chat.schemas import AskRequest, AskResponse, SourceChunk
from app.features.chat.service import ChatService


QUERY = "請參考我的模擬投資可用資金、持股與收藏股票，協助我討論下一步投資安排"
CATALOG = {"2330": {"name": "台積電"}, "2317": {"name": "鴻海"}}
METADATA = {"finish_reason": "stop", "prompt_tokens": 120, "completion_tokens": 80}


def evidence(scenario):
    held = scenario in {"holdings", "pending"}
    pending = scenario == "pending"
    portfolio = {
        "initialized": True, "as_of": "2026-10-08T10:00:00+08:00",
        "cash": 50000, "available_cash": 40000 if pending else 50000,
        "reserved_cash": 10000 if pending else 0,
        "holdings_value": 10000 if held else 0, "equity": 60000 if held else 50000,
        "positions": [{"symbol": "2330", "quantity": 100,
                       "reserved_quantity": 40 if pending else 0,
                       "market_value": 10000}] if held else [],
        "orders": [{"symbol": "2330", "side": "sell", "quantity": 40, "status": "pending"},
                   {"symbol": "2317", "side": "buy", "quantity": 100,
                    "reserved_cash": 10000, "status": "pending"}] if pending else [],
    }
    payloads = [
        ("personal", "", {"portfolio": portfolio, "favorites": ["2330", "2317"]}),
        ("market_technical", "2330", {"columns": ["date", "close", "chg_pct"],
                                          "rows": [["2026-10-07", 100, 2]]}),
        ("availability", "", {"description": "本輪選取台積電，因行情資料足夠；鴻海尚缺行情資料。"}),
    ]
    if scenario == "missing":
        payloads[1] = ("market_technical", "2330", {"columns": ["date", "close"], "rows": []})
        payloads[2] = ("availability", "", {"description": "台積電與鴻海皆尚缺行情資料，無法比較。"})
    return [SourceChunk(citation_id=f"S{i}", category=category, stock_id=symbol,
                        title=category, source="fixture", source_name="Fixture",
                        pub_time="2026-10-08", url="", score=1,
                        content=json.dumps(payload, ensure_ascii=False))
            for i, (category, symbol, payload) in enumerate(payloads, 1)]


def substantive_answer(scenario):
    available = 40000 if scenario == "pending" else 50000
    position = "目前沒有持股。" if scenario == "cash" else "台積電持股100股。"
    orders = "已委託賣出40股，可用股數60股。" if scenario == "pending" else ""
    return (
        f"帳戶資料截至2026-10-08，可用資金{available}元。{position}[S1]\n\n"
        + (f"台積電{orders}[S1]\n\n" if orders else "")
        + "本輪選取台積電，因行情資料足夠；鴻海尚缺行情資料，未納入比較。[S3]\n\n"
        + "台積電2026-10-07收盤價100元。[S2]\n\n"
        + "分析意見：應避免把資金集中在單一股票；尚需確認投資期間與可承受風險。[S1]\n\n"
        + f"假設能承受股價波動，建議投入可用資金10000元買台積電，另保留{available - 10000}元現金。[S1]\n\n"
        + "若無法承受波動，先維持現金並補足鴻海資料，再討論是否投入。[S1][S3]"
    )


def run_turn(db, scenario, drafts, *, stream):
    sources = evidence(scenario)
    calls = []

    async def text(**kwargs):
        index = len(calls)
        calls.append(kwargs)
        answer, metadata = drafts[index]
        return LlmResult({}, answer, metadata)

    async def stream_text(**kwargs):
        result = await text(**kwargs)
        yield LlmTextChunk(result.raw_text, result.metadata)

    model = SimpleNamespace(text=text, stream_text=stream_text, require_enabled=lambda: None,
                            model_name="fixed-investment-model",
                            settings=SimpleNamespace(LLM_MAX_TOKENS=4096))
    chat = ChatService(http=None, settings=None, retrieval=object(), llm=model,
                       session_factory=sessionmaker(db.get_bind()))

    async def prepare(request):
        assert request.query == QUERY
        response = AskResponse(answer="", detected_stocks=[], time_range=None, sources=sources,
                               tokens={"input": None, "output": None, "thinking": None},
                               duration_ms=0, current_time="2026-10-08")
        response._company_catalog = CATALOG
        response._requires_portfolio = True
        yield response, "Fixed evidence for investment discussion", ""

    chat._prepare_steps = prepare

    async def run():
        request = AskRequest(query=QUERY, stream=stream)
        if stream:
            events = [event async for event in chat.stream_events(request)]
            assert events[-1]["type"] == "done"
            return events[-1]["answer"], json.dumps(events, ensure_ascii=False)
        response = await chat.ask(request)
        return response.answer, response.model_dump_json()

    answer, public = asyncio.run(run())
    db.expire_all()
    summaries, total = chat_review_repository.review_list(
        db, since=utcnow() - timedelta(days=1), outcome=None, reason="", query=QUERY,
        limit=10, offset=0)
    assert total == 1
    record, email = chat_review_repository.review_by_id(
        db, summaries[0]["id"], since=utcnow() - timedelta(days=1))
    assert email is None
    assert record.query == QUERY and record.data["publication_completed"]
    assert record.data["sources"][0]["content"] == sources[0].content
    assert record.data["duration_ms"] >= 0
    assert record.data["tokens"]["input"] == 120 * len(calls)
    assert record.data["tokens"]["output"] == 80 * len(calls)
    return answer, public, record, calls


@pytest.mark.parametrize("scenario", ["cash", "holdings", "pending"])
@pytest.mark.parametrize("stream", [False, True])
def test_substantive_investment_discussion_is_published_and_audited(db_session, scenario, stream):
    draft = substantive_answer(scenario)
    answer, _, record, calls = run_turn(db_session, scenario, [(draft, METADATA)], stream=stream)
    assert answer.startswith(draft)
    assert record.outcome == "passed" and len(calls) == 1
    assert record.data["attempts"][0]["finish_reason"] == "stop"
    assert all(part in answer for part in ("2026-10-08", "2026-10-07"))
    assert all(part in answer for part in ("本輪選取", "尚缺行情", "若無法承受", "另保留"))


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("scenario", ["cash", "missing"])
def test_missing_or_different_dates_publish_explicit_limits(db_session, stream, scenario):
    answer = "帳戶截至2026-10-08，可用資金50000元，目前沒有持股。[S1]\n\n"
    if scenario == "missing":
        answer += "台積電與鴻海皆尚缺行情資料，無法比較。應補足行情再討論投入，先維持現金。[S3]"
    else:
        answer += ("台積電行情截至2026-10-07，收盤價100元；與帳戶日期不同，不能當作即時報價。[S2]\n\n"
                   "鴻海尚缺行情資料，未納入比較；先補足相同日期資料，再討論配置。[S3]")
    published, _, record, calls = run_turn(db_session, scenario, [(answer, METADATA)], stream=stream)
    assert published.startswith(answer) and record.outcome == "passed" and len(calls) == 1


@pytest.mark.parametrize("bad,reason", [
    ("目前可用資金999元。[S1]", "numbers"),
    ("鴻海持股999股。[S1]", "numbers"),
    ("因公司取得大單，台積電上漲2%。[S2]", "grounding"),
    ("假設建議投入60000元買台積電。[S1]", "numbers"),
    ("假設建議賣出台積電80股。[S1]", "numbers"),
])
@pytest.mark.parametrize("stream", [False, True])
def test_bad_draft_is_repaired_once_without_leaking(db_session, bad, reason, stream):
    repaired = substantive_answer("pending")
    answer, public, record, calls = run_turn(
        db_session, "pending", [(bad, METADATA), (repaired, METADATA)], stream=stream)
    assert answer.startswith(repaired) and bad not in public
    assert len(calls) == 2 and record.outcome == "repaired"
    assert record.data["attempts"][0]["reason"] == reason


@pytest.mark.parametrize("stream", [False, True])
def test_two_truncated_drafts_never_publish_and_never_retry_again(db_session, stream):
    draft = substantive_answer("cash")
    metadata = {**METADATA, "finish_reason": "length"}
    answer, public, record, calls = run_turn(
        db_session, "cash", [(draft, metadata), (draft, metadata)], stream=stream)
    assert draft not in public and draft != answer
    assert record.outcome == "fallback" and len(calls) == 2
    assert [attempt["reason"] for attempt in record.data["attempts"]] == ["length", "length"]
