# Denote — Architecture Decision Records

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
- **Decision:** Opaque random session ID (256-bit, `secrets.token_urlsafe`) in cookie `denote_session`; the database stores only its SHA-256 hash in a `sessions` table with `user_id`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`, `ip`, `user_agent`. Cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`. Idle timeout 12 h, absolute 7 d. Session ID is rotated on login and on password change; all sessions revoked on password reset. Logout revokes the row.
- **Why not JWT:** revocation (FR-AUTH-02 "logout invalidates the session") and access-revocation predictability (O7) are simpler with server state.
- **Consequences:** One indexed lookup per request; acceptable at MVP scale.

## ADR-005 Identity providers deferred

- **Decision:** MVP uses email + password only. FR-AUTH-01's "approved identity provider" is deferred; `users.password_hash` is nullable-ready for future OAuth accounts via a separate `user_identities` table.

## ADR-006 CSRF and CORS

- **Decision:** Double-submit CSRF token: on session creation the API sets a non-HttpOnly `denote_csrf` cookie; the SPA echoes it in the `X-CSRF-Token` header for every unsafe method (POST/PUT/PATCH/DELETE). The server compares it with a value bound to the session (HMAC of session ID). Visitors without a session get a random token from `GET /auth/csrf` (the API client fetches it automatically before the first unsafe request). With a session, that endpoint re-derives the bound token, so a lost cookie heals itself; the client retries once on `csrf_failed`. Implemented as a dependency on the whole `/api/v1` router (`csrf_protect`). Combined with `SameSite=Lax`. CORS allows only the configured `FRONTEND_ORIGINS`, `allow_credentials=True`, no wildcard. In local dev the Vite dev server proxies `/api` to the backend, so the browser sees a single origin.

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

## ADR-011 Predefined roles and baseline permission matrix (finalized in M4)

| Permission | Owner | Admin | Dept Manager* | Team Lead* | Member |
|---|:-:|:-:|:-:|:-:|:-:|
| task.create | ✓ | ✓ | ✓ | ✓ | ✓ |
| task.view_own | ✓ | ✓ | ✓ | ✓ | ✓ |
| task.view_department | ✓ | ✓ | ✓ | ✓ | ✓ (own depts) |
| task.view_all *(added in M5)* | ✓ | ✓ | – | – | – |
| task.view_organization *(widened in M5, ADR-027)* | ✓ | ✓ | ✓ | ✓ | ✓ |
| task.assign | ✓ | ✓ | ✓ | ✓ | – (own created, or picking up unassigned work) |
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

## ADR-023 Product name: Denote

- **Decision:** the product is **Denote** (owner, 2026-10-31). It was called Listify before that, and the BRD and PRD use the earlier working name "WorkPulse"; those two source files keep their names. Everything else was renamed, including cookies (`denote_session`, `denote_csrf`), so anyone signed in before the rename signs in once more.
- **Databases too:** `denote` and `denote_test`. MySQL has no database rename, so the tables were moved with one `RENAME TABLE`, after a backup, and row counts were compared before the old empty databases were removed.
- **Not renamed:** the project folder and the GitHub repository are still called Listify. The folder can't move while tools run inside it, and its Python environment holds fixed paths, so moving it means rebuilding `backend/.venv`. Migrations never contained the name.

## ADR-024 Borderless cards

- **Decision:** cards have no borders (owner, 2026-10-30). Separation comes from `--shadow-card` on a tinted page background; rows nested inside a card use a tinted fill instead of their own surface. Hover and selection use shadow or tint. Form fields and outline buttons keep their outlines, because those signal that a control is interactive, and sidebar/header dividers stay as layout lines.

## ADR-025 Organization authorization in practice (Phase 3)

