"""backtest_digest_eval.py 重構後的回歸測試：prompt template 化、JSON parser、compute_metrics 參數化。

重點是 test_default_prompt_byte_identical_to_legacy：template=None 時產出的 prompt 必須與重構前的
f-string 完全相同（逐字），確保既有 A 組結果與新跑的 A 組可直接比較。
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest



from app.jobs.research import backtest_digest_eval as bde  # noqa: E402


# ---- 重構前的 prompt（從 git 歷史逐字複製，作為快照） ----
def _legacy_prompt(as_of, name, stock_id, horizon, context_block):
    return f"""你是台股分析師。根據以下截至 {as_of} 的資訊，預測 {name}（{stock_id}）未來 {horizon} 個交易日的「總漲跌幅」。
只能用下方資訊，不得引入 {as_of} 之後才知道的事。

{context_block}

請依序完成以下推理步驟：

步驟1（市場狀態判斷）：先判斷目前是「強趨勢」還是「盤整／雜訊」——
觀察近期價格走勢的斜率是否一致、方向是否穩定（強趨勢：斜率持續同向、無劇烈來回；
盤整：漲跌互見、乖離不大、方向不明）。這一步決定後續要用哪一套邏輯：
動能策略在盤整期容易失準，均值回歸策略在強趨勢中也容易失準，兩者要看市場狀態選用，
不要無條件套用其中一種。

步驟2（技術面推理）：依步驟1判斷的市場狀態，評估近期價格走勢：
若判斷為強趨勢，優先考慮動能延續（強趨勢中的「超買/超跌」較常是趨勢確認訊號而非反轉訊號，
但仍有約3成機率會反轉，非必然）；若判斷為盤整或訊號紊亂，優先考慮均值回歸或維持觀望。
若近期已大幅上漲或下跌（例如超過10%），需明確說出這在你判斷的市場狀態下對未來
{horizon} 個交易日的方向含義是什麼，不要只是複述數字。

步驟3（新聞面推理）：判斷新聞內容是否直接與公司基本面（營收、訂單、法說、產業動能）相關，
還是多為周邊消息（人事、廠房進度、政治發言等）；新聞面的訊號強度是強、中、弱。

步驟4（綜合結論）：綜合步驟1-3，給出最終方向與幅度。可參考以下區間刻度輔助定位幅度
（僅供你推理時參考，不必在輸出中提及）：{bde._MAGNITUDE_BUCKETS}

