"""確認模型回答不經內容檢核，也不會觸發重新生成。"""
import pytest

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
def test_answers_are_published_unchanged(chat, stream, answer, metadata):
    client, _, llm, _ = chat
    llm.answer = answer
    llm.metadata.update(metadata)
    response = client.post("/api/ask", json={"query": "台積電最近新聞", "stream": stream})
    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == answer
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1
    assert data["sources"] and data["dashboard"]
