from __future__ import annotations

import logging
import random
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

from agent.pipeline import AnalysisPipelineService
from agent.scoring import compute_score_breakdown
from agent.schemas import DBData, ParsedIntent
from crud import daily_price as crud_price
from crud import technical_indicator as crud_indicator
from crud.institutional_trade import get_by_symbol_range as crud_institutional_range
from database import SessionLocal
from schemas.backtest import (
    BacktestMetrics,
    BacktestRunRequest,
    BacktestRunResult,
    BacktestSegmentResult,
    LLMConsistencyResult,
)

logger = logging.getLogger(__name__)

_QUERY_TEMPLATE = "Analyze TW stock {symbol} with price, technical and institutional data."


@dataclass
class _EvalPoint:
    as_of_date: date
    prediction: str
    actual: str


class BacktestRunStore:
    def __init__(self) -> None:
        self._runs: dict[str, BacktestRunResult] = {}

    def set(self, result: BacktestRunResult) -> None:
        self._runs[result.run_id] = result

    def get(self, run_id: str) -> Optional[BacktestRunResult]:
        return self._runs.get(run_id)


class BacktestService:
    def __init__(self, *, pipeline: AnalysisPipelineService) -> None:
        self._pipeline = pipeline

    async def run(self, req: BacktestRunRequest) -> BacktestRunResult:
        run_id = uuid.uuid4().hex
        started_at = datetime.utcnow()
        notes: list[str] = []

        symbol = req.symbol.strip().upper()
        if not symbol:
            raise ValueError("symbol is required")
        if req.start_date >= req.end_date:
            raise ValueError("start_date must be earlier than end_date")

        prefetch_start = req.start_date - timedelta(days=req.lookback_days + 5)
        prefetch_end = req.end_date + timedelta(days=req.horizon + 5)

        prices_rows, indicators_rows, institutional_rows = self._prefetch_rows(
            symbol=symbol,
            start_date=prefetch_start,
            end_date=prefetch_end,
        )

        if len(prices_rows) < req.horizon + 2:
            raise ValueError("Not enough price history for selected horizon")

        eval_points = self._build_eval_points(
            req=req,
            symbol=symbol,
            prices_rows=prices_rows,
            indicators_rows=indicators_rows,
            institutional_rows=institutional_rows,
        )

        if not eval_points:
            raise ValueError("No eligible evaluation points in selected range")

        overall_metrics = self._compute_metrics(eval_points)
        segments = self._build_segments(eval_points, req.walk_forward)

        llm_consistency: Optional[LLMConsistencyResult] = None
        if req.mode != "score_only":
            llm_consistency = await self._measure_llm_consistency(
                req=req,
                symbol=symbol,
                eval_points=eval_points,
            )

        finished_at = datetime.utcnow()

        return BacktestRunResult(
            run_id=run_id,
            status="completed",
            config=BacktestRunRequest(
                symbol=symbol,
                start_date=req.start_date,
                end_date=req.end_date,
                horizon=req.horizon,
                lookback_days=req.lookback_days,
                mode=req.mode,
                llm_sample_size=req.llm_sample_size,
                walk_forward=req.walk_forward,
            ),
            started_at=started_at,
            finished_at=finished_at,
            overall=overall_metrics,
            segments=segments,
            llm_consistency=llm_consistency,
            notes=notes,
        )

    def _prefetch_rows(self, *, symbol: str, start_date: date, end_date: date):
        db = SessionLocal()
        try:
            prices_rows = crud_price.get_price_range(db, symbol, start_date, end_date)
            indicators_rows = crud_indicator.get_indicators(db, symbol, start_date, end_date)
            institutional_rows = crud_institutional_range(db, symbol, start_date, end_date)
            return prices_rows, indicators_rows, institutional_rows
        finally:
            db.close()

    def _build_eval_points(
        self,
        *,
        req: BacktestRunRequest,
        symbol: str,
        prices_rows,
        indicators_rows,
        institutional_rows,
    ) -> list[_EvalPoint]:
        points: list[_EvalPoint] = []

        prices = [r for r in prices_rows if r.close is not None]
        prices_by_date = {r.date: r for r in prices}

        indicators = sorted(indicators_rows, key=lambda r: r.date)
        institutional = sorted(institutional_rows, key=lambda r: r.date)

        for idx, current in enumerate(prices):
            if current.date < req.start_date or current.date > req.end_date:
                continue
            if idx + req.horizon >= len(prices):
                continue

            future = prices[idx + req.horizon]
            current_close = float(current.close)
            future_close = float(future.close)
            if current_close <= 0:
                continue

            actual = "buy" if (future_close - current_close) / current_close > 0 else "sell"
            window_start = current.date - timedelta(days=req.lookback_days)

            window_prices = [
                self._price_to_dict(pr)
                for pr in prices
                if window_start <= pr.date <= current.date
            ]
            window_indicators = [
                self._indicator_to_dict(ind)
                for ind in indicators
                if window_start <= ind.date <= current.date
            ]
            window_institutional = [
                self._institutional_to_dict(inst)
                for inst in institutional
                if window_start <= inst.date <= current.date
            ]

            if not window_prices:
                continue

            db_data = DBData(
                symbol=symbol,
                date_start=window_start,
                date_end=current.date,
                prices=window_prices,
                indicators=window_indicators,
                institutional=window_institutional,
            )
            breakdown = compute_score_breakdown(db_data, "", None)
            prediction = "buy" if breakdown.weighted_score >= 0 else "sell"

            if current.date not in prices_by_date:
                continue

            points.append(
                _EvalPoint(
                    as_of_date=current.date,
                    prediction=prediction,
                    actual=actual,
                )
            )

        return points

    def _build_segments(self, eval_points: list[_EvalPoint], frequency: str) -> list[BacktestSegmentResult]:
        grouped: dict[str, list[_EvalPoint]] = {}
        for point in eval_points:
            seg_id = self._segment_id(point.as_of_date, frequency)
            grouped.setdefault(seg_id, []).append(point)

        out: list[BacktestSegmentResult] = []
        for seg_id in sorted(grouped.keys()):
            rows = grouped[seg_id]
            out.append(
                BacktestSegmentResult(
                    segment_id=seg_id,
                    start_date=rows[0].as_of_date,
                    end_date=rows[-1].as_of_date,
                    metrics=self._compute_metrics(rows),
                )
            )
        return out

    def _segment_id(self, day: date, frequency: str) -> str:
        if frequency == "monthly":
            return f"{day.year:04d}-{day.month:02d}"
        quarter = ((day.month - 1) // 3) + 1
        return f"{day.year:04d}-Q{quarter}"

    def _compute_metrics(self, points: list[_EvalPoint]) -> BacktestMetrics:
        n = len(points)
        if n == 0:
            return BacktestMetrics(sample_count=0, coverage=0.0)

        tp = sum(1 for p in points if p.prediction == "buy" and p.actual == "buy")
        fp = sum(1 for p in points if p.prediction == "buy" and p.actual == "sell")
        fn = sum(1 for p in points if p.prediction == "sell" and p.actual == "buy")
        tn = sum(1 for p in points if p.prediction == "sell" and p.actual == "sell")

        correct = tp + tn
        accuracy = correct / n if n else 0.0
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

        return BacktestMetrics(
            sample_count=n,
            correct_count=correct,
            accuracy=round(accuracy, 4),
            precision_buy=round(precision, 4),
            recall_buy=round(recall, 4),
            f1_buy=round(f1, 4),
            tp=tp,
            fp=fp,
            fn=fn,
            tn=tn,
            coverage=1.0,
        )

    async def _measure_llm_consistency(
        self,
        *,
        req: BacktestRunRequest,
        symbol: str,
        eval_points: list[_EvalPoint],
    ) -> LLMConsistencyResult:
        if not eval_points:
            return LLMConsistencyResult()

        if req.mode == "llm_full":
            sampled = eval_points
        else:
            sample_size = min(req.llm_sample_size, len(eval_points))
            rng = random.Random(42)
            sampled = rng.sample(eval_points, sample_size)

        matched = 0
        compared = 0

        for point in sampled:
            llm_side = await self._llm_side_for_date(
                symbol=symbol,
                as_of_date=point.as_of_date,
                lookback_days=req.lookback_days,
            )
            if llm_side is None:
                continue
            compared += 1
            if llm_side == point.prediction:
                matched += 1

        sampled_count = len(sampled)
        consistency = (matched / compared) if compared else 0.0
        coverage = (compared / sampled_count) if sampled_count else 0.0

        return LLMConsistencyResult(
            sampled_count=sampled_count,
            compared_count=compared,
            matched_count=matched,
            consistency_rate=round(consistency, 4),
            llm_coverage=round(coverage, 4),
        )

    async def _llm_side_for_date(self, *, symbol: str, as_of_date: date, lookback_days: int) -> Optional[str]:
        intent = ParsedIntent(
            symbols=[symbol],
            date_start=as_of_date - timedelta(days=lookback_days),
            date_end=as_of_date,
            original_query=_QUERY_TEMPLATE.format(symbol=symbol),
        )

        try:
            payload = await self._pipeline.run_report(intent, request_id=f"bt-{symbol}-{as_of_date.isoformat()}")
        except Exception:
            logger.warning("LLM consistency replay failed symbol=%s as_of=%s", symbol, as_of_date, exc_info=True)
            return None

        rec_text = (payload.final_result.recommendation or "").lower()
        if "buy" in rec_text or "買" in rec_text:
            return "buy"
        if "sell" in rec_text or "賣" in rec_text:
            return "sell"
        return None

    @staticmethod
    def _price_to_dict(row) -> dict:
        return {
            "date": row.date.isoformat(),
            "open": float(row.open) if row.open is not None else None,
            "high": float(row.high) if row.high is not None else None,
            "low": float(row.low) if row.low is not None else None,
            "close": float(row.close) if row.close is not None else None,
            "volume": int(row.volume_shares) if row.volume_shares is not None else None,
            "change": float(row.change) if row.change is not None else None,
        }

    @staticmethod
    def _indicator_to_dict(row) -> dict:
        return {
            "date": row.date.isoformat(),
            "ma5": float(row.ma5) if row.ma5 is not None else None,
            "ma10": float(row.ma10) if row.ma10 is not None else None,
            "ma20": float(row.ma20) if row.ma20 is not None else None,
            "ma60": float(row.ma60) if row.ma60 is not None else None,
            "k_value": float(row.k_value) if row.k_value is not None else None,
            "d_value": float(row.d_value) if row.d_value is not None else None,
            "rsi14": float(row.rsi14) if row.rsi14 is not None else None,
            "macd": float(row.macd) if row.macd is not None else None,
            "macd_signal": float(row.macd_signal) if row.macd_signal is not None else None,
            "macd_hist": float(row.macd_hist) if row.macd_hist is not None else None,
            "bb_upper": float(row.bb_upper) if row.bb_upper is not None else None,
            "bb_middle": float(row.bb_middle) if row.bb_middle is not None else None,
            "bb_lower": float(row.bb_lower) if row.bb_lower is not None else None,
        }

    @staticmethod
    def _institutional_to_dict(row) -> dict:
        return {
            "date": row.date.isoformat(),
            "foreign_net": int(row.foreign_excl_dealer_net or 0) + int(row.foreign_dealer_net or 0),
            "trust_net": int(row.investment_trust_net or 0),
            "dealer_net": int(row.dealer_net_total or 0),
            "total_net": int(row.total_net or 0),
        }
