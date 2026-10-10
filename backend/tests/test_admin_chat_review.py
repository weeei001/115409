from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy.exc import OperationalError

from app.db.models.admin import AdminAccount
from app.db.models.chat_audit import ChatValidationRun
from app.db.models.user import User
from app.features.admin import chat_review_repository
from app.features.auth.service import create_access_token


def credentials(db, settings, *, admin=False, active=True):
    user = User(email=f"{uuid4().hex}@example.com", is_active=active)
    db.add(user)
    db.flush()
    if admin:
        db.add(AdminAccount(user_id=user.id))
    db.commit()
    token, _ = create_access_token(user.id, settings)
    return user, {"Authorization": f"Bearer {token}"}


def retained_run(db, *, user=None, outcome="fallback", query="我的可用資金如何安排？", age_days=0,
                 reason="citations", reasons=None):
    reasons = reasons or ["numbers", "citations"]
    row = ChatValidationRun(
        id=str(uuid4()), created_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=age_days),
        user_id=user.id if user else None, outcome=outcome, query=query, reason=reason,
        data={"schema_version": 1, "model": "test-model", "duration_ms": 1200,
              "attempt_count": 2, "source_count": 1, "publication_completed": True,
              "reasons": reasons, "final_answer": "本次分析未完成核對。", "private_debug": "PRIVATE_METADATA",
              "attempts": [{"number": i + 1, "stage": "initial" if i == 0 else "repair",
                            "text": f"REJECTED_DRAFT_{i}", "validation": "rejected", "reason": code,
                            "detail": "檢核失敗", "finish_reason": "stop", "private_debug": "PRIVATE_METADATA"}
                           for i, code in enumerate(reasons[:2])],
              "sources": [{"citation_id": "S1", "title": "帳戶快照", "source": "portfolio",
                           "source_name": "模擬投資", "pub_time": "2026-10-09", "url": "", "stock_id": "",
                           "content": "PRIVATE_ACCOUNT_EVIDENCE 可用資金50000元", "score": 1,
                           "category": "portfolio", "private_debug": "PRIVATE_METADATA"}]})
    db.add(row)
    db.commit()
    return row


def test_private_diagnostics_require_current_administrator_membership(client, db_session, settings):
    admin, headers = credentials(db_session, settings, admin=True)
    _, member_headers = credentials(db_session, settings)
    _, inactive_headers = credentials(db_session, settings, admin=True, active=False)
    row = retained_run(db_session)
    paths = ("/admin/ai-conversations", f"/admin/ai-conversations/{row.id}")
    for path in paths:
        for rejected in ({}, member_headers, inactive_headers):
            response = client.get(path, headers=rejected)
            assert response.status_code in {401, 403}
            assert "REJECTED_DRAFT" not in response.text and "PRIVATE_ACCOUNT_EVIDENCE" not in response.text
        assert client.get(path, headers=headers).status_code == 200
    db_session.delete(db_session.get(AdminAccount, admin.id))
    db_session.commit()
    for path in paths:
        assert client.get(path, headers=headers).status_code == 403, "Revocation must affect existing tokens."


def test_list_is_small_and_detail_preserves_evidence_without_unlisted_metadata(client, db_session, settings):
    owner, headers = credentials(db_session, settings, admin=True)
    row = retained_run(db_session, user=owner)
    response = client.get("/admin/ai-conversations", headers=headers)
    assert response.headers["cache-control"] == "no-store"
    listing = response.json()
    assert listing["total"] == 1 and listing["retention_days"] == 14
    item = listing["items"][0]
    assert item["id"] == row.id and item["user_email"] == owner.email
    assert item["reasons"] == ["numbers", "citations"]
    assert item["attempt_count"] == 2 and item["publication_completed"] is True
    assert datetime.fromisoformat(item["created_at"]).utcoffset() == timedelta(0)
    assert "REJECTED_DRAFT" not in response.text and "PRIVATE_ACCOUNT_EVIDENCE" not in response.text
    detail = client.get(f"/admin/ai-conversations/{row.id}", headers=headers)
    assert detail.headers["cache-control"] == "no-store"
    data = detail.json()
    assert [a["text"] for a in data["attempts"]] == ["REJECTED_DRAFT_0", "REJECTED_DRAFT_1"]
    assert data["sources"][0]["content"] == row.data["sources"][0]["content"]
    assert data["final_answer"] == "本次分析未完成核對。"
    assert data["tokens"] == {"input": None, "output": None, "thinking": None}
    assert "PRIVATE_METADATA" not in detail.text


