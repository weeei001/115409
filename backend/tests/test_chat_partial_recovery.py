"""Fixed evidence only; partial publication must pass the normal validator."""
import json

import pytest

from app.features.chat.partial_recovery import recover_partial_answer
from app.features.chat.schemas import SourceChunk


FACTS = "台積電公布的營運資料顯示公司持續擴充先進製程產能，海外設廠計畫仍在進行。[S2]"


def sources():
    return [
        SourceChunk(citation_id="S1", title="Synthetic price", source="test", source_name="Test",
                    pub_time="", url="", stock_id="2330", score=1, category="market_technical",
                    content=json.dumps({"columns": ["date", "close"], "rows": [["2026-10-01", 100]]})),
        SourceChunk(citation_id="S2", title="Synthetic disclosure", source="test", source_name="Test",
                    pub_time="", url="", stock_id="2330", score=1, category="news",
                    content=FACTS.removesuffix("[S2]")),
    ]


@pytest.mark.parametrize("separator", ["\n\n", " "])
def test_retains_valid_content_and_removes_bad_numbers_and_dependent_advice(separator):
    draft = separator.join(["因此建議優先買進台積電。[S2]", FACTS,
                            "2330在2026-10-01收盤價999元。[S1]", "上述表現適合加碼。[S2]"])
    answer, diagnostics = recover_partial_answer(draft, {"finish_reason": "stop"}, sources())
    assert answer is not None
    assert FACTS in answer
    assert "999" not in answer
    assert "優先買進" not in answer
    assert "適合加碼" not in answer
    assert "已省略" in answer
    assert any(item["reason"] == "contradicted" for item in diagnostics)


@pytest.mark.parametrize("metadata", [{"finish_reason": "length"},
                                       {"finish_reason": "stop", "truncated": True},
                                       {"finish_reason": "error"}])
def test_truncated_drafts_cannot_be_partially_published(metadata):
    answer, diagnostics = recover_partial_answer(FACTS, metadata, sources())
    assert answer is None
    assert diagnostics[0]["result"] == "ineligible"


def test_conditions_stay_atomic_and_only_disclaimers_cannot_be_success():
    draft = "如果2330在2026-10-01收盤價999元。" + FACTS
    answer, _ = recover_partial_answer(draft, {"finish_reason": "stop"}, sources())
    assert answer is None
    answer, _ = recover_partial_answer("非投資建議。\n\n目前提供的資料不足以回答此問題。",
                                       {"finish_reason": "stop"}, sources())
    assert answer is None


def test_wrong_citation_is_not_lent_from_other_sentence():
    answer, _ = recover_partial_answer(FACTS + "2330在2026-10-01收盤價100元。[S2]",
                                       {"finish_reason": "stop"}, sources())
    assert answer is not None
    assert "100元" not in answer


def test_removed_date_context_does_not_turn_wrong_observation_valid():
    draft = "2026-10-02的觀察。\n\n2330收盤價100元。[S1]\n\n" + FACTS
    answer, _ = recover_partial_answer(draft, {"finish_reason": "stop"}, sources())
    assert answer is not None
    assert "100元" not in answer


@pytest.mark.parametrize("conclusion", [
    "這表示台積電的投資風險已經明顯降低，可以安心建立部位。[S2]",
    "這代表台積電擁有相對較佳的防禦能力，後續操作可以更積極。[S2]",
    "此表現意味台積電的風險已經降低。[S2]",
    "可以安心建立部位。[S2]",
])
def test_explicit_dependent_conclusions_are_removed_without_dropping_disclosure(conclusion):
    draft = FACTS + "\n\n2330在2026-10-01收盤價999元。[S1]\n\n" + conclusion
    answer, _ = recover_partial_answer(draft, {"finish_reason": "stop"}, sources())
    assert answer is not None
    assert FACTS in answer
    assert conclusion not in answer
    assert "999元" not in answer


@pytest.mark.parametrize("heading", ["鴻海的行情。", "鴻海（2317）的行情。"])
def test_removed_subject_context_cannot_lend_the_source_company_to_a_number(heading):
    draft = heading + "\n\n收盤價100元。[S1]\n\n" + FACTS
    answer, diagnostics = recover_partial_answer(
        draft, {"finish_reason": "stop"}, sources(),
        company_catalog={"2330": {"name": "台積電"}, "2317": {"name": "鴻海"}})
    assert answer is not None
    assert FACTS in answer
    assert "100元" not in answer
    assert any(item["reason"] == "dependent_subject" for item in diagnostics)


def test_correct_comparison_numbers_survive_unsupported_stability_conclusion():
    # These values are synthetic fixtures, not verified historical observations.
    source = SourceChunk(
        citation_id="S1", title="Synthetic comparison", source="test", source_name="Test",
        pub_time="", url="", stock_id="", score=1, category="comparison",
        content=json.dumps({"common_start_date": "2026-09-09", "common_end_date": "2026-10-07",
                            "stocks": [{"symbol": "2412", "interval_return_pct": 4.3,
                                        "annualized_volatility_pct": 10.69, "max_drawdown_pct": -1.37},
                                       {"symbol": "2501", "interval_return_pct": -8.04}]}))
    draft = ("在2026-09-09至2026-10-07，中華電（2412）區間報酬率4.30%，"
             "年化波動度10.69%，最大回撤-1.37%，比國建（2501，區間報酬率-8.04%）更為穩健。[S1]")
    answer, diagnostics = recover_partial_answer(
        draft, {"finish_reason": "stop"}, [source],
        company_catalog={"2412": {"name": "中華電"}, "2501": {"name": "國建"}})
    assert answer is not None
    assert "10.69%" in answer and "-8.04%" in answer
    assert "更為穩健" not in answer
    assert any(item["result"] == "narrowed" for item in diagnostics)


def test_unit_limit_bounds_synchronous_recovery_work():
    answer, diagnostics = recover_partial_answer(FACTS * 129, {"finish_reason": "stop"}, sources())
    assert answer is None
    assert diagnostics[-1]["reason"] == "recovery_limit"


@pytest.mark.parametrize("citation", ["[S1]", "【S1】", "[片段1]"])
def test_inline_repeated_citations_keep_comparison_observations(citation):
    from test_chat_claim_wording import CATALOG, LONG, evidence

    draft = LONG.replace("%，年化", "%" + citation + "，年化") + citation
    answer, _ = recover_partial_answer(draft, {"finish_reason": "stop"}, [evidence()],
                                       company_catalog=CATALOG)
    assert answer is not None
    assert "更為抗跌穩健" not in answer
    assert all(value in answer for value in ("4.30", "10.69", "-1.37", "-8.04", "-19.50", "-1.68"))


@pytest.mark.parametrize("citation", ["[S2]", "【S2】", "［S2］", "[片段2]", "[s2]"])
def test_recovery_normalizes_the_same_citation_typography_as_validation(citation):
    draft = FACTS.replace("[S2]", citation) + "\n\n2330收盤價999元。[S1]"
    answer, _ = recover_partial_answer(draft, {"finish_reason": "stop"}, sources())
    assert answer is not None
    assert FACTS in answer


def test_coverage_limitations_and_upstream_warning_are_preserved():
    limitation = "國建的本輪資料尚缺，未納入比較；股票行情日期不一致。[S2]"
    draft = FACTS + "\n\n" + limitation + "\n\n2330收盤價999元。[S1]"
    answer, _ = recover_partial_answer(draft, {"finish_reason": "stop"}, sources(),
                                       warning="測試來源：未涵蓋國建。")
    assert answer is not None
    assert limitation in answer
    assert "測試來源：未涵蓋國建。" in answer
