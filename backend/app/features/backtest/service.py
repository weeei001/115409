"""AI backtest: three groups decide every five trading days on the same stock and the same dates.

The rule group votes with point-in-time signal statistics, one AI group sees only the anonymized market
snapshot, and the other also sees the signal evidence list; positions follow the same preset for all.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import tempfile
from bisect import bisect_right
from dataclasses import dataclass
from datetime import date
from functools import cached_property
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.features.analysis.repository import benchmark_series
from app.features.signals import repository as signal_repository
from app.features.signals.detection import Day
from app.features.signals.history import SignalHistory, StockSeries
from app.features.signals.service import HISTORY_START, revenue_months, series_from_rows
from . import engine, prompts
from .repository import open_prices
from .schemas import AIBacktestResult, BacktestDecision, DecisionRecord, GroupDecision, Preset

REVISION = "ai-backtest-v2"
DECISION_EVERY = 5
MAX_DECISIONS = 130
# A decision is a short answer, unlike a brief: LLM_TIMEOUT_SECONDS would let one stalled call hold the run for minutes.
DECISION_TIMEOUT_SECONDS = 120
# Decision days in a row on which every AI group failed before the run stops instead of paying for more calls.
MAX_FAILED_DAYS = 3
GROUP_LABELS = {"rule": "純規則", "ai_plain": "AI 不給訊號", "ai_signals": "AI 給訊號"}

METHOD_NOTE = (
    "每 5 個交易日在收盤後判斷一次，下一個交易日開盤依持股規則調整到目標比例；中性不調整，"
    "持股比例和目標相差不到 5 個百分點也不調整（目標為 0 時一律出清）。"
    "三組用同一檔股票、同一批判斷日、同一套持股規則，只有判斷方式不同：純規則看當天證據清單裡歷史上勝過或輸給任一天進場的訊號投票；"
    "AI 不給訊號只看匿名化的價量、指標、法人與營收資料；AI 給訊號另外收到證據清單，統計只用判斷日當天已經知道結果的事件。"
    "給 AI 的資料去掉股票代號、名稱與日期，價格換成指數，降低模型靠記憶知道後來行情的機會，但無法完全排除。"
    "只用現金、整股、不放空；買賣各收手續費 0.1425%，賣出另收證交稅 0.3%，不計最低手續費與滑價。"
    "命中率看判斷日收盤到之後第 5 個交易日收盤的漲跌方向；中性不算方向判斷。"
    "行情為未還原價格。這是研究用的模擬，不是投資建議，過去表現不代表未來結果。"
)


@dataclass
class Prepared:
    symbol: str
    start: date
    end: date
    preset: Preset
    initial_cash: float
    use_ai: bool
    days: list[Day]
    opens: dict[date, float]
    revenue: list[tuple[int, date, float | None]]
    benchmark: list[tuple[date, float]]
    series: dict[str, StockSeries]
    decision_indexes: list[int]
    first: int
    last: int
    fingerprint: dict[str, Any]

    @property
    def groups(self) -> list[str]:
        return ["rule", "ai_plain", "ai_signals"] if self.use_ai else ["rule"]

    @cached_property
    def history(self) -> SignalHistory:
        # Built on first use: reading a cached result only needs the fingerprint.
        return SignalHistory(self.series, DECISION_EVERY, self.benchmark)


def prepare(db: Session, *, symbol: str, start: date, end: date, preset: Preset, initial_cash: float,
            use_ai: bool) -> Prepared:
    if start >= end:
        raise AppError("開始日要早於結束日", status_code=422)
    symbols = signal_repository.catalog_symbols(db)
    if symbol not in symbols:
        raise AppError(f"股票清單裡沒有 {symbol}", status_code=404)
    try:
        rows = signal_repository.market_rows(db, symbols, HISTORY_START, HISTORY_START)
        benchmark = benchmark_series(db, HISTORY_START)
        opens = open_prices(db, symbol, start)
    finally:
        # End the read transaction before a stream that may wait minutes on the model.
        db.rollback()
    series = series_from_rows(rows, symbols)
    days = series[symbol][0]
    in_range = [index for index, day in enumerate(days) if start <= day.date <= end]
    if len(in_range) <= DECISION_EVERY:
        raise AppError(f"{symbol} 在這段期間的交易日不足", status_code=422)
    decisions = in_range[::DECISION_EVERY]
    if len(decisions) > MAX_DECISIONS:
        raise AppError(f"判斷次數 {len(decisions)} 次超過上限 {MAX_DECISIONS} 次，請縮短期間", status_code=422)
    revenue = revenue_months(rows[symbol]["revenue"])
    # The last decision's forward window ends after the range does; nothing later is read.
    through = days[min(decisions[-1] + engine.FORWARD_DAYS, len(days) - 1)].date
    return Prepared(
        symbol=symbol, start=start, end=end, preset=preset, initial_cash=initial_cash, use_ai=use_ai, days=days,
        opens=opens, revenue=revenue, benchmark=benchmark, series=series, decision_indexes=decisions,
        first=in_range[0], last=in_range[-1], fingerprint=_fingerprint(series, benchmark, revenue, through),
    )


def _fingerprint(series: dict, benchmark: list[tuple[date, float]], revenue: list[tuple[int, date, float | None]],
                 through: date) -> dict[str, Any]:
    """Row and event counts up to the last close the result reads: a day of new data keeps the cache,
    while added or removed history, on any stock in the catalog, replaces it."""
    stocks = {}
    for code, (days, fired) in series.items():
        count = bisect_right(days, through, key=lambda day: day.date)
        stocks[code] = [count, sum(index < count for indexes in fired.values() for index in indexes)]
    return {"through": through.isoformat(), "stocks": stocks,
            "benchmark": bisect_right(benchmark, through, key=lambda item: item[0]),
            "revenue": sum(available <= through for _, available, _ in revenue)}


def cache_path(settings: Any, prepared: Prepared, model_name: str | None) -> Path:
    identity = {"revision": REVISION, "symbol": prepared.symbol, "start": prepared.start.isoformat(),
                "end": prepared.end.isoformat(), "preset": prepared.preset, "cash": prepared.initial_cash,
                "ai": prepared.use_ai, "data": prepared.fingerprint, "prompt": [prompts.SYSTEM_PROMPT, prompts.SIGNALS_ADDENDUM],
                "model": [model_name, settings.LLM_BASE_URL, settings.LLM_TEMPERATURE, settings.LLM_MAX_TOKENS,
                          settings.LLM_RESPONSE_FORMAT] if prepared.use_ai else None}
    key = hashlib.sha256(json.dumps(identity, sort_keys=True, default=str).encode()).hexdigest()
    return Path(settings.SIMULATION_CACHE_DIR) / "ai-backtest" / f"{key}.json"


def read_cached(path: Path) -> AIBacktestResult | None:
    try:
        return AIBacktestResult.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_cached(path: Path, result: AIBacktestResult) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False) as output:
        temporary = Path(output.name)
    try:
        temporary.write_text(result.model_dump_json(), encoding="utf-8")
        os.replace(temporary, path)
    except OSError:
        temporary.unlink(missing_ok=True)  # No partial file left behind in the cache directory.
        raise


async def _ask(llm, payload: dict[str, Any], system_prompt: str, allowed: dict[str, str]) -> GroupDecision:
    """One model decision; a failed or unreadable answer keeps the position (recorded as failed)."""
    for _ in range(2):
        try:
            async with asyncio.timeout(DECISION_TIMEOUT_SECONDS):
                result = await llm.generate(system_prompt=system_prompt, payload=payload, schema=BacktestDecision)
            decision = BacktestDecision.model_validate(result.payload)
        except (AppError, ValidationError, TimeoutError):
            continue
        keys = list(dict.fromkeys(allowed[item] for item in decision.evidence_ids if item in allowed))
        return GroupDecision(stance=decision.stance, signal_keys=keys, reason=" ".join(decision.reason.split()))
    return GroupDecision(failed=True, reason="模型沒有回傳可用的判斷，這次不調整持股。")


async def decide(prepared: Prepared, llm, index: int) -> tuple[DecisionRecord, dict[str, float | None]]:
    """All groups' decisions for one day, with the evidence each could see and what followed."""
    days = prepared.days
    evidence = prepared.history.evidence(prepared.symbol, index)
    stance, used, reason = engine.rule_stance(evidence)
    groups = {"rule": GroupDecision(stance=stance, signal_keys=used, reason=reason)}
    if prepared.use_ai:
        plain = prompts.snapshot(days, index, prepared.revenue)
        rich = prompts.with_evidence(plain, prepared.history.baseline(days[index].date), evidence)
        groups["ai_plain"], groups["ai_signals"] = await asyncio.gather(
            _ask(llm, plain, prompts.SYSTEM_PROMPT, {}),
            _ask(llm, rich, prompts.SYSTEM_PROMPT + "\n" + prompts.SIGNALS_ADDENDUM, {item.id: item.key for item in evidence}))
    change, market = engine.forward(days, index, prepared.benchmark)
    record = DecisionRecord(
        date=days[index].date.isoformat(),
        execution_date=days[index + 1].date.isoformat() if index + 1 <= prepared.last else None,
        forward_return_pct=None if change is None else round(change * 100, 2),
        market_return_pct=None if market is None else round(market * 100, 2),
        active_signals=[item.key for item in evidence], groups=groups)
    return record, {item.key: item.edge_vs_baseline_pct for item in evidence}


