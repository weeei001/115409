"""A failed analysis can return dated structured facts without its failed dependencies."""
import json

import pytest

from app.features.chat.schemas import SourceChunk
from app.features.chat.verified_fallback import VERIFIED_FALLBACK_NOTICE, verified_facts_fallback
from test_chat import chat, events
from test_chat_personal_validation import CATALOG, personal_source


def price_source(rows=None):
    return SourceChunk(citation_id="S2", title="2330 daily observations", source="system_market",
                       source_name="Test", pub_time="2026-10-06", url="", stock_id="2330", score=1,
                       category="market_technical", content=json.dumps({
                           "columns": ["date", "close"],
                           "rows": rows if rows is not None else [["2026-10-02", 100], ["2026-10-01", 90]],
                       }))


def test_fallback_uses_dated_original_values_and_server_sources_only():
    account = personal_source(as_of="2026-10-05T18:00:00+00:00")
    payload = json.loads(account.content)
    payload["portfolio"]["available_cash"] = 123456
    account.content = json.dumps(payload)
    answer = verified_facts_fallback([account, price_source()], "部分公司缺少行情。", company_catalog=CATALOG)
    assert answer.startswith(VERIFIED_FALLBACK_NOTICE)
    assert "2026-10-06 模擬帳戶：可用資金 123456 元。[S1]" in answer
    assert "2026-10-06 模擬帳戶：持股檔數 2 檔。[S1]" in answer
    assert "2026-10-02 股票 2330 收盤價 100 元。[S2]" in answer
    assert "收盤價 90" not in answer
    assert "部分公司缺少行情。" in answer
    assert "【引用來源】" in answer


@pytest.mark.parametrize("rows", [
    [["2026-10-02", float("nan")]], [["2026-10-02", float("inf")]],
    [["2026-10-02", True]], [["2026-10-02", -1]], [["2026-10-02", None]],
    [["2026-99-99", 100]], [["20261002", 100]], [["2026-10-02"]],
    [["2026-10-02", 100], ["2026-10-02", 999]],
])
def test_malformed_or_conflicting_structured_prices_are_not_safe_facts(rows):
    assert verified_facts_fallback([price_source(rows)]) is None


def test_bad_source_does_not_remove_independent_valid_source():
    answer = verified_facts_fallback([price_source([["bad-date", 100]]), personal_source()], company_catalog=CATALOG)
    assert answer and "可用資金 20000 元" in answer
    assert "收盤價" not in answer and "[S2]" not in answer


def test_cross_source_conflicts_are_removed_before_applying_display_limit():
    sources = [price_source()]
    for index, symbol in enumerate(["2317", "2454", "1101", "1303"], 3):
        source = price_source()
        source.citation_id = f"S{index}"
        source.stock_id = symbol
        sources.append(source)
    conflict = price_source([["2026-10-02", 999]])
    conflict.citation_id = "S7"
    sources.append(conflict)
    answer = verified_facts_fallback(sources, company_catalog=CATALOG)
    assert answer
    body = answer.split("【引用來源】")[0]
    assert "股票 2330" not in body and "999" not in body
    assert "股票 2317" in body and "股票 1303" in body


def test_only_conflicting_price_sources_produce_no_fallback():
    conflict = price_source([["2026-10-02", 999]])
    conflict.citation_id = "S3"
    assert verified_facts_fallback([price_source(), conflict]) is None


@pytest.mark.parametrize("category", ["news", "analysis", "knowledge", "help"])
def test_unstructured_or_model_derived_sources_are_not_relabelled_as_verified_facts(category):
    source = price_source()
    source.category = category
    source.impact_context = [{"claim": "因為取得大單，股價將上漲"}]
    assert verified_facts_fallback([source]) is None


def test_missing_positions_do_not_turn_into_zero_holdings():
    source = personal_source()
    payload = json.loads(source.content)
    del payload["portfolio"]["positions"]
    source.content = json.dumps(payload)
    answer = verified_facts_fallback([source])
    assert answer and "可用資金 20000 元" in answer
    assert "持股檔數" not in answer


def test_undated_or_uninitialized_account_does_not_present_zero_as_current_money():
    source = personal_source()
    for overrides in ({"as_of": None}, {"initialized": False, "available_cash": 0}):
        payload = json.loads(personal_source().content)
        payload["portfolio"].update(overrides)
        source.content = json.dumps(payload)
        assert verified_facts_fallback([source]) is None


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("finish", ["stop", "length"])
def test_two_failed_attempts_publish_only_new_source_summary_without_dependencies(chat, stream, finish):
    client, service, llm, _ = chat
    llm.intent = {"is_finance": True, "stocks": ["2330"], "data_needs": ["market"]}
    service._market_sources = lambda *_: [price_source([["2026-09-11", 100]])]
    llm.answer = "台積電收盤價999元。[S1]\n\n因此建議全部投入。[S1]"
    llm.metadata["finish_reason"] = finish
    response = client.post("/api/ask", json={"query": "台積電股價", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"].startswith(VERIFIED_FALLBACK_NOTICE)
    assert "2026-09-11 股票 2330 收盤價 100 元。[S1]" in data["answer"]
    assert "999" not in data["answer"] and "全部投入" not in data["answer"]
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 2
    assert data["sources"] and data["dashboard"]
    if stream:
        result = events(response)
        assert [item["content"] for item in result if item["type"] == "text"] == [data["answer"]]
        assert result[-1]["type"] == "done"


def test_unsupported_cause_uses_grounding_recovery_then_source_facts(chat):
    client, service, llm, _ = chat
    llm.intent = {"is_finance": True, "stocks": ["2330"], "data_needs": ["market"]}
    market = price_source([["2026-09-11", 100]])
    market.content = json.dumps({"columns": ["date", "close", "chg_pct"], "rows": [["2026-09-11", 100, 2]]})
    service._market_sources = lambda *_: [market]
    llm.answer = "因公司取得大單，2330上漲2%。[S1]"
    data = client.post("/api/ask", json={"query": "台積電為什麼上漲"}).json()
    assert data["answer"].startswith(VERIFIED_FALLBACK_NOTICE)
    assert "大單" not in data["answer"] and "收盤價 100 元" in data["answer"]
    assert "漲跌原因沒有可核對的原文支持" in llm.calls[-1][1]["system_prompt"]
