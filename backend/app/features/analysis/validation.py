"""Pure normalization and compliance gates for the public brief."""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any
from pydantic import ValidationError
from .schemas import (RawStockBehaviorTextBrief, RawTextBriefClaim, RawTextBriefForwardView,
    RawTextBriefKeyDay, RawTextBriefRisk, RawTextBriefWatchPoint, StockBehaviorTextBrief,
    TextBriefClaim, TextBriefForwardView, TextBriefKeyDay, TextBriefRisk, TextBriefWatchPoint)
from .compliance import ComplianceHit, scan_compliance_hits
from .evidence import EvidenceBundle
from app.features.retrieval.common import TAIPEI, get_source_name, parse_timestamp
from datetime import date, datetime, timedelta

MAX_LLM_NEWS_SOURCES = 20
ANALYSIS_LANGUAGE = "zh-TW"
RAG_DEFAULT_NEWS_LOOKBACK_DAYS = 60
RAG_DEFAULT_MAX_NEWS_EVENTS = 20
NEWS_SUMMARY_CHARS: int | None = None
TEXT_BRIEF_SCHEMA_VERSION = "text-first-v1"
TEXT_BRIEF_TARGET_COUNTS = {"key_days": 3, "watch_points": 2}
TEXT_BRIEF_MAX_COUNTS = {
    "key_days": 5,
    "current_status": 3,
    "positive_factors": 3,
    "negative_factors": 3,
    "source_divergences": 3,
    "risks": 3,
    "watch_points": 4,
    "limitations": 5,
}
JARGON_TERMS_RE = re.compile(
    r"MACD|RSI|KDJ|KD值|KD|布林(?:通道|線)?|乖離|黃金交叉|死亡交叉|K值|D值|J值|"
    r"隨機指標|相對強弱|指數平滑異同"
)
FORWARD_CONDITION_KEYS = frozenset({"trigger", "invalidation"})
FORWARD_PRICE_RE = re.compile(r"(?<![\d.,])([\d.,]+(?:\s*(?:至|到|[-–—~～、/]|及|與|和|或)\s*[\d.,]+)*)\s*(?:元|塊)")
TEXT_BRIEF_NUMBER_TOLERANCE_PP = 0.1
TEXT_BRIEF_NO_GUIDANCE_LIMITATION = "本分析未涵蓋公司自提財測，展望類資訊僅來自媒體報導。"
TEXT_BRIEF_DISCLAIMER_VERSION = "v1"
TEXT_BRIEF_DISCLAIMER_TEXT = (
    "本內容由 AI 系統彙整公開資訊自動產生，僅供參考，不構成投資建議或個股買賣依據；"
    "投資人應自行獨立判斷並自負投資風險。行情與公告請以臺灣證券交易所、"
    "證券櫃檯買賣中心及公開資訊觀測站公告為準。"
)
TEXT_BRIEF_UNAVAILABLE_MESSAGE = "模型輸出無法解析，本次無法提供簡報。"
TEXT_BRIEF_COMPLIANCE_UNAVAILABLE_MESSAGE = "簡報內容未通過合規檢查，本次無法提供。"
TEXT_BRIEF_CACHE_MISS_LIMITATION = "目前沒有可用的已存 AI 分析，排程更新後才會出現。"
TEXT_BRIEF_ITEM_SECTIONS = (
    "key_days",
    "current_status",
    "positive_factors",
    "negative_factors",
    "source_divergences",
    "risks",
    "watch_points",
)
TEXT_BRIEF_COMPLIANCE_TEXT_KEYS = frozenset(
    {
        "text",
        "title",
        "description",
        "rationale",
        "headline",
        "statement",
        "confidence_reason",
        "what",
        "what_to_watch",
        "why_it_matters",
        "when",
        "trigger",
        "risk_type",
        "reason",
        "invalidation",
    }
)
PERCENT_IN_TEXT_RE = re.compile(r"([+-]?\d+(?:\.\d+)?)\s*%")


def _price_mentions(text: str, *, condition: bool = False):
    """Keep monetary facts such as EPS out of stock-price checks."""
    for match in FORWARD_PRICE_RE.finditer(text):
        start = max(text.rfind(char, 0, match.start()) for char in "。；;，,\n") + 1
        prefix = text[start:match.start()]
        end = min((pos for char in "。；;，,\n" if (pos := text.find(char, match.end())) >= 0), default=len(text))
        suffix = text[match.end():end]
        subjects = list(re.finditer(
            r"(?P<financial>EPS|每股盈餘|營收|獲利|盈餘|股利|盤價|產品售價)"
            r"|(?P<market>股價|收盤|價位|支撐|壓力|防守|買點|賣點|高點|低點)", prefix, re.I))
        if subjects:
            if subjects[-1].lastgroup == "market":
                yield match
        elif (condition or re.search(r"價格|突破|站上|跌破|守住|失守", prefix)
              or re.search(r"股價|收盤|價位|支撐|壓力|防守|買點|賣點", suffix)):
            yield match


def _is_price_scenario(text: str, match: re.Match) -> bool:
    start = max(text.rfind(char, 0, match.start()) for char in "。；;，,\n") + 1
    prefix = text[start:match.start()]
    markers = list(re.finditer(r"情境假設|假設門檻", prefix))
    return bool(markers) and not re.search(
        r"已(?:收盤|成交|突破|站上|跌破)|實際(?:收盤|成交)|收盤|歷史(?:高點|低點)",
        prefix[markers[-1].end():] if markers else prefix)