def build_result(prepared: Prepared, records: list[DecisionRecord], edges: list[dict[str, float | None]],
                 model_name: str | None) -> AIBacktestResult:
    days, first, last = prepared.days, prepared.first, prepared.last
    dates = [day.date for day in days[first:last + 1]]
    groups = []
    for key in prepared.groups:
        stances = {index: record.groups[key].stance for index, record in zip(prepared.decision_indexes, records)}
        simulation = engine.simulate(days, prepared.opens, first, last, stances, prepared.preset, prepared.initial_cash)
        for index, record in zip(prepared.decision_indexes, records):
            target, traded = simulation.traded.get(index, (None, 0))
            record.groups[key].target_exposure, record.groups[key].traded_shares = target, traded
        groups.append(engine.score_group(key, GROUP_LABELS[key], records, simulation, prepared.initial_cash, edges))
    return AIBacktestResult(
        symbol=prepared.symbol, start=prepared.start.isoformat(), end=prepared.end.isoformat(), preset=prepared.preset,
        initial_cash=prepared.initial_cash, decision_every=DECISION_EVERY, model_name=model_name if prepared.use_ai else None,
        dates=[day.isoformat() for day in dates],
        buy_and_hold=engine.buy_and_hold(days, prepared.opens, first, last, prepared.initial_cash),
        market_index=engine.market_curve(dates, prepared.benchmark, prepared.initial_cash),
        groups=groups, decisions=records, method_note=METHOD_NOTE)


