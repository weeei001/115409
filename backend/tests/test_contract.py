"""驗證來源欄位維持可選且型別正確。"""


SOURCE_PROVENANCE_FIELDS = {
    "article_id", "chunk_id", "chunk_index", "char_start", "char_end", "content_hash",
    "revision", "index_version", "embedding_model", "stock_ids",
}


def test_source_provenance_is_additive_optional_and_typed():
    from app.features.chat.schemas import SourceChunk
    from app.features.retrieval.schemas import NewsSource

    for model in (SourceChunk, NewsSource):
        schema = model.model_json_schema()
        fields = SOURCE_PROVENANCE_FIELDS | ({"citation_id", "in_time_range"} if model is SourceChunk else set())
        assert fields.isdisjoint(schema.get("required", []))
        for field in fields:
            prop = schema["properties"][field]
            expected = ("integer" if field in {"chunk_index", "char_start", "char_end"} else
                        "boolean" if field == "in_time_range" else "array" if field == "stock_ids" else "string")
            assert expected in {item.get("type") for item in prop.get("anyOf", [prop])}