def _percentage_metric(text: str, match: re.Match) -> str | None:
    """Resolve the local metric, including labels placed after the percentage."""
    patterns = (
        (r"一年(?:高低)?區間|收盤價位置|年度高位|年度區間位置", "close_pos_in_1y_pct"),
        (r"二十日均線|20\s*日均?線|月線|vs_ma20_pct", "vs_ma20_pct"),
        (r"六十日均線|60\s*日均?線|季線|vs_ma60_pct", "vs_ma60_pct"),
        (r"二百四十日均線|240\s*日均?線|年線|vs_ma240_pct", "vs_ma240_pct"),
        (r"成交量|均量|量|vol_vs_ma5_pct", "vol_vs_ma5_pct"),
        (r"年增|年減|yoy_pct", "yoy_pct"), (r"月增|月減|mom_pct", "mom_pct"),
        (r"季增|季減|較前季|比上季|qoq_pct", "qoq_pct"),
        (r"毛利率|gross_margin_pct", "gross_margin_pct"),
        (r"營業利益率|operating_margin_pct", "operating_margin_pct"),
        (r"殖利率|dividend_yield", "dividend_yield"),
        (r"漲|跌|chg_pct", "chg_pct"),
        (r"分佈|百分位|排名|pct_rank_1y", "pct_rank_1y"),
    )
    prefix = re.split(r"[。；;，,\n]", text[:match.start()])[-1][-40:]
    suffix = text[match.end():]
    # Only a directly attached noun phrase can override the preceding label.
    for pattern, metric in patterns:
        if re.match(r"\s*(?:的)?\s*(?:現金)?(?:" + pattern + r")", suffix, re.I):
            return metric
    matches = [(found.end(), metric) for pattern, metric in patterns
               for found in re.finditer(pattern, prefix, re.I)]
    return max(matches, default=(0, None), key=lambda item: item[0])[1]


def _revenue_growth_values(row: dict, context: str) -> list[float]:
    history = {period: value for period, value in row.get("yoy_last6", [])
               if isinstance(value, (int, float))}
    months = list(re.finditer(r"(?:(\d{4})[-/年](\d{1,2})(?:月)?|(?<!\d)(\d{1,2})月)", context))
    if months:
        match = months[-1]
        year, month = match.group(1), int(match.group(2) or match.group(3))
        values = [value for period, value in history.items()
                  if period.endswith(f"-{month:02d}") and (not year or period.startswith(year + "-"))]
        if values:
            return values
        if row.get("period") != f"{year or str(row.get('period', ''))[:4]}-{month:02d}":
            return []
    elif re.search(r"(?:近|最近|過去|提供|資料|歷史)[^。；;]{0,12}(?:月份|月|筆)", context):
        return list(history.values())
    value = row.get("yoy_pct")
    if value is None:
        value = history.get(row.get("period"))
    return [value] if isinstance(value, (int, float)) else []


def _quote_covers_date(quote: str, event_date: str, published: str | None) -> bool:
    try:
        day = date.fromisoformat(event_date)
        explicit = (event_date, f"{day.year}年{day.month}月{day.day}日")
        if any(value in quote for value in explicit):
            return True
        published_day = date.fromisoformat((published or "")[:10])
        return "昨日" in quote and published_day - timedelta(days=1) == day
    except ValueError:
        return False


def _published_label(row: dict, as_of_date: date) -> str | None:
    """Reader-facing Taiwan time; a date-only stamp stays a date instead of gaining 00:00."""
    raw = str(row.get("published_at") or row.get("date") or "").strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            day, clock = date.fromisoformat(raw), None
        else:
            stamp = parse_timestamp(raw) if raw else None
            if stamp is None:
                return None
            day, clock = stamp.date(), stamp.strftime("%H:%M")
    except ValueError:
        return None
    label = day.strftime("%m/%d") if day.year == as_of_date.year else day.strftime("%Y/%m/%d")
    return f"{label} {clock}" if clock else label


