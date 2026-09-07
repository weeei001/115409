"""backtest_report.py：arm 名稱參數化（A/B vs A/L）、verdict/methodology 章節、舊報告回歸。"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backtest_report as br  # noqa: E402


def _decisions(cmp_arm, n=6):
    rows = []
    for i in range(n):
        as_of = f"2025-0{i+1}-07"
        act = 5.0 if i % 2 == 0 else -5.0
        rows.append({"as_of": as_of, "arm": "A", "model": "m", "predicted_pct": "5.0",
                     "predicted_dir": "up", "actual_pct": str(act),
                     "actual_dir": "up" if act > 0 else "down",
                     "hit": "True" if act > 0 else "False", "abs_err": "0.0",
                     "n_news": "3", "n_digests_used": "0", "skipped_reason": ""})
        rows.append({"as_of": as_of, "arm": cmp_arm, "model": "m", "predicted_pct": "1.0",
                     "predicted_dir": "flat", "actual_pct": str(act),
                     "actual_dir": "up" if act > 0 else "down",
                     "hit": "False", "abs_err": "4.0",
                     "n_news": "3", "n_digests_used": "0", "skipped_reason": ""})
    return rows


def _metrics(cmp_arm, with_verdict):
    m = {
        "config": {"stock": "2330", "start": "2025-01-01", "horizon": 20},
        "arms": {"A": {"n": 6, "hit_rate": 0.5, "hits": 3, "mae": 0.0},
                 cmp_arm: {"n": 6, "hit_rate": 0.0, "hits": 0, "mae": 4.0}},
        "baselines": {"always_up": {"n": 6, "hit_rate": 0.5},
                      "always_down": {"n": 6, "hit_rate": 0.5}},
        "mcnemar_sign_test": {"b_wins": 0, "a_wins": 3, "p_value": 0.25,
                              "cmp_arm": cmp_arm, "base_arm": "A"},
        "band_sensitivity": {"band_2.0": {"A": 0.5, cmp_arm: 0.2},
                             "band_3.0": {"A": 0.5, cmp_arm: 0.0}},
        "coverage": {"n_decision_points": 6, "n_valid_as_of": 6, "n_llm_failed_as_of": 0,
                     "n_digests_used_distribution": {0: 6}},
    }
    if with_verdict:
        m["relative_to_always_up"] = {"A": 0.0, cmp_arm: -0.5}
        m["verdict"] = {"cmp_arm": cmp_arm, "base_arm": "A", "cond1_beats_always_up": False,
                        "cond2_wins_ratio": False, "passed": False, "note": "..."}
    return m


def test_cmp_arm_of():
    assert br.cmp_arm_of({"arms": {"A": {}, "B": {}}}) == "B"
    assert br.cmp_arm_of({"arms": {"A": {}, "L": {}}}) == "L"
    assert br.cmp_arm_of({"arms": {}}) == "B"


def test_build_report_digest_ab():
    h20 = {"metrics": _metrics("B", with_verdict=False), "decisions": _decisions("B")}
    h5 = {"metrics": _metrics("B", with_verdict=False), "decisions": _decisions("B")}
    html = br.build_report(h20, h5, "盤點", "變更")
    assert "digest 疊加" in html
    assert "B 疊加摘要" in html
    assert "學到的預測方法論" not in html
    assert "雙條件方向制判定" not in html  # 舊 metrics 無 verdict


def test_build_report_learned_al_with_methodology():
    h20 = {"metrics": _metrics("L", with_verdict=True), "decisions": _decisions("L")}
    h5 = {"metrics": _metrics("L", with_verdict=True), "decisions": _decisions("L")}
    methodology = {"summary": "核心方法論", "regime_rules": ["斜率一致 = 強趨勢"],
                   "rules": [{"id": "R1", "signal": "營收創高", "condition": "強趨勢",
                              "expected_effect": "h20 偏多 +3%", "confidence": 0.7,
                              "evidence_case_ids": ["2330_2024-03-08"]}],
                   "anti_patterns": ["人事異動不影響方向"]}
    train_log = {"config": {"train_start": "2024-01-01", "train_end": "2024-12-31",
                            "n_cases": 40, "n_batch1": 20, "n_batch2": 20, "model": "Gemma4-31B"},
                 "rounds": [{"k": 0, "heldout_h20": 0.55, "heldout_h5": 0.5, "heldout_n_h20": 18,
                             "batch1_h20": 0.6, "always_up_h20_heldout": 0.6, "n_misses_h20": 8},
                            {"k": 1, "heldout_h20": 0.65, "heldout_h5": 0.55, "heldout_n_h20": 18,
                             "batch1_h20": 0.7, "always_up_h20_heldout": 0.6, "n_misses_h20": 6}],
                 "best": 1}
    html = br.build_report(h20, h5, "盤點", "變更", methodology, train_log)
    assert "學到的預測方法論" in html
    assert "核心方法論" in html and "營收創高" in html and "2330_2024-03-08" in html
    assert "L 學習方法論" in html
    assert "雙條件方向制判定" in html
    assert "v1（best）" in html
    assert "digest 疊加" not in html


def test_verdict_block_renders_conditions():
    m = _metrics("L", with_verdict=True)
    out = br.verdict_block(m)
    assert "cond1" in out and "cond2" in out and "不確定 / 無效" in out


def test_verdict_block_empty_without_verdict():
    assert br.verdict_block(_metrics("B", with_verdict=False)) == ""
