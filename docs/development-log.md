# Listify — Development Log

## 2026-10-30 — Phase 4 complete: roles, permissions and member management

### Requested by the owner
Start Phase 4.

### Changes
- **Backend:** `memberships/policies.py` (who may change whom) and `memberships/management.py` (roles, suspend, reactivate, remove, transfer, add/leave department, ownership, impact preview). `MemberRead` gained `actions`; the directory gained a `status` filter. No migration: the Phase 3 tables already hold all of this. Rules are in ADR-026.
- **Frontend:** a member panel on the Members page with role, impact-preview and ownership dialogs; department names on role chips; a status filter; activity-log wording for every new action. A 403 or 404 from an organization request now reloads the user's organizations, so a page left open follows a change in access.
- **Tests:** added a role × permission matrix (23 actions × 5 roles). Test cleanup moved from `TRUNCATE` to `DELETE`, which more than halved run time.

### Tests executed (all actually run)
| Suite | Result |
|---|---|
| Backend pytest (real MySQL) | **300 passed** (167 new, 115 of them the matrix) |
| Frontend Vitest | **74 passed** (12 new) |
| Playwright E2E | **19 passed, 1 skipped by design**. New: two-person journey through roles, departments, suspension on an open page, reactivation, ownership and removal; axe scans of the member panel and dialogs, including dark mode; panel and preview added to the 3-width responsive check |
| Ruff, ESLint, Prettier, `tsc -b`, `vite build` | passed; no warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `alembic check` | clean; no schema change |
| Visual review | member list, member panel and impact preview at phone and desktop widths |
| Running dev servers | new routes present, 401 when signed out, health OK. The flows themselves were exercised by Playwright on `listify_test`, not on the development database |

### Defects found and fixed during the phase
- The shared red failed WCAG contrast on red buttons in both themes (4.33:1 light, 4.25:1 dark). No earlier scan had a red button on screen. Fixed at the token, so every red button benefits.
- On phones, a long name in a dialog title ran under the close button, and the dialog focused the reason box, which would open the keyboard over the impact preview.
- Member rows repeated the department name when a role chip already showed it.
- `catalog.py` pointed at `tests/test_permissions.py`, which didn't exist. The file now exists and holds the seed check.

### Decisions worth checking
- A transfer is approved by the administrator who confirms it; there's no second approver.
- Department Managers can't suspend, move or re-role people, following ADR-011.
- There's no way yet for a member to leave an organization by themselves; an administrator has to remove them.

### Known limitations
- The impact preview has no task or update-request counts, because organization tasks don't exist until Phase 5. Reassignment of a departing member's tasks arrives with them.
- People aren't told when their access changes until notifications arrive in Phase 6; they see the result on their next click.
- The row lock has no automated concurrency test; the tests run one request at a time.
- CI result unverified: GitHub has commit `3f22af5`, but `gh` isn't installed here, so no run could be checked. The local Phase 3 commit `248d1f2` isn't pushed, and Phase 4 isn't committed.

### Next
**Phase 5 — Department Work Boards.**

## 2026-10-30 — Phase 3 complete: organizations, departments & membership; rename; borderless cards

### Requested by the owner
Start the servers; no borders on cards; explain how to start from the terminal; rename the site to Listify; start Phase 3.

### Changes
- **Rename:** WorkPulse → Listify across code, docs, cookies, logger names and package names (39 files), plus a new checklist logo and favicon. The BRD/PRD file names are unchanged.
- **Borderless cards:** removed from every card surface, including the shadcn Card; section side bars removed; nested task rows use a tinted fill; page background deepened and card shadow strengthened so cards still separate.
- **Phase 3 backend:** `modules/organizations`, `memberships`, `permissions`, `audit_logs`; migration `fa2cb7581b65` (11 tables plus seeded roles and permissions).
- **Phase 3 frontend:** workspace switcher, permission-based navigation, Create and Join pages, invitation page, and Overview, Departments, Members, Join requests, Invitations, Activity log and Settings pages.

