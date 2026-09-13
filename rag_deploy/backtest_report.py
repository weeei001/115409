"""
歷史回測成果報告產生器
======================
讀 backtest_digest_eval.py（A/B 對照）或 backtest_learned_prompt.py（A/L 對照）產出的
decisions.csv + metrics.json（h20 主結論、h5 穩健性對照），產一份自包含 HTML 報告
（inline CSS + inline SVG 圖表，零外部資源），可直接發佈為 Artifact。

用法：
    # digest A/B 對照
    python backtest_report.py \
        --h20-dir backtest_results/2330_week_2024-01-01_2024-12-31_h20 \
        --h5-dir backtest_results/2330_week_2024-01-01_2024-12-31_h5 \
        --out backtest_report.html

    # 學到的 prompt A/L 對照（加 methodology 章節）
    python backtest_report.py \
        --h20-dir backtest_results/2330_learned_2025-01-01_2025-12-31_h20 \
        --h5-dir backtest_results/2330_learned_2025-01-01_2025-12-31_h5 \
        --methodology-dir methodology/2330_2024-01-01_2024-12-31 \
        --out learned_report.html
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

# 對照臂標籤：B=digest 疊加、L=學到的方法論 prompt
ARM_LABELS = {"A": "A 現行 prompt", "B": "B 疊加摘要", "L": "L 學習方法論"}


def cmp_arm_of(metrics: dict) -> str:
    """metrics.arms 裡除了 A 以外的那個對照臂（B 或 L）。"""
    for a in ("L", "B"):
        if a in metrics.get("arms", {}):
            return a
    return "B"


def load_run(run_dir: Path) -> dict:
    metrics = json.loads((run_dir / "metrics.json").read_text())
    with (run_dir / "decisions.csv").open(newline="", encoding="utf-8") as f:
        decisions = list(csv.DictReader(f))
    return {"metrics": metrics, "decisions": decisions}


# ---------------- SVG 圖表小工具（純 Python 算幾何，零外部套件） ----------------

COL_BLUE = "#2a78d6"    # series 1：A
COL_ORANGE = "#eb6834"  # series 6：B
COL_GRAY = "#898781"    # 基準線/中性
COL_GREEN = "#0ca30c"   # good / 命中
COL_RED = "#d03b3b"     # critical / 未命中
INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
GRID = "#e1e0d9"
SURFACE = "#fcfcfb"


def svg_open(width: int, height: int) -> str:
    return f'<svg viewBox="0 0 {width} {height}" width="100%" style="max-width:{width}px" role="img">'


def cumulative_hit_rate_chart(decisions: list[dict], cmp_arm: str = "B", width=640, height=280) -> str:
    """A / 對照臂 累積命中率折線（依 as_of 時間順序）。"""
    pad_l, pad_r, pad_t, pad_b = 44, 16, 16, 32
    plot_w, plot_h = width - pad_l - pad_r, height - pad_t - pad_b

    by_arm = {"A": [], cmp_arm: []}
    for arm in ("A", cmp_arm):
        rows = [d for d in decisions if d["arm"] == arm and d["skipped_reason"] == ""]
        rows.sort(key=lambda r: r["as_of"])
        cum_hits, series = 0, []
        for i, r in enumerate(rows, start=1):
            if r["hit"] == "True":
                cum_hits += 1
            series.append(cum_hits / i)
        by_arm[arm] = series

    n = max(len(by_arm["A"]), len(by_arm[cmp_arm]), 1)
    def x(i): return pad_l + (i / max(n - 1, 1)) * plot_w
    def y(v): return pad_t + (1 - v) * plot_h

    parts = [svg_open(width, height)]
    parts.append(f'<rect x="0" y="0" width="{width}" height="{height}" fill="{SURFACE}"/>')
    for frac in (0, 0.25, 0.5, 0.75, 1.0):
        gy = y(frac)
        parts.append(f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{width-pad_r}" y2="{gy:.1f}" stroke="{GRID}" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l-8}" y="{gy+4:.1f}" text-anchor="end" font-size="11" fill="{INK_MUTED}">{int(frac*100)}%</text>')

    a_label, c_label = ARM_LABELS["A"], ARM_LABELS.get(cmp_arm, cmp_arm)
    for arm, color in (("A", COL_BLUE), (cmp_arm, COL_ORANGE)):
        series = by_arm[arm]
        if not series:
            continue
        pts = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(series))
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>')

    parts.append(f'<text x="{pad_l}" y="14" font-size="12" fill="{INK_SECONDARY}">累積方向命中率（依決策時間順序）</text>')
    ly = height - 8
    parts.append(f'<circle cx="{pad_l+4}" cy="{ly-4}" r="4" fill="{COL_BLUE}"/><text x="{pad_l+14}" y="{ly}" font-size="11" fill="{INK_SECONDARY}">{a_label}</text>')
    parts.append(f'<circle cx="{pad_l+130}" cy="{ly-4}" r="4" fill="{COL_ORANGE}"/><text x="{pad_l+140}" y="{ly}" font-size="11" fill="{INK_SECONDARY}">{c_label}</text>')
    parts.append("</svg>")
    return "".join(parts)


def predicted_vs_actual_scatter(decisions: list[dict], arm: str, color: str, width=340, height=300) -> str:
    """單一 arm 的預測 vs 實際散點（含 y=x 參考線）。"""
    pad_l, pad_r, pad_t, pad_b = 44, 16, 16, 32
    plot_w, plot_h = width - pad_l - pad_r, height - pad_t - pad_b

    rows = [d for d in decisions if d["arm"] == arm and d["skipped_reason"] == ""]
    if not rows:
        return f'{svg_open(width, height)}<rect width="{width}" height="{height}" fill="{SURFACE}"/><text x="{width/2}" y="{height/2}" text-anchor="middle" fill="{INK_MUTED}" font-size="12">無資料</text></svg>'

    vals = [float(r["predicted_pct"]) for r in rows] + [float(r["actual_pct"]) for r in rows]
    vmin, vmax = min(vals + [0]), max(vals + [0])
    span = max(vmax - vmin, 1e-6)
    vmin -= span * 0.1
    vmax += span * 0.1

    def sx(v): return pad_l + (v - vmin) / (vmax - vmin) * plot_w
    def sy(v): return pad_t + (1 - (v - vmin) / (vmax - vmin)) * plot_h

    parts = [svg_open(width, height)]
    parts.append(f'<rect width="{width}" height="{height}" fill="{SURFACE}"/>')
    # y=x reference line
    parts.append(f'<line x1="{sx(vmin):.1f}" y1="{sy(vmin):.1f}" x2="{sx(vmax):.1f}" y2="{sy(vmax):.1f}" stroke="{GRID}" stroke-width="1.5" stroke-dasharray="4,3"/>')
    parts.append(f'<line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{height-pad_b}" stroke="{INK_MUTED}" stroke-width="1"/>')
    parts.append(f'<line x1="{pad_l}" y1="{height-pad_b}" x2="{width-pad_r}" y2="{height-pad_b}" stroke="{INK_MUTED}" stroke-width="1"/>')
    for r in rows:
        hit = r["hit"] == "True"
        cx, cy = sx(float(r["predicted_pct"])), sy(float(r["actual_pct"]))
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="4.5" fill="{color}" fill-opacity="{"0.85" if hit else "0.35"}" stroke="{color}" stroke-width="1"/>')
    parts.append(f'<text x="{pad_l}" y="14" font-size="12" fill="{INK_SECONDARY}">{arm} 組：預測 vs 實際（%）</text>')
    parts.append(f'<text x="{width/2}" y="{height-6}" text-anchor="middle" font-size="11" fill="{INK_MUTED}">預測漲跌幅</text>')
    parts.append(f'<text x="12" y="{height/2}" text-anchor="middle" font-size="11" fill="{INK_MUTED}" transform="rotate(-90 12 {height/2})">實際漲跌幅</text>')
    parts.append("</svg>")
    return "".join(parts)


def hit_rate_bar_chart(h20_metrics: dict, h5_metrics: dict, width=460, height=280) -> str:
    """h20/h5 × A/對照臂/always_up 命中率長條比較。"""
    pad_l, pad_r, pad_t, pad_b = 44, 16, 16, 44
    plot_w, plot_h = width - pad_l - pad_r, height - pad_t - pad_b

    c20, c5 = cmp_arm_of(h20_metrics), cmp_arm_of(h5_metrics)
    groups = [
        ("h20 · A", h20_metrics["arms"]["A"]["hit_rate"], COL_BLUE),
        (f"h20 · {c20}", h20_metrics["arms"][c20]["hit_rate"], COL_ORANGE),
        ("h20 · 基準", h20_metrics["baselines"]["always_up"]["hit_rate"], COL_GRAY),
        ("h5 · A", h5_metrics["arms"]["A"]["hit_rate"], COL_BLUE),
        (f"h5 · {c5}", h5_metrics["arms"][c5]["hit_rate"], COL_ORANGE),
        ("h5 · 基準", h5_metrics["baselines"]["always_up"]["hit_rate"], COL_GRAY),
    ]
    bar_w = plot_w / len(groups) * 0.6
    gap = plot_w / len(groups)

    def y(v): return pad_t + (1 - v) * plot_h

    parts = [svg_open(width, height)]
    parts.append(f'<rect width="{width}" height="{height}" fill="{SURFACE}"/>')
    for frac in (0, 0.25, 0.5, 0.75, 1.0):
        gy = y(frac)
        parts.append(f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{width-pad_r}" y2="{gy:.1f}" stroke="{GRID}" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l-8}" y="{gy+4:.1f}" text-anchor="end" font-size="10" fill="{INK_MUTED}">{int(frac*100)}%</text>')

    for i, (label, val, color) in enumerate(groups):
        cx = pad_l + gap * i + gap / 2
        bx = cx - bar_w / 2
        by = y(val)
        bh = height - pad_b - by
        parts.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bar_w:.1f}" height="{bh:.1f}" rx="3" fill="{color}"/>')
        parts.append(f'<text x="{cx:.1f}" y="{by-4:.1f}" text-anchor="middle" font-size="10" fill="{INK_SECONDARY}">{val*100:.1f}%</text>')
        parts.append(f'<text x="{cx:.1f}" y="{height-pad_b+14:.1f}" text-anchor="middle" font-size="10" fill="{INK_MUTED}">{label}</text>')
    parts.append(f'<text x="{pad_l}" y="14" font-size="12" fill="{INK_SECONDARY}">方向命中率比較（A / B / always_up 基準線）</text>')
    parts.append("</svg>")
    return "".join(parts)


# ---------------- HTML 組裝 ----------------

def fmt_pct(v) -> str:
    return f"{v*100:.1f}%" if v is not None else "—"


def coverage_table(metrics: dict) -> str:
    cov = metrics["coverage"]
    cmp_arm = cmp_arm_of(metrics)
    dist = cov["n_digests_used_distribution"]
    dist_str = "、".join(f"{k}份×{v}筆" for k, v in sorted(dist.items()))
    dist_row = (f"<tr><td>{ARM_LABELS.get(cmp_arm, cmp_arm)} 疊加週摘要份數分佈</td><td>{dist_str}</td></tr>"
                if cmp_arm == "B" else "")
    denom = cov["n_decision_points"] or 1
    return f"""
    <table class="tbl">
      <tr><td>決策點總數</td><td>{cov['n_decision_points']}</td></tr>
      <tr><td>有效樣本（兩臂皆成功）</td><td>{cov['n_valid_as_of']}</td></tr>
      <tr><td>因 LLM 失敗排除</td><td>{cov['n_llm_failed_as_of']}</td></tr>
      <tr><td>涵蓋率</td><td>{cov['n_valid_as_of']/denom*100:.1f}%</td></tr>
      {dist_row}
    </table>"""


def band_sensitivity_table(metrics: dict) -> str:
    bs = metrics["band_sensitivity"]
    cmp_arm = cmp_arm_of(metrics)
    rows = "".join(
        f"<tr><td>±{k.split('_')[1]}%</td><td>{fmt_pct(v['A'])}</td><td>{fmt_pct(v.get(cmp_arm))}</td></tr>"
        for k, v in bs.items()
    )
    return f"""
    <table class="tbl">
      <tr><th>中性帶</th><th>{ARM_LABELS['A']} 命中率</th><th>{ARM_LABELS.get(cmp_arm, cmp_arm)} 命中率</th></tr>
      {rows}
    </table>"""


def verdict_block(metrics: dict) -> str:
    """h20 主結論的雙條件方向制判定（僅 A/L 對照的 metrics 有 verdict/relative_to_always_up）。"""
    v = metrics.get("verdict")
    if not v:
        return ""
    rel = metrics.get("relative_to_always_up", {})
    cmp_arm = v["cmp_arm"]
    mc = metrics["mcnemar_sign_test"]
    icon = lambda ok: "✅" if ok else "❌"
    passed_txt = {True: "有效", False: "不確定 / 無效"}[v["passed"]]
    return f"""
    <table class="tbl">
      <tr><th>判定條件</th><th>結果</th></tr>
      <tr><td>cond1：{cmp_arm} 命中率 − always_up &gt; 0</td>
          <td>{icon(v['cond1_beats_always_up'])} {cmp_arm} 相對 always_up {rel.get(cmp_arm, 0):+.3f}</td></tr>
      <tr><td>cond2：{cmp_arm} 勝次數 ≥ 1.5 × A 勝次數</td>
          <td>{icon(v['cond2_wins_ratio'])} {cmp_arm} 勝 {mc['b_wins']} / A 勝 {mc['a_wins']}（p={mc['p_value']}）</td></tr>
      <tr><td><strong>綜合判定（h20）</strong></td><td><strong>{icon(v['passed'])} {passed_txt}</strong></td></tr>
    </table>
    <p class="skip">p 值僅供參考，不作為門檻（樣本數不足以達到 p&lt;0.05）。</p>"""


def methodology_section(methodology: dict, train_log: dict) -> str:
    """規則表 + 每 round held-out 命中率（來自 methodology_trainer 的產出）。"""
    m = methodology
    rule_rows = "".join(
        f"<tr><td>{r.get('id','')}</td><td>{r.get('signal','')}</td><td>{r.get('condition','')}</td>"
        f"<td>{r.get('expected_effect','')}</td><td>{r.get('confidence','')}</td>"
        f"<td>{'、'.join(r.get('evidence_case_ids', []))}</td></tr>"
        for r in m.get("rules", [])
    )
    regime = "".join(f"<li>{x}</li>" for x in m.get("regime_rules", []))
    anti = "".join(f"<li>{x}</li>" for x in m.get("anti_patterns", []))
    rounds = train_log.get("rounds", [])
    best_k = train_log.get("best")
    round_rows = "".join(
        f"<tr><td>v{r['k']}{'（best）' if r['k']==best_k else ''}</td>"
        f"<td>{fmt_pct(r['heldout_h20'])}（n={r.get('heldout_n_h20','?')}）</td>"
        f"<td>{fmt_pct(r['heldout_h5'])}</td>"
        f"<td>{fmt_pct(r.get('always_up_h20_heldout'))}</td>"
        f"<td>{fmt_pct(r['batch1_h20'])}</td><td>{r.get('n_misses_h20','?')}</td></tr>"
        for r in rounds
    )
    cfg = train_log.get("config", {})
    return f"""
    <p><strong>方法論核心</strong>：{m.get('summary', '（無）')}</p>
    <h4>市場狀態判準（regime rules）</h4><ul>{regime or '<li>（無）</li>'}</ul>
    <h4>預測規則</h4>
    <table class="tbl">
      <tr><th>id</th><th>訊號</th><th>條件</th><th>預期效果</th><th>信心</th><th>證據案例</th></tr>
      {rule_rows or '<tr><td colspan="6" class="skip">（無規則）</td></tr>'}
    </table>
    <h4>反例（anti-patterns）</h4><ul>{anti or '<li>（無）</li>'}</ul>
    <h4>訓練過程：每輪 held-out 命中率</h4>
    <p class="skip">訓練期 {cfg.get('train_start','?')}~{cfg.get('train_end','?')}，
      {cfg.get('n_cases','?')} 個案例（歸納 {cfg.get('n_batch1','?')} / held-out {cfg.get('n_batch2','?')}），
      模型 {cfg.get('model','?')}。held-out 已參與修正迴圈，best 選擇略偏樂觀；2025 才是乾淨測試。</p>
    <table class="tbl">
      <tr><th>版本</th><th>held-out h20</th><th>held-out h5</th><th>held-out always_up</th>
          <th>batch_1 h20（過擬合檢查）</th><th>餵入 miss 數</th></tr>
      {round_rows}
    </table>"""


def decisions_table(decisions: list[dict], cmp_arm: str = "B", limit=None) -> str:
    rows_html = []
    by_as_of: dict[str, dict] = {}
    for d in decisions:
        by_as_of.setdefault(d["as_of"], {})[d["arm"]] = d
    items = sorted(by_as_of.items())
    if limit:
        items = items[:limit]
    for as_of, arms in items:
        a, b = arms.get("A"), arms.get(cmp_arm)
        def cell(r):
            if r is None:
                return "<td>—</td><td>—</td>"
            if r["skipped_reason"]:
                return f'<td colspan="2" class="skip">略過（{r["skipped_reason"]}）</td>'
            hit = "✅" if r["hit"] == "True" else "❌"
            return f'<td>{float(r["predicted_pct"]):+.2f}% ({r["predicted_dir"]})</td><td>{hit}</td>'
        actual = a or b
        actual_str = f'{float(actual["actual_pct"]):+.2f}% ({actual["actual_dir"]})' if actual else "—"
        rows_html.append(
            f"<tr><td>{as_of}</td><td>{actual_str}</td>{cell(a)}{cell(b)}</tr>"
        )
    cl = ARM_LABELS.get(cmp_arm, cmp_arm)
    return f"""
    <table class="tbl decisions">
      <tr><th>as_of</th><th>實際</th><th>{ARM_LABELS['A']} 預測</th><th>命中</th><th>{cl} 預測</th><th>命中</th></tr>
      {''.join(rows_html)}
    </table>"""


def build_report(h20: dict, h5: dict, inventory_md: str, changes_md: str,
                 methodology: dict | None = None, train_log: dict | None = None) -> str:
    m20, m5 = h20["metrics"], h5["metrics"]
    d20, d5 = h20["decisions"], h5["decisions"]
    c20, c5 = cmp_arm_of(m20), cmp_arm_of(m5)
    is_learned = c20 == "L"
    cmp_label = ARM_LABELS.get(c20, c20)

    chart_cum20 = cumulative_hit_rate_chart(d20, c20)
    chart_cum5 = cumulative_hit_rate_chart(d5, c5)
    chart_scatter_a20 = predicted_vs_actual_scatter(d20, "A", COL_BLUE)
    chart_scatter_b20 = predicted_vs_actual_scatter(d20, c20, COL_ORANGE)
    chart_bar = hit_rate_bar_chart(m20, m5)

    methodology_html = ""
    if is_learned and methodology is not None and train_log is not None:
        methodology_html = f"""
  <h2>2b. 學到的預測方法論</h2>
  <div class="card">{methodology_section(methodology, train_log)}</div>"""
    verdict_html = ""
    if m20.get("verdict"):
        verdict_html = f"""
  <h3>雙條件方向制判定（h20 主結論）</h3>
  <div class="card">{verdict_block(m20)}</div>"""

    import re
    def md_to_html(md: str) -> str:
        html = md
        html = re.sub(r"^### (.*)$", r"<h4>\1</h4>", html, flags=re.M)
        html = re.sub(r"^## (.*)$", r"<h3>\1</h3>", html, flags=re.M)
        html = re.sub(r"\*\*(.*?)\*\*", r"<strong>\1</strong>", html)
        html = re.sub(r"^- (.*)$", r"<li>\1</li>", html, flags=re.M)
        html = re.sub(r"(<li>.*</li>\n?)+", lambda mm: "<ul>" + mm.group(0) + "</ul>", html)
        html = "\n".join(f"<p>{line}</p>" if line.strip() and not line.lstrip().startswith("<") else line
                          for line in html.split("\n"))
        return html

    stock = m20.get("config", {}).get("stock", "2330")
    yr = f"{m20.get('config', {}).get('start', '?')[:4]}"
    if is_learned:
        page_title = f"{stock} 學到的預測方法論回測報告"
        subtitle = f"訓練期歸納的方法論 prompt（L）vs 現行 prompt（A）：{yr} 全年週頻 A/L 對照"
        design_li = (f"<li><strong>對照設計</strong>：A 組 = 現行 CoT prompt（<code>backtest_digest_eval.DEFAULT_PROMPT_TEMPLATE</code>）；"
                     f"L 組 = 訓練期讓 LLM 從歷史案例歸納出的方法論 prompt。兩組用<strong>同一批 Qdrant 語意檢索的新聞、同一個模型</strong>，"
                     f"唯一差別是 prompt。訓練期與測試期<strong>嚴格時間切分</strong>，訓練不碰測試期任何資料。</li>")
        news_li = "<li><strong>新聞來源</strong>：Qdrant 語意 point-in-time 檢索（<code>fetch_pit_articles</code>），前 14 天窗口，非 analysis_digests 快照。</li>"
    else:
        page_title = f"{stock} 回測成果報告：digest 疊加是否提升 AI 預測命中率"
        subtitle = f"digest 疊加是否提升方向命中率？{yr} 全年週頻 A/B 對照實驗"
        design_li = ("<li><strong>對照設計</strong>：A 組 = 該決策點（as_of）digest 紀錄裡 <code>news_json</code> 的完整新聞內文（不截斷）＋技術面；"
                     "B 組 = A 組 + 額外疊加最近 4 週（含當週）的 <code>analysis_digests</code> 週摘要。B 是 A 的超集，測的是「多給一份消化過的摘要有沒有幫助」。</li>")
        news_li = ""

    # 核心結論 callout（A/L 學習報告專用；依 verdict 產生對應敘事）
    conclusion_html = ""
    if is_learned and m20.get("verdict") is not None:
        a20, l20 = m20["arms"]["A"]["hit_rate"], m20["arms"][c20]["hit_rate"]
        au20 = m20["baselines"]["always_up"]["hit_rate"]
        rel = m20["relative_to_always_up"]
        mc = m20["mcnemar_sign_test"]
        mae_a, mae_l = m20["arms"]["A"]["mae"], m20["arms"][c20]["mae"]
        n5 = m5["coverage"]["n_valid_as_of"]
        a5, l5 = m5["arms"]["A"]["hit_rate"], m5["arms"][c20]["hit_rate"]
        verdict_word = ("通過——學到的方法論 prompt 在雙條件下優於現行 prompt"
                        if m20["verdict"]["passed"] else
                        "未通過——學到的方法論 prompt 並未優於現行 prompt")
        hz = m20["config"].get("horizon", 20)
        conclusion_html = f"""
  <div class="callout">
    <strong>核心結論（h20 主結論）</strong>：判定{verdict_word}。
    在 {yr} 全年 {m20['coverage']['n_valid_as_of']} 個週頻決策點上，L（訓練期歸納的方法論 prompt）方向命中率
    {fmt_pct(l20)}、A（現行 prompt）{fmt_pct(a20)}，兩者<strong>都大幅低於「無腦看漲」（always_up）基準線
    {fmt_pct(au20)}</strong>（L 相對基準線 {rel[c20]:+.1%}、A {rel['A']:+.1%}）。McNemar 成對比較
    L 勝 {mc['b_wins']} / A 勝 {mc['a_wins']}（p={mc['p_value']}），方向上<strong>反而是 A 略勝</strong>。
    L 的幅度誤差（MAE {mae_l}）明顯高於 A（{mae_a}）——L 學到了訓練年（2024，多頭）「AI 動能＝大漲」的幅度預期，
    套用到 {yr} 反而更離譜。h5 穩健性對照（{n5} 點，L {fmt_pct(l5)} / A {fmt_pct(a5)}）方向一致。
    <br><br>
    <strong>為什麼</strong>：{yr} 全年 2330 走勢極端（上半年關稅急跌、單週跌逾 15%；下半年 AI 狂噴、單週漲逾 20%），
    大多數週的實際 {hz} 日漲跌幅遠超 ±{m20['config']['neutral_band']}% 中性帶。
    LLM 對「幅度」的預測能力不足，即使方向判對，保守的幅度估計也會落進中性帶被判失敗；
    用單一多頭年訓練出的方法論，遇到修正段會系統性做多。這是<strong>乾淨的負面結果</strong>：
    現有 LLM 預測管線（無論現行 prompt 或訓練優化版）在這類高波動年份，尚未證明比最簡單的基準線更準。
  </div>"""

    return f"""
