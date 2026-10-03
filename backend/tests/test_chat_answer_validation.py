import json

import pytest

from app.clients.llm import LlmResult
from app.features.chat import service as chat_module
from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.schemas import SourceChunk
from test_chat import MODEL_ANSWER, chat, events


def price_source(citation_id, price):
    return SourceChunk(citation_id=citation_id, title="Price", source="system_market",
                       source_name="Market", pub_time="2026-10-01", url="", stock_id="2330",
                       score=1, category="market_technical", content=json.dumps({
                           "columns": ["date", "close"], "rows": [["2026-10-01", price]],
                       }))


@pytest.mark.parametrize("answer", [
    "收盤價 200 元。[S1] 收盤價 100 元。[S2]",
    "收盤價 100 元。[S1] 收盤價 100 元。[S2]",
    "收盤價 100 元。[S1] 收盤價 200 元。",
])
def test_other_citations_cannot_lend_numbers_to_a_claim(answer):
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"},
                        [price_source("S1", 100), price_source("S2", 200)])


@pytest.mark.parametrize("answer", [
    "收盤價 100 元。[S1] 收盤價 200 元。[S2]",
    "收盤價 100 元，另一筆收盤價 200 元。[S1][S2]",
    "收盤價 100 元，另一筆收盤價 200 元。[S1] [S2]",
])
def test_local_and_paragraph_end_citation_groups_support_their_own_text(answer):
    assert _checked_answer(answer, {"finish_reason": "stop"},
                           [price_source("S1", 100), price_source("S2", 200)]).startswith(answer)


@pytest.mark.parametrize("qualifier", ["2317", "2026-10-01"])
def test_changing_citations_does_not_reset_subject_or_date(qualifier):
    first = price_source("S1", 100).model_copy(update={"stock_id": "2317"})
    second = price_source("S2", 200)
    second.content = json.dumps({"columns": ["date", "close"], "rows": [["2026-10-02", 200]]})
    answer = f"{qualifier} 收盤價 100 元[S1]，收盤價 200 元[S2]。"
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, [first, second])


def test_local_citation_retains_a_new_explicit_subject():
    first = price_source("S1", 100).model_copy(update={"stock_id": "2317"})
    answer = "2317 收盤價 100 元[S1]，2330 收盤價 200 元[S2]。"
    assert _checked_answer(answer, {"finish_reason": "stop"},
                           [first, price_source("S2", 200)]).startswith(answer)


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("reason", ["empty", "numbers", "citations"])
def test_recovery_uses_failure_category_and_publishes_only_valid_replacement(chat, monkeypatch, stream, reason):
    client, _, llm, retrieval = chat
    llm.answer = {"empty": "", "numbers": "股價 200 元。[S1]", "citations": "營收增加。[S99]"}[reason]
    retrieval.hits[0]["payload"]["page_content"] = "營收增加，股價 100 元。"
    original_text = llm.text
    original_prompt = chat_module.recovery_system_prompt
    reasons, attempts = [], []

    def recovery_prompt(detail, failure):
        reasons.append(failure)
        return original_prompt(detail, failure)

    async def repair(**kwargs):
        attempts.append(kwargs)
        if not stream and len(attempts) == 1:
            return await original_text(**kwargs)
        return LlmResult({}, MODEL_ANSWER, llm.metadata)

    monkeypatch.setattr(chat_module, "recovery_system_prompt", recovery_prompt)
    llm.text = repair
    response = client.post("/api/ask", json={"query": "台積電", "stream": stream})
    assert response.status_code == 200
    result = events(response)[-1] if stream else response.json()
    assert result["answer"].startswith(MODEL_ANSWER)
    assert "200 元" not in response.text
    assert reasons == [reason]
    assert len(attempts) == (1 if stream else 2)


@pytest.mark.parametrize("stream", [False, True])
def test_empty_recovery_has_same_bounded_attempt_budget(chat, stream):
    client, _, llm, _ = chat
    llm.answer = ""
    response = client.post("/api/ask", json={"query": "台積電", "stream": stream})
    assert sum(kind in {"text", "stream"} for kind, _ in llm.calls) == 2
    if stream:
        result = events(response)
        assert result[-1]["type"] == "error"
        assert not any(event["type"] in {"text", "done"} for event in result)
    else:
        assert response.status_code == 503