### Tests executed (all actually run)
| Suite | Result |
|---|---|
| Backend pytest (real MySQL) | **133 passed** (37 new) |
| Frontend Vitest | **62 passed** (11 new) |
| Playwright E2E | **15 passed, 1 skipped by design** (responsive runs once with explicit viewports). New: two-user join-and-approve journey, private-org invitation journey, axe scans of 9 organization pages, responsive check of 15 pages at 3 widths |
| Ruff, ESLint, Prettier, `tsc -b`, `vite build` | passed; no warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Migrations | upgrade → downgrade → upgrade on `listify` and `listify_test`; `alembic check` clean |
| Visual review | screenshots of My Day, organization overview, departments and members (desktop/phone) |

### Defects found and fixed during the phase
- Approve/reject responses returned an empty department name.
- Test cleanup would have wiped the seeded roles and permissions; they're now excluded in both reset paths.
- E2E hit the real registration rate limit (10/hour per IP). Added `RATE_LIMITS_ENABLED`, off only for the isolated E2E server; production startup refuses it.
- Downgrade dropped indexes needed by foreign keys (same MySQL rule as earlier phases).

### Known limitations
- Invitation emails go to the backend log until SMTP arrives (Phase 8). The one-time link shown to the admin works today.
- The outcome of a join request appears on the Join page; in-app notifications arrive in Phase 6.
- Changing roles and suspending, removing or transferring members arrive in Phase 4. Tests set suspended/removed status directly to prove access stops at once.
- Organization logos wait for file storage (Phase 6).
- Tasks inside organizations arrive in Phase 5. Archiving a department doesn't affect tasks yet, because none exist.
- CI still not executed (no GitHub remote); nothing committed.

### Next
**Phase 4 — Roles & permissions.**

## 2026-10-29 — Persistence audit, page redesign, responsive pass

### Requested by the owner
Short done/pending view and a living pending-features document; every user entry stored in the database; less generic My Day / My Tasks / Upcoming; responsive check on phone, tablet and desktop.

### Changes
- **Persistence audit:** the only user data not in MySQL was the theme (browser `localStorage`). Added `user_preferences` (migration `004bd59b961b`), `PATCH /me/preferences`, `theme` on `/me`; the SPA saves on change (rolls back on failure) and applies the account value after sign-in. Filters remain URL state by design.
- **New document:** `docs/feature-status.md` (done/pending per feature, with the backing table) — to be updated on every feature change.
- **Redesign:**
  - My Day: hero with greeting, date, progress ring (done today vs remaining), quick add; colour-coded collapsible sections (Overdue / Due today / Starting today); "Done today" section (new `done_today` view).
  - My Tasks: summary chips (open, overdue, due today, high & urgent), planner grouped by Overdue / Today / Tomorrow / This week / Later / No deadline; flat paged list when a sort is chosen.
  - Upcoming: 14-day strip with counts (tap a day to target quick add), agenda with large date column.
  - Priority icons changed to arrows (the low "signal" icon read as punctuation).
- **Responsive fixes found by the new check:** Home overflowed by 230px on phones (grid without a min-width column) — all page grids now use `grid-cols-1`/`minmax(0,…)`; task panel was 75% wide on phones (base sheet selector overrode `w-full`) and clipped date inputs; "Done today" briefly started expanded while data loaded; day strip got an edge fade.

### Tests executed (all actually run)
| Suite | Result |
|---|---|
| Backend pytest (real MySQL) | **96 passed** (+ theme persistence across devices, done-today local-day boundary) |
| Frontend Vitest | **51 passed**, twice in a row (+ theme save/rollback/account-wins, My Day ring & sections, My Tasks buckets, Upcoming strip & day-targeted quick add) |
| Playwright E2E | **9 passed** (+ new responsive test: 6 pages × 3 viewports with overflow assertion, plus the task panel) |
| Lint, format, type check, build, `npm audit --omit=dev` | passed / 0 vulnerabilities |
| Visual review | screenshots of My Day, My Tasks, Upcoming and the task panel at phone/tablet/desktop |

