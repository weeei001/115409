import pytest

from app.clients.llm import LlmResult
from app.core.errors import ServiceUnavailable
from app.features.chat.schemas import SourceChunk
from app.features.chat.service import _checked_answer
from app.features.chat.verified_fallback import VERIFIED_FALLBACK_NOTICE
from test_chat import MODEL_ANSWER, chat, events, withheld_answer


@pytest.mark.parametrize("citation", ["[s1]", "［S1］", "【S1】", "[ S1 ]", "[S1, S2]"])
def test_citation_typography_keeps_source_identity(citation):
    sources = [SourceChunk(citation_id=f"S{i}", content="Revenue report.", title="Report",
                           source="test", source_name="Test", pub_time="", url="", stock_id="2330", score=1)
               for i in (1, 2)]
    answer = _checked_answer(f"## **【重點】**\n\n營收增加。{citation}", {"finish_reason": "stop"}, sources)
    assert "營收增加。[S1]" in answer
    if "S2" in citation:
        assert "[S1][S2]" in answer
    with pytest.raises(ServiceUnavailable):
        _checked_answer("營收增加。［S99］", {"finish_reason": "stop"}, sources)


@pytest.mark.parametrize("stream", [False, True])
def test_invalid_citation_is_regenerated_once_before_publication(chat, stream):
    client, _, llm, _ = chat
    invalid = "營收增加。[S99]\n\n明年一定上漲。"
    llm.answer = invalid
    initial_text = llm.text
    attempts = []

    async def repair(**kwargs):
        attempts.append(kwargs)
        if not stream and len(attempts) == 1:
            return await initial_text(**kwargs)
        assert invalid not in kwargs["prompt"]
        return LlmResult({}, MODEL_ANSWER, llm.metadata)

    llm.text = repair
    response = client.post("/api/ask", json={
        "query": "我想知道台積電的相關資訊，以及一個月內股價可能會上漲還是?", "stream": stream,
    })
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"].startswith(MODEL_ANSWER)
    assert "S99" not in response.text and "一定上漲" not in response.text
    assert data["tokens"]["input"] == 200 and data["tokens"]["output"] == 60
    assert len(attempts) == (1 if stream else 2)