- **Decision:** every org route takes `OrgCtx`, built from the URL and an active membership (ADR-010). Roles and permissions are read from the database; `permissions/catalog.py` mirrors the seed and a test fails if they drift. Department-scoped roles add to the base Member role and apply only to their department.
- **Department visibility:** administrators see all departments; other members see only their own (BR-006), so a department's existence isn't disclosed to the rest of the organization.
- **Direct invitations bypass the discoverable check** because an administrator chose that person. Join requests require a discoverable organization.

## ADR-026 Member management rules (Phase 4)

- **One rule table:** `memberships/policies.py` decides what the current user may do to each member. The API enforces it, and the same result goes to the UI as `actions`, so buttons and enforcement can't disagree. Previews run the same checks as the action.
- **The Owner is protected:** only the Owner touches the Owner's membership, and only their own departments. The Owner's role changes only through ownership transfer, so an organization always has exactly one Owner. Admins can manage other Admins.
- **No self-lockout:** nobody can suspend, remove or re-role themselves.
- **Ownership transfer needs the Owner's password** (rate limited) and makes the old Owner an Admin. The new Owner keeps any department roles.
- **Suspended members keep roles and departments** so reactivation is exact, and can't change state until reactivated (except removal). Removed members lose both; the row stays as history.
- **A transfer is confirmed by the administrator who starts it.** That confirmation is the approval FR-ORG-08 asks for; there is no second approver. The person arrives as a plain member of the new department, and roles limited to the old department end. Organization-wide roles keep their access, which the preview states.
- **Department Managers don't manage members.** `member.manage` and `role.assign` stay with Owner and Admin (ADR-011), so a manager's reach stays limited to approving requests and editing their own department.
- **Department Managers don't manage members** applies to organization-wide actions; ADR-027 covers what they can do to tasks.
- **Revocation needs no session work:** access is read from the database on every request, so a change applies from the person's next request and their session keeps working for personal tasks. In the SPA, any organization 403 or 404 reloads the user's organizations, so navigation and pages follow (PRD §13).
- **Concurrency:** member changes hold a row lock on the organization. The lock is taken after ending the read snapshot from loading `OrgContext`, because InnoDB's repeatable read would otherwise show pre-lock data.

## ADR-027 Organization task access (Phase 5)

- **One visibility rule:** `tasks/policies.py::visible_tasks` is the only definition of who can see a task. Lists, boards, search and single reads all use it, so they can't disagree.
- **Who sees what:** the creator, assignee and collaborators always see a task. Beyond them: Private adds nobody, Department adds members of that department, Selected people adds those chosen, Organization adds every member.
- **Owners and Admins see every task** (`task.view_all`), including Private ones. The PRD left this for us to define. A private task of someone who has left must still be reassignable, so oversight wins, and the UI says so wherever Private is offered. Anything truly private belongs in personal tasks, which organizations can never see.
- **`task.view_organization` went to every role.** With only Owner and Admin holding it, as ADR-011 first had it, Organization visibility would have shown a task to exactly the people who already see everything, making it the same as Private. Only administrators can choose Organization visibility, so a member can't expose department work company-wide.
- **Editing:** the people on a task, plus Team Leads and Department Managers of its department, and administrators. Selected people can read, not edit.
- **Creators who leave:** creator rights only apply while the person is in the task's department, or if it has none. They can still read what they created.
- **Assigning:** the creator or anyone with `task.assign` in that department, following the PRD's "manager, creator or task owner". Anyone who can see an unassigned task can pick it up. Assignees must be active members of the task's department; collaborators can come from any department, and get that task only.
- **Moving between departments** needs `task.assign` in both, so a manager can't push work into a department they don't belong to. It's written to the audit log.
- **People leaving:** tasks stay assigned, with their history, and show as needing reassignment. That's worked out from memberships rather than stored.
- **Review:** with the organization's setting on, work passes through In Review, and only the creator or a manager can approve it. The assignee can't sign off their own work, even if they created it, unless they're an Owner or Admin, so a one-person organization isn't stuck. Subtasks skip review.
- **Organization tasks are archived, never deleted,** with an audit entry. Subtasks can be deleted.
- **Dates use the organization's timezone,** not the viewer's profile, so a deadline is the same day for the whole team (ADR-019).
- **The board is a view of filters, not of order:** cards sort by deadline and priority, so dragging changes status only. A saved card order isn't a PRD requirement.

