import pytest

from app.core.errors import ServiceUnavailable
from app.features.chat.schemas import SourceChunk
from app.features.chat.answer_validation import _checked_answer
from test_chat import MODEL_ANSWER, chat, events


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
@pytest.mark.parametrize("answer", [
    "?????[S99]\n\n???????",
    "?????????[S99]",
    "??????S1?",
])
def test_citations_are_published_unchanged_without_repair(chat, stream, answer):
    client, _, llm, retrieval = chat
    llm.answer = answer
    response = client.post("/api/ask", json={"query": "????????", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"] == answer
    assert data["tokens"] == {"input": 100, "output": 30, "thinking": None}
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1
    assert len(retrieval.calls) == 1
    assert data["sources"][0]["url"] == "https://news.test/report"
    assert "https://news.test/report" not in data["answer"]
    if stream:
        result = events(response)
        assert result[-1]["type"] == "done" and llm.closed
        assert "".join(event["content"] for event in result if event["type"] == "text") == answer


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("completion", [
    {"finish_reason": "length"}, {"finish_reason": "stop", "truncated": True},
])
@pytest.mark.parametrize("citation", ["S1", "S99"])
def test_truncation_and_citation_metadata_do_not_gate_or_retry_output(chat, stream, completion, citation):
    client, _, llm, retrieval = chat
    llm.answer = f"Incomplete fixture draft [{citation}]"
    llm.metadata.update(completion, thinking_tokens=7)
    response = client.post("/api/ask", json={"query": "???????", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"] == llm.answer
    assert data["tokens"] == {"input": 100, "output": 30, "thinking": 7}
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1
    assert len(retrieval.calls) == 1
    if stream:
        result = events(response)
        assert result[-1]["type"] == "done" and llm.closed
        assert [event["content"] for event in result if event["type"] == "text"] == [llm.answer]


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
@pytest.mark.parametrize("stream", [False, True])
def test_outlook_is_not_replaced_by_verified_fallback(chat, news, stream):
    client, service, llm, retrieval = chat
    retrieval.hits[0]["payload"]["page_content"] = news
    llm.intent = {"is_finance": True, "stocks": ["2330", "2317"], "data_needs": ["market", "news"]}
    service._market_sources = lambda *_: [SourceChunk(citation_id="", title="2317 price", source="system_market",
        source_name="Test", pub_time="2026-09-11", url="", stock_id="2317", score=1,
        category="market_technical", content='{"columns":["date","close"],"rows":[["2026-09-11",50]]}')]
    llm.answer = "保證上漲。[S99]"
    response = client.post("/api/ask", json={"query": "???????????", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"] == llm.answer
    assert any(source["stock_id"] == "2317" for source in data["sources"])
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1



@pytest.mark.parametrize("stream", [False, True])
def test_partial_market_coverage_does_not_append_to_model_answer(chat, monkeypatch, stream):
    from app.features.chat import service as chat_module
    client, service, llm, _ = chat
    monkeypatch.setattr(chat_module, "load_catalog", lambda: {"2330": {"name": "台積電"}, "2603": {"name": "長榮"}})
    llm.intent = {"is_finance": True, "stocks": ["2330", "2603"], "data_needs": ["market", "news"]}
    service._market_sources = lambda *_: []
    response = client.post("/api/ask", json={"query": "????????", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"] == MODEL_ANSWER
    assert data["detected_stocks"] == ["2330", "2603"]
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1
    assert data["sources"]



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