def _news_support_issues(item: dict, news: list[dict], bundle: EvidenceBundle) -> list[str]:
    if not (item.get("id") or "what" in item or "stance" in item):
        return []
    if not news:
        return ["新聞支持契約未列入同項證據引用"] if item.get("news_support") else []
    by_id = {row["id"]: row for row in news}
    support = item.get("news_support") or []
    forward_view = "stance" in item
    support_ids = {entry.get("evidence_id") for entry in support}
    if support_ids - set(by_id) or (not forward_view and support_ids != set(by_id)):
        return ["新聞主張缺少同項原文支持契約"]
    issues = []
    if forward_view and set(by_id) - support_ids:
        issues.append("未核實逐篇新聞摘錄；方向推論依據已引用的新聞原文")
    if "what" not in item:
        texts = " ".join(str(item.get(key, "")) for key in TEXT_BRIEF_COMPLIANCE_TEXT_KEYS)
        # Forecasts may infer from the cited source, not only its selected excerpt.
        source_text = " ".join(str(row.get("value", "")) for row in news) if forward_view else " ".join(
            str(entry.get("quote", "")) for entry in support)
        terms = set(re.findall(r"\b[A-Z][A-Z0-9-]{2,}\b", texts)) - {"EPS", "TWD", "RSI", "MACD"}
        if any(term not in source_text for term in terms):
            return ["主張的產品或實體名稱不在同項引用來源" if forward_view else "主張的產品或實體名稱不在同項引文"]
    for entry in support:
        row = by_id.get(entry.get("evidence_id"))
        quote = entry.get("quote", "")
        if row is None or len(quote) < 4 or quote not in str(row.get("value", "")):
            return ["新聞主張引文不存在於引用片段"]
        event_date = entry.get("event_date")
        if event_date and not _quote_covers_date(quote, event_date, row.get("published_at")):
            texts = " ".join(str(item.get(key, "")) for key in TEXT_BRIEF_COMPLIANCE_TEXT_KEYS)
            try:
                day = date.fromisoformat(event_date)
            except ValueError:
                return ["事件日期未獲同段原文支持"]
            mentions_date = bool(re.search(
                rf"(?<!\d)(?:{day.year}[-/年])?0?{day.month}(?:[-/]|月)0?{day.day}(?:日)?(?!\d)", texts))
            if entry.get("use") == "retrospective" or mentions_date:
                return ["事件日期未獲同段原文支持"]
            entry["event_date"] = None
            event_date = None
            issues.append("未核實事件日期；已省略非必要的事件日期")
        if entry.get("use") == "retrospective" and (
                not event_date or item.get("date") and event_date != item["date"]):
            return ["回顧引用未支持指定事件日期"]
        if "what" in item:
            if entry.get("use") == "price_reaction":
                try:
                    stamp = datetime.fromisoformat(str(row.get("published_at", "")).replace("Z", "+00:00"))
                    timely = (stamp.tzinfo is not None
                              and stamp.astimezone(TAIPEI).date().isoformat() == item["date"]
                              and (stamp.astimezone(TAIPEI).hour, stamp.astimezone(TAIPEI).minute) < (13, 30)
                              and event_date == item["date"])
                except (ValueError, KeyError):
                    timely = False
                if not timely:
                    entry["use"] = "reported_fact"
                    issues.append("未核實消息與價格反應時間；已分列行情與報導")
            # The model's free-form cause is replaced, regardless of its verbs.
            # Exact source attribution retains facts without asserting market motives.
            observation = bundle.timeline_by_id().get(item.get("ref"), {})
            close = observation.get("close")
            price = f"收盤 {close:g} 元。" if isinstance(close, (int, float)) else "當日行情見資料。"
            published = _published_label(row, bundle.as_of_date)
            publisher = get_source_name(row.get("publisher") or "")
            role = "回顧" if entry.get("use") == "retrospective" else "報導"
            source = (f"{published} {publisher}{role}" if published
                      else f"{publisher}{role}（發布時間未知）")
            item["what"] = f"{price}{source}：「{quote}」。新聞和股價變動是否有關，未經核實。"
        else:
            texts = " ".join(str(item.get(key, "")) for key in TEXT_BRIEF_COMPLIANCE_TEXT_KEYS)
            source_text = str(row.get("value", ""))
            offset = source_text.index(quote)
            paragraph_start = source_text.rfind("\n", 0, offset) + 1
            paragraph_end = source_text.find("\n", offset + len(quote))
            paragraph = source_text[paragraph_start:paragraph_end if paragraph_end >= 0 else len(source_text)]
            aggregate = r"(?:\d+|多|各)家金控|金控(?:業|整體|合計)|整體金控|全體金控"
            if (re.search(aggregate, paragraph) and re.search(r"獲利|盈餘", quote)
                    and re.search(r"獲利|盈餘", texts) and not re.search(aggregate, texts)):
                return ["金控合計獲利未保留產業主詞，不能當成單一公司獲利"]
    return issues