@pytest.mark.parametrize("stream", [False, True])
def test_failed_repair_does_not_loop_or_publish_unsupported_claims(chat, stream):
    client, _, llm, _ = chat
    llm.answer = "無來源的保證上漲。[S99]"
    response = client.post("/api/ask", json={"query": "台積電明天會漲嗎", "stream": stream})
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 2
    data = events(response)[-1] if stream else response.json()
    assert response.status_code == 200
    assert data["answer"].startswith("目前提供的資料不足以回答此問題。")
    assert "保證上漲" not in response.text


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("completion", [
    {"finish_reason": "length"}, {"finish_reason": "stop", "truncated": True},
])
def test_truncated_answer_is_regenerated_from_same_evidence_before_publication(chat, stream, completion):
    client, _, llm, retrieval = chat
    llm.answer = "This incomplete draft must never be published [S99]"
    llm.metadata.update(completion, thinking_tokens=7)
    initial_text = llm.text
    attempts = []

    async def repair(**kwargs):
        attempts.append(kwargs)
        if not stream and len(attempts) == 1:
            return await initial_text(**kwargs)
        return LlmResult({}, MODEL_ANSWER, {
            "finish_reason": "stop", "prompt_tokens": 80, "completion_tokens": 20, "thinking_tokens": 3,
        })

    llm.text = repair
    response = client.post("/api/ask", json={"query": "台積電最近營收", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"].startswith(MODEL_ANSWER)
    assert data["answer"].count("https://news.test/report") == 1
    assert data["tokens"] == {"input": 180, "output": 50, "thinking": 10}
    assert "incomplete draft" not in response.text and "S99" not in response.text
    assert len(attempts) == (1 if stream else 2)
    initial_call = next(kwargs for kind, kwargs in llm.calls if kind in {"text", "stream"})
    assert attempts[-1]["prompt"] == initial_call["prompt"]
    assert llm.answer not in attempts[-1]["prompt"]
    assert len(retrieval.calls) == 1
    if stream:
        result = events(response)
        assert result[-1]["type"] == "done" and llm.closed
        assert [event["content"] for event in result if event["type"] == "text"] == [data["answer"]]


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("first_truncated", [False, True])
def test_citation_and_truncation_failures_share_one_retry_budget(chat, stream, first_truncated):
    client, _, llm, _ = chat
    llm.answer = "Rejected draft [S99]"
    if first_truncated:
        llm.metadata["finish_reason"] = "length"
    initial_text = llm.text
    attempts = []

    async def repair(**kwargs):
        attempts.append(kwargs)
        if not stream and len(attempts) == 1:
            return await initial_text(**kwargs)
        return LlmResult({}, llm.answer, {"finish_reason": "stop" if first_truncated else "length"})

    llm.text = repair
    response = client.post("/api/ask", json={"query": "台積電最近營收", "stream": stream})
    assert len(attempts) == (1 if stream else 2)
    assert "Rejected draft" not in response.text
    withheld_answer(response, stream)


@pytest.mark.parametrize("claim", ["收盤價 999 元", "漲跌幅 +2.03%", "EPS 999 元", "2026-09-10 收盤價 100 元", "股票2317收盤價100元"])
def test_numeric_claims_use_cited_metric_date_symbol_and_sign(claim):
    source = SourceChunk(citation_id="S1", title="2330 observations", source="system_market",
                         source_name="Test", pub_time="2026-09-11", url="", stock_id="2330", score=1,
                         category="market_technical",
                         content='{"columns":["date","close","chg_pct"],"rows":[["2026-09-11",100,-2.03]]}')
    with pytest.raises(ServiceUnavailable):
        _checked_answer(claim + "。[S1]", {"finish_reason": "stop"}, [source])
    assert "收盤價 100" in _checked_answer("2026-09-11 收盤價 100 元、漲跌幅 -2.03%。[S1]",
                                          {"finish_reason": "stop"}, [source])


@pytest.mark.parametrize("news", ["接單成長", "工廠停工並取消財測"])
def test_failed_outlook_does_not_invent_direction_or_misattribute_prices(chat, news):
    client, service, llm, retrieval = chat
    retrieval.hits[0]["payload"]["page_content"] = news
    llm.intent = {"is_finance": True, "stocks": ["2330", "2317"], "data_needs": ["market", "news"]}
    service._market_sources = lambda *_: [SourceChunk(citation_id="", title="2317 price", source="system_market",
        source_name="Test", pub_time="2026-09-11", url="", stock_id="2317", score=1,
        category="market_technical", content='{"columns":["date","close"],"rows":[["2026-09-11",50]]}')]
    llm.answer = "保證上漲。[S99]"
    answer = client.post("/api/ask", json={"query": "台積電跟鴻海明天會漲嗎"}).json()["answer"]
    assert answer.startswith(VERIFIED_FALLBACK_NOTICE)
    assert "2330" in answer and "缺少" in answer
    assert "2026-09-11 股票 2317 收盤價 50 元。[S3]" in answer
    assert "2330 收盤價" not in answer
    assert not any(word in answer for word in ["偏多", "下週", "最新一日"])


def test_mixed_supported_stocks_disclose_partial_market_coverage(chat, monkeypatch):
    from app.features.chat import service as chat_module
    client, service, llm, _ = chat
    monkeypatch.setattr(chat_module, "load_catalog", lambda: {"2330": {"name": "台積電"}, "2603": {"name": "長榮"}})
    llm.intent = {"is_finance": True, "stocks": ["2330", "2603"], "data_needs": ["market", "news"]}
    service._market_sources = lambda *_: []
    answer = client.post("/api/ask", json={"query": "比較台積電與長榮"}).json()["answer"]
    assert "2603" in answer and "不支援行情" in answer
    assert "2330" in answer and "缺少指定區間" in answer
    assert "不能據此完成全體比較" in answer


@pytest.mark.parametrize("claim,supported", [
    ("外資買賣超100張", True), ("外資買賣超100000股", True),
    ("外資買賣超100000張", False), ("外資買賣超100股", False),
    ("外資買賣超100000", False), ("外資買賣超-100張", False),
])
def test_institutional_claims_convert_explicit_lots_to_stored_shares(claim, supported):
    from app.features.chat.claims import numeric_claims_supported
    source = SourceChunk(citation_id="S1", title="Institutional", source="system_market",
        source_name="Test", pub_time="2026-09-01", url="", stock_id="2330", score=1,
        category="institutional", content='{"columns":["date","foreign_net"],'
        '"rows":[["2026-09-01",100000]],"unit":"shares"}')
    assert numeric_claims_supported(claim, [source]) is supported


@pytest.mark.parametrize("claim,supported", [
    ("2026-09-01收盤價100元，2026-09-02收盤價200元", True),
    ("2026-09-01收盤價200元，2026-09-02收盤價100元", False),
    ("股票2330收盤價100元，股票2317收盤價300元", True),
    ("股票2330收盤價300元，股票2317收盤價100元", False),
    ("2026-09-01股票2330收盤價100元，股票2317收盤價300元", True),
])
def test_date_and_symbol_are_bound_to_each_claim_not_the_paragraph(claim, supported):
    from app.features.chat.claims import numeric_claims_supported
    sources = [SourceChunk(citation_id="S1", title="Price", source="system_market",
        source_name="Test", pub_time="2026-09-02", url="", stock_id=symbol, score=1,
        category="market_technical", content=content) for symbol, content in [
            ("2330", '{"columns":["date","close"],"rows":[["2026-09-01",100],["2026-09-02",200]]}'),
            ("2317", '{"columns":["date","close"],"rows":[["2026-09-01",300]]}'),
        ]]
    assert numeric_claims_supported(claim, sources) is supported
