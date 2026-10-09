"""確認模型回答不經內容檢核，也不會觸發重新生成。"""
import pytest

from app.features.chat import answer_validation, partial_recovery, verified_fallback
from test_chat import chat, events


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("answer,metadata", [
    ("沒有引用的回答。", {"finish_reason": "stop"}),
    ("股價999元，這是沒有來源的數字。[S99]", {"finish_reason": "stop"}),
    ("假設投入999999999元，保證獲利。", {"finish_reason": "stop"}),
    ("因為未經證實的事件，所以更穩健。", {"finish_reason": "stop"}),
    ("未完成的回答", {"finish_reason": "length", "truncated": True}),
    ("", {"finish_reason": "stop"}),
    ("  原始格式 <b>文字</b> https://example.test [S999]\n", {"finish_reason": "stop"}),
])
def test_all_answer_gates_are_disconnected(chat, monkeypatch, stream, answer, metadata):
    client, _, llm, _ = chat

    def forbidden(*args, **kwargs):
        raise AssertionError("Answer validation and recovery must not run")

    monkeypatch.setattr(answer_validation, "_checked_answer", forbidden)
    monkeypatch.setattr(partial_recovery, "recover_partial_answer", forbidden)
    monkeypatch.setattr(verified_fallback, "verified_facts_fallback", forbidden)
    llm.answer = answer
    llm.metadata.update(metadata)
    response = client.post("/api/ask", json={"query": "台積電最近新聞", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"] == answer
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1
    assert data["sources"] and data["dashboard"]
    if stream:
        received = events(response)
        assert received[-1]["type"] == "done"
        assert [event["content"] for event in received if event["type"] == "text"] == [answer]
        assert not any("核對" in event.get("content", "") for event in received if event["type"] == "status")
