# 115409
G115409

## Market benchmark deployment

The comparison API uses the official [TWSE TAIEX monthly history](https://www.twse.com.tw/zh/indices/taiex/mi-5min-hist.html), a price index excluding cash dividends. It is not the total return index; corporate actions follow TWSE index methodology.

Run the initial import from `backend/` using the backend database configuration:

```powershell
python -m app.jobs market-backfill --benchmark-only --start 2024-09-25 --end 2026-09-25
```

The worker creates only the additive `market_benchmark_prices` table if missing, then upserts monthly history. It does not modify existing stock tables. The worker's database account needs permission to create this table during initial deployment. API requests never create tables: before initialization the benchmark endpoint returns HTTP 503; an initialized table without matching rows returns HTTP 200 with `data: []`. The frontend keeps individual-stock comparisons available when the benchmark is unavailable.

The existing market scheduler now runs an incremental benchmark import after the stock import. To run it manually:

```powershell
python -m app.jobs market-backfill --benchmark-only --incremental --start 2024-09-25
```

`--end` defaults to today. Incremental runs refresh the latest stored month and later months; omit `--incremental` to repair older gaps or revisions. Change the initial date range to match the desired comparison coverage.

Read the imported series with `/stocks/benchmark/history?start_date=2024-09-25&end_date=2026-09-25`. Its metadata identifies `TAIEX`, `TWSE`, and `price_index_excluding_dividends`; daily closes are numbers and absent dates are not filled. The runtime `/openapi.json` documents this contract. This checkout has no tracked OpenAPI snapshot or generator; the frontend's `sync:openapi` package command references a missing script.

Offline verification:

```powershell
python -m pytest tests/test_benchmark.py tests/test_scheduler.py -q
```
