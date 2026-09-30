"""Explicit source-version migration and reviewed source selection. Dry-run is the default."""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json

from sqlalchemy import inspect, select, insert
from sqlalchemy.orm import Session

from app.db.models.news_article import NewsArticle
from app.db.models.news_version import NewsArticleVersion, NewsSourceSelection, NewsSourceDecision
from app.db.models.news_chunk import news_chunks
from app.db.models.news_impact import NewsEventAnalysis
from app.db.models.llm_response import LlmResponse
from app.features.news.versions import (source_identity, snapshot, content_digest, record_version,
                                        set_selection, utc_now)


def inventory(db):
    groups = defaultdict(list)
    for article in db.scalars(select(NewsArticle).order_by(NewsArticle.article_id)):
        groups[source_identity(article)[0]].append(article)
    return groups


def revision_plan(db, groups=None):
    """Describe affected IDs without changing schema/data or exposing article bodies."""
    tables = set(inspect(db.connection()).get_table_names())
    groups = inventory(db) if groups is None else groups
    selected = {row.source_key: row for row in db.scalars(select(NewsSourceSelection))} if "news_source_selections" in tables else {}
    observed = {(row.article_id, row.content_hash): row.observed_at for row in db.execute(
        select(NewsArticleVersion.article_id, NewsArticleVersion.content_hash, NewsArticleVersion.observed_at))} if "news_article_versions" in tables else {}
    snapshots = defaultdict(set)
    chunks = defaultdict(list)
    if "news_chunks" in tables:
        for row in db.execute(select(news_chunks.c.article_id, news_chunks.c.chunk_id)):
            chunks[row.article_id].append(row.chunk_id)
    analyses = set(db.scalars(select(NewsEventAnalysis.article_id))) if "news_event_analyses" in tables else set()
    if "llm_responses" in tables:
        for row in db.execute(select(LlmResponse.id, LlmResponse.response_json)):
            try:
                payload = json.loads(row.response_json or "{}")
                for item in payload.get("evidence_catalog", []):
                    if isinstance(item, dict) and item.get("article_id"):
                        snapshots[item["article_id"]].add(row.id)
            except (ValueError, TypeError, AttributeError):
                continue
    report = []
    for key, articles in groups.items():
        ids = [article.article_id for article in articles]
        digests = {article.article_id: content_digest(snapshot(article)) for article in articles}
        hashes = set(digests.values())
        previous = selected.get(key)
        chosen = previous.selected_article_id if previous else (ids[0] if len(hashes) == 1 else None)
        status = previous.status if previous else ("active" if chosen else "conflict")
        report.append({"source_key": key, "canonical_url": source_identity(articles[0])[1],
            "article_ids": ids, "proposed_selected_article_id": chosen, "status": status,
            "reason": ("Preserve explicit existing selection" if previous else
                       "Single source" if len(ids) == 1 else
                       "Identical content; stable ID tie-break, not publication truth" if len(hashes) == 1 else
                       "Conflicting legacy versions; source review required, created_at is not authority"),
            "versions": [{"article_id": article.article_id, "content_hash": digests[article.article_id],
                          "content_length": len(article.content or ""), "publication_time": article.pub_time,
                          "observation_time": (observed[(article.article_id, digests[article.article_id])].isoformat() + "Z"
                              if observed.get((article.article_id, digests[article.article_id])) else None)} for article in articles],
            "chunk_ids": [chunk for article_id in ids for chunk in chunks[article_id]],
            "analysis_article_ids": [article_id for article_id in ids if article_id in analyses],
            "snapshot_ids": sorted(set().union(*(snapshots[id_] for id_ in ids))),
            "historical_limitation": "Legacy first observation/revision times unknown; not verified point-in-time evidence."})
    return report