## 2026-10-29 — Phase 2 complete: personal workspace

### Features delivered
Personal tasks with full lifecycle (create, edit, complete/reopen, cancel/restore, archive/restore, permanent delete), subtasks (one level), personal tags, per-task activity history, My Day / My Tasks / Archived / Upcoming / Completed views, URL-persisted filters (status, priority, tags, overdue, search), sorting and pagination, quick-add, task detail side panel, personal analytics (7/30/90 days), and a home page with today's numbers and tasks.

### Files and modules
- Backend: `app/modules/tasks/` (models, transitions, schemas, policies, service, router), `app/modules/dashboards/`, `app/common/time.py`, `app/common/pagination.py`; migration `2cc57b884713`.
- Frontend: `src/features/tasks/` (API hooks with optimistic completion, date helpers, URL filter state, TaskRow/TaskList/QuickAdd/TaskFilters/TaskDetailSheet/TagPicker/SubtaskList/ActivityTimeline), `src/features/personal-tasks/` (pages, grouping), `src/features/dashboards/` (StatTile, CompletionTrendChart, BreakdownBars, analytics page); personal routes lazy-loaded.
- E2E: `frontend/e2e/personal-tasks.spec.ts`.

### Database
`tasks`, `tags`, `task_tags`, `task_activity_logs` (see `database-design.md`). Upgrade → downgrade → upgrade verified on `listify` and `listify_test`; `alembic check` clean.

### Security and correctness notes
- One authorization path (`tasks/policies.py`): personal tasks are visible only to their owner; every endpoint returns 404 for other users' task or tag IDs (tested across GET/PATCH/complete/archive/activity/delete/subtask/tag use).
- Server-computed `is_overdue` and timezone-aware view boundaries; a test user in Asia/Kolkata with a frozen clock at 20:00 UTC (already "tomorrow" locally) catches UTC-vs-local mistakes; DST 23/25-hour days covered.
- Search treats `%` and `_` literally; page size capped at 100; unknown request fields rejected.

### Tests executed (all actually run)
| Suite | Result |
|---|---|
| Backend pytest (real MySQL) | **94 passed** (47 new) |
| Frontend Vitest | **48 passed** (9 new), stable across repeated runs |
| Playwright E2E, desktop + mobile | **8 passed**: auth journey, task journey (quick add → details → tag → subtasks → completion rules → Completed → analytics), axe WCAG 2.2 AA scans of auth pages, task pages and the open task panel |
| Ruff, ESLint, Prettier, `tsc -b`, `vite build` | passed; no warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Chart color validation (dataviz validator) | chart-1 passes in light and dark (dark step deepened to L 0.64) |
| Visual review | Playwright screenshots of task panel, My Day and analytics (desktop + mobile) |

### Defects found and fixed during the phase
- Migration: MySQL rejected `ON DELETE CASCADE` on a column used in a CHECK → `owner_user_id` uses RESTRICT; downgrade no longer drops FK-backing indexes first.
- **Rapid entry lost input**: quick-add and subtask fields cleared themselves when the *previous* save finished, erasing text typed meanwhile (caught by the mobile E2E run) → clear on submit, restore only on failure.
- Accessibility: stat-tile info buttons and tag remove buttons were below the 24×24 px WCAG 2.2 target size → enlarged.
- Mobile: date inputs overflowed the task panel → constrained width.
- Task panel went blank while sliding closed → keeps the last task rendered during the exit animation.
- Editor remounted on every save (would steal focus) → state syncs from props without remounting.
- Test infrastructure: lazy routes need a longer Testing Library wait under parallel load (global `asyncUtilTimeout`).

### Known limitations
- Estimated/actual effort are stored and accepted by the API but not editable in the UI yet.
- Recurring tasks are P2 (not in MVP).
- Chart palette slots 2–5 are unvalidated until multi-series charts appear (Phase 7).
- CI still not executed (no GitHub remote); nothing committed.

### Next
**Phase 3 — Organizations, departments & membership.**

