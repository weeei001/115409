"""Worker-only Qdrant writes using the same embedding settings as retrieval."""
from datetime import datetime
import math
from urllib.parse import quote
from uuid import NAMESPACE_URL, uuid5

import httpx

from app.clients.vector import VectorClient, _timestamp
from app.core.errors import AppError, ServiceUnavailable, UpstreamTimeout


class VectorWriter:
    def __init__(self, http: httpx.AsyncClient, settings):
        self.http, self.settings = http, settings
        self.reader = VectorClient(http, settings)
        self.url = f"{self.reader.base_url}/collections/{quote(settings.QDRANT_COLLECTION, safe='')}"
        self.dimension = None
        self._create_allowed = False
        self._missing = False

    async def _request(self, method, suffix="", *, payload=None, allow_missing=False):
        self.reader.require_enabled()
        try:
            response = await self.http.request(method, self.url + suffix, json=payload,
                headers={"api-key": self.settings.QDRANT_API_KEY} if self.settings.QDRANT_API_KEY else {},
                timeout=self.settings.QDRANT_TIMEOUT_SECONDS)
            if allow_missing and response.status_code == 404:
                return None
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict) or data.get("status") not in (None, "ok"):
                raise ValueError("Invalid vector response")
            return data
        except httpx.TimeoutException as exc:
            raise UpstreamTimeout("Vector database timed out") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ServiceUnavailable("Vector database request failed") from exc

    async def require_collection(self, create=False):
        if not self.settings.NEWS_INDEX_VERSION or self.settings.QDRANT_COLLECTION == "news_chunks":
            raise AppError("Select an explicit index version and a new collection for v2 ingestion", 409)
        if self.settings.EMBED_TRUNCATE != "NONE":
            raise AppError("News indexing requires EMBED_TRUNCATE=NONE to preserve evidence", 409)
        info = await self._request("GET", allow_missing=True)
        self._create_allowed = create
        self._missing = info is None
        if self._missing:
            if not create:
                raise AppError("Qdrant collection does not exist; use --create-collection explicitly", 503)
            return
        try:
            vectors = info["result"]["config"]["params"]["vectors"]
            size = vectors["size"]
            if type(size) is not int or size <= 0 or str(vectors["distance"]).lower() != "cosine":
                raise ValueError("Incompatible vector configuration")
            self.dimension = size
        except (KeyError, TypeError, ValueError) as exc:
            raise AppError("Qdrant collection must have one unnamed dense Cosine vector", 409) from exc
        # Fail before embedding or writing if an existing collection contains another pipeline.
        expected = self.reader._filter(None, None, None)
        result = await self._request("POST", "/points/count", payload={
            "filter": {"must_not": [expected]}, "exact": True})
        count = result.get("result", {}).get("count") if isinstance(result.get("result"), dict) else None
        if type(count) is not int or count < 0:
            raise ServiceUnavailable("Invalid vector database count response")
        if count:
            raise AppError("Collection contains a different model or indexing configuration; use a new collection", 409)

    async def existing_chunk_ids(self, ids: list[str]) -> set[str]:
        if not ids or self._missing:
            return set()
        wanted, found, visited = set(ids), set(), set()
        offset = None
        while True:
            payload = {"filter": {"must": [{"key": "chunk_id", "match": {"any": sorted(wanted)}}]},
                       "limit": 256, "with_payload": ["chunk_id"], "with_vector": False}
            if offset is not None:
                payload["offset"] = offset
            data = await self._request("POST", "/points/scroll", payload=payload)
            try:
                result = data["result"]
                points = result["points"]
                if not isinstance(points, list):
                    raise ValueError("Invalid points")
                for point in points:
                    chunk_id = point["payload"]["chunk_id"]
                    if not isinstance(chunk_id, str) or chunk_id not in wanted:
                        raise ValueError("Invalid chunk identifier")
                    found.add(chunk_id)
                offset = result.get("next_page_offset")
                if offset is None:
                    return found
                if not isinstance(offset, (int, str)) or isinstance(offset, bool) or offset in visited:
                    raise ValueError("Invalid scroll cursor")
                visited.add(offset)
            except (KeyError, TypeError, ValueError) as exc:
                raise ServiceUnavailable("Invalid vector database scroll response") from exc

    async def embed_documents(self, texts):
        return await self.reader.embed_documents(texts)

    async def upsert_chunks(self, chunks: list[dict], vectors: list[list[float]]) -> int:
        if len(chunks) != len(vectors):
            raise AppError("Embedding count does not match chunk count")
        if not chunks:
            return 0
        points, size = [], None
        try:
            for chunk, vector in zip(chunks, vectors):
                chunk_id = chunk["chunk_id"]
                if not isinstance(chunk_id, str) or not chunk_id or not vector:
                    raise ValueError("Invalid chunk")
                if (chunk.get("index_version") != self.settings.NEWS_INDEX_VERSION
                        or chunk.get("index_fingerprint") != self.settings.news_index_fingerprint):
                    raise ValueError("Chunk indexing configuration does not match the writer")
                if not isinstance(chunk.get("article_id"), str) or not chunk["article_id"]:
                    raise ValueError("Missing article identifier")
                if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in vector):
                    raise ValueError("Invalid vector")
                size = size or len(vector)
                if len(vector) != size:
                    raise ValueError("Inconsistent embedding dimensions")
                timestamp = datetime.fromisoformat(chunk["pub_time"].replace("Z", "+00:00"))
                payload = {key: chunk.get(key) for key in (
                    "article_id", "chunk_id", "chunk_index", "stock_id", "stock_ids", "title", "source",
                    "pub_time", "url", "tags", "char_start", "char_end", "content_hash", "revision",
                    "index_version", "index_fingerprint", "token_count")}
                payload["embedding_model"] = self.settings.EMBED_MODEL
                payload.update(page_content=chunk["content_chunk"], pub_ts=_timestamp(timestamp))
                points.append({"id": str(uuid5(NAMESPACE_URL, "news_chunks:" + chunk_id)),
                               "vector": vector, "payload": payload})
            if len({point["id"] for point in points}) != len(points):
                raise ValueError("Duplicate chunk identifiers")
        except (AttributeError, KeyError, TypeError, ValueError, OverflowError, OSError) as exc:
            raise AppError("Invalid chunk or embedding batch") from exc
        if self.dimension is None and not self._missing:
            await self.require_collection()
        if self._missing:
            if not self._create_allowed:
                raise AppError("Collection creation was not enabled", 503)
            result = await self._request("PUT", payload={"vectors": {"size": size, "distance": "Cosine"}})
            if result.get("result") is not True:
                raise ServiceUnavailable("Collection creation was not confirmed")
            self._missing, self.dimension = False, size
            for name, schema in (("pub_ts", "float"), ("chunk_id", "keyword"), ("stock_id", "keyword"),
                                 ("stock_ids", "keyword"), ("article_id", "keyword"),
                                 ("index_version", "keyword"), ("index_fingerprint", "keyword"),
                                 ("embedding_model", "keyword")):
                result = await self._request("PUT", "/index?wait=true", payload={"field_name": name, "field_schema": schema})
                self._require_completed(result)
        if size != self.dimension:
            raise AppError("Embedding dimension does not match the existing Qdrant collection", 409)
        existing = await self.existing_chunk_ids([chunk["chunk_id"] for chunk in chunks])
        points = [point for point in points if point["payload"]["chunk_id"] not in existing]
        if not points:
            return 0
        result = await self._request("PUT", "/points?wait=true", payload={"points": points})
        self._require_completed(result)
        return len(points)

    async def delete_stale_article_chunks(self, article_id, index_version, current_chunk_ids):
        """Retire previous revisions only after the complete replacement is confirmed."""
        if not article_id or index_version != self.settings.NEWS_INDEX_VERSION or not current_chunk_ids:
            raise AppError("A complete nonempty article revision is required for stale cleanup", 409)
        current = set(current_chunk_ids)
        if await self.existing_chunk_ids(sorted(current)) != current:
            raise AppError("Replacement article is incomplete; old vectors were retained", 409)
        result = await self._request("POST", "/points/delete?wait=true", payload={"filter": {
            "must": [{"key": "article_id", "match": {"value": article_id}},
                     {"key": "index_version", "match": {"value": index_version}}],
            "must_not": [{"key": "chunk_id", "match": {"any": sorted(current)}}],
        }})
        self._require_completed(result)

    @staticmethod
    def _require_completed(result):
        if not isinstance(result.get("result"), dict) or result["result"].get("status") != "completed":
            raise ServiceUnavailable("Vector database operation was not confirmed completed")