def migrate(engine):
    # This explicit offline command is the only schema owner; API startup never calls it.
    for model in (NewsArticleVersion, NewsSourceSelection, NewsSourceDecision):
        model.__table__.create(engine, checkfirst=True)
    with Session(engine) as db, db.begin():
        groups = inventory(db)
        plan = revision_plan(db, groups)
        existing_versions = set(db.scalars(select(NewsArticleVersion.revision_id)))
        existing_selections = set(db.scalars(select(NewsSourceSelection.source_key)))
        version_rows, selection_rows, decision_rows = [], [], []
        now = utc_now()
        for group in plan:
            for article in groups[group["source_key"]]:
                values = snapshot(article)
                digest = content_digest(values)
                revision = hashlib.sha256(f"{article.article_id}:{digest}".encode()).hexdigest()
                if revision not in existing_versions:
                    version_rows.append(dict(revision_id=revision, article_id=article.article_id,
                        source_key=group["source_key"], content_hash=digest,
                        snapshot_json=json.dumps(values, ensure_ascii=False), observed_at=None, recorded_at=now))
            if group["source_key"] not in existing_selections:
                after = dict(selected_article_id=group["proposed_selected_article_id"], status=group["status"], reason=group["reason"])
                selection_rows.append(dict(source_key=group["source_key"], canonical_url=group["canonical_url"], observed_at=now, **after))
                decision_rows.append(dict(source_key=group["source_key"], before_json="null", after_json=json.dumps(after),
                                          observed_at=now, reason=group["reason"]))
        for model, rows in ((NewsArticleVersion, version_rows), (NewsSourceSelection, selection_rows), (NewsSourceDecision, decision_rows)):
            for offset in range(0, len(rows), 500):
                db.execute(insert(model), rows[offset:offset + 500])
        return {"groups": len(plan), "conflicts": sum(item["status"] == "conflict" for item in plan)}


def choose(db, source_key, article_id, reason):
    if db.get(NewsSourceSelection, source_key) is None:
        raise ValueError("Migrate and review the source group before choosing a version")
    article = db.get(NewsArticle, article_id)
    if article is None or source_identity(article)[0] != source_key:
        raise ValueError("Chosen article must belong to the requested source group")
    if not reason.strip():
        raise ValueError("A documented source verification reason is required")
    record_version(db, article, observed_at=None)
    return set_selection(db, source_key, source_identity(article)[1], article_id, "active", reason)


def rollback_decision(db, decision_id, reason):
    decision = db.get(NewsSourceDecision, decision_id)
    if decision is None or not reason.strip():
        raise ValueError("A valid decision and rollback reason are required")
    latest_id = db.scalar(select(NewsSourceDecision.id).where(NewsSourceDecision.source_key == decision.source_key)
                         .order_by(NewsSourceDecision.id.desc()).limit(1))
    if latest_id != decision_id:
        raise ValueError("Only the latest source decision can be rolled back")
    current = db.get(NewsSourceSelection, decision.source_key)
    current_state = ({"selected_article_id": current.selected_article_id, "status": current.status, "reason": current.reason}
                     if current else None)
    if current_state != json.loads(decision.after_json):
        raise ValueError("Selection changed after this decision; refuse stale rollback")
    before = json.loads(decision.before_json)
    db.add(NewsSourceDecision(source_key=decision.source_key, before_json=json.dumps(current_state),
        after_json=json.dumps(before), reason=reason, observed_at=utc_now()))
    if before is None:
        db.delete(current)
    else:
        for key, value in before.items():
            setattr(current, key, value)
        current.observed_at = utc_now()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create/backfill source-version tables")
    parser.add_argument("--choose", nargs=2, metavar=("SOURCE_KEY", "ARTICLE_ID"))
    parser.add_argument("--rollback", type=int, metavar="DECISION_ID")
    parser.add_argument("--reason", default="")
    args = parser.parse_args(argv)
    if sum((bool(args.apply), bool(args.choose), args.rollback is not None)) > 1:
        parser.error("Use only one mutation operation")
    from app.core.config import get_settings
    from app.db.engine import make_engine
    engine = make_engine(get_settings())
    try:
        if args.apply:
            result = migrate(engine)
        else:
            with Session(engine) as db:
                if args.choose:
                    choose(db, *args.choose, args.reason)
                    db.commit()
                elif args.rollback is not None:
                    rollback_decision(db, args.rollback, args.reason)
                    db.commit()
                result = revision_plan(db)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