## 2026-10-29 — Phase 1 complete: accounts & sign-in

### Phase 0 close-out
- MySQL credentials provided: `listify` / `listify_test` on localhost:3306, user `root`, empty password (local only, in gitignored `backend/.env`).
- Found WAMP defaults of **MyISAM** storage engine and an **empty `sql_mode`**. The app now forces InnoDB, strict mode and UTC on every connection, and declares InnoDB/utf8mb4 per table.
- Alembic upgrade → downgrade → upgrade verified on both databases; `alembic check` clean; the real-MySQL health test passes.

### Features delivered
Registration (auto sign-in, detected timezone, terms), sign-in/out, forgot/reset password (console mailer in dev), onboarding page, profile (name, timezone), security (change password, list and revoke sessions), route guards with return path, global "session ended → sign-in" handling, automatic CSRF token handling in the API client.

### Files and modules
- Backend: `app/modules/auth/` (models, passwords, tokens, sessions, dependencies, schemas, service, router), `app/modules/users/` (model, schemas, `/me` router), `app/common/` (rate limiter, mailer, schema bases), `app/db/models.py`, `scripts/reset_test_db.py`, migration `810edd16f8d9`.
- Frontend: `src/features/auth/`, `src/features/settings/`, shared `FormField`, `PasswordInput`, `NativeSelect`, `FullPageLoader`, `lib/form-errors.ts`, `lib/timezones.ts`, `e2e/`, `playwright.config.ts`.
- CI: `.github/workflows/ci.yml`.

### Security notes
- Argon2id hashing; timing-equalized login for unknown emails; generic auth errors; enumeration-safe forgot-password.
- Opaque 256-bit session tokens, stored as SHA-256; HttpOnly + SameSite=Lax cookies (Secure in production); 12 h idle / 7 d absolute; rotation on login; revocation on logout, password change (other sessions) and reset (all sessions).
- CSRF: double-submit token bound to the session by HMAC; checked on every unsafe API request.
- Reset links: single-use, 60 min, only the newest valid; the SPA strips the token from the URL immediately.
- Rate limits on login (per account and IP), registration, forgot/reset and password change; 429 with `Retry-After`.
- Production startup refuses: console mailer, insecure cookies, non-HTTPS origins, weak secret, empty DB password.

### Tests executed (all actually run)
| Suite | Result |
|---|---|
| Backend pytest (real MySQL `listify_test`) | **47 passed** |
| Frontend Vitest | **39 passed** (7 files) |
| Playwright E2E (desktop + mobile) | **4 passed**: full auth journey ×2, axe WCAG 2.2 AA scans ×2 (0 violations) |
| Ruff, ESLint, Prettier, `tsc -b`, `vite build` | passed; no build warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Manual browser walkthrough (real backend + MySQL) | redirect with `next`, register, onboarding, sign out, wrong password, sign in, forgot → log link → reset (token removed from URL, old password rejected), security page |

### Defects found and fixed during the phase
- Downgrade migration failed on MySQL (dropping an index a FK depends on) → drop tables directly.
- Test harness used a QueryClient without the global 401 handler → harness uses the real client.
- E2E selectors matched the "Show password" button / description text → exact selectors.
- A PowerShell edit saved a UTF-8 BOM and garbled characters in a spec file → rewritten without BOM.

### Known limitations / not done
- CI workflow not yet executed (no GitHub remote).
- Avatar upload deferred to Phase 6 (file storage); notification preferences to Phase 8; identity-provider login deferred (ADR-005).
- Client IP comes from the direct connection; trusted-proxy handling arrives with the Nginx setup (Phase 9).
- Git identity not configured; nothing committed.

### Next
**Phase 2 — Personal workspace** (tasks core, My Day / My Tasks / Upcoming / Completed, tags, subtasks, personal dashboard).

## 2026-10-29 — Milestone 0: requirements analysis and foundation

