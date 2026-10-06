import json

import pytest

from app.features.analysis.prompts import few_shot_examples, select_examples
from app.features.analysis.schemas import StockBehaviorTextBrief
from app.features.analysis.validation import _text_brief_referenced_ids


@pytest.mark.parametrize("example", few_shot_examples(), ids=lambda example: example["scenario"])
def test_examples_match_their_own_evidence_and_schema(example):
    payload = example["input_payload"]
    answer = StockBehaviorTextBrief.model_validate(example["output_brief"])
    ids = {item["id"] for section in ("daily_timeline", "chip_summary", "long_term_anchor", "fundamental", "news")
           for item in payload.get(section, [])}
    timeline = {item["id"]: item for item in payload["daily_timeline"]}
    assert _text_brief_referenced_ids(answer.model_dump()) <= ids
    for day in answer.key_days:
        assert day.ref in day.evidence_ids
        assert day.date == timeline[day.ref]["date"] <= payload["task"]["as_of_date"]
    news = {item["id"]: item for item in payload.get("news", [])}
    def check_support(value):
        if isinstance(value, dict):
            refs = set(value.get("evidence_ids", [])) & news.keys()
            if refs:
                assert {item["evidence_id"] for item in value["news_support"]} == refs
                for item in value["news_support"]:
                    assert item["quote"] in news[item["evidence_id"]]["value"]
            for child in value.values():
                check_support(child)
        elif isinstance(value, list):
            for child in value:
                check_support(child)
    check_support(answer.model_dump())
    assert all(item.claim_type == "conflict" for item in answer.source_divergences)


def test_examples_exclude_all_future_and_same_stock_same_day_answers():
    assert select_examples("2330", "2020-01-01") == []
    for source, answer in select_examples("2330", "2026-07-13"):
        task = json.loads(source)["task"]
        assert task["as_of_date"] <= "2026-07-13"
        assert (task["symbol"], task["as_of_date"]) != ("2330", "2026-07-13")
        assert StockBehaviorTextBrief.model_validate_json(answer)


def test_generation_uses_one_bounded_example_and_bounded_citations():
    from pydantic import ValidationError
    from app.features.analysis.schemas import TextBriefForwardView

    assert len(select_examples("2330", "2026-09-22")) == 1
    view = {"stance": "uncertain", "reason": "Limited data", "invalidation": "Operating conditions change"}
    for ids in (["nw_01"] * 7, ["nw_01 HDMI_01"], ["nw_" + "1" * 20]):
        with pytest.raises(ValidationError):
            TextBriefForwardView(**view, evidence_ids=ids)
    schema = TextBriefForwardView.model_json_schema()["properties"]["evidence_ids"]
    assert schema["maxItems"] == 6 and schema["items"]["maxLength"] == 16


@pytest.mark.parametrize("note", [
    "部分新聞為媒體轉述之目標價，非正式公司公告。",
    "部分新聞提及之目標價為分析師預測，非確定事實。",
])
def test_source_disclaimer_does_not_hide_price_targets_or_trade_instructions(note):
    from app.features.analysis.compliance import scan_compliance_hits

    assert not scan_compliance_hits(note)
    for text in (note + "目標價 1500 元。", note + "建議買進。",
                 "媒體目標價 1500 元，非公司公告。",
                 note.replace("目標價", "目標價 1500 元")):
        assert any(hit.severity == "hard" for hit in scan_compliance_hits(text))


@pytest.mark.parametrize("disclaimer", ["不保證", "無法保證", "不能保證", "並非保證", "不是保證", "尚未保證"])
def test_direction_disclaimer_does_not_hide_affirmative_promises(disclaimer):
    from app.features.analysis.compliance import scan_compliance_hits

    note = f"短線偏多，但{disclaimer}後續上漲。"
    assert not scan_compliance_hits(note)
    for promise in ("保證上漲", "必然上漲", "穩賺", "絕對會上漲", "不能不保證上漲"):
        assert any(hit.rule == "承諾詞-hard" for hit in scan_compliance_hits(note + promise))


