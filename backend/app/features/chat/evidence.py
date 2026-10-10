"""生成回答前，核對已取得的來源是否涵蓋後端編譯的資料需求。"""
import json


# 僅採計行情收集器產生的資料類別；資料缺漏說明不是行情證據。
MARKET_EVIDENCE_CATEGORIES = frozenset({"market_technical", "institutional", "fundamental", "comparison"})


def assess_evidence(required, sources):
    available = set()
    for source in sources:
        if source.category == "personal":
            try:
                payload = json.loads(source.content)
            except (TypeError, ValueError):
                continue
            if not isinstance(payload, dict):
                continue
            if isinstance(payload.get("portfolio"), dict):
                available.add("portfolio")
            if isinstance(payload.get("favorites"), list):
                available.add("favorites")
        elif source.category in MARKET_EVIDENCE_CATEGORIES:
            available.add("market")
        elif source.category in {"news", "knowledge", "help"}:
            available.add(source.category)
    missing = required - available
    blocked = bool(missing & {"portfolio", "favorites"})
    return {"requested": sorted(required), "available": sorted(available),
            "missing": sorted(missing), "blocked": blocked,
            "status": "blocked" if blocked else "partial" if missing else "ready"}