## ADR-028 Security hardening and accepted risks

- **Decision:** the 2026-10-30 audit findings are fixed in the code, each with a regression test in `tests/test_security_fixes.py`. Status of every finding is in `security-audit.md`.
- **An invitation is only as good as its creator's authority today.** It's checked at acceptance as well as revoked when the creator loses access, so one missed revoke can't reopen the hole.
- **One validation rule for all input:** `InputModel` refuses control characters in every string field, so new fields are covered automatically. Multi-line fields and secrets are listed by name.
- **Limits on creation, not on all writes.** A write limit on every request would add a database commit to each one. Limits on what fills the database stop the same abuse.
- **Accepted for now, by the owner:** sign-in stays unchanged until Login with Google, and the MySQL root account stays unchanged while the app only runs on this PC. Both must be closed before real users or deployment.
- **Security events go to the `denote.security` log,** not `audit_logs`, which is per organization and visible to its admins. The log never holds passwords or the text typed into a failed sign-in.

## ADR-029 Collaboration and notifications (Phase 6)

- **A notification stores references, never content.** No task title or comment text is saved in a notification. The Inbox looks up the title when it's read, after checking access, so a person who has lost access sees "You no longer have access" and nothing else. This also means nothing needs cleaning up when access changes.
- **Notifications are sent after the change commits.** A failure is logged and doesn't undo the change (PRD §13). Sending happens in the request for now; it moves to the background worker in Phase 8.
- **Comments:** authors edit and delete their own. Owners and Admins can delete any comment, but nobody can rewrite someone else's words. Deleting hides the text from every response and leaves a marker. Anyone who can see a task can comment, including people it was only shared with, because `task.comment` says "tasks the user can access".
- **Mentions must point at someone who can see the task.** Otherwise a mention would be a way to tell someone a private task exists.
- **Attachments follow ADR-018.** The file's type comes from its contents, never its name or what the browser claims. HTML and SVG aren't allowed because they can run scripts. Files are stored under random keys, and always download rather than display. Only people who can edit a task can upload, and access is checked on every download.
- **Uploads send the file as the request body** rather than multipart, so no new dependency was needed. The 1 MB request limit rises to 10 MB for that one route.
- **Update requests go to the assignee or a collaborator,** and the database allows one open request per person per task. Removing someone closes the requests waiting on them. Requests don't expire yet.

## ADR-030 Reports (Phase 7)

- **Reports start from `visible_tasks`,** as BRD Rule 14 requires. A Department Manager's numbers can therefore be lower than an Owner's, because private tasks aren't counted, and each report says whose tasks it covers.
- **The trade-off with history:** BRD Rule 13 keeps completed work with its original department, while Rule 14 limits what a reader may see. If a completed task moves to another department, an Owner still sees it under the old department, but that department's manager may not. Access wins.
- **Attribution:** open, overdue, blocked and created use the task's department today. Completed uses `completed_department_id` (ADR-020).
- **No employee scoring (PRD §5.9).** Member reports show counts of work only, with no on-time rate, and lists are by name, never ranked. "Completed" for a person means tasks assigned to them, not who pressed the button.
- **One pass, several numbers.** Each report runs three grouped queries rather than one per number. Local days are worked out by MySQL with `INTERVAL(TO_SECONDS(column), each day's start)`, using boundaries computed in Python from the organization's timezone. That is exact in every timezone and on days when the clocks change, and it needs no timezone tables in MySQL.
- **Permissions:** report access uses the existing `report.*` permissions. Exporting needs the same permission as reading that report, not a separate one.
- **CSV:** cells starting with a formula character are prefixed with a quote mark, including full-width forms. Exports are refused rather than cut short when too large, because a silently partial file would mislead. Each export is audited, recording counts and dates but no task data.
- **No caching.** PRD §10 says to add caching only after measuring slow queries. The one report over target is a rare view, so nothing is cached.

