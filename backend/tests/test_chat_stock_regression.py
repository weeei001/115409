"""Regression for stock collection latency and compact numeric evidence."""
from datetime import timedelta

import pytest
from sqlalchemy.orm import sessionmaker

from app.db.models.daily_price import DailyPrice
from app.features.analysis import repository
from test_chat import NOW, chat


@pytest.mark.parametrize("stream", [False, True])
def test_hon_hai_compact_percent_answer_needs_no_fingerprint_or_model_retry(chat, db_session, monkeypatch, stream):
    client, service, llm, retrieval = chat
    db_session.add_all([
        DailyPrice(symbol="2317", date=NOW.date() - timedelta(days=1), close=101, volume_shares=30_000_000),
        DailyPrice(symbol="2317", date=NOW.date(), close=102, volume_shares=30_526_551),
    ])
    db_session.commit()
    service.session_factory = sessionmaker(bind=db_session.get_bind())
    llm.intent = {"stocks": ["2317"], "data_needs": ["market"]}
    llm.answer = "鴻海漲幅為 0.99%。[S1]"
    def no_archive_scan(*args, **kwargs):
        raise AssertionError("A live stock question must not scan archived analysis inputs")
    monkeypatch.setattr(repository, "input_fingerprint", no_archive_scan)

    result = client.post("/api/ask", json={"query": "鴻海的個股走勢如何？", "stream": stream})
    assert result.status_code == 200
    data = result.json()
    assert data["answer"].startswith(llm.answer)
    market = next(source for source in data["sources"] if source["category"] == "market_technical")
    assert "30526551,0.99" in market["content"]
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1
    assert not retrieval.calls
