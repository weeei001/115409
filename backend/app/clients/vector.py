"""Qdrant reads and shared embedding requests. Writes live in the worker adapter."""
from datetime import datetime, timezone, timedelta
import math
from urllib.parse import quote

import httpx

from app.core.errors import ServiceUnavailable, UpstreamTimeout


def _timestamp(value: datetime) -> float:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone(timedelta(hours=8)))
    return value.timestamp()


class VectorClient:
    def __init__(self, http: httpx.AsyncClient, settings):
        self.http, self.settings = http, settings
        self.base_url = (settings.QDRANT_URL or (
            f"http://{settings.QDRANT_HOST}:{settings.QDRANT_PORT}" if settings.QDRANT_HOST else "")).rstrip("/")
        self.embed_key = settings.EMBED_API_KEY

    def require_enabled(self):
        if not self.base_url or not self.settings.EMBED_API_URL or not self.settings.EMBED_MODEL or not self.embed_key:
            raise ServiceUnavailable({"code": "retrieval_unavailable", "message": "Retrieval service is not configured", "context": {}})

    async def _post(self, url, *, payload, headers, timeout, service):
        try:
            response = await self.http.post(url, json=payload, headers=headers, timeout=timeout)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("Expected an object")
            return data
        except httpx.TimeoutException as exc:
            raise UpstreamTimeout(f"{service} timed out") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ServiceUnavailable(f"{service} unavailable") from exc

    async def embed_query(self, text: str) -> list[float]:
        return (await self._embed([text], "query"))[0]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return await self._embed(texts, "passage") if texts else []

    async def _embed(self, texts: list[str], input_type: str) -> list[list[float]]:
        self.require_enabled()
        data = await self._post(self.settings.EMBED_API_URL, payload={
            "model": self.settings.EMBED_MODEL, "input": texts, "input_type": input_type,
            "encoding_format": "float", "truncate": self.settings.EMBED_TRUNCATE,
        }, headers={"Authorization": f"Bearer {self.embed_key}"},
            timeout=self.settings.EMBED_TIMEOUT_SECONDS, service="Embedding service")
        try:
            items = data["data"]
            if not isinstance(items, list) or len(items) != len(texts):
                raise ValueError("Invalid embedding count")
            ordered = {}
            dimension = None
            for item in items:
                index = item.get("index", 0 if len(texts) == 1 else None)
                if type(index) is not int or not 0 <= index < len(texts) or index in ordered:
                    raise ValueError("Invalid embedding index")
                values = item["embedding"]
                if not isinstance(values, list) or not values or any(
                    isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in values
                ):
                    raise ValueError("Invalid vector")
                dimension = dimension or len(values)
                if len(values) != dimension:
                    raise ValueError("Inconsistent embedding dimension")
                ordered[index] = [float(value) for value in values]
            return [ordered[index] for index in range(len(texts))]
        except (AttributeError, KeyError, IndexError, TypeError, ValueError, OverflowError) as exc:
            raise ServiceUnavailable("Invalid embedding response") from exc

    def _filter(self, symbols, start, end):
        conditions = []
        if self.settings.NEWS_INDEX_VERSION:
            conditions.extend([
                {"key": "index_version", "match": {"value": self.settings.NEWS_INDEX_VERSION}},
                {"key": "embedding_model", "match": {"value": self.settings.EMBED_MODEL}},
                {"key": "index_fingerprint", "match": {"value": self.settings.news_index_fingerprint}},
            ])
        if symbols:
            conditions.append({"should": [
                {"key": "impact_company_ids", "match": {"any": symbols}},
                {"key": "stock_ids", "match": {"any": symbols}},
                {"key": "stock_id", "match": {"any": symbols}},
            ]})
        bounds = {}
        if start is not None:
            bounds["gte"] = _timestamp(start)
        if end is not None:
            bounds["lte"] = _timestamp(end)
        if bounds:
            conditions.append({"key": "pub_ts", "range": bounds})
        return {"must": conditions}

    async def _points(self, operation, payload):
        self.require_enabled()
        collection = quote(self.settings.QDRANT_COLLECTION, safe="")
        return await self._post(f"{self.base_url}/collections/{collection}/points/{operation}", payload=payload,
            headers={"api-key": self.settings.QDRANT_API_KEY} if self.settings.QDRANT_API_KEY else {},
            timeout=self.settings.QDRANT_TIMEOUT_SECONDS, service="Vector database")

    async def query(self, vector, *, symbols=None, start=None, end=None, limit=20):
        data = await self._points("query", {"query": vector, "filter": self._filter(symbols, start, end),
            "limit": limit, "with_payload": True, "with_vector": False})
        try:
            points = data["result"]["points"]
            if not isinstance(points, list):
                raise ValueError("Expected points")
            result = []
            for point in points:
                if not isinstance(point, dict) or not isinstance(point.get("payload"), dict):
                    raise ValueError("Invalid point")
                score = float(point.get("score", 0))
                if not math.isfinite(score):
                    raise ValueError("Invalid score")
                result.append({"id": str(point["id"]), "score": score, "payload": point["payload"]})
            return result
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            raise ServiceUnavailable("Invalid vector database response") from exc

    async def count(self, *, symbols=None, start=None, end=None):
        data = await self._points("count", {"filter": self._filter(symbols, start, end), "exact": True})
        try:
            count = data["result"]["count"]
            if type(count) is not int or count < 0:
                raise ValueError("Invalid count")
            return count
        except (KeyError, TypeError, ValueError) as exc:
            raise ServiceUnavailable("Invalid vector database response") from exc