def test_filters_match_both_attempts_and_literal_queries_with_server_pagination(client, db_session, settings):
    user, headers = credentials(db_session, settings, admin=True)
    old = retained_run(db_session, user=user, age_days=5, query="資金50%保留_現金")
    retained_run(db_session, outcome="passed", reason=None, reasons=["grounding"], query="一般概念")
    newer = retained_run(db_session, outcome="error", reason="timeout", reasons=["timeout"], query="資料取得失敗")
    base = "/admin/ai-conversations"
    listing = client.get(base, params={"outcome": "attention", "limit": 1}, headers=headers).json()
    assert listing["total"] == 2 and listing["items"][0]["id"] == newer.id
    second = client.get(base, params={"outcome": "attention", "limit": 1, "offset": 1}, headers=headers).json()
    assert second["total"] == 2 and second["items"][0]["id"] == old.id
    for query in ("50%", "_現金", user.email, old.id):
        result = client.get(base, params={"q": query}, headers=headers).json()
        assert result["total"] == 1 and result["items"][0]["id"] == old.id
    result = client.get(base, params={"reason": "numbers"}, headers=headers).json()
    assert result["total"] == 1 and result["items"][0]["id"] == old.id
    assert client.get(base, params={"reason": "truncated"}, headers=headers).json()["total"] == 0
    assert client.get(base, params={"days": 1}, headers=headers).json()["total"] == 2


def test_current_generation_record_remains_readable_without_legacy_repair_fields(client, db_session, settings):
    _, headers = credentials(db_session, settings, admin=True)
    row = retained_run(db_session, outcome="direct", reason=None)
    row.data = {"schema_version": 2, "attempt_count": 1, "reasons": [],
                "final_answer": "Current answer", "publication_completed": True,
                "attempts": [{"number": 1, "stage": "initial", "text": "Current answer",
                              "validation": "not_checked", "tokens": {"output": 12}}]}
    db_session.commit()

    response = client.get(f"/admin/ai-conversations/{row.id}", headers=headers)
    assert response.status_code == 200
    detail = response.json()
    assert detail["schema_version"] == 2 and detail["final_answer"] == "Current answer"
    assert detail["repair_max_tokens"] is None and detail["recovery"] is None
    attempt = detail["attempts"][0]
    assert attempt["validation"] == "not_checked" and attempt["tokens"]["output"] == 12
    assert attempt["hint"] is None and attempt["diagnostics_truncated"] is False


def test_retention_is_enforced_on_reads_even_before_opportunistic_cleanup(client, db_session, settings):
    _, headers = credentials(db_session, settings, admin=True)
    old = retained_run(db_session, age_days=15)
    assert client.get("/admin/ai-conversations", headers=headers).json()["total"] == 0
    assert client.get(f"/admin/ai-conversations/{old.id}", headers=headers).status_code == 404
    assert client.get(f"/admin/ai-conversations/{uuid4()}", headers=headers).status_code == 404


