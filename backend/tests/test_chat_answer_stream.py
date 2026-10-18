import json
from contextlib import contextmanager

from app.core.errors import ServiceUnavailable
from app.features.chat.router import get_guest_quota
from test_chat import chat  # noqa: F401  (fixture)

SSE = {"Accept": "text/event-stream"}


def events(response):
    return [json.loads(line[len("data: "):]) for line in response.text.split("\n\n") if line.startswith("data: ")]


def test_sse_streams_answer_text_then_the_same_result_as_json(chat):
    client, _, llm, _ = chat
    streamed = client.post("/api/ask", headers=SSE, json={"query": "台積電最近新聞"})
    assert streamed.status_code == 200
    assert streamed.headers["content-type"].startswith("text/event-stream")
    received = events(streamed)
    deltas = [event["text"] for event in received if event["type"] == "delta"]
    assert len(deltas) >= 2 and "".join(deltas) == llm.answer
    done = received[-1]
    assert done["type"] == "done" and done["response"]["answer"] == llm.answer
    assert [kind for kind, _ in llm.calls if kind in {"text", "stream"}] == ["stream"]

    plain = client.post("/api/ask", json={"query": "台積電最近新聞", "stream": True})
    assert plain.headers["content-type"].startswith("application/json")
    assert plain.json()["answer"] == done["response"]["answer"]
    assert plain.json()["sources"] == done["response"]["sources"]


def test_sse_failure_is_an_error_event_and_returns_the_question(chat):
    client, _, llm, _ = chat
    llm.error = ServiceUnavailable("模型服務暫時無法回應")
    released = []

    class RecordingQuota:
        @contextmanager
        def reserve(self):
            try:
                yield
            except Exception:
                released.append(True)
                raise

    client.app.dependency_overrides[get_guest_quota] = lambda: RecordingQuota()
    received = events(client.post("/api/ask", headers=SSE, json={"query": "台積電最近新聞"}))
    assert received[-1] == {"type": "error", "status": 503, "message": "模型服務暫時無法回應"}
    assert not any(event["type"] == "done" for event in received)
    assert released == [True]