def _grounding_issues(item: dict, bundle: EvidenceBundle) -> list[str]:
    """Reject known numeric/citation contradictions; this is not semantic verification."""
    refs = set(item.get("evidence_ids") or [])
    if item.get("ref"):
        refs.add(item["ref"])
    if not refs:
        if item.get("claim_type") != "limitation" and item.get("stance") != "uncertain":
            return ["缺少同項證據引用"]
    rows = [row for row in bundle.catalog() if row["id"] in refs]
    timeline = [row for row in bundle.daily_timeline if row["id"] in refs]
    issues = []
    news = [row for row in rows if row.get("field") == "news"]

    def dated(candidates, text, offset):
        dates = re.findall(r"\d{4}-\d{2}-\d{2}", text[:offset])
        target = dates[-1] if dates else None
        selected = []
        for row in candidates:
            row_target = target or (item.get("date") if row["id"].startswith("d_") else None)
            if not row_target or row.get("date") == row_target:
                selected.append(row)
        return selected

    issues.extend(_news_support_issues(item, news, bundle))
    for key in TEXT_BRIEF_COMPLIANCE_TEXT_KEYS:
        text = item.get(key)
        if not isinstance(text, str):
            continue
        if (re.search(r"(?:基本面|盤價|產品售價|出廠價|報價)[^。；;]{0,10}(?:調漲|調降)", text)
                and not news):
            issues.append("公司調價事件缺少同項新聞依據，行情與籌碼不能證明營運事件")
        if any(row.get("field") in {"per", "pbr", "dividend_yield"} for row in rows):
            for clause in re.split(r"[。；;，\n]", text):
                strong = re.search(r"(?:強大|強勁|堅實|穩固|強力)(?:的)?(?:下行|下檔|股價)?(?:支撐|保護)"
                                   r"|(?:下行|下檔)(?:支撐|保護)(?:穩固|強大|堅實)", clause)
                if strong and not re.search(r"不能|無法|未能|不代表|尚未證明", clause[:strong.start()]):
                    issues.append("估值與殖利率數值不能證明強大下行支撐，須保留有條件推論與限制")
        if key not in FORWARD_CONDITION_KEYS:
            for clause in re.split(r"[。；;，,\n]", text):
                if not re.search(r"營收[^。；;]{0,32}(?:年增|年減|年成長|年衰退|較去年|比去年)", clause):
                    continue
                if re.search(r"缺少|未提供|未取得|無法確認|無法判斷|資料不足|仍待確認|是否", clause):
                    continue
                growth = [value for row in rows if row.get("field") == "revenue_monthly"
                          for value in _revenue_growth_values(row, clause)]
                supported = bool(growth)
                if re.search(r"年增(?:率)?(?:強勁|亮眼)|年增(?:率)?(?:為|維持)?正|年成長", clause):
                    supported = any(value > 0 for value in growth)
                elif re.search(r"年減|年衰退|年增率(?:為|轉為)?負", clause):
                    supported = any(value < 0 for value in growth)
                quoted = any(re.search(r"營收[^。；;]{0,24}(?:年增|年減|年成長|年衰退|較去年|比去年)",
                                      str(entry.get("quote", ""))) for entry in item.get("news_support", [])
                             if entry.get("evidence_id") in {row["id"] for row in news})
                if not supported and not quoted:
                    issues.append("營收年增敘述缺少同項年增資料或原文，單月金額不能證明成長方向")
        for match in PERCENT_IN_TEXT_RE.finditer(text):
            number = float(match.group(1))
            prefix = text[max(0, match.start() - 24):match.start()]
            if not match.group(1).startswith(("+", "-")) and re.search(r"(?:下跌|下滑|減少|衰退|負成長|跌幅|重挫|年減|月減|季減)\s*$", prefix):
                number = -number
            metric = _percentage_metric(text, match)
            if metric in {"chg_pct", "vol_vs_ma5_pct", "vs_ma20_pct"}:
                candidates = [row.get(metric) for row in dated(timeline, text, match.start())]
            else:
                candidates = []
                for row in dated(rows, text, match.start()):
                    if metric in {"yoy_pct", "mom_pct", "qoq_pct"}:
                        if re.search(r"EPS|每股盈餘", prefix, re.I) and row.get("field") != "eps":
                            continue
                        if "營收" in prefix and row.get("field") != "revenue_monthly":
                            continue
                    if metric in {"yoy_pct", "mom_pct", "qoq_pct", "pct_rank_1y"}:
                        if metric == "yoy_pct" and row.get("field") == "revenue_monthly":
                            candidates.extend(_revenue_growth_values(row, prefix))
                        else:
                            candidates.append(row.get(metric))
                    elif metric and row.get("field") == metric:
                        candidates.append(row.get("value"))
            if not any(isinstance(value, (int, float)) and abs(number - value) <= 0.1 for value in candidates):
                quoted = any(any(abs(float(found.group(1)) - float(match.group(1))) <= TEXT_BRIEF_NUMBER_TOLERANCE_PP
                                 for found in PERCENT_IN_TEXT_RE.finditer(str(row.get("value", "")))) for row in news)
                if quoted:
                    issues.append(f"未核實新聞百分比語義：{match.group(0)}")
                else:
                    label = "未核實百分比指標" if metric is None else "百分比未獲同項證據支持"
                    issues.append(f"{label}：{match.group(0)}")
        for match in re.finditer(
                r"(?:EPS|每股盈餘)\s*(?:為|是|達|[:：]|較|比|低於|高於|跌破|超過)?\s*"
                r"(?:\d{4}\s*Q[1-4]\s*)?[（(]?\s*([+-]?\d+(?:\.\d+)?)(?![\d.Q])", text, re.I):
            number = float(match.group(1))
            if not any(row.get("field") == "eps" and isinstance(row.get("value"), (int, float))
                       and abs(row["value"] - number) <= 0.01 for row in dated(rows, text, match.start())):
                quoted = any(any(abs(float(found.group(1)) - number) <= 0.01
                                 for found in re.finditer(
                                     r"(?:EPS|每股盈餘)\s*(?:為|是|達)?\s*([+-]?\d+(?:\.\d+)?)",
                                     str(entry.get("quote", "")), re.I))
                             for entry in item.get("news_support", [])
                             if entry.get("evidence_id") in {row["id"] for row in news})
                issues.append("未核實新聞 EPS 期間與語義" if quoted else "EPS 未獲同項證據支持")
        for match in _price_mentions(text, condition=key in FORWARD_CONDITION_KEYS):
            clause_start = max(text.rfind(char, 0, match.start()) for char in "。；;\n") + 1
            clause_end = min((pos for char in "。；;\n" if (pos := text.find(char, match.end())) >= 0), default=len(text))
            clause = text[clause_start:clause_end]
            scenario = key in FORWARD_CONDITION_KEYS and _is_price_scenario(text, match)
            if scenario and any(ref in _historical_prices(bundle) for ref in refs):
                continue
            candidates = [row.get("close") for row in dated(timeline, text, match.start())]
            candidates += [row.get("value") for row in dated(rows, text, match.start())
                           if row.get("field") in {"high_1y", "low_1y"}]
            for amount in re.findall(r"[\d,]+(?:\.\d+)?", match.group(1)):
                number = float(amount.replace(",", ""))
                supported = any(isinstance(value, (int, float)) and abs(value - number) <= 0.01 for value in candidates)
                prefix = text[max(clause_start, match.start() - 8):match.start()]
                if key not in FORWARD_CONDITION_KEYS and not re.search(r"若|如果|將|預期|未來", clause):
                    closes = [row.get("close") for row in dated(timeline, text, match.start())]
                    if re.search(r"突破|站上", prefix):
                        supported |= any(isinstance(value, (int, float)) and value > number for value in closes)
                    elif "跌破" in prefix:
                        supported |= any(isinstance(value, (int, float)) and value < number for value in closes)
                if not supported:
                    issues.append("價格未獲同項證據支持")
        for match in re.finditer(r"(?:本益比|PER|P/E|股價淨值比|PBR|P/B)[^。；;\d]{0,16}([\d,]+(?:\.\d+)?)\s*倍", text, re.I):
            metric = "pbr" if re.match(r"股價淨值比|PBR|P/B", match.group(), re.I) else "per"
            number = float(match.group(1).replace(",", ""))
            metric_rows = [row for row in dated(rows, text, match.start()) if row.get("field") == metric]
            supported = any(isinstance(row.get("value"), (int, float)) and abs(row["value"] - number) <= 0.01
                            for row in metric_rows)
            quote_pattern = (r"(?:本益比|PER|P/E)" if metric == "per" else r"(?:股價淨值比|PBR|P/B)")
            supported |= any(any(float(found.group(1).replace(",", "")) == number for found in re.finditer(
                quote_pattern + r"[^。；;\d]{0,16}([\d,]+(?:\.\d+)?)\s*倍", str(entry.get("quote", "")), re.I))
                for entry in item.get("news_support", []) if entry.get("evidence_id") in refs)
            # A labeled scenario is a model assumption, not an observed valuation.
            prefix = re.split(r"[。；;\n]", text[:match.start()])[-1]
            scenario = (key in FORWARD_CONDITION_KEYS or item.get("claim_type") == "inference") and bool(
                re.search(r"情境假設|假設門檻", prefix)) and bool(metric_rows)
            if not supported and not scenario:
                issues.append("估值倍數未獲同項證據支持，情境門檻須明示為假設")
        if re.search(r"MACD|柱狀體", text, re.I):
            values = [row["macd_hist"] for row in sorted(timeline, key=lambda row: str(row.get("date", "")))
                      if isinstance(row.get("macd_hist"), (int, float))]
            checks = ((r"由負轉正", len(values) >= 2 and values[0] < 0 < values[-1]),
                      (r"由正轉負", len(values) >= 2 and values[0] > 0 > values[-1]),
                      (r"持續(?:擴大|增加|走高)", len(values) >= 2 and all(b > a for a, b in zip(values, values[1:]))),
                      (r"持續(?:縮小|下降|走低)", len(values) >= 2 and all(b < a for a, b in zip(values, values[1:]))))
            for pattern, supported in checks:
                indicator_clauses = [clause for clause in re.split(r"[。；;，\n]", text)
                                     if re.search(r"MACD|柱狀體", clause, re.I)]
                if any(re.search(pattern, clause) for clause in indicator_clauses) and not supported:
                    issues.append("MACD 趨勢未獲同項日期序列支持")
        for match in re.finditer(r"([+-]?\d[\d,]*(?:\.\d+)?)\s*張", text):
            number = float(match.group(1).replace(",", ""))
            start = max(text.rfind(char, 0, match.start()) for char in "。；;，\n") + 1
            prefix = text[start:match.start()]
            subjects = list(re.finditer(r"成交量|交易量|量能|外資|投信|自營商|法人", prefix))
            subject = subjects[-1].group() if subjects else None
            metric = {"成交量": "vol_lots", "交易量": "vol_lots", "量能": "vol_lots",
                      "外資": "foreign_net_lots", "投信": "trust_net_lots",
                      "自營商": "dealer_net_lots"}.get(subject)
            if metric is None:
                issues.append("未核實張數主詞，無法判定成交量或法人類別")
                continue
            metric_prefix = prefix[subjects[-1].end():]
            if metric != "vol_lots" and "賣超" in metric_prefix and not match.group(1).startswith(("+", "-")):
                number = -number
            ten_days = bool(re.search(r"(?:十|10)\s*(?:個)?(?:交易)?日", prefix))
            has_period = bool(re.search(r"(?:[二三四五六七八九十百]|\d+)\s*(?:個)?(?:交易)?日|累計|合計", prefix))
            candidates = ([row.get("value") for row in dated(rows, text, match.start())
                           if row.get("field") == "foreign_net_10d_lots"]
                          if ten_days and metric == "foreign_net_lots" else [] if has_period
                          else [row.get(metric) for row in dated(timeline, text, match.start())])
            assumption = bool(re.search(r"情境假設|假設門檻", prefix))
            conditional = key in FORWARD_CONDITION_KEYS and bool(re.search(r"若|如果|一旦|假設", prefix))
            if assumption and key in FORWARD_CONDITION_KEYS:
                context = ([row.get(metric) for row in timeline]
                           + [row.get("value") for row in rows
                              if metric == "foreign_net_lots" and row.get("field") == "foreign_net_10d_lots"])
                if any(isinstance(value, (int, float)) for value in context):
                    issues.append("未核實情境張數；門檻為分析假設，非已發生事實")
                    continue
            supported = any(isinstance(value, (int, float)) and abs(number - value) <= 0.5
                            for value in candidates)
            if conditional and not supported:
                issues.append("條件張數須明示為情境假設並引用對應資料脈絡")
                continue
            if not supported:
                issues.append("成交量或統計期間未獲同項證據支持" if metric == "vol_lots"
                              else "法人張數或統計期間未獲同項證據支持")
    return list(dict.fromkeys(issues))



