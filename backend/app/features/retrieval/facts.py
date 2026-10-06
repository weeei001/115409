"""Group explicit shared facts within returned sources; retain all original passages."""
from collections import defaultdict
from decimal import Decimal
import hashlib
import json
import re

from app.features.news.sentiment import extract_candidate_stocks, source_quote_span


_MONTHLY_REVENUE = re.compile(
    r"(?P<year>20\d{2})\s*+(?:年|[-/])\s*+(?P<month>1[0-2]|0?[1-9])\s*+月?"
    r"(?:份)?\s*+(?:合併)?營收(?:為約|達到|為|達|約|來到|金額|新台幣|新臺幣|台幣|[\s：:])*+"
    r"(?P<amount>(?:\d{1,3}(?:,\d{3})++|\d++)(?:\.\d++)?)\s*+(?P<unit>億|萬|千)?元")
_EXPLICIT_DAY = re.compile(r"20\d{2}\s*(?:年|[-/])\s*\d{1,2}\s*(?:月|[-/])\s*\d{1,2}(?:日)?")


def _id(key: tuple) -> str:
    return hashlib.sha256(json.dumps(key, ensure_ascii=False).encode()).hexdigest()[:20]


def group_shared_facts(sources: list[dict], catalog: dict) -> list[dict]:
    """Only explicit monthly revenue or dated, attributed identical statements qualify.

    This does not merge arbitrary events or remove passages with additional information.
    """
    output = [{**source, "shared_fact_ids": [], "shared_facts": []} for source in sources]
    groups = defaultdict(list)
    for index, source in enumerate(output):
        if source.get("analysis_status") != "success":
            continue
        for context in source.get("impact_context") or []:
            if context.get("target_type") != "company" or not context.get("target_id"):
                continue
            for quote in context.get("quotes") or []:
                if not isinstance(quote, str):
                    continue
                if source_quote_span(source.get("summary"), quote) is None:
                    continue
                normalized = re.sub(r"\s+", " ", quote).strip()
                revenue = _MONTHLY_REVENUE.search(normalized) if context.get("statement_type") == "fact" else None
                if revenue:
                    mentioned = set(extract_candidate_stocks(None, None, None, quote, catalog))
                    if mentioned != {context["target_id"]} or re.search(r"人民幣|港幣|美元|日圓|歐元|USD|RMB|CNY", quote, re.IGNORECASE):
                        continue
                    value = Decimal(revenue["amount"].replace(",", "")) * {
                        None: 1, "千": 1000, "萬": 10000, "億": 100000000}[revenue["unit"]]
                    period = f'{revenue["year"]}-{int(revenue["month"]):02}'
                    key = (context["target_id"], "monthly_revenue", period, "元")
                    detail = {"metric": "monthly_revenue", "period": period, "value": str(value.normalize()), "unit": "元"}
                elif (context.get("statement_type") in {"fact", "plan", "forecast", "opinion"}
                        and context.get("speaker") and _EXPLICIT_DAY.search(normalized)):
                    key = (context["target_id"], "attributed_statement", context["statement_type"], context["speaker"], normalized)
                    detail = {"statement_type": context["statement_type"], "speaker": context["speaker"], "quote": quote}
                else:
                    continue
                groups[key].append((index, detail, quote))
    for key, members in groups.items():
        if len({output[index].get("article_id") or output[index].get("url") or output[index].get("id")
                for index, _, _ in members}) < 2:
            continue
        fact_id = _id(key)
        refs = []
        for index, detail, quote in members:
            source = output[index]
            if fact_id not in source["shared_fact_ids"]:
                source["shared_fact_ids"].append(fact_id)
            reference = {field: source.get(field) for field in
                ("id", "article_id", "chunk_id", "revision", "content_hash", "char_start", "char_end",
                 "timestamp", "url", "source_state")}
            reference.update({"quote": quote, **detail})
            if reference not in refs:
                refs.append(reference)
        values = {detail.get("value") for _, detail, _ in members}
        shared = {"fact_id": fact_id, "target_id": key[0], "kind": key[1],
                  "status": "conflict" if len(values) > 1 else "shared", "source_refs": refs,
                  "distinct_fact_count": 0 if len(values) > 1 else 1,
                  "independent_corroboration": "not_established"}
        if key[1] == "monthly_revenue":
            shared.update(period=key[2], unit=key[3])
        output[members[0][0]]["shared_facts"].append(shared)
    return output
