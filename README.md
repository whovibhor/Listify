# Listify

Task and work management for individuals and organizations: a private **Personal Workspace** plus **Organization Workspaces** with departments, role-based access, department Work Boards and dashboards.

- Requirements: [`docs/WorkPulse_BRD_v1.docx`](docs/WorkPulse_BRD_v1.docx), [`docs/WorkPulse_PRD_v1.docx`](docs/WorkPulse_PRD_v1.docx)
- Analysis and plan: [`docs/requirements-analysis.md`](docs/requirements-analysis.md), [`docs/implementation-roadmap.md`](docs/implementation-roadmap.md), [`docs/architecture-decisions.md`](docs/architecture-decisions.md)
- Status: **Phases 0–4 complete (foundation, accounts, personal workspace, organizations, roles & member management); Phase 5 (Department Work Boards) next.** What's done and pending, feature by feature: [`docs/feature-status.md`](docs/feature-status.md). Phase tracker: [`docs/implementation-roadmap.md`](docs/implementation-roadmap.md) · history: [`docs/development-log.md`](docs/development-log.md).

## Repository layout

```
docs/        requirements, ADRs, roadmap, design docs, development log
backend/     FastAPI modular monolith (Python 3.12, SQLAlchemy 2, Alembic, MySQL)
frontend/    React + TypeScript + Vite SPA (Tailwind v4, shadcn/ui, TanStack Query)
scripts/     developer scripts (check.ps1 runs every quality gate)
```

## Required tools

| Tool | Version used | Notes |
|---|---|---|
| Python | 3.12.x | `python --version` |
| Node.js | 22 LTS or newer (developed on 26.13) | ships with npm |
| Git | any recent | |
| MySQL | 8.4 (WAMP `wampmysqld64`, port 3306) | do **not** use the MariaDB instance on 3307 |

## 1. MySQL setup (WAMP)

1. Make sure the WAMP tray icon is green and the `wampmysqld64` service is running.
2. Open phpMyAdmin (`http://localhost/phpmyadmin`) and select the **MySQL** server (not MariaDB).
3. Create the development and test databases (the test database name must end in `_test`):

   ```sql
   CREATE DATABASE listify      CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   CREATE DATABASE listify_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   ```

   This machine uses the WAMP `root` account with no password for local development. Anywhere else, create a dedicated user and grant it only these two databases. The app forces InnoDB, strict SQL mode and UTC on every connection, so WAMP's defaults (MyISAM, non-strict) don't matter.

## 2. Backend setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
copy .env.example .env          # then edit DB_* values and SESSION_SECRET
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

- API: <http://127.0.0.1:8000/api/v1/health> · interactive docs (non-production only): <http://127.0.0.1:8000/api/docs>
- `requirements.lock.txt` pins the exact versions last verified (runtime + dev tools); `pyproject.toml` holds the supported ranges. After upgrading packages, regenerate it with `pip freeze > requirements.lock.txt`.

### Environment variables (`backend/.env`)

| Variable | Purpose | Example |
|---|---|---|
| `APP_ENV` | `development`, `test` or `production` (production enforces secure settings at startup) | `development` |
| `LOG_LEVEL` | `DEBUG`/`INFO`/`WARNING`/`ERROR` | `INFO` |
| `DB_HOST`, `DB_PORT` | MySQL server | `127.0.0.1`, `3306` |
| `DB_NAME`, `DB_TEST_NAME` | development and test databases | `listify`, `listify_test` |
| `DB_USER`, `DB_PASSWORD` | DB account (empty password allowed outside production) | `root`, *(empty)* |
| `FRONTEND_ORIGINS` | comma-separated origins allowed by CORS | `http://localhost:5173` |
| `FRONTEND_BASE_URL` | public URL of the SPA, used in password-reset links | `http://localhost:5173` |
| `SESSION_SECRET` | ≥ 32 random chars (signs CSRF tokens); `python -c "import secrets; print(secrets.token_urlsafe(48))"` | — |
| `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_MINUTES` | session idle timeout / maximum lifetime | `720`, `10080` |
| `PASSWORD_RESET_TTL_MINUTES` | reset-link lifetime | `60` |
| `COOKIE_SECURE` | force `Secure` cookies (defaults to on only in production) | *(unset)* |
| `MAIL_BACKEND` | `console` (dev: emails, including reset links, are written to the backend log) or `smtp` (Phase 8) | `console` |