def _normalize_text_brief_items(
    raw_items: Any,
    *,
    raw_model: Any,
    strict_model: Any,
    id_prefix: str,
    section: str,
    discarded: list[str],
) -> list[dict[str, Any]]:
    if not isinstance(raw_items, list):
        discarded.append(section)
        return []

    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(raw_items):
        item_label = f"{section}[{index}]"
        try:
            raw_item = raw_model.model_validate(item).model_dump(mode="python")
        except ValidationError:
            discarded.append(item_label)
            continue

        item_id = raw_item.get("id")
        if not isinstance(item_id, str) or re.fullmatch(
            rf"{re.escape(id_prefix)}_[0-9]+", item_id
        ) is None:
            discarded.append(item_id if isinstance(item_id, str) else item_label)
            continue
        try:
            normalized.append(
                strict_model.model_validate(raw_item).model_dump(mode="python")
            )
        except ValidationError:
            discarded.append(item_id)
    return normalized

def _normalize_text_brief_forward_views(
    raw_forward_views: Any,
    *,
    discarded: list[str],
) -> dict[str, Any] | None:
    if not isinstance(raw_forward_views, dict):
        discarded.append("forward_views")
        return None

    normalized: dict[str, Any] = {}
    for horizon in ("short_1_5", "swing_6_20", "medium_21_40"):
        try:
            raw_view = RawTextBriefForwardView.model_validate(
                raw_forward_views.get(horizon)
            ).model_dump(mode="python")
            normalized[horizon] = TextBriefForwardView.model_validate(
                raw_view
            ).model_dump(mode="python")
        except ValidationError:
            discarded.append(f"forward_views.{horizon}")
            return None
    return normalized