請只輸出 JSON，不要其他文字：
{{"market_regime": "步驟1判斷：強趨勢或盤整，1句", "technical_reasoning": "步驟2的推理，1-2句", "news_reasoning": "步驟3的推理，1-2句", "change_pct": 預估總漲跌幅數字（例如 2.5 代表漲 2.5%，-1.8 代表跌 1.8%）}}"""


def test_default_prompt_byte_identical_to_legacy():
    ctx = "## 近期價格趨勢\n（測試）\n\n## 近期新聞（完整內文）\n- [2024-03-01] 標題｜內文 {有大括號} 也不能壞"
    got = bde.build_prediction_prompt("2330", "2024-03-08", 20, ctx, template=None)
    assert got == _legacy_prompt("2024-03-08", "台積電", "2330", 20, ctx)


def test_format_safe_only_replaces_known_placeholders():
    tpl = '前綴 {as_of} {name} {unknown} {"json": "literal"} {{escaped}} {context_block}'
    out = bde._format_safe(tpl, as_of="2024-01-05", name="台積電", stock_id="2330", horizon=5,
                           context_block="CTX", magnitude_buckets="MB")
    assert out == '前綴 2024-01-05 台積電 {unknown} {"json": "literal"} {{escaped}} CTX'


def test_learned_template_roundtrips_through_parser():
    learned = ("規則：… 截至 {as_of}，{name}（{stock_id}）未來 {horizon} 日。\n{context_block}\n"
               '輸出 JSON：{"market_regime": "...", "technical_reasoning": "...", "news_reasoning": "...", "change_pct": 數字}')
    prompt = bde.build_prediction_prompt("2330", "2025-02-07", 20, "CTX", template=learned)
    assert "{context_block}" not in prompt and "CTX" in prompt and "2025-02-07" in prompt
    raw = '<think>亂想</think>\n說明文字 {"market_regime": "強趨勢", "technical_reasoning": "x", "news_reasoning": "y", "change_pct": "2.5"}'
    parsed = bde.parse_prediction_json(raw)
    assert parsed["change_pct"] == 2.5 and parsed["market_regime"] == "強趨勢"


@pytest.mark.parametrize("raw", ["沒有 JSON", '{"market_regime": "x"}', '{"change_pct": null}', '{"change_pct": "abc"}'])
def test_parse_prediction_json_rejects_bad_payloads(raw):
    with pytest.raises((ValueError, TypeError)):
        bde.parse_prediction_json(raw)


def test_parse_prediction_json_tolerates_latex_backslash_in_reasoning():
    # 模型把方法論裡的 $\rightarrow$ 帶進理由欄 → 裸 \r 會炸 json.loads，需容錯
    raw = ('{"market_regime": "強趨勢", "technical_reasoning": "斜率>0 $\\rightarrow$ 動能延續", '
           '"news_reasoning": "營收創高 $\\le$ 乖離 10%", "change_pct": 4.2}')
    parsed = bde.parse_prediction_json(raw)
    assert parsed["change_pct"] == 4.2


def test_parse_prediction_json_regex_fallback_when_json_unrecoverable():
    # 有 {...} blob 但結構壞掉（缺逗號），兩段 loads 都失敗 → regex 撈 change_pct
    raw = '{"market_regime": "x" "technical_reasoning": "y", "change_pct": -1.8}'
    parsed = bde.parse_prediction_json(raw)
    assert parsed["change_pct"] == -1.8 and parsed["_parse"] == "regex_fallback"


class _FakeClient:
    """回傳固定內容的假 OpenAI client；記錄送出的 prompt 供斷言。"""
    def __init__(self, content):
        self.content, self.prompts = content, []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.prompts.append(kwargs["messages"][0]["content"])
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))])


def test_predict_change_pct_uses_template_and_returns_float():
    client = _FakeClient('{"market_regime": "盤整", "technical_reasoning": "a", "news_reasoning": "b", "change_pct": -1.2}')
    tpl = "LEARNED {as_of} {name} {stock_id} {horizon}\n{context_block}"
    got = bde.predict_change_pct(client, "m", "2330", "2025-03-07", 5, "CTX", "h200", prompt_template=tpl)
    assert got == -1.2
    assert client.prompts == ["LEARNED 2025-03-07 台積電 2330 5\nCTX"]


def test_predict_change_pct_returns_none_after_retry(monkeypatch):
    monkeypatch.setattr(bde.time, "sleep", lambda *_: None)
    client = _FakeClient("完全不是 JSON")
    assert bde.predict_change_pct(client, "m", "2330", "2025-03-07", 5, "CTX", "nim") is None
    assert len(client.prompts) == 2  # 重試 1 次


def test_build_context_from_pit_merges_tiers_and_filters_future():
    tech = {"available": True, "n_days": 20, "first_close": 100, "last_close": 110, "change_pct": 10.0,
            "slope_per_day": 0.5, "ma20": 105}
    analyst = [{"title": "分析師A", "pub_time": "2024-03-01T10:00:00+08:00", "content": "內文A"}]
    news = [{"title": "新聞B", "pub_time": "2024-03-05", "content": "內文B"},
            {"title": "未來C", "pub_time": "2024-03-09", "content": "不該出現"}]
    ctx = bde.build_context_from_pit(analyst, news, tech, "2024-03-08")
    assert "分析師A" in ctx and "新聞B" in ctx and "未來C" not in ctx
    assert ctx.startswith("## 近期價格趨勢")


# ---- compute_metrics ----

def _row(as_of, arm, pred, act, band=3.0, skipped=None):
    if skipped:
        return {"as_of": as_of, "arm": arm, "model": "m", "predicted_pct": None, "predicted_dir": None,
                "actual_pct": act, "actual_dir": bde.classify(act, band), "hit": None, "abs_err": None,
                "n_news": 0, "n_digests_used": 0, "skipped_reason": skipped}
    pd, ad = bde.classify(pred, band), bde.classify(act, band)
    return {"as_of": as_of, "arm": arm, "model": "m", "predicted_pct": pred, "predicted_dir": pd,
            "actual_pct": act, "actual_dir": ad, "hit": pd == ad, "abs_err": round(abs(pred - act), 2),
            "n_news": 3, "n_digests_used": 0, "skipped_reason": None}


@pytest.mark.parametrize("arms", [("A", "B"), ("A", "L")])
def test_compute_metrics_arm_names_and_mcnemar_counts(arms):
    base, cmp_ = arms
    # 5 個錨點：cmp 勝 3、base 勝 1、同對 1；再加 1 個 llm_failed 要被成對排除
    decisions = [
        _row("d1", base, 1.0, 5.0), _row("d1", cmp_, 5.0, 5.0),    # cmp 勝
        _row("d2", base, 1.0, 5.0), _row("d2", cmp_, 5.0, 5.0),    # cmp 勝
        _row("d3", base, 1.0, 5.0), _row("d3", cmp_, 5.0, 5.0),    # cmp 勝
        _row("d4", base, 5.0, 5.0), _row("d4", cmp_, -5.0, 5.0),   # base 勝
        _row("d5", base, 5.0, 5.0), _row("d5", cmp_, 5.0, 5.0),    # 同對
        _row("d6", base, None, 5.0, skipped="llm_failed"), _row("d6", cmp_, None, 5.0, skipped="llm_failed"),
    ]
    m = bde.compute_metrics(decisions, arm_names=arms, band=3.0, seed=1, config={"stock": "2330"}, n_decision_points=6)
    assert set(m["arms"]) == set(arms)
    assert m["arms"][cmp_]["n"] == 5 and m["arms"][cmp_]["hits"] == 4 and m["arms"][base]["hits"] == 2
    assert m["mcnemar_sign_test"]["b_wins"] == 3 and m["mcnemar_sign_test"]["a_wins"] == 1
    assert m["mcnemar_sign_test"]["p_value"] == bde._mcnemar_p(3, 1)
    assert m["baselines"]["always_up"]["hit_rate"] == 1.0  # 全部實際都是 up
    assert m["coverage"] == {"n_decision_points": 6, "n_valid_as_of": 5, "n_llm_failed_as_of": 1,
                             "n_digests_used_distribution": {0: 6}}
    assert m["config"]["stock"] == "2330" and m["config"]["neutral_band"] == 3.0
    assert set(m["band_sensitivity"]) == {"band_1.5", "band_2.0", "band_3.0", "band_4.0"}
    # verdict：cmp 命中率 0.8 − always_up 1.0 < 0 → cond1 失敗；cmp 勝 3 ≥ 1.5×1 → cond2 通過
    assert m["relative_to_always_up"][cmp_] == pytest.approx(-0.2)
    assert m["verdict"] == {
        "cmp_arm": cmp_, "base_arm": base, "cond1_beats_always_up": False,
        "cond2_wins_ratio": True, "passed": False, "note": m["verdict"]["note"],
    }


def test_compute_metrics_verdict_passes_when_both_conditions_hold():
    # 實際：up, up, down, flat → always_up = 0.5；L 全對（1.0）、A 只對 1 個 → L 勝 3、A 勝 0
    acts = [5.0, 5.0, -5.0, 0.5]
    decisions = []
    for i, act in enumerate(acts):
        decisions.append(_row(f"d{i}", "A", 5.0 if i == 0 else -9.0 if act > 0 else 9.0, act))
        decisions.append(_row(f"d{i}", "L", act, act))
    m = bde.compute_metrics(decisions, arm_names=("A", "L"), band=3.0)
    assert m["baselines"]["always_up"]["hit_rate"] == 0.5
    assert m["relative_to_always_up"] == {"A": pytest.approx(-0.25), "L": pytest.approx(0.5)}
    assert m["verdict"]["passed"] is True
    assert m["mcnemar_sign_test"]["b_wins"] == 3 and m["mcnemar_sign_test"]["a_wins"] == 0


def test_default_band_grid():
    assert bde.default_band_grid(3.0) == (1.5, 2.0, 3.0, 4.0)
    assert bde.default_band_grid(1.0) == (0.5, 1.0, 1.5)
