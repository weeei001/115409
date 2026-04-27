from __future__ import annotations

import asyncio
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable

from services.advisor.runtime import AdvisorRuntimeStore
from services.core_mode import CoreModeService
from trend_core import CoreModePresetStore

MaybeAsyncDictHandler = Callable[[dict[str, Any]], Awaitable[None] | None]
MaybeAsyncErrorHandler = Callable[[str], Awaitable[None] | None]


class BacktestSnapshotService:
    def __init__(
        self,
        *,
        preset_store_path: Path,
        runtime_store: AdvisorRuntimeStore,
        compute_timeout_sec: float = 10.0,
    ) -> None:
        self._runtime_store = runtime_store
        self._preset_store = CoreModePresetStore(preset_store_path)
        self._core_mode_service = CoreModeService(preset_store_path=preset_store_path)
        self._compute_timeout_sec = max(1.0, float(compute_timeout_sec))

    @staticmethod
    def _resolve_start_date(as_of_date: date, window_spec: str) -> date:
        token = (window_spec or "1y").strip().lower()
        match = re.fullmatch(r"(\d+)([dmy])", token)
        if not match:
            return as_of_date - timedelta(days=365)
        amount = max(1, int(match.group(1)))
        unit = match.group(2)
        if unit == "d":
            return as_of_date - timedelta(days=amount)
        if unit == "m":
            return as_of_date - timedelta(days=amount * 30)
        return as_of_date - timedelta(days=amount * 365)

    def build_cache_key(
        self,
        *,
        symbol: str,
        preset_id: str,
        as_of_date: date,
        window_spec: str,
        validation_mode: str,
    ) -> str:
        return "|".join(
            [
                symbol.strip().upper(),
                preset_id,
                as_of_date.isoformat(),
                window_spec.strip().lower() or "1y",
                validation_mode.strip().lower() or "rolling_walk_forward",
            ]
        )

    def _resolve_preset_params(self, *, preset_id: str | None, use_active_preset: bool) -> tuple[str, dict[str, Any]]:
        listed = self._preset_store.list_presets()
        presets = listed.get("presets") or []
        active = listed.get("active_preset")

        selected = None
        if preset_id:
            selected = next((item for item in presets if item.get("id") == preset_id), None)
            if selected is None:
                raise ValueError("找不到指定的 preset")
        elif use_active_preset:
            selected = active
        else:
            selected = active

        if not selected:
            raise ValueError("目前沒有可用 preset")
        return str(selected.get("id") or ""), dict(selected.get("params") or {})

    @staticmethod
    def _build_benchmark_curve(price_chart: dict[str, Any]) -> list[dict[str, Any]]:
        candles = price_chart.get("candles") or []
        if not candles:
            return []
        base = candles[0].get("close") or 0
        if not base:
            return []
        out: list[dict[str, Any]] = []
        for item in candles:
            close = item.get("close")
            if close is None:
                continue
            out.append({"date": item.get("time"), "equity": round(float(close) / float(base), 6)})
        return out

    @staticmethod
    def _build_drawdown_curve(equity_curve: list[dict[str, Any]]) -> list[dict[str, Any]]:
        peak = 0.0
        out: list[dict[str, Any]] = []
        for point in equity_curve:
            equity = float(point.get("equity") or 0.0)
            if equity > peak:
                peak = equity
            drawdown = 0.0 if peak <= 0 else (peak - equity) / peak
            out.append({"date": point.get("date"), "drawdown": round(drawdown, 6)})
        return out

    @staticmethod
    async def _maybe_call(handler: MaybeAsyncDictHandler | MaybeAsyncErrorHandler | None, value: Any) -> None:
        if handler is None:
            return
        result = handler(value)
        if asyncio.iscoroutine(result):
            await result

    def _to_snapshot_payload(
        self,
        *,
        result: dict[str, Any],
        symbol: str,
        preset_id: str,
        as_of_date: date,
        window_spec: str,
        validation_mode: str,
        cache_key: str,
        cache_hit: bool,
    ) -> dict[str, Any]:
        summary = result.get("summary") or {}
        equity_curve = result.get("equity_curve") or []
        price_chart = result.get("price_chart") or {}
        walk_forward = result.get("walk_forward") or {}
        trades = result.get("trades") or []
        regime = result.get("regime_breakdown") or []

        return {
            "status": "ready",
            "cache_hit": cache_hit,
            "cache_key": cache_key,
            "symbol": symbol,
            "preset_id": preset_id,
            "as_of_date": as_of_date.isoformat(),
            "window_spec": window_spec,
            "validation_mode": validation_mode,
            "credibility_summary": {
                "ac": summary.get("ac", 0.0),
                "win_rate": summary.get("win_rate", 0.0),
                "max_drawdown": summary.get("max_drawdown", 0.0),
                "stability": summary.get("stability", 0.0),
                "expectancy": summary.get("expectancy", 0.0),
                "future_trend_quality": summary.get("future_trend_quality", 0.0),
                "cumulative_return": summary.get("cumulative_return", 0.0),
                "trade_count": summary.get("trade_count", 0),
            },
            "price_chart": price_chart,
            "equity_curve": equity_curve,
            "benchmark_curve": self._build_benchmark_curve(price_chart),
            "drawdown_curve": self._build_drawdown_curve(equity_curve),
            "walk_forward_summary": {
                "aggregate": walk_forward.get("aggregate") or {},
                "holdout": walk_forward.get("holdout") or {},
                "fold_count": len(walk_forward.get("folds") or []),
            },
            "regime_summary": regime,
            "trade_preview": trades[:20],
        }

    async def _compute_snapshot_payload(
        self,
        *,
        symbol: str,
        as_of_date: date,
        preset_id: str | None,
        use_active_preset: bool,
        window_spec: str,
        validation_mode: str,
        rolling_settings: dict[str, Any] | None,
        holdout_settings: dict[str, Any] | None,
    ) -> dict[str, Any]:
        resolved_preset_id, params = self._resolve_preset_params(
            preset_id=preset_id,
            use_active_preset=use_active_preset,
        )
        start_date = self._resolve_start_date(as_of_date, window_spec)
        cache_key = self.build_cache_key(
            symbol=symbol,
            preset_id=resolved_preset_id,
            as_of_date=as_of_date,
            window_spec=window_spec,
            validation_mode=validation_mode,
        )
        request = {
            "symbol": symbol,
            "date_range": {
                "start_date": start_date.isoformat(),
                "end_date": as_of_date.isoformat(),
            },
            "params": params,
            "validation_mode": validation_mode,
            "rolling_settings": rolling_settings or {},
            "holdout_settings": holdout_settings or {},
            "run_optimization": False,
        }
        result = await asyncio.wait_for(
            asyncio.to_thread(self._core_mode_service.run_core_mode, request),
            timeout=self._compute_timeout_sec,
        )
        payload = self._to_snapshot_payload(
            result=result,
            symbol=symbol,
            preset_id=resolved_preset_id,
            as_of_date=as_of_date,
            window_spec=window_spec,
            validation_mode=validation_mode,
            cache_key=cache_key,
            cache_hit=False,
        )
        self._runtime_store.set_backtest_cache(cache_key, payload)
        return payload

    def get_cached_snapshot(
        self,
        *,
        symbol: str,
        as_of_date: date,
        preset_id: str | None,
        use_active_preset: bool,
        window_spec: str,
        validation_mode: str,
    ) -> dict[str, Any] | None:
        resolved_preset_id, _ = self._resolve_preset_params(
            preset_id=preset_id,
            use_active_preset=use_active_preset,
        )
        cache_key = self.build_cache_key(
            symbol=symbol,
            preset_id=resolved_preset_id,
            as_of_date=as_of_date,
            window_spec=window_spec,
            validation_mode=validation_mode,
        )
        cached = self._runtime_store.get_backtest_cache(cache_key)
        if not cached:
            return None
        cached["cache_hit"] = True
        return cached

    def enqueue_snapshot(
        self,
        *,
        symbol: str,
        as_of_date: date,
        preset_id: str | None,
        use_active_preset: bool,
        window_spec: str,
        validation_mode: str,
        rolling_settings: dict[str, Any] | None,
        holdout_settings: dict[str, Any] | None,
        on_ready: MaybeAsyncDictHandler | None = None,
        on_failed: MaybeAsyncErrorHandler | None = None,
    ) -> tuple[str, asyncio.Task[bool]]:
        resolved_preset_id, _ = self._resolve_preset_params(
            preset_id=preset_id,
            use_active_preset=use_active_preset,
        )
        cache_key = self.build_cache_key(
            symbol=symbol,
            preset_id=resolved_preset_id,
            as_of_date=as_of_date,
            window_spec=window_spec,
            validation_mode=validation_mode,
        )
        cached = self._runtime_store.get_backtest_cache(cache_key)
        if cached:
            async def _ready_task() -> bool:
                if on_ready:
                    await self._maybe_call(on_ready, {**cached, "cache_hit": True})
                return True

            return cache_key, asyncio.create_task(_ready_task())

        inflight = self._runtime_store.get_backtest_inflight(cache_key)
        if inflight:
            return cache_key, inflight

        async def _runner() -> bool:
            try:
                payload = await self._compute_snapshot_payload(
                    symbol=symbol,
                    as_of_date=as_of_date,
                    preset_id=preset_id,
                    use_active_preset=use_active_preset,
                    window_spec=window_spec,
                    validation_mode=validation_mode,
                    rolling_settings=rolling_settings,
                    holdout_settings=holdout_settings,
                )
                await self._maybe_call(on_ready, payload)
                return True
            except Exception as exc:
                message = str(exc) or "core backtest snapshot 逾時或失敗"
                await self._maybe_call(on_failed, message)
                return False
            finally:
                self._runtime_store.clear_backtest_inflight(cache_key)

        task = asyncio.create_task(_runner())
        self._runtime_store.set_backtest_inflight(cache_key, task)
        return cache_key, task