## 3. Frontend setup

```powershell
cd frontend
npm install
npm run dev                     # http://localhost:5173 — proxies /api to the backend
```

Optional `frontend/.env.local` (see `.env.example`): `VITE_API_BASE_URL` (default `/api/v1`), `VITE_API_PROXY_TARGET` (default `http://127.0.0.1:8000`).

## Common commands

| Task | Command |
|---|---|
| All quality gates | `powershell -ExecutionPolicy Bypass -File scripts\check.ps1` |
| Backend tests | `cd backend; .\.venv\Scripts\python.exe -m pytest` |
| Backend lint / format | `.\.venv\Scripts\ruff.exe check .` / `.\.venv\Scripts\ruff.exe format .` |
| New migration | `.\.venv\Scripts\alembic.exe revision --autogenerate -m "describe change"` |
| Apply / roll back migrations | `alembic upgrade head` / `alembic downgrade -1` |
| Migrate the test DB | `alembic -x test=true upgrade head` |
| Frontend tests | `cd frontend; npm test` (watch: `npm run test:watch`) |
| Frontend lint / format / types | `npm run lint` / `npm run format` / `npm run typecheck` |
| Frontend production build | `npm run build` (output in `frontend/dist`) |
| End-to-end tests | `cd frontend; npm run test:e2e` (first time: `npx playwright install chromium`). Starts its own backend on :8001 against `listify_test` and Vite on :5174, after resetting the test database. |
| Reset the test database | `cd backend; .\.venv\Scripts\python.exe -m scripts.reset_test_db` (refuses unless the name ends in `_test`) |

**Trying the app locally:** start the backend and frontend, open <http://localhost:5173>, create an account. To test "forgot password", submit the form, then copy the reset link from the backend log line `Email (console backend, not sent)`.

**CI:** `.github/workflows/ci.yml` runs lint, formatting, migrations round-trip, backend tests against a MySQL 8.4 service, frontend tests and build, the production dependency audit, and the Playwright suite. It runs once the repository is pushed to GitHub.

## Common setup problems

- **`ImportError: DLL load failed ... An Application Control policy has blocked this file`** — Windows Smart App Control can block a freshly installed native wheel (seen once with SQLAlchemy) on first load while it checks reputation. Re-run the command; if it persists, allow the file in Windows Security.
- **Health shows `Database: Unavailable` / `Access denied for user`** — check `DB_*` in `backend/.env` and that you are on port 3306 (MySQL), not 3307 (MariaDB). The backend log contains a one-line reason.
- **`node`/`npm`/`git` not recognized** after installing — open a new terminal (or restart the app) so the updated PATH is picked up.
- **Port already in use** — the frontend uses a strict port 5173 and the backend 8000 (E2E uses 5174/8001); stop the other process or change the port.
- **Blank page and `504 (Outdated Optimize Dep)` in the browser console** — Vite's pre-bundled dependencies are stale after installing packages. Restart `npm run dev`.
- **Every form submit fails with "Security token missing or invalid"** — the browser is blocking cookies for `localhost`, or you're calling the API from a different origin. Use the Vite URL (requests go through its `/api` proxy).
- **Prettier/ESLint disagree** — run `npm run format` then `npm run lint`; ESLint's stylistic rules are disabled in favour of Prettier.

## Security notes

- Never commit `.env` files; only `.env.example` placeholders are tracked.
- All authorization is enforced server-side (see ADR-010). Frontend hiding is only a usability aid.
