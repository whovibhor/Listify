# WorkPulse — Architecture Decision Records

Format: each ADR states context, decision and consequences. Status is **Accepted** unless noted. "Owner-confirmed" means the product owner explicitly chose it on 2026-10-29.

---

## ADR-001 Backend framework: FastAPI (overrides PRD §10/§19)

- **Context:** PRD recommends Laravel + Sanctum. The product owner's build instructions mandate Python/FastAPI. PRD §10.2 lists FastAPI as Option C with the trade-off "more decisions and wiring for admin, permissions, queues and business workflow conventions".
- **Decision:** FastAPI + Pydantic v2 + SQLAlchemy 2.0 + Alembic + PyMySQL. Owner-confirmed.
- **Consequences:** We build explicitly what Laravel provides: a policy layer (ADR-010), session auth + CSRF (ADR-004/006), a mail abstraction (ADR-017), a job runner (ADR-008), seeders, and rate limiting (ADR-009).

## ADR-002 Modular monolith

- **Decision:** One FastAPI deployment; code organized under `backend/app/modules/<domain>/` with `router.py` (HTTP), `schemas.py` (Pydantic I/O), `models.py` (SQLAlchemy), `service.py` (business rules, transactions), `policies.py` (authorization) where needed. Cross-module calls go through services, never another module's router.
- **Consequences:** Modules are added only when a milestone needs them — no empty scaffolding.

## ADR-003 Database: MySQL 8.4 (WAMP, port 3306)

- **Context:** WAMP runs MySQL 8.4.7 on 3306 and MariaDB 11.4.9 on 3307.
- **Decision:** MySQL 8.4.7, InnoDB, `utf8mb4` / `utf8mb4_0900_ai_ci`, driver `mysql+pymysql`. Owner-confirmed. All timestamps stored as UTC in `DATETIME(6)` columns; the app always writes timezone-aware UTC and converts at the edges.
- **Consequences:** No SQLite fallback. Tests run against a dedicated MySQL test database (`<db>_test`) so constraint behavior matches production.

## ADR-004 Authentication: server-side sessions in HttpOnly cookies

- **Context:** First-party SPA + API. PRD §11.1 requires secure HttpOnly cookies and CSRF protection.
- **Decision:** Opaque random session ID (256-bit, `secrets.token_urlsafe`) in cookie `wp_session`; the database stores only its SHA-256 hash in a `sessions` table with `user_id`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`, `ip`, `user_agent`. Cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`. Idle timeout 12 h, absolute 7 d. Session ID is rotated on login and on password change; all sessions revoked on password reset. Logout revokes the row.
- **Why not JWT:** revocation (FR-AUTH-02 "logout invalidates the session") and access-revocation predictability (O7) are simpler with server state.
- **Consequences:** One indexed lookup per request; acceptable at MVP scale.

## ADR-005 Identity providers deferred

- **Decision:** MVP uses email + password only. FR-AUTH-01's "approved identity provider" is deferred; `users.password_hash` is nullable-ready for future OAuth accounts via a separate `user_identities` table.

## ADR-006 CSRF and CORS

- **Decision:** Double-submit CSRF token: on session creation the API sets a non-HttpOnly `wp_csrf` cookie; the SPA echoes it in the `X-CSRF-Token` header for every unsafe method (POST/PUT/PATCH/DELETE). The server compares it with a value bound to the session (HMAC of session ID). Visitors without a session get a random token from `GET /auth/csrf` (the API client fetches it automatically before the first unsafe request). With a session, that endpoint re-derives the bound token, so a lost cookie heals itself; the client retries once on `csrf_failed`. Implemented as a dependency on the whole `/api/v1` router (`csrf_protect`). Combined with `SameSite=Lax`. CORS allows only the configured `FRONTEND_ORIGINS`, `allow_credentials=True`, no wildcard. In local dev the Vite dev server proxies `/api` to the backend, so the browser sees a single origin.

## ADR-007 Password hashing: Argon2id via `argon2-cffi`

- **Decision:** `argon2-cffi` `PasswordHasher` (Argon2id, library defaults ≥ RFC 9106 low-memory profile), `check_needs_rehash` on login. Password policy: 12–128 chars, common-password blocklist (NIST 800-63B style).

## ADR-008 Background jobs: Redis + Celery + Beat, from Milestone 8

- **Decision:** Owner-confirmed Redis + Celery (worker + Beat). Introduced in Milestone 8 (deadline/overdue reminders, notification fan-out, update-request expiry). Before M8, in-app notifications are inserted in the same transaction as the triggering change (cheap, no external delivery). Tasks must be idempotent (dedupe key per notification). On Windows dev, Redis runs via Memurai or WSL2 (decided at M8); worker uses `--pool=solo`.

## ADR-009 Rate limiting

- **Decision:** Login, password reset, registration, invitations and membership requests are rate-limited. Pre-Redis: a small MySQL-backed fixed-window limiter keyed by (action, IP/email hash). Swap to Redis at M8 without changing call sites.

