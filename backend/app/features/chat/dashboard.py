"""Convert cited evidence into display data; never query or generate new evidence."""
from __future__ import annotations

import json
import re
from datetime import date
from html import unescape
from math import isfinite
from urllib.parse import urlsplit

from app.features.retrieval.common import normalize_source_url

from .schemas import (
    ChatDashboard, DashboardChart, DashboardMetrics, DashboardNews, DashboardTable, SourceChunk,
)


_FOCUS = {"price", "technical", "institutional", "fundamental", "comparison", "news"}
_PRICE = (("close", "收盤價", "元"), ("chg_pct", "漲跌幅", "%"), ("volume_shares", "成交量", "股"),
          ("open", "開盤價", "元"), ("high", "最高價", "元"), ("low", "最低價", "元"))
_CHIPS = ("foreign_net", "investment_trust_net", "dealer_net", "total_institutional_net")
_FUNDAMENTALS = {
    "eps": ("每股盈餘", "元／股"), "gross_margin_pct": ("毛利率", "%"),
    "operating_margin_pct": ("營業利益率", "%"), "revenue_monthly": ("月營收", "元"),
    "revenue_yoy_positive_streak": ("營收年增連續為正", "個月"),
    "per": ("本益比", "倍"), "pbr": ("股價淨值比", "倍"), "dividend_yield": ("現金殖利率", "%"),
}


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
        return number if isfinite(number) else None
    except OverflowError:
        return None


def _text(value, limit=240) -> str:
    return " ".join(re.sub(r"<[^>]*>", "", unescape(value)).split())[:limit] if isinstance(value, str) else ""


def _day(value) -> str | None:
    try:
        return date.fromisoformat(value).isoformat() if isinstance(value, str) else None
    except ValueError:
        return None


def _period(value) -> str | None:
    if isinstance(value, str) and re.fullmatch(r"\d{4}Q[1-4]", value):
        return value
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}", value):
        return value if _day(value + "-01") else None
    return _day(value)


def _formatted(value, digits: int = 2) -> str:
    """Table cells: two decimals by default; counts and share totals use digits=0. Never a negative zero."""
    number = _number(value)
    if number is None:
        return "無資料"
    text = format(number, f".{digits}f")
    return text[1:] if text.startswith("-") and float(text) == 0 else text


def _lots(value) -> str:
    """Institutional shares → whole 張 (1 張 = 1,000 股, half up); a non-zero amount under one lot reads 「不到 1 張」."""
    number = _number(value)
    if number is None:
        return "無資料"
    if number != 0 and abs(number) < 1000:
        return "不到 1 張"
    lots = int(abs(number) / 1000 + 0.5)
    return f"-{lots}" if number < 0 and lots else str(lots)


def _ids(sources) -> list[str]:
    return list(dict.fromkeys(source.citation_id for source in sources if source.citation_id))


def _rows(payload) -> list[dict]:
    columns, values = payload.get("columns"), payload.get("rows")
    if not isinstance(columns, list) or not all(isinstance(key, str) for key in columns) or not isinstance(values, list):
        return []
    by_date = {}
    for cells in values:
        if isinstance(cells, list):
            row = dict(zip(columns, cells))
            if day := _day(row.get("date")):
                by_date[day] = {**row, "date": day}
    return [by_date[day] for day in sorted(by_date)[-40:]]


def _latest(rows, fields):
    return next((row for row in reversed(rows)
                 if any(_number(row.get(field)) is not None for field in fields)), None)


def _technical_charts(source, rows, query, show_missing=False):
    requested = []
    if re.search(r"kd|[kd]\s*值|隨機指標", query, re.IGNORECASE):
        requested.append("KD")
    if re.search(r"rsi|相對強弱", query, re.IGNORECASE):
        requested.append("RSI")
    if re.search(r"macd|平滑異同", query, re.IGNORECASE):
        requested.append("MACD")
    groups = {
        "KD": (("kd_k9", "K（9日）"), ("kd_d9", "D（9日）")),
        "RSI": (("rsi5", "RSI（5日）"), ("rsi10", "RSI（10日）")),
        "MACD": (("macd_dif", "DIF"), ("macd_dea", "DEA"), ("macd_hist", "柱狀體")),
    }
    for name in requested or ["KD"]:
        fields = groups[name]
        latest = _latest(rows, [field for field, _ in fields])
        if latest is None and not requested and not show_missing:
            continue
        description = (f"最新有效觀察：{latest['date']}。缺值保留空白，不與其他日期的股價混用。" if latest else
                       f"此區間沒有有效的 {name} 指標觀察值；保留缺值，無法據此判讀指標訊號。")
        if name == "MACD":
            description += "平滑參數未記錄。"
        yield DashboardChart(
            title=f"{source.stock_id} {name}", description=description, source_ids=_ids([source]),
            dates=[row["date"] for row in rows], unit="元" if name == "MACD" else "指數點",
            series=[{"name": label, "values": [_number(row.get(field)) for row in rows]}
                    for field, label in fields],
        )


