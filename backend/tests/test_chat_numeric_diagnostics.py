import json

import pytest

from app.clients.llm import LlmResult
from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.claims import numeric_claim_issue, numeric_claims_supported, unsupported_numeric_claim
from app.features.chat.schemas import SourceChunk
from test_chat import MODEL_ANSWER, chat, events


def source(content=None):
    return SourceChunk(citation_id="S1", title="Observation", source="system_market",
                       source_name="Market", pub_time="2026-10-01", url="", stock_id="2330",
                       score=1, category="market_technical", content=content or json.dumps({
                           "columns": ["date", "close"], "rows": [["2026-10-01", 100]],
                       }))


@pytest.mark.parametrize("text,evidence,reason", [
    ("神秘指標 10%", source(), "unparsed"),
    ("收盤價 200 元", source(), "contradicted"),
    ("殖利率 10%", source(), "unsupported"),
    ("收盤價 100 元", source("not valid structured evidence"), "invalid_evidence"),
    ("2317 收盤價 100 元", source(), "unsupported"),
    ("2026-10-02 收盤價 100 元", source(), "unsupported"),
])
def test_diagnostics_distinguish_failures_without_accepting_any(text, evidence, reason):
    issue = numeric_claim_issue(text, [evidence])
    assert issue.reason == reason
    assert unsupported_numeric_claim(text, [evidence]) == issue.sentence
    assert not numeric_claims_supported(text, [evidence])
    with pytest.raises(NumericValidationError) as error:
        _checked_answer(text + "。[S1]", {"finish_reason": "stop"}, [evidence])
    assert error.value.issue == reason
    assert error.value.hint
    assert error.value.reason == "numbers"


def test_supported_observation_keeps_compatibility():
    text = "2330 收盤價 100 元。[S1]"
    assert numeric_claim_issue(text, [source()]) is None
    assert unsupported_numeric_claim(text, [source()]) is None
    assert numeric_claims_supported(text, [source()])
    assert _checked_answer(text, {"finish_reason": "stop"}, [source()]).startswith(text)


@pytest.mark.parametrize("stream", [False, True])
def test_numeric_repair_receives_diagnostic_without_entire_rejected_draft(chat, stream):
    client, _, llm, retrieval = chat
    llm.answer = "一般段落不應整篇回填。[S1]\n\n股價 200 元。[S1]"
    retrieval.hits[0]["payload"]["page_content"] = "營收增加，股價 100 元。"
    original_text = llm.text
    attempts = []

    async def repair(**kwargs):
        attempts.append(kwargs)
        if not stream and len(attempts) == 1:
            return await original_text(**kwargs)
        return LlmResult({}, MODEL_ANSWER, llm.metadata)

    llm.text = repair
    response = client.post("/api/ask", json={"query": "台積電", "stream": stream})
    assert response.status_code == 200
    result = events(response)[-1] if stream else response.json()
    assert result["answer"].startswith(MODEL_ANSWER)
    assert len(attempts) == (1 if stream else 2)
    repair_prompt = attempts[-1]["system_prompt"]
    assert "contradicts the cited observation" in repair_prompt
    assert "股價 200 元" in repair_prompt
    assert "一般段落不應整篇回填" not in repair_prompt
    assert "contradicts the cited observation" not in response.text