<title>{page_title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {{ color-scheme: light; }}
  .report-root {{
    --surface-1: #fcfcfb; --page: #f9f9f7; --text-primary: #0b0b0b; --text-secondary: #52514e;
    --muted: #898781; --grid: #e1e0d9; --border: rgba(11,11,11,0.10);
    background: var(--page); color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    max-width: 960px; margin: 0 auto; padding: 32px 20px 80px;
    line-height: 1.65;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:where(:not([data-theme="light"])) .report-root {{
      --surface-1: #1a1a19; --page: #0d0d0d; --text-primary: #ffffff; --text-secondary: #c3c2b7;
      --muted: #898781; --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
    }}
  }}
  :root[data-theme="dark"] .report-root {{
    --surface-1: #1a1a19; --page: #0d0d0d; --text-primary: #ffffff; --text-secondary: #c3c2b7;
    --muted: #898781; --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
  }}
  .report-root h1 {{ font-size: 1.6rem; margin-bottom: 4px; }}
  .report-root h2 {{ font-size: 1.25rem; margin-top: 40px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }}
  .report-root h3 {{ font-size: 1.05rem; margin-top: 24px; }}
  .report-root h4 {{ font-size: 0.95rem; margin-top: 16px; color: var(--text-secondary); }}
  .subtitle {{ color: var(--text-secondary); margin-bottom: 24px; }}
  .card {{ background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin: 16px 0; overflow-x: auto; }}
  .callout {{ background: var(--surface-1); border-left: 3px solid #eda100; border-radius: 8px; padding: 14px 18px; margin: 16px 0; font-size: 0.92rem; }}
  .grid2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
  @media (max-width: 640px) {{ .grid2 {{ grid-template-columns: 1fr; }} }}
  .tbl {{ width: 100%; border-collapse: collapse; font-size: 0.88rem; }}
  .tbl th, .tbl td {{ text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--grid); }}
  .tbl th {{ color: var(--text-secondary); font-weight: 600; }}
  .tbl.decisions {{ font-size: 0.82rem; }}
  .skip {{ color: var(--muted); font-style: italic; }}
  .stat-row {{ display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0; }}
  .stat-tile {{ background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 12px 18px; min-width: 140px; }}
  .stat-tile .label {{ font-size: 0.78rem; color: var(--muted); }}
  .stat-tile .value {{ font-size: 1.4rem; font-weight: 600; margin-top: 2px; }}
  .tag {{ display: inline-block; font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: var(--grid); color: var(--text-secondary); margin-left: 8px; }}
  code {{ background: var(--grid); padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }}
  ul {{ padding-left: 22px; }}
</style>

<div class="report-root">
  <h1>{page_title}</h1>
  <p class="subtitle">{subtitle}</p>
  {conclusion_html}
  <h2>1. 摘要數字</h2>
  <div class="stat-row">
    <div class="stat-tile"><div class="label">h20 · {ARM_LABELS['A']} 命中率</div><div class="value">{fmt_pct(m20['arms']['A']['hit_rate'])}</div></div>
    <div class="stat-tile"><div class="label">h20 · {cmp_label} 命中率</div><div class="value">{fmt_pct(m20['arms'][c20]['hit_rate'])}</div></div>
    <div class="stat-tile"><div class="label">h20 · always_up 基準</div><div class="value">{fmt_pct(m20['baselines']['always_up']['hit_rate'])}</div></div>
    <div class="stat-tile"><div class="label">h20 · McNemar p</div><div class="value">{m20['mcnemar_sign_test']['p_value']}</div></div>
  </div>
  <div class="stat-row">
    <div class="stat-tile"><div class="label">h5 · {ARM_LABELS['A']} 命中率</div><div class="value">{fmt_pct(m5['arms']['A']['hit_rate'])}</div></div>
    <div class="stat-tile"><div class="label">h5 · {ARM_LABELS.get(c5, c5)} 命中率</div><div class="value">{fmt_pct(m5['arms'][c5]['hit_rate'])}</div></div>
    <div class="stat-tile"><div class="label">h5 · always_up 基準</div><div class="value">{fmt_pct(m5['baselines']['always_up']['hit_rate'])}</div></div>
    <div class="stat-tile"><div class="label">h5 · McNemar p</div><div class="value">{m5['mcnemar_sign_test']['p_value']}</div></div>
  </div>

  <div class="card">{chart_bar}</div>
  {verdict_html}
  <h2>2. 方法論</h2>
  <ul>
    {design_li}
    {news_li}
    <li><strong>Point-in-time 防洩漏</strong>：組 context 時只用 pub_time ≤ as_of 的新聞；實際漲跌只用 as_of 之後的收盤價。</li>
    <li><strong>命中定義</strong>：三分類 up/flat/down，h20 中性帶 ±3%、h5 ±1%；下方附帶寬敏感度（h20：±1.5/2/3/4%）。</li>
    <li><strong>horizon</strong>：主結論 h20（20 個交易日，對齊線上 <code>/api/trend_predict</code>），另跑 h5（5 個交易日）當穩健性對照。</li>
    <li><strong>基準線</strong>：always_up / always_down / random（seed=42）。多頭年 always_up 會很強，敘事以「相對 always_up」為主軸。</li>
    <li><strong>統計檢定</strong>：McNemar 符號檢定（雙尾），比較兩臂在同一批錨點上的配對命中差異。</li>
    <li><strong>失敗處理</strong>：LLM 呼叫失敗重試 1 次，仍失敗則該 as_of 兩臂成對排除，維持配對比較公平。</li>
  </ul>
  {methodology_html}
  <h2>3. h20（主結論，horizon=20 交易日）</h2>
  <div class="card">{chart_cum20}</div>
  <div class="grid2">
    <div class="card">{chart_scatter_a20}</div>
    <div class="card">{chart_scatter_b20}</div>
  </div>
  <h3>涵蓋率</h3>
  <div class="card">{coverage_table(m20)}</div>
  <h3>中性帶敏感度</h3>
  <div class="card">{band_sensitivity_table(m20)}</div>

  <h2>4. h5（穩健性對照，horizon=5 交易日）</h2>
  <div class="card">{chart_cum5}</div>
  <h3>涵蓋率</h3>
  <div class="card">{coverage_table(m5)}</div>
  <h3>中性帶敏感度</h3>
  <div class="card">{band_sensitivity_table(m5)}</div>

  <h2>5. 逐筆決策明細</h2>
  <h3>h20</h3>
  <div class="card">{decisions_table(d20)}</div>
  <h3>h5</h3>
  <div class="card">{decisions_table(d5)}</div>

  <h2>6. AI QA 功能盤點</h2>
  <div class="card">{md_to_html(inventory_md)}</div>

  <h2>7. 近期團隊變更</h2>
  <div class="card">{md_to_html(changes_md)}</div>

  <h2>8. 誠實的 caveat</h2>
  <ul>
    <li>單一股票（{stock}）、單一年度（{yr}），結論不能外推到其他股票或空頭年份。</li>
    <li>週頻錨點 × {m20.get('config', {}).get('horizon', 20)} 日預測窗口 → 相鄰決策點的答案窗口高度重疊，樣本<strong>不獨立</strong>，不能宣稱「{m20['coverage']['n_valid_as_of']} 個獨立樣本」。</li>
    <li>約 {m20['coverage']['n_valid_as_of']} 個有效樣本，McNemar 需 10+ 不一致對才有檢定力；<strong>p&gt;0.05 是預期結果</strong>，即使效果真實存在。判定改看「相對 always_up」與「勝負比例方向」。</li>
    {"<li>訓練期 held-out 已參與修正迴圈，"
     "「best」選擇略偏樂觀；<strong>2025 測試期才是唯一乾淨的驗證</strong>。方法論規則可能過擬合 " + yr + " 的行情特性。</li>"
     if is_learned else
     "<li>分析師層（moneydj/CMoney）資料目前為空，對照臂只包含新聞消化，未包含分析師觀點。</li>"}
  </ul>
</div>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--h20-dir", required=True)
    ap.add_argument("--h5-dir", required=True)
    ap.add_argument("--out", default="backtest_report.html")
    ap.add_argument("--inventory-md", default=None, help="AI QA 功能盤點 markdown 檔路徑")
    ap.add_argument("--changes-md", default=None, help="近期團隊變更 markdown 檔路徑")
    ap.add_argument("--methodology-dir", default=None,
                    help="methodology_trainer 的輸出目錄（A/L 對照報告才需要，加 methodology 章節）")
    args = ap.parse_args()

    h20 = load_run(Path(args.h20_dir))
    h5 = load_run(Path(args.h5_dir))

    inventory_md = Path(args.inventory_md).read_text() if args.inventory_md else DEFAULT_INVENTORY_MD
    changes_md = Path(args.changes_md).read_text() if args.changes_md else DEFAULT_CHANGES_MD

    methodology = train_log = None
    if args.methodology_dir:
        md = Path(args.methodology_dir)
        best = json.loads((md / "best.json").read_text())
        methodology = json.loads((md / best["methodology"]).read_text())
        train_log = json.loads((md / "train_log.json").read_text())

    html = build_report(h20, h5, inventory_md, changes_md, methodology, train_log)
    Path(args.out).write_text(html, encoding="utf-8")
    print(f"報告已產生：{args.out}")


DEFAULT_INVENTORY_MD = """
本專案目前對外提供的 RAG AI 問答相關功能：

- **`/api/ask`（含 SSE 串流版）**：核心問答端點。AI Intent Classifier（meta/llama3-70b-instruct）判斷是否為財經問題、
  涉及哪些股票、時間範圍；查詢 Qdrant 向量庫（`news_chunks` collection，10,913+ 篇文章切塊）並依時間加權排序；
  分析 LLM（meta/llama-3.3-70b-instruct）生成回答，記錄於 MySQL `qa_logs`。
- **`/api/trend_predict`（含 SSE 逐週版）**：股價走勢 AI 預測。加權線性迴歸 + 動能/均值回歸曲線 + 近 30 天新聞情緒，
  預測未來 20 個交易日。目前為即時查詢，預測結果不落地，本次回測正是為了補上這塊「無法回頭驗證準確率」的缺口。
- **`analysis_digests`（週期性個股分析總結）**：離線預建的「消化過」個股分析（新聞面/技術面/綜合研判/重點），
  透過 `build_analysis_digests.py` 離線批次產生，供本次回測與未來 `/api/ask` 可能的 digest 注入使用。
- **`/api/news`、`/api/stocks`、`/api/history`**：新聞瀏覽、股票清單、歷史問答紀錄查詢端點。
"""

DEFAULT_CHANGES_MD = """
近期（main 分支）團隊改動摘要：

- **DB 整合**：`rag_deploy` 與 `backend` 原本各自的 MySQL（`rag_logs` / 獨立股價庫）已合併為同一個 `topic_stock` 資料庫，
  同庫不同表，schema 互不相通。
- **排程整合**：`backend/crawler/scheduler_utils.py` 統一管理 cnyes、LTN、FinMind 三個排程來源，
  新聞抓取完成後延遲觸發向量化管線（切塊 → embedding）。
- **新聞噪音過濾**：`api_server.py` 新增 `_is_quote_noise` / `_is_market_noise` / `_is_market_context` 等過濾函式，
  提升 `/api/analyze` 的新聞品質。
- **架構重寫**：LTN、cnyes 爬蟲改為直接 upsert 進 MySQL `news_articles`（不再經 CSV 中介），移除舊版情境推演與冗餘函式。
- **本次回測順帶發現並修復的問題**：合併新架構後 `backend/.env` 未隨之建立，導致 LTN／cnyes 爬蟲以錯誤的資料庫帳密
  連線、失敗訊息被吞掉、排程 log 顯示「成功」但實際上超過一個月沒有新資料寫入 MySQL。已建立 `backend/.env` 並驗證修復。
"""


if __name__ == "__main__":
    main()