def _truncate_oversized_sections(
    normalized: dict[str, Any],
    *,
    truncated: list[str],
) -> None:
    for section, maximum in TEXT_BRIEF_MAX_COUNTS.items():
        items = normalized.get(section)
        if isinstance(items, list) and len(items) > maximum:
            truncated.append(f"{section}>{maximum}")
            normalized[section] = items[:maximum]

def _normalize_text_brief_payload(
    payload: dict[str, Any],
) -> tuple[StockBehaviorTextBrief | None, list[str], list[str]]:
    discarded: list[str] = []
    truncated: list[str] = []
    try:
        raw = RawStockBehaviorTextBrief.model_validate(payload).model_dump(
            mode="python"
        )
    except ValidationError:
        return None, ["root"], truncated

    claim_sections = (
        ("current_status", "cs"),
        ("positive_factors", "pos"),
        ("negative_factors", "neg"),
        ("source_divergences", "div"),
    )
    normalized: dict[str, Any] = {
        "key_days": _normalize_text_brief_items(
            raw["key_days"],
            raw_model=RawTextBriefKeyDay,
            strict_model=TextBriefKeyDay,
            id_prefix="kd",
            section="key_days",
            discarded=discarded,
        ),
        "headline": raw["headline"],
        "risks": _normalize_text_brief_items(
            raw["risks"],
            raw_model=RawTextBriefRisk,
            strict_model=TextBriefRisk,
            id_prefix="rk",
            section="risks",
            discarded=discarded,
        ),
        "watch_points": _normalize_text_brief_items(
            raw["watch_points"],
            raw_model=RawTextBriefWatchPoint,
            strict_model=TextBriefWatchPoint,
            id_prefix="wp",
            section="watch_points",
            discarded=discarded,
        ),
        "forward_views": _normalize_text_brief_forward_views(
            raw["forward_views"], discarded=discarded
        ),
        "overall_stance": raw["overall_stance"],
        "confidence": raw["confidence"],
        "confidence_reason": raw["confidence_reason"],
        "limitations": raw["limitations"],
    }
    for section, prefix in claim_sections:
        normalized[section] = _normalize_text_brief_items(
            raw[section],
            raw_model=RawTextBriefClaim,
            strict_model=TextBriefClaim,
            id_prefix=prefix,
            section=section,
            discarded=discarded,
        )

    _truncate_oversized_sections(normalized, truncated=truncated)

    try:
        return StockBehaviorTextBrief.model_validate(normalized), discarded, truncated
    except ValidationError as exc:
        return None, discarded, truncated

