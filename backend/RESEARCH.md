# Methodology experiments

Bob's daily/weekly training anchors, resumable cases, stratified induction,
temporal split with a 20-anchor embargo, learning curves, and paired learned-prompt
backtests run as independent backend jobs. The API and scheduler do not start them.

Run from `backend/` with the normal backend dependencies and `.env`:

```powershell
python -m app.jobs methodology-train --stock 2330 --period day --train-start 2023-01-01 --train-end 2024-12-31 --build-cases-only
python -m app.jobs methodology-train --stock 2330 --period day --train-start 2023-01-01 --train-end 2024-12-31 --curve 50,150,300,all
python -m app.jobs methodology-train --stock 2330 --period day --train-start 2023-01-01 --train-end 2024-12-31
python -m app.jobs backtest-learned --stock 2330 --period day --start 2025-01-01 --end 2025-12-31 --methodology-dir .state/methodology/2330_2023-01-01_2024-12-31_day
```

Use `--help` for each command. Building cases uses embedding requests but does not
call the chat model. Training and backtesting explicitly call the configured model.
`--limit` bounds cases; `--rounds 0` runs induction without refinement.

- `ANALYSIS_LLM_*` (and existing backend aliases) select the endpoint, key and model.
  Both legacy `--provider` values use these settings; `h200` additionally sends
  Bob's thinking-disabled request option. No provider URL is hardcoded.
- `DATABASE_*` selects imported `market_daily_prices`. Prices are database closes,
  not Yahoo adjusted prices; comparisons against old Yahoo runs require matching
  price adjustments and coverage. Import the historical prices before building cases.
- `QDRANT_*` and `EMBED_*` use the backend vector client, including its index/version
  filters and Taiwan timezone. Research uses the stored retrieved article chunks.
- Artifacts live under `backend/.state/`, outside source control. Training directories
  include the anchor period. A learning curve writes `learning_curve.json` and
  per-size versions under `curve/`; ordinary training writes `best.json` and prompt
  versions for the backtest command. Backtests write CSV decisions and JSON metrics.

`--induction-cases` defaults to 40: each curve tier changes the available training
pool, while at most 40 stratified cases enter the induction prompt. Increase the
cap explicitly when the model context permits. The curve therefore measures pool
size under a fixed prompt budget, not necessarily increasing prompt sample count.
Refinement uses held-out errors, so these scores are validation scores; evaluate
the selected prompt on a separate later period with `backtest-learned`.

The old `rag_deploy/` scripts remain historical references. The backend jobs import
no legacy modules and require neither yfinance nor the old Qdrant/LangChain SDKs.
Main's current chat rendering and automatic sentiment schedule remain in place;
Bob's older reply-format normalizer is superseded by that chat implementation.

Offline verification:

```powershell
python -m pytest tests -q
```

At migration time, the unchanged `main` baseline also fails seven tests: six legacy
contract/news probes require the removed `backend/config.py`, and the RAG integration
fixture uses July 2026 news outside the current chat time window. These are unrelated
to the research jobs. The new research tests and worker architecture checks run offline.