async def events(prepared: Prepared, settings: Any, llm):
    """SSE events: init, one progress per decision day, then done with the full result (or error)."""
    try:
        model_name = getattr(llm, "model_name", None)
        path = cache_path(settings, prepared, model_name)
        total = len(prepared.decision_indexes)
        cached = await asyncio.to_thread(read_cached, path)
        yield {"type": "init", "symbol": prepared.symbol, "decisions": total, "groups": prepared.groups,
               "llm_calls": total * 2 if prepared.use_ai else 0, "cached": cached is not None}
        if cached is not None:
            yield {"type": "done", "result": cached.model_dump(mode="json")}
            return
        if prepared.use_ai:
            llm.require_enabled()
        await asyncio.to_thread(getattr, prepared, "history")  # CPU-bound; keep it off the event loop.
        records, edges, failed_days = [], [], 0
        for done, index in enumerate(prepared.decision_indexes, 1):
            record, known = await decide(prepared, llm, index)
            records.append(record)
            edges.append(known)
            yield {"type": "progress", "done": done, "total": total, "date": record.date}
            ai_groups = [decision for key, decision in record.groups.items() if key != "rule"]
            failed_days = failed_days + 1 if ai_groups and all(decision.failed for decision in ai_groups) else 0
            if failed_days >= MAX_FAILED_DAYS:
                yield {"type": "error", "message": f"模型連續 {MAX_FAILED_DAYS} 次判斷都沒有回覆，已停止回測；請確認模型服務後再試。"}
                return
        result = build_result(prepared, records, edges, model_name)
        if not any(group.failed_calls for group in result.groups):
            try:
                await asyncio.to_thread(_write_cached, path, result)
            except OSError:
                logging.getLogger(__name__).warning("AI backtest cache write failed")
        yield {"type": "done", "result": result.model_dump(mode="json")}
    except AppError as exc:
        message = exc.detail.get("message", "回測暫時無法完成") if isinstance(exc.detail, dict) else str(exc.detail)
        yield {"type": "error", "message": message}
    except Exception as exc:
        logging.getLogger(__name__).error("AI backtest failed: %s", type(exc).__name__)
        yield {"type": "error", "message": "回測暫時無法完成，請稍後重試"}