def _filter_text_brief_evidence_ids(
    value: Any,
    *,
    allowed_ids: set[str],
    filtered_ids: list[str],
) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "evidence_ids" and isinstance(item, list):
                kept = []
                for evidence_id in item:
                    if isinstance(evidence_id, str) and evidence_id in allowed_ids:
                        if evidence_id not in kept:
                            kept.append(evidence_id)
                    else:
                        filtered_ids.append(str(evidence_id))
                value[key] = kept
            else:
                _filter_text_brief_evidence_ids(
                    item,
                    allowed_ids=allowed_ids,
                    filtered_ids=filtered_ids,
                )
    elif isinstance(value, list):
        for item in value:
            _filter_text_brief_evidence_ids(
                item,
                allowed_ids=allowed_ids,
                filtered_ids=filtered_ids,
            )

def _text_brief_compliance_texts(value: Any) -> list[str]:
    parts: list[str] = []

    def collect(item: Any) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                if key in TEXT_BRIEF_COMPLIANCE_TEXT_KEYS:
                    if isinstance(child, str):
                        parts.append(child)
                elif key == "limitations" and isinstance(child, list):
                    parts.extend(entry for entry in child if isinstance(entry, str))
                else:
                    collect(child)
        elif isinstance(item, list):
            for child in item:
                collect(child)

    collect(value)
    return parts

def _historical_prices(bundle: EvidenceBundle) -> dict[str, Decimal]:
    prices = {}
    for row in bundle.daily_timeline + bundle.long_term_anchor:
        try:
            if date.fromisoformat(str(row.get("date"))) > bundle.as_of_date:
                continue
            value = (row.get("close") if "close" in row else row.get("value")
                     if row.get("field") in {"high_1y", "low_1y"} else None)
            price = Decimal(str(value))
            if price.is_finite() and price > 0:
                prices[row["id"]] = price
        except (ValueError, InvalidOperation):
            continue
    return prices