def test_planning_and_coverage_are_admin_only_typed_diagnostics(client, db_session, settings):
    _, headers = credentials(db_session, settings, admin=True)
    _, member_headers = credentials(db_session, settings)
    row = retained_run(db_session, outcome="direct")
    row.data = {**row.data, "planning": [
        {"stage": "plan", "status": "accepted", "result": {
            "tasks": ["portfolio_review"], "portfolio_access": "requested",
            "favorites_access": "not_needed", "private_debug": "PRIVATE_METADATA"}},
        {"stage": "plan", "status": "accepted", "result": {"tasks": ["portfolio_review"]},
         "effective_needs": ["portfolio"], "tokens": {"prompt_tokens": 42}, "private_debug": "PRIVATE_METADATA"}],
        "evidence": {"requested": ["portfolio"], "available": [], "missing": ["portfolio"],
                     "blocked": True, "status": "blocked", "private_debug": "PRIVATE_METADATA"}}
    db_session.commit()
    path = f"/admin/ai-conversations/{row.id}"
    assert client.get(path, headers=member_headers).status_code == 403
    response = client.get(path, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["planning"][0]["result"]["tasks"] == ["portfolio_review"]
    assert data["planning"][1]["result"]["tasks"] == ["portfolio_review"]
    assert data["planning"][1]["tokens"]["prompt_tokens"] == 42
    assert data["evidence"]["blocked"] is True
    assert data["evidence"]["missing"] == ["portfolio"]
    assert "PRIVATE_METADATA" not in response.text


def test_clipped_provenance_remains_readable_without_inventing_missing_values(client, db_session, settings):
    _, headers = credentials(db_session, settings, admin=True)
    row = retained_run(db_session)
    data = dict(row.data)
    source = dict(data["sources"][0])
    source.update(score=None, stock_ids=["2330", None], impact_context=[None], snapshot_truncated=True,
                  content_truncated=True, original_chars=99999)
    data["sources"] = [source]
    data["sources_truncated"] = True
    row.data = data
    db_session.commit()
    response = client.get(f"/admin/ai-conversations/{row.id}", headers=headers)
    assert response.status_code == 200
    item = response.json()["sources"][0]
    assert item["snapshot_truncated"] is True and item["content_truncated"] is True
    assert item["metadata"]["score"] is None and item["metadata"]["impact_context"] == [None]
    assert item["stock_ids"] == ["2330"]
    assert "PRIVATE_METADATA" not in response.text


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}, {"offset": 100001},
                                    {"days": 0}, {"days": 15}, {"outcome": "invented"},
                                    {"q": "x" * 121}, {"reason": "x" * 65}])
def test_invalid_filters_are_rejected(client, db_session, settings, params):
    _, headers = credentials(db_session, settings, admin=True)
    assert client.get("/admin/ai-conversations", headers=headers, params=params).status_code == 422


def test_missing_table_is_distinct_from_empty_history_and_technical_errors_are_sanitized(
        client, db_session, settings, monkeypatch):
    _, headers = credentials(db_session, settings, admin=True)
    ChatValidationRun.__table__.drop(db_session.get_bind())
    for path in ("/admin/ai-conversations", f"/admin/ai-conversations/{uuid4()}"):
        response = client.get(path, headers=headers)
        assert response.status_code == 503
        assert "尚未初始化" in response.json()["detail"]
        assert "SELECT" not in response.text and "chat_validation_runs" not in response.text

    def fail(**_kwargs):
        raise OperationalError("PRIVATE SQL", {"password": "PRIVATE_PASSWORD"}, RuntimeError("PRIVATE_SERVER"))

    monkeypatch.setattr(chat_review_repository, "review_list", lambda *args, **kwargs: fail(**kwargs))
    response = client.get("/admin/ai-conversations", headers=headers)
    assert response.status_code == 503 and "目前無法讀取" in response.json()["detail"]
    assert "PRIVATE" not in response.text


def test_invalid_id_is_rejected_and_routes_do_not_offer_replay_or_mutation(client, db_session, settings):
    _, headers = credentials(db_session, settings, admin=True)
    assert client.get("/admin/ai-conversations/not-an-id", headers=headers).status_code == 422
    for method in (client.post, client.delete):
        assert method("/admin/ai-conversations", headers=headers).status_code == 405
