"""Small, cited reference set for the features this application actually supports."""
import json
import re

from app.features.analysis.evidence import FIELD_GLOSSARY
from app.features.retrieval.common import STOCK_OPTIONS

from .schemas import SourceChunk


INDICATOR_GUIDES = (
    (r"KD|隨機|stochastic|黃金交叉|死亡交叉", "KD／隨機指標觀念", "fast-stochastic",
     "Stochastic indicators describe where a close sits within a recent high-low range. K is the "
     "faster line; D smooths K. Regions above 80 and below 20 are commonly called overbought and "
     "oversold. A line crossing requires its relative position to change between observations. "
     "Different smoothing and lookback settings exist; the reference's example uses 14 periods. "
     "These are general concepts, not the application's stored indicator values."),
    (r"RSI|相對強弱", "RSI 相對強弱指標觀念", "RSI",
     "RSI measures price momentum on a 0-100 scale using relative upward and downward price changes. "
     "70 and 30 are common overbought/oversold thresholds, not universal settings. During a strong "
     "trend RSI can stay in either extreme region for a long time. A high or low RSI alone does "
     "not establish that price will reverse; the period setting and other evidence matter."),
    (r"MACD|指數平滑異同", "MACD 趨勢動能觀念", "macd",
     "MACD compares a faster and a slower exponential moving average. A common example uses "
     "12 and 26 periods with a 9-period EMA signal line. Line and zero crossings describe momentum "
     "changes, and range-bound markets can produce repeated misleading crossings. MACD is unbounded "
     "and is not normally an overbought/oversold oscillator. Parameters can differ between systems."),
)


def reference_source(title: str, content: str, *, category: str = "knowledge", url: str = "") -> SourceChunk:
    return SourceChunk(title=title, content=content, category=category, source=f"system_{category}",
                       source_name="Fidelity 指標指南" if url else "系統功能與欄位說明",
                       pub_time="", url=url, stock_id="", score=1)


def collect_knowledge_sources(query: str, *, include_help: bool, include_knowledge: bool) -> list[SourceChunk]:
    sources = []
    if include_help:
        sources.append(reference_source("系統功能與操作入口", json.dumps({
            "supported_stocks": STOCK_OPTIONS,
            "features": {
                "home": "Homepage: stock overview and entry to individual stock pages.",
                "individual_stock": "Stock page: price/volume charts, technical indicators, institutional "
                                    "flows, financial data, news and AI analysis when records are available.",
                "comparison": "Compare page: select multiple supported stocks and a date range to compare "
                              "price performance, volatility, drawdown, correlation, technicals and flows.",
                "chat": "Ask about single stocks, multiple stocks, news or indicator concepts; click AI-suggested "
                        "follow-up questions or ask for a shorter or deeper explanation in the conversation.",
                "simulated_orders": "Simulated order page: enter stock, direction, date and quantity, inspect "
                                     "order records and profit grouped by stock. Uses the logged-in account "
                                     "or this browser's anonymous identity. These are simulated records.",
            },
            "chat_limits": "Chat reads available system market data and references. It does not read personal "
                           "holdings, access account details, place/cancel orders or perform strategy backtests. "
                           "Use the supplied page buttons for these supported page features. Data may be missing "
                           "or delayed; stored prices are not real-time quotes.",
        }, ensure_ascii=False), category="help"))
    if include_knowledge:
        glossary = {key: value for key, value in FIELD_GLOSSARY.items()
                    if key not in {"rsi5", "kd_k", "macd_hist"}}
        sources.append(reference_source("系統分析欄位與比較口徑", json.dumps({
            "fields": glossary,
            "comparison": "Interval price return = (last close / first close - 1) * 100. Annualized "
                          "volatility = sample standard deviation of daily returns * sqrt(252) * 100. "
                          "Maximum drawdown is the lowest percentage change from a prior running peak "
                          "within the interval. Pearson correlation uses paired daily returns; constant "
                          "series or too few samples have no defined correlation. Returns exclude "
                          "dividends, transaction costs and taxes; missing values are not zeros.",
            "limits": "These are field definitions and calculation methods, not observed stock conditions. "
                      "Use each supplied stock record's actual units and parameter names.",
        }, ensure_ascii=False)))
        for pattern, title, slug, content in INDICATOR_GUIDES:
            if re.search(pattern, query, re.IGNORECASE):
                sources.append(reference_source(title, content, url=
                    "https://www.fidelity.com/learning-center/trading-investing/technical-analysis/"
                    f"technical-indicator-guide/{slug}"))
    return sources