## ADR-010 Authorization: centralized policy layer

- **Decision:** All permission decisions go through `app/modules/permissions/`:
  - `resolve_membership(user, org_id)` → active membership + effective permissions (union of role permissions, department-scoped where applicable). Cached per request.
  - Policy functions per resource (`can_view_task`, `can_update_task`, `can_view_board`, …) return bool and are the only place rules live.
  - Query scoping helpers (`visible_tasks_query(user, scope)`) build the WHERE clauses for lists, search, dashboards and exports, so list filters can't diverge from object checks.
  - Route dependencies (`require_org_permission("task.create")`) for coarse checks; services call policies for object checks.
  - Organization scope is always taken from the route + verified membership, never from request bodies.
- **Consequences:** Every endpoint test suite includes a forbidden/cross-tenant case. Unauthorized object access returns **404** (not 403) to avoid confirming existence across tenants; 403 is used when the resource is visible but the action isn't permitted.

## ADR-011 Predefined roles and baseline permission matrix (proposed; finalized in M4)

| Permission | Owner | Admin | Dept Manager* | Team Lead* | Member |
|---|:-:|:-:|:-:|:-:|:-:|
| task.create | ✓ | ✓ | ✓ | ✓ | ✓ |
| task.view_own | ✓ | ✓ | ✓ | ✓ | ✓ |
| task.view_department | ✓ | ✓ | ✓ | ✓ | ✓ (own depts) |
| task.view_organization | ✓ | ✓ | – | – | – |
| task.assign | ✓ | ✓ | ✓ | ✓ | – |
| task.update | ✓ | ✓ | ✓ | ✓ | ✓ (own/assigned/collab) |
| task.delete | ✓ | ✓ | ✓ | – | – (own created) |
| task.comment | ✓ | ✓ | ✓ | ✓ | ✓ |
| task.manage_collaborators | ✓ | ✓ | ✓ | ✓ | – (own created) |
| task.request_update | ✓ | ✓ | ✓ | ✓ | – |
| member.view | ✓ | ✓ | ✓ | ✓ | ✓ (dept) |
| member.approve | ✓ | ✓ | ✓ (own dept) | – | – |
| member.manage | ✓ | ✓ | – | – | – |
| department.create | ✓ | ✓ | – | – | – |
| department.update | ✓ | ✓ | ✓ (own dept) | – | – |
| role.assign | ✓ | ✓ (not Owner) | – | – | – |
| report.view_personal | ✓ | ✓ | ✓ | ✓ | ✓ |
| report.view_department | ✓ | ✓ | ✓ | ✓ | – |
| report.view_organization | ✓ | ✓ | – | – | – |
| organization.settings.update | ✓ | ✓ | – | – | – |
| owner transfer / org archive | ✓ | – | – | – | – |

\* department-scoped role assignment.

## ADR-012 API conventions

- Prefix `/api/v1`. Resource-oriented routes; PRD §9 paths adopted with the version prefix (e.g. `/api/v1/me/tasks`).
- Errors: `{"error": {"code": "string", "message": "string", "details": [...], "request_id": "..."}}` for all non-2xx, including validation (422) and unexpected errors (500 with no internals).
- Pagination: `?page=1&page_size=25` (max 100) → `{"items": [...], "page", "page_size", "total"}`. Cursor pagination may be added for activity feeds.
- Sorting `?sort=due_at,-priority`; filters as explicit query params.
- Request/response Pydantic schemas are separate from ORM models; responses never include hashes, tokens or internal flags.
- OpenAPI docs at `/api/docs` in non-production only.

## ADR-013 Frontend architecture

- React 19 + TypeScript + Vite, Tailwind CSS v4 (CSS-first `@theme` tokens), shadcn/ui (Radix primitives, copied into `src/components/ui`), React Router (data router), TanStack Query for server state, React Hook Form + Zod, Lucide, Motion, Sonner, date-fns (+ `@date-fns/tz`), Recharts, TanStack Table where tables need it.
- Feature folders under `src/features/*`; API calls only through `src/lib/api-client.ts` + per-feature `api.ts` and query hooks. No global store for server data. Auth state = TanStack Query `['me']` query; route guards read it.
- Vite dev server proxies `/api` → `http://127.0.0.1:8000` (same-origin in dev).

## ADR-014 Organization discovery

- Owner-confirmed: private by default; invitation links always work; owner can set `is_discoverable` to allow name search. Search returns only name, slug, logo, short description for discoverable orgs.

## ADR-015 Task status transition policy

Statuses: `not_started`, `in_progress`, `blocked`, `in_review`, `completed`, `cancelled`. Terminal: `completed`, `cancelled`.