def _comparison(source, payload, symbols, query):
    stocks = payload.get("stocks")
    if not isinstance(stocks, list):
        return []
    by_symbol = {row.get("symbol"): row for row in stocks if isinstance(row, dict) and isinstance(row.get("symbol"), str)}
    requested = symbols or list(by_symbol)[:6]
    if not requested:
        return []
    start, end = _day(payload.get("common_start_date")), _day(payload.get("common_end_date"))
    price_count = _number(payload.get("common_price_samples"))
    return_count = _number(payload.get("common_daily_return_samples"))
    description = (f"查詢區間：{_day(payload.get('requested_start_date')) or '未提供'} → "
                   f"{_day(payload.get('requested_end_date')) or '未提供'}；"
                   f"各股都有收盤價的日期：{start or '無資料'} → {end or '無資料'}"
                   + (f"，共 {_formatted(price_count, 0)} 個交易日。" if price_count is not None else "。")
                   + "用未還原收盤價，不含股息與稅費；缺漏的日子不補值，只比較各股都有資料的日期，可能漏掉回撤。")
    if (return_start := _day(payload.get("daily_return_start_date"))) and (return_end := _day(payload.get("daily_return_end_date"))):
        description += f"波動與相關係數用 {return_start} → {return_end} 的日漲跌幅計算。"
    if not start or not end:
        description += "這幾檔股票沒有共同的交易日，無法公平比較。"
    if return_count is not None and return_count < 20:
        description += f"只有 {_formatted(return_count, 0)} 筆日漲跌幅，波動與相關係數可能不穩定。"
    fields = (("first_common_close", 2), ("last_common_close", 2), ("interval_return_pct", 2),
              ("annualized_volatility_pct", 2), ("max_drawdown_pct", 2),
              ("available_price_samples", 0), ("missing_observed_dates", 0))
    blocks = [DashboardTable(
        title="多股比較", description=description, source_ids=_ids([source]),
        columns=["股票", "共同起始收盤（元）", "共同期末收盤（元）", "區間漲跌幅（%）", "年化波動（%）",
                 "最大回撤（%）", "有效股價筆數", "缺漏日期數"],
        rows=[[_text(symbol, 20), *(_formatted(by_symbol.get(symbol, {}).get(field), digits) for field, digits in fields)]
              for symbol in requested],
    )]
    correlations = payload.get("correlations")
    if re.search(r"相關|連動|correlation", query, re.IGNORECASE) and isinstance(correlations, list):
        rows = []
        for item in correlations:
            pair = item.get("symbols") if isinstance(item, dict) else None
            if isinstance(pair, list) and len(pair) == 2 and all(symbol in requested for symbol in pair):
                rows.append(["／".join(_text(symbol, 20) for symbol in pair), _formatted(item.get("pearson_r"))])
        if rows:
            blocks.append(DashboardTable(title="日漲跌幅相關係數", description=description,
                                         source_ids=_ids([source]), columns=["股票組合", "相關係數"], rows=rows[:15]))
    return blocks


def _news(sources):
    items, used_sources, article_ids, urls, fallback_keys = [], [], set(), set(), set()
    for source in sources:
        title = _text(source.title)
        if not title and not _text(source.content):
            continue
        url = normalize_source_url(source.url)
        try:
            parts = urlsplit(url)
            if (parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password
                    or re.search(r"[\s<>\\\x00-\x1f\x7f]", url)):
                url = ""
            parts.port
        except ValueError:
            url = ""
        published_at = _text(source.pub_time, 40)
        fallback_key = (title, published_at)
        if ((url and url in urls) or (source.article_id and source.article_id in article_ids)
                or (not url and not source.article_id and fallback_key in fallback_keys)):
            continue
        if url:
            urls.add(url)
        if source.article_id:
            article_ids.add(source.article_id)
        if not url and not source.article_id:
            fallback_keys.add(fallback_key)
        title = title or "未提供標題"
        items.append({"title": title, "publisher": _text(source.source_name) or "來源未標示",
                      "published_at": published_at, "url": url, "source_id": source.citation_id,
                      "article_id": source.article_id})
        used_sources.append(source)
        if len(items) == 12:
            break
    if not items:
        return None
    return DashboardNews(title="相關新聞", source_ids=_ids(used_sources), items=items,
                         description="依來源列出新聞發布時間。")


