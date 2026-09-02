"""SourceChunk 要能吃下 Qdrant payload 裡的 null 欄位（整體性新聞沒有 stock_id）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "rag_deploy"))

from api_server import SourceChunk  # noqa: E402


def test_null_strings_become_empty():
    c = SourceChunk(
        title=None,
        source="cnyes",
        source_name="鉅亨網",
        pub_time="2026-09-01 10:00",
        url="https://example.com/a",
        stock_id=None,
        content="內文",
        score=0.87,
    )
    assert c.stock_id == ""
    assert c.title == ""
    assert c.score == 0.87


def test_score_still_required_as_number():
    import pytest

    with pytest.raises(Exception):
        SourceChunk(
            title="t", source="s", source_name="n", pub_time="p",
            url="u", stock_id="2330", content="c", score=None,
        )


if __name__ == "__main__":
    test_null_strings_become_empty()
    print("ok")