| From → To | Allowed | Notes |
|---|---|---|
| not_started → in_progress | ✓ | |
| not_started → completed | ✓ only when review not required | quick completion for simple tasks (NFR-06) |
| in_progress → blocked | ✓ | optional reason recorded in activity |
| blocked → in_progress | ✓ | |
| in_progress → not_started | ✓ | *(added in Phase 2)* undo an accidental start |
| blocked → completed | ✓ only when review not required | *(added in Phase 2)* ticking a blocked checklist item done |
| in_progress → in_review | ✓ if org `review_required` | hidden in personal workspace |
| in_progress → completed | ✓ only when review not required | |
| in_review → completed | ✓ | any user with `task.update` in scope (creator, assigner or manager) |
| in_review → in_progress | ✓ | changes requested |
| any non-terminal → cancelled | ✓ | optional reason |
| completed → in_progress | ✓ (reopen) | clears `completed_at`, keeps completion event in history |
| cancelled → not_started | ✓ (restore) | |

Parent tasks cannot move to `completed` while any subtask is still open (not completed or cancelled). The table lives in `backend/app/modules/tasks/transitions.py` and is covered by parametrized tests.

## ADR-016 Subtasks as child tasks

- `tasks.parent_task_id` (self FK, one level deep in MVP). Subtask inherits workspace, organization, department and visibility from parent; it is validated at write time.

## ADR-017 Email abstraction

- `Mailer` protocol with `ConsoleMailer` (logs message, dev default) and `SmtpMailer` (later). Configured via `MAIL_BACKEND`. Owner-confirmed.

## ADR-018 Attachments (Milestone 6)

- `StorageBackend` protocol; `LocalStorage` under `backend/storage/` (gitignored) for dev; S3-compatible later. Downloads always pass an authorization check, served via short-lived signed URL or streamed response. Size/MIME allowlist, randomized storage keys, original filename only as metadata.

## ADR-019 Time and timezone policy

- Store UTC. Users have `timezone` (IANA, default from browser at registration); organizations have `timezone` (default creator's). Personal metrics use user timezone; org/department metrics use org timezone. "Overdue" compares `due_at` with the current instant. Period boundaries ("this week") computed in the relevant timezone, weeks start Monday (ISO). Deadlines entered as local date/time in the workspace timezone; date-only deadlines are stored as 23:59:59.999 local.

## ADR-020 Completion attribution snapshot

- On transition to `completed`, store `completed_department_id` and `completed_by` on the task (and in the activity event). Historical reports group by `completed_department_id`; current-workload reports group by current `department_id` (BRD Rule 13, PRD §5.9).

## ADR-021 Tooling

- Backend: Python 3.12, venv at `backend/.venv`, `pyproject.toml` with pinned minimums, Ruff (lint + format), Pytest + HTTPX. HTTPX is installed as `httpx2` (the successor package) because Starlette 1.10's TestClient emits a deprecation warning for `httpx`; we fix warnings rather than suppress them.
- SQLAlchemy resolved to 2.1.x (the current 2.x line); the 2.0-style API is unchanged.
- Frontend: Node 26 LTS, npm, ESLint (flat config), Prettier, Vitest + React Testing Library, Playwright (added when the first full journey exists, M1).
- CI (GitHub Actions) added once the foundation is stable (end of M1).
- No Docker/Kubernetes in MVP. Production: Nginx → Gunicorn with Uvicorn workers under systemd (ADR to be refined in M9).

## ADR-022 Personal view and metric definitions (Phase 2)

All boundaries use the user's profile timezone (ADR-019); "now" is the request time in UTC. Only top-level tasks are listed or counted; subtasks live inside their parent.

| View / metric | Definition |
|---|---|
| My Day | open, not archived, and (`due_at` before the end of today **or** `start_at` before the end of today) |
| My Tasks | open, not archived |
| Upcoming | open, not archived, `due_at` from tomorrow 00:00 to the end of day +14 |
| Completed | status Completed, not archived |
| Done today | status Completed, not archived, `completed_at` since local midnight (My Day's "Done today") |
| Archived | `archived_at` set (read-only until restored) |
| Overdue (flag and metric) | open and `due_at` < now; no deadline ⇒ never overdue |
| Open | not Completed/Cancelled, not archived |
| Completed in period | `completed_at` within the period (archived tasks still count — the work was done; reopened tasks don't — `completed_at` is cleared) |
| On-time rate | of tasks completed in the period that had a deadline, share with `completed_at` ≤ `due_at`; `null` (shown as "—") when none |
| Period | the last 7/30/90 local calendar days including today |
| Trend buckets | completions grouped by local calendar date |

The API returns these sentences in `definitions`, and the UI shows them beside each number, so code and copy share one source.

**Deadlines:** clients send local `due_date` + optional `due_time`; the server converts with the user's timezone. All-day deadlines are stored as 23:59:59.999999 local time, so a task becomes overdue only after its day ends. Responses carry UTC instants plus `due_all_day`, and the SPA formats them in the profile timezone (not the browser's) using `@date-fns/tz`.
