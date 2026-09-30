# AGENTS.md

## Outcome and autonomy

Complete the requested outcome and proportionate verification within the authorized scope. Choose the approach, tools, reading depth, and useful parallel work yourself. Resolve routine decisions; ask only when missing information materially changes the result or additional authorization is required. Reuse authorization already given. Stop when the task is complete.

Communicate in Taiwan Traditional Chinese by default. Write implementation artifacts in English unless requested otherwise. Keep explanations concise, preserve unrelated user changes, and report verification limits honestly. Explicit user instructions take precedence over this file, within platform constraints.

## Where to work

- Backend: `backend/app/`; tests: `backend/tests/`; API entry: `app.main:app` from `backend/`.
- Frontend: `frontend/Topic/`, Next.js Pages Router with npm and `package-lock.json`. `frontend/topictest/` is historical, not the active app.
- Use [README.md](README.md) for setup and [docs/README.md](docs/README.md) for backend boundaries, benchmark operations, and verification limits. Read the parts relevant to the task.
- Keep secrets, machine-local `.env` files, `deploy/`, `.state/`, `qdrant_db/`, and generated outputs out of commits. Preserve local data unless the task requires a change; sanitized example configuration can be maintained with the source.
- Keep machine-specific deployment runbooks, service configurations, and deployment scripts local; do not commit them.

## Design constraints

Apply SOLID, DRY, and YAGNI to the problem at hand. Trace affected callers before changing shared behavior. Prefer existing helpers, the standard library, and native framework features; introduce abstractions or dependencies when the current requirement justifies them. Preserve API and data contracts unless the requested change includes altering them.

- Routers handle HTTP validation and dependency injection. Services coordinate use cases and transactions. Repositories execute SQL without committing or rolling back.
- Domain services remain independent of FastAPI. API features and clients do not import `app.jobs`; workers use shared feature logic and database mappings.
- Use FastAPI dependencies and existing constructor injection for substitutions. `app/main.py` owns resource lifespan, including the serial scheduler in `app.jobs.runtime`. API startup must not create tables; imports must not establish external connections or start jobs. Only the lifespan imports the job runtime; API features and clients remain independent of workers.
- News recognition lives in `features/news/sentiment.py`, chunking in `features/retrieval/chunking.py`, and the shared chunk table in `db/models/news_chunk.py`. The old worker chunking import remains a compatibility export for offline scripts.
- Reuse `core/streaming.py` for SSE. Preserve endpoint frames, headers, number policies, and iterator cleanup when changing streaming paths.

## Verification and operational context

Choose checks that exercise the changed behavior; expand only for a failure or unresolved risk. Local backend fixtures use disposable SQLite and disable `.env` loading. Run relevant local checks without asking again. Documentation-only edits normally need command/path/link verification, not a full test run.

With the backend dependencies installed, useful commands are:

| Working directory | Check |
| --- | --- |
| Repository root | `python -m pytest backend/tests/test_architecture.py backend/tests/test_system.py backend/tests/test_streaming.py -q` |
| Repository root | `python -m pytest backend/tests -q` when broad regression coverage is needed |
| `frontend/Topic/` | `npm.cmd run lint -- --incremental false` |
| `frontend/Topic/` | `npm.cmd run test:chat` or `npm.cmd run test:compare` for the affected feature |

Use the configured Python interpreter; `npm` replaces `npm.cmd` outside Windows. Check the [documented verification limits](docs/README.md#已知驗證限制) before interpreting a full-suite result. Do not mask regressions or rewrite unrelated tests to make the suite green.

Runtime operations are separate from tests: worker commands can write data or call paid providers. In particular, `migrate-news-schema` and `migrate-news-impact-schema` execute even with `--help`. Inspect their dispatch before running them and stay within existing authorization. `/health` checks the API process only; database and provider readiness require separate evidence.

Development uses `APP_ENV=development`, `backend/.env.development`, database/account/collection names ending in `_dev`, and `backend/.state/development/`. Start the backend and frontend independently in separate terminals using the native CLI commands in README.md. Do not copy production credentials into development settings.