def _scan_text_brief_compliance(value: Any, *, prices: dict[str, Decimal] | None = None) -> list[ComplianceHit]:
    hits = []
    if isinstance(value, list):
        for item in value:
            hits.extend(_scan_text_brief_compliance(item, prices=prices))
    elif isinstance(value, dict):
        cited_prices = {(prices or {})[ref] for ref in value.get("evidence_ids", []) if ref in (prices or {})}
        for key, text in value.items():
            if key in TEXT_BRIEF_COMPLIANCE_TEXT_KEYS and isinstance(text, str):
                condition = key in FORWARD_CONDITION_KEYS
                matches = list(_price_mentions(text, condition=condition))
                amounts = [amount for match in matches for amount in re.findall(r"[\d.,]+", match.group(1))]
                valid_amounts = bool(amounts) and all(
                    re.fullmatch(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?", amount)
                    and Decimal(amount.replace(",", "")) > 0 for amount in amounts)
                grounded = valid_amounts and all(Decimal(amount.replace(",", "")) in cited_prices for amount in amounts)
                scenarios = [condition and bool(cited_prices) and _is_price_scenario(text, match) for match in matches]
                supported = valid_amounts and all(scenario or all(
                    Decimal(amount.replace(",", "")) in cited_prices
                    for amount in re.findall(r"[\d.,]+", match.group(1)))
                    for match, scenario in zip(matches, scenarios))
                if any(scenarios) and valid_amounts and not grounded:
                    hits.append(ComplianceHit("情境價位-soft", "soft", text))
                hits.extend(scan_compliance_hits(text, grounded_condition=supported))
                if condition and amounts and not supported:
                    hits.append(ComplianceHit("前瞻價位-hard", "hard", text))
            elif key == "limitations" and isinstance(text, list):
                for entry in text:
                    if isinstance(entry, str):
                        hits.extend(scan_compliance_hits(entry))
            else:
                hits.extend(_scan_text_brief_compliance(text, prices=prices))
    return hits

def _apply_text_brief_compliance_gate(
    brief_payload: dict[str, Any], *, bundle: EvidenceBundle | None = None, allow_partial_forward_views: bool = False,
) -> tuple[list[str], list[str], list[str], bool]:
    removed_ids: list[str] = []
    hard_violations: list[str] = []
    soft_hits: list[str] = []
    prices = _historical_prices(bundle) if bundle is not None else {}

    def check(item):
        hits = _scan_text_brief_compliance(item, prices=prices)
        if bundle is not None:
            hits.extend(ComplianceHit("證據支持", "soft" if issue.startswith("未核實") else "hard", issue)
                        for issue in _grounding_issues(item, bundle))
        return hits

    def record(hits):
        hard_violations.extend(f"{hit.rule}: {hit.snippet}" for hit in hits if hit.severity == "hard")
        soft_hits.extend(f"{hit.rule}: {hit.snippet}" for hit in hits if hit.severity == "soft")
        return any(hit.severity == "hard" for hit in hits)

    for section in TEXT_BRIEF_ITEM_SECTIONS:
        kept = []
        for item in brief_payload[section]:
            if record(check(item)):
                removed_ids.append(item["id"])
            else:
                kept.append(item)
        brief_payload[section] = kept

    blocked = False
    for horizon, view in brief_payload["forward_views"].items():
        if record(check(view)):
            # An invalid condition does not invalidate a supported explanation.
            explanation = {key: value for key, value in view.items() if key != "invalidation"}
            if not any(hit.severity == "hard" for hit in check(explanation)):
                view["invalidation"] = "本次未提供可核對的失效條件。"
                removed_ids.append(f"forward_views.{horizon}.invalidation")
                brief_payload["confidence"] = "low"
            elif not allow_partial_forward_views:
                blocked = True
            else:
                removed_ids.append(f"forward_views.{horizon}")
                brief_payload["forward_views"][horizon] = {
                    "stance": "uncertain",
                    "reason": "此期間展望未通過內容檢查，暫不提供方向判讀。",
                    "invalidation": "缺少通過檢查的失效條件。",
                    "evidence_ids": [],
                    "validation_status": "rejected",
                }

    has_direction = any(view["stance"] != "uncertain" and view.get("evidence_ids")
                        and view.get("validation_status") != "rejected"
                        for view in brief_payload["forward_views"].values())
    if any(f"forward_views.{horizon}" in removed_ids for horizon in brief_payload["forward_views"]):
        if not has_direction:
            brief_payload["overall_stance"] = "uncertain"
        brief_payload["confidence"] = "low"
        brief_payload["confidence_reason"] = "部分期間的分析依據無法確認，信心調降；請參考其餘有依據的期間判斷。"
    elif any(item.endswith(".invalidation") for item in removed_ids):
        brief_payload["confidence_reason"] = "部分失效條件未通過檢查，已保留有依據的方向與理由，信心調降。"

    refs = list(_text_brief_referenced_ids(brief_payload))
    replacements = {"headline": "依可核對資料整理個股現況與展望",
                    "confidence_reason": "部分文字未通過檢查，僅保留有依據的分析，信心調降。"}
    for key, replacement in replacements.items():
        if record(check({key: brief_payload[key], "evidence_ids": refs})):
            if allow_partial_forward_views:
                brief_payload[key] = replacement
                brief_payload["confidence"] = "low"
                removed_ids.append(key)
            else:
                blocked = True
    kept_limits = []
    for index, text in enumerate(brief_payload["limitations"]):
        if record(check({"text": text, "claim_type": "limitation", "evidence_ids": refs})):
            if allow_partial_forward_views:
                removed_ids.append(f"limitations[{index}]")
                brief_payload["confidence"] = "low"
                continue
            blocked = True
        kept_limits.append(text)
    brief_payload["limitations"] = kept_limits
    if any(not brief_payload[section] for section in TEXT_BRIEF_ITEM_SECTIONS if section != "source_divergences"):
        if not has_direction:
            brief_payload["overall_stance"] = "uncertain"
        brief_payload["confidence"] = "low"
        brief_payload["confidence_reason"] = "部分項目缺少分析依據，信心調降；方向判斷僅依現有可用資料。"
    return (
        removed_ids,
        hard_violations,
        soft_hits,
        blocked or not any(brief_payload[section] for section in TEXT_BRIEF_ITEM_SECTIONS),
    )

def _text_brief_referenced_ids(value: Any) -> set[str]:
    referenced: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "evidence_ids" and isinstance(item, list):
                referenced.update(
                    evidence_id
                    for evidence_id in item
                    if isinstance(evidence_id, str)
                )
            else:
                referenced.update(
                    _text_brief_referenced_ids(item)
                )
    elif isinstance(value, list):
        for item in value:
            referenced.update(
                _text_brief_referenced_ids(item)
            )
    return referenced

def _backfill_key_days(
    brief_payload: dict[str, Any],
    *,
    bundle: EvidenceBundle,
    as_of_date: date,
    discarded: list[str],
    future_dated: list[str],
) -> None:
    by_id = bundle.timeline_by_id()
    by_date = bundle.timeline_by_date()
    kept: list[dict[str, Any]] = []
    for item in brief_payload["key_days"]:
        item_date = item.get("date")
        if isinstance(item_date, str):
            try:
                if date.fromisoformat(item_date) > as_of_date:
                    future_dated.append(item["id"])
                    continue
            except ValueError:
                discarded.append(item["id"])
                continue

        row = by_id.get(item.get("ref")) or by_date.get(item_date)
        if row is None:
            discarded.append(item["id"])
            continue

        item["ref"] = row["id"]
        item["date"] = row["date"]
        item["move_pct"] = row.get("chg_pct")
        volume_pct = row.get("vol_vs_ma5_pct")
        item["volume_ratio"] = (
            None if volume_pct is None else round(1.0 + volume_pct / 100.0, 2)
        )
        kept.append(item)
    brief_payload["key_days"] = kept

def _collect_jargon_hits(brief_payload: dict[str, Any]) -> list[str]:
    hits: list[str] = []
    for text in _text_brief_compliance_texts(brief_payload):
        hits.extend(JARGON_TERMS_RE.findall(text))
    return list(dict.fromkeys(hits))

def _undercount_sections(brief_payload: dict[str, Any]) -> list[str]:
    return [
        f"{section}<{minimum}"
        for section, minimum in TEXT_BRIEF_TARGET_COUNTS.items()
        if len(brief_payload.get(section) or []) < minimum
    ]