def build_dashboard(sources: list[SourceChunk], symbols: list[str], query: str,
                    focus: list[str] | None = None) -> ChatDashboard | None:
    wanted = set(focus or _FOCUS)
    requested = list(dict.fromkeys(symbol.strip().upper() for symbol in symbols if symbol.strip()))[:6]
    if not requested:
        requested = list(dict.fromkeys(symbol for source in sources
                                       for symbol in [source.stock_id, *source.stock_ids] if symbol))[:6]
    availability = {source.stock_id: source for source in sources
                    if source.category == "data_availability" and source.stock_id in requested}
    parsed = []
    for source in sources:
        if source.category in {"market_technical", "institutional", "fundamental", "comparison"}:
            try:
                payload = json.loads(source.content)
            except (ValueError, TypeError):
                continue
            if isinstance(payload, dict):
                parsed.append((source, payload))
    blocks, markets, institutions = [], {}, {}
    for source, payload in parsed:
        if source.category == "comparison":
            if "comparison" in wanted:
                blocks.extend(_comparison(source, payload, requested, query))
            continue
        if source.stock_id not in requested:
            continue
        if source.category == "market_technical":
            rows = _rows(payload)
            markets[source.stock_id] = (source, rows)
            if "price" in wanted and (latest := _latest(rows, [field for field, _, _ in _PRICE])):
                blocks.append(DashboardMetrics(
                    title=f"{source.stock_id} 價量", description=f"資料日期：{latest['date']}；不是即時行情，缺漏的資料不補。",
                    source_ids=_ids([source]), items=[{"label": label, "value": _number(latest.get(field)),
                                                     "unit": unit, "date": latest["date"]} for field, label, unit in _PRICE],
                ))
            if "technical" in wanted:
                blocks.extend(_technical_charts(source, rows, query, show_missing=bool(focus)))
        elif source.category == "institutional":
            institutions[source.stock_id] = (source, _latest(_rows(payload), _CHIPS))
        elif source.category == "fundamental" and "fundamental" in wanted:
            raw_items = payload.get("items")
            if not isinstance(raw_items, list):
                continue
            metrics = []
            for item in raw_items:
                field = item.get("field") if isinstance(item, dict) else None
                if isinstance(field, str) and field in _FUNDAMENTALS:
                    label, unit = _FUNDAMENTALS[field]
                    metrics.append({"label": label, "value": _number(item.get("value")), "unit": unit,
                                    "date": _period(item.get("period")) or _day(item.get("date"))})
            if any(item["value"] is not None for item in metrics):
                blocks.append(DashboardMetrics(title=f"{source.stock_id} 基本面與估值", items=metrics,
                    source_ids=_ids([source]), description="各項分別標示資料日期或報告期；跨股比較須對齊期別。財報公告日依既有延遲規則推估，未取得實際公告時間。"))

    if "technical" in wanted:
        for symbol in requested:
            if symbol not in markets and symbol in availability:
                blocks.extend(_technical_charts(availability[symbol], [], query, show_missing=bool(focus)))
    if "price" in wanted and (markets or availability):
        dates = sorted({row["date"] for _, rows in markets.values() for row in rows})[-40:]
        series = []
        for symbol in requested:
            by_date = {row["date"]: row for row in markets.get(symbol, (None, []))[1]}
            series.append({"name": symbol, "values": [_number(by_date.get(day, {}).get("close")) for day in dates]})
        missing = [item["name"] for item in series if all(value is None for value in item["values"])]
        if any(value is not None for item in series for value in item["values"]) or focus:
            description = "最多顯示最近40個觀察日期。各股票保留原始價格，缺漏日期不補值。"
            if missing:
                description += f"沒有有效收盤價資料：{'、'.join(missing)}；各自以空值保留。"
            blocks.append(DashboardChart(title="收盤價走勢", dates=dates, series=series, unit="元",
                source_ids=_ids([source for source, _ in markets.values()]
                                + [availability[symbol] for symbol in missing if symbol in availability]),
                description=description))
    if "institutional" in wanted and any(row is not None for _, row in institutions.values()):
        rows = []
        for symbol in requested:
            row = institutions.get(symbol, (None, None))[1] or {}
            rows.append([symbol, row.get("date", "無資料"), *(_lots(row.get(field)) for field in _CHIPS)])
        blocks.append(DashboardTable(title="法人買賣超", source_ids=_ids([source for source, _ in institutions.values()]),
            description="單位為張（1 張 = 1,000 股，四捨五入到整數張）；正數為買超、負數為賣超，不滿 1 張寫「不到 1 張」。"
                        "各股票分別標示最新有效觀察日期，無資料不當成零。",
            columns=["股票", "資料日期", "外資（張）", "投信（張）", "自營商（張）", "三大法人合計（張）"], rows=rows))
    if "news" in wanted:
        news = _news([source for source in sources if source.category == "news"])
        if news is not None:
            blocks.append(news)
    if len(requested) > 1:
        blocks.sort(key=lambda block: not (block.kind == "table" and block.title in {"多股比較", "日漲跌幅相關係數"}))
    return ChatDashboard(title="對話資料總覽", blocks=blocks) if blocks else None