### Decisions confirmed by the product owner
FastAPI backend (overrides the PRD's Laravel recommendation), MySQL 8.4 on port 3306, repository at the project root with `git init` (no commits without approval), console mailer in development, Redis + Celery + Beat from Milestone 8, private-by-default organization discovery with owner opt-in search, and the product defaults A1–A19 in `requirements-analysis.md`.

### Environment inspected
| Item | Finding |
|---|---|
| OS | Windows 11 Home Single Language (10.0.26300) |
| Python | 3.12.10 (venv at `backend/.venv`) |
| Node.js / npm | not installed → installed via winget: Node 26.13.0 LTS, npm 11.20.0 |
| Git | not installed → installed via winget: 2.56.0.windows.3; repo initialized on `main`; `user.name`/`user.email` not configured yet |
| WAMP | `wampmysqld64` (MySQL 8.4.7, port 3306), `wampmariadb64` (MariaDB 11.4.9, port 3307), `wampapache64` all running |
| Smart App Control | blocked a SQLAlchemy native DLL once on first load; succeeded on retry (documented in README) |

### Built
- Docs: requirements analysis, traceability matrix, 21 ADRs, roadmap, database/API/testing docs, README.
- Backend: app factory, pydantic-settings config with production validation, JSON logging + request IDs, error envelope, CORS, SQLAlchemy engine/session (UTC session timezone), Alembic (env from settings, `-x test=true`), baseline revision `30737a4dbfd2`, `GET /api/v1/health` with a real DB probe.
- Frontend: Vite 8 + React 19 + TS 6.0, Tailwind v4 tokens (violet brand, semantic status/priority/feedback colors, motion and shadow tokens, dark theme, reduced motion), shadcn/ui (radix-nova), app shell (desktop sidebar, mobile sheet, workspace switcher, account menu with theme, skip link), API client (error envelope, CSRF header, network errors), TanStack Query setup, route error boundary, 404, honest "not available yet" pages for upcoming routes, live system-status card, dev-only `/design` page.

### Version and compatibility notes
- TypeScript pinned to `~6.0.3` (Vite's template ships TS 7, but typescript-eslint 8.72 supports `<6.1`).
- `httpx2` used instead of `httpx` (Starlette 1.10 TestClient deprecates `httpx`).
- shadcn 4.x uses the `cn` package; `clsx`/`tailwind-merge` were removed as duplicates. The `shadcn` package is a devDependency (only its CSS is consumed at build time). It pulls a low-severity `deepmerge` advisory, so the production dependency audit is clean but the full audit shows 3 low findings, all in that build tool.
- `next-themes` replaced by a 60-line theme provider (its injected script triggered a React 19 console error in a SPA).
- Vendor chunks split (react/router/ui/motion/data); largest gzip chunk 68 kB; no build warnings.

### Checks executed (all actually run)
| Check | Result |
|---|---|
| Backend `ruff check` / `ruff format --check` | passed |
| Backend `pytest` | **14 passed, 1 skipped** (the skipped test needs real MySQL credentials) |
| Frontend `eslint` / `prettier --check` / `tsc -b` | passed |
| Frontend `vitest` | **24 passed** (5 files) |
| Frontend `vite build` | passed, no warnings |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Backend starts (uvicorn) | yes; `/api/v1/health` → **503 degraded**, database `error` (placeholder credentials; access denied) |
| Frontend dev server + proxy | yes; home page shows API Operational / Database Unavailable; no console errors other than the expected 503 |
| Responsive check | 375 px and 768 px: sidebar hidden, mobile sheet works, no horizontal overflow; 1280 px: sidebar visible |
| Alembic | config loads; `alembic upgrade head --sql` renders correct MySQL DDL offline; online upgrade **not yet run** (needs credentials) |

### Not done / blocked
- **MySQL connectivity, online Alembic upgrade/downgrade and the `db`-marked test**: waiting for MySQL credentials from the owner.
- Git identity not configured; nothing committed (per instructions).
- Playwright and GitHub Actions CI are scheduled for Milestone 1.

### Next
Finish M0 database verification once credentials are provided, then start **Milestone 1 — Authentication and account**.