@pytest.mark.parametrize("separator", ["。", "，", ",", "；", ";", "\n", "\r\n"])
def test_promise_negation_does_not_cross_clause_boundaries(separator):
    from app.features.analysis.compliance import scan_compliance_hits

    assert any(hit.rule == "承諾詞-hard" for hit in scan_compliance_hits(f"不能{separator}保證上漲。"))


@pytest.mark.parametrize("separator", ["，", ",", "；", ";", "\n", "\r\n"])
def test_return_rules_do_not_join_separate_clauses(separator):
    from app.features.analysis.compliance import scan_compliance_hits

    actual = f"受輝達財報激勵記憶體短缺預期{separator}股價飆漲 4.64% 至 541 元再創新高。"
    assert not scan_compliance_hits(actual)
    # 「看好」 itself is an opinion word; the forward-return rules must still not join the clauses.
    assert [hit.rule for hit in scan_compliance_hits(f"市場看好{separator}股價已上漲4.64%。")] == ["投資觀點-hard"]
    for text in ("預期漲4.64%", f"預期{separator}將漲4.64%"):
        assert any(hit.rule == "前瞻報酬-hard" for hit in scan_compliance_hits(text))
    assert any(hit.rule == "前瞻報酬-soft" for hit in scan_compliance_hits("未來上漲4.64%"))


@pytest.mark.parametrize("text", ["基本面提供支撐，長期趨勢仍看好。", "若數據亮眼可進一步上攻。",
                                  "法人看壞後市。", "市場不看好短線表現。"])
def test_opinion_words_are_hard_violations(text):
    from app.features.analysis.compliance import scan_compliance_hits

    assert any(hit.rule == "投資觀點-hard" and hit.severity == "hard" for hit in scan_compliance_hits(text))


@pytest.mark.parametrize("text", ["基本面支撐偏多。", "若財報優於預期，價格可能走高。",
                                  "報導：「外資看好 AI 需求，股價有望上攻」。"])
def test_neutral_direction_and_quoted_sources_pass_opinion_rule(text):
    from app.features.analysis.compliance import scan_compliance_hits

    assert not [hit for hit in scan_compliance_hits(text) if hit.rule == "投資觀點-hard"]


def test_opinion_rule_reaches_the_brief_gate_and_revision():
    from app.features.analysis.compliance import compliance_rules_signature
    from app.features.analysis.validation import _scan_text_brief_compliance

    assert any("投資觀點-hard" in rule for rule in compliance_rules_signature())
    hits = _scan_text_brief_compliance({"text": "長期趨勢仍看好。", "evidence_ids": []})
    assert any(hit.rule == "投資觀點-hard" for hit in hits)
    quoted = {"what": "收盤 100 元。09/16 09:19 鉅亨網報導：「法人看好後市」。新聞和股價變動是否有關，未經核實。"}
    assert not [hit for hit in _scan_text_brief_compliance(quoted) if hit.rule == "投資觀點-hard"]


@pytest.mark.parametrize("separator", ["，", ";"])
def test_historical_price_range_is_not_a_forecast_from_a_separate_support_clause(separator):
    from datetime import date

    from app.features.analysis import validation as gate
    from app.features.analysis.evidence import EvidenceBundle

    bundle = EvidenceBundle(symbol="2727", as_of_date=date(2026, 10, 1), daily_timeline=[
        {"id": "d_01", "date": "2026-09-01", "close": 227},
        {"id": "d_02", "date": "2026-09-02", "close": 241},
    ])
    item = {"id": "cs_01", "evidence_ids": ["d_01", "d_02"],
            "text": f"市場支撐因素仍待觀察{separator}股價在 227-241 元區間震盪後回升。"}
    prices = gate._historical_prices(bundle)
    assert not gate._grounding_issues(item, bundle)
    assert not any(hit.severity == "hard" for hit in gate._scan_text_brief_compliance(item, prices=prices))

    item["text"] = "股價可望挑戰 241 元。"
    assert any(hit.severity == "hard" for hit in gate._scan_text_brief_compliance(item, prices=prices))