## ADR-031 Database connections and query cost

- **Pool:** 20 connections plus 20 overflow per server process, and a 10-second wait. Production refuses to start below 40 in total, because a smaller pool stalled at 100 requests in flight. Migrations use no pool. Server processes × 40 must stay under MySQL's `max_connections`.
- **The pool only raises the limit.** The same stall returned at about 140 requests in flight, because each request keeps its connection while it waits for a thread. ADR-032 removes it.
- **Relationship loading:** `Task.subtasks` sets `join_depth=1`, because `selectin` is otherwise skipped on a table linked to itself. `User.preferences` loads only when read.
- **Query cost is tested.** `tests/test_query_counts.py` requires busy pages to run the same number of queries as data grows. A new page that loads lists belongs there too.

## ADR-032 Request limiter and slow clients

- **35 requests per server process run at once** (`MAX_CONCURRENT_REQUESTS`), below the 40 threads and 40 connections, so that exempt requests always have some. Others wait in the event loop, holding no thread or connection.
- **Waiting ends after 30 seconds** (`REQUEST_WAIT_SECONDS`) with a 503 `server_busy` and `Retry-After`, because a clear refusal beats a request hanging until something times out.
- **A slot covers only the work.** A request takes one after its body has arrived and gives it back when its response starts, so a slow client can't hold a slot while sending or receiving. Otherwise anyone could block the API with slow requests, without signing in.
- **Bodies were already held in memory** before this, capped at 1 MB by the size limit, so reading them first adds no memory risk. The limiter sits inside the size limit for that reason.
- **Exempt:** health checks, which must answer during an overload, and file uploads, which can legitimately take minutes.
- **Uploads give their connection back before reading the file.** Sign-in runs first and opens a connection, and 45 paused uploads held all 40 and froze the app. Sign-in stays first, so that strangers can't make the server hold 10 MB.
- **Per process:** with several server processes, the total allowed is the limit times the number of processes.

## ADR-033 Faster task lists

- **`visible_tasks` compares with lists instead of checking each row.** For non-Owners, the tasks shared with them are fetched once per request, only if the request needs them, and only for that organization. Over 1,000 entries (`MAX_LISTED_SHARES`), it falls back to checking each row. Both ways must give the same answer, and the visibility matrix runs both.
- **`organization_id` alone now scopes a task,** because the table's checks stop a personal task from having one. That removed `workspace_type` from the filter and from the report indexes.
- **The default sort has its own index,** `ix_tasks_org_default_sort`. It's built on expressions that must match `order_by("due")` exactly, or MySQL silently ignores it, so `tests/test_indexes.py` checks the real query plan. Changing that sort means changing the index too.
- **Autogenerate can't compare expression indexes,** so `alembic/env.py` skips this one and migrations manage it by hand.
- **Accepted trade-off:** rare searches matching nothing and very deep pages are slightly slower, because MySQL walks the index further. Everyday lists gain far more.

## ADR-034 Remembering the workspace

- **Three kinds of page.** `/org/:id/*` is that organization, and `/` and `/personal/*` are Personal. Everything else, such as Settings, belongs to neither and keeps the workspace in `user_preferences.last_organization_id`. Without this, those pages flipped the sidebar to Personal.
- **The choice is saved in MySQL,** like the theme, so it follows the person to other devices. The server rejects an organization the person isn't an active member of, and the client still checks membership before using it, because they may have been removed since.
- **`/` only redirects on a fresh visit or sign-in,** detected by React Router's `default` location key or `resumeWorkspace` state. A redirect on every visit would bounce people straight back out of Personal when they chose it. `useRememberWorkspace` skips saving during that moment, or it would overwrite the organization with Personal first.
- **The sidebar names the current workspace.** The header button only offers the one you can swap to, so without this nothing would say where you are.
