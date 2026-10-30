# Listify — Implementation Roadmap

Dependency-aware sequence derived from PRD §15–16 and the owner's build instructions. Each phase ends with: backend tests, frontend tests, production build, browser walkthrough, authorization/isolation checks, docs update and a phase report in `development-log.md`.

> **How this document is maintained:** the tracker below is updated when a phase is finished — meaning its features work end-to-end and all its tests have been run and passed. A feature is ticked only after that verification. "Phase N" and "M*N*" refer to the same milestone.

## Phase tracker

> Short feature-by-feature view (done / pending, with the database table behind each feature): [`feature-status.md`](feature-status.md).

| Phase | Name | Status | Completed |
|---|---|---|---|
| 0 | Foundation | ✅ Complete | 2026-10-29 |
| 1 | Accounts & sign-in | ✅ Complete | 2026-10-29 |
| 2 | Personal workspace | ✅ Complete | 2026-10-29 |
| 3 | Organizations, departments & membership | ✅ Complete | 2026-10-30 |
| 4 | Roles & permissions | ✅ Complete | 2026-10-30 |
| 5 | Department Work Boards | 🚧 Next | — |
| 6 | Collaboration (comments, update requests, attachments, inbox) | ⏳ Planned | — |
| 7 | Dashboards & reporting | ⏳ Planned | — |
| 8 | Reminders & scheduled notifications | ⏳ Planned | — |
| 9 | Production readiness | ⏳ Planned | — |

## What you get in each phase (feature checklist)

### Phase 0 — Foundation ✅
- [x] Project structure, documentation, decision records, traceability matrix
- [x] Backend API skeleton with health check that really tests MySQL
- [x] MySQL `listify` / `listify_test` connected; Alembic migrations working (upgrade + downgrade verified)
- [x] App shell: sidebar, mobile menu, workspace switcher (personal only), account menu, light/dark theme
- [x] Design system: violet brand tokens, status/priority badges, empty/error/loading states
- [x] Lint, formatting, test and build pipelines (`scripts\check.ps1`)

### Phase 1 — Accounts & sign-in ✅
- [x] Register with name, email, password (timezone auto-detected, terms accepted)
- [x] Sign in / sign out with secure cookie sessions (CSRF-protected)
- [x] Forgot password → reset link (written to the backend log in development) → set new password
- [x] Onboarding choice after registration (Personal tasks / Create organization / Join organization / Skip) — the two organization options are shown as "Phase 3" until that phase ships
- [x] Profile: name, timezone; Security: change password, see and sign out other sessions
- [x] Protected pages redirect to sign-in and return you where you were
- [x] Brute-force protection (rate limits) on sign-in, registration, password reset and password change
- [x] End-to-end browser tests (Playwright, desktop + mobile, with axe accessibility scans)
- [x] GitHub Actions CI workflow written — **a passing run not yet confirmed** (the repository is now on GitHub)
- Deferred: avatar upload (needs file storage, Phase 6); notification preferences (Phase 8); changing email address (not in the PRD)

### Phase 2 — Personal workspace ✅
- [x] Create, edit, complete, reopen, archive/restore and permanently delete personal tasks (private to you only)
- [x] Fields: title, description, priority, status, start date, deadline (all-day or timed), tags, subtasks; full activity history per task
- [x] Views: My Day (overdue / due today / starting today), My Tasks (with Archived), Upcoming (next 14 days grouped by day), Completed
- [x] Filters (status, priority, tags, overdue, title search) and sorting, all kept in the URL; pagination; quick-add; task detail side panel with optimistic complete/undo
- [x] Personal tags (create from the picker, colors, private per user)
- [x] Personal analytics: completed, on-time rate, overdue, open, completed-per-day chart with table view, open by priority/status — 7/30/90 days, in your timezone, each metric with its definition
- [x] Home page: today's numbers, today's tasks, quick-add
- Not included (by plan): recurring tasks (P2), estimated/actual effort fields are stored and in the API but not yet shown in the UI

### Phase 3 — Organizations, departments & membership ✅
- [x] Create an organization (you become Owner) with profile and timezone
- [x] Create, edit and archive departments; choose which are open for join requests
- [x] Workspace switcher lists Personal + your organizations
- [x] Invite by email/link; optional "searchable by name" setting
- [x] Request to join an organization and pick a department → Pending until approved
- [x] Admins approve, reject or amend (department/role) requests
- [x] Members list; audit log of membership changes
- Note: invitation emails use the development mailer (written to the backend log) until SMTP arrives in Phase 8. People see the outcome of their request on the Join page; in-app notifications arrive in Phase 6.

### Phase 4 — Roles & permissions ✅
- [x] Predefined roles: Owner, Admin, Department Manager, Team Lead, Member (delivered early, needed by Phase 3)
- [x] Navigation shows only what your role allows; the API enforces every rule (delivered early)
- [x] Change a member's role (with confirmation); department-scoped roles after joining
- [x] Suspend, reactivate, remove and transfer members with an impact preview
- [x] Add members to additional departments; transfer ownership
- Note: the impact preview covers departments, roles, departments left without a manager and waiting join requests. Task and update-request counts join it in Phases 5 and 6, when those records exist. Telling people about changes to their access arrives with notifications in Phase 6.

### Phase 5 — Department Work Boards
- [ ] Department board in Kanban (drag-and-drop), List and Calendar views
- [ ] Create organization tasks with assignee, collaborators, visibility, tags
- [ ] Filters: assignee, creator, priority, status, due date, tags, overdue (kept in the URL)
- [ ] Organization "My Work" and "Team Tasks" views; search
- [ ] Visibility rules: Private / Department / Selected users / Organization
- [ ] Impact preview counts open assigned tasks; suspended or removed assignees' tasks are flagged for reassignment
- [ ] Task permissions added to the role × permission matrix test

### Phase 6 — Collaboration
- [ ] Comments (edit/delete your own) and full activity timeline on tasks
- [ ] Request a progress update; recipient responds from the Inbox
- [ ] File attachments with access checks on every download
- [ ] Inbox: assignments, update requests, notifications with unread badges

### Phase 7 — Dashboards & reporting
- [ ] Organization overview: open, completed, overdue, blocked, workload by department, on-time rate
- [ ] Department summary: by status, by assignee, overdue, blocked, recent completions, trend
- [ ] Member summary (self or authorized manager)
- [ ] Date range picker; every metric shows its formula and timezone; CSV export where permitted

### Phase 8 — Reminders & scheduled notifications
- [ ] Deadline-approaching and overdue notifications
- [ ] Update-request reminders and expiry
- [ ] Notification preferences; optional email delivery
- [ ] Background worker (Redis + Celery) with duplicate-safe jobs

### Phase 9 — Production readiness
- [ ] Security review, dependency audit, accessibility audit, responsive QA
- [ ] Backups + restore drill, monitoring, error reporting
- [ ] Deployment runbook (Nginx + Gunicorn/Uvicorn), production config checks
- [ ] Privacy / retention policy

---

# Technical detail per phase

**Universal Definition of Done (PRD §17 + build instructions):** acceptance criteria met; server-side authorization and validation; unit + API tests for success and failure paths including cross-tenant/forbidden cases; activity/audit events recorded; loading/empty/error/permission-denied UI states; migration reviewed incl. downgrade; API and behavior documented; no known critical isolation issue.

## Dependency graph

```
M0 Foundation
 └─ M1 Auth & account
     ├─ M2 Personal workspace (tasks core, personal dashboard)
     └─ M3 Organizations, departments, membership
         └─ M4 Roles & permissions (policy layer complete, suspend/transfer)
             └─ M5 Department Work Boards (org tasks, visibility, assignment, collaborators)
                 └─ M6 Collaboration (comments, activity UI, update requests, attachments, in-app notifications)
                     ├─ M7 Dashboards & reporting (dept/org/member)
                     └─ M8 Scheduled ops & notifications (Redis/Celery: reminders, overdue, expiry, prefs)
                         └─ M9 Production readiness
```

Why this order: tasks core (M2) is built once in personal scope, then extended with organization scope in M5 rather than duplicated. Membership (M3) must exist before permissions (M4) have anything to grant. Boards (M5) need permissions. Update requests and notifications (M6) need org tasks. Reporting (M7) comes after collaboration because update-response metrics need update requests (BRD KPI); the personal dashboard ships early in M2. Redis enters only at M8 (ADR-008).

---

## M0 — Foundation *(complete)*

- **Build:** monorepo, FastAPI app factory, config (pydantic-settings), structured JSON logging with request IDs, error envelope, `GET /api/v1/health` (app + DB status reported honestly), SQLAlchemy engine/session, Alembic configured, Pytest + HTTPX, Ruff. Vite React TS app, Tailwind v4 tokens, shadcn/ui base components, router, TanStack Query, API client, app shell (sidebar, workspace switcher placeholder, top bar, mobile nav), error boundary, Vitest + RTL, ESLint + Prettier.
- **DB:** Alembic baseline revision (empty) applied to verify the pipeline.
- **Tests:** health endpoint (DB up/down), config validation, shell renders, nav responsive behavior.
- **Exit:** frontend dev + build OK; backend starts; health reports real DB status; Alembic upgrade/downgrade OK; lint/format/test commands pass; `.env.example` complete; no secrets tracked.

## M1 — Authentication and account *(complete)*

- **User sees:** Register (name, email, password, timezone auto-detected, terms checkbox) → onboarding chooser (Personal / Create org / Join org / Skip) → Personal Workspace. Login, logout, forgot/reset password, Profile (name, avatar URL/upload later, timezone), Security (change password, sign out other sessions).
- **Backend:** `modules/auth`, `modules/users`. Tables: `users`, `sessions`, `password_reset_tokens`, `rate_limit_buckets`, `user_preferences`. Endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `GET /auth/csrf`, `GET /me`, `PATCH /me`, `POST /me/password`, `GET /me/sessions`, `DELETE /me/sessions/{id}`.
- **Security:** Argon2id; session cookie + CSRF (ADR-004/006); generic login errors; enumeration-safe forgot-password; rate limits; session rotation.
- **Frontend:** `features/auth` pages with RHF + Zod, `useMe` query, `ProtectedRoute`/`GuestRoute`, 401 handling → redirect to login with return path.
- **Tests:** register OK/duplicate/invalid; login OK/wrong password/unknown email (same response); logout revokes; expired/idle session rejected; CSRF missing → 403; reset token expiry and reuse; password stored as Argon2id hash; rate-limit triggers; RTL form validation; Playwright register→logout→login journey. CI workflow added at the end of M1.
- **Edge cases:** email case/whitespace normalization; concurrent duplicate registration (unique index → 409).

## M2 — Personal workspace *(complete)*

- **User sees:** Sidebar "Personal": My Day (due today + overdue + started today, user tz), My Tasks (all open, filters/sort), Upcoming (next 14 days grouped by day), Completed (by completed_at desc), Personal Analytics. Quick-add bar, task detail side panel (title, description, priority, status, start, deadline, tags, subtasks), inline status change with animated feedback, archive with undo toast.
- **Backend:** `modules/tasks` (shared core: model, transitions, service), `modules/tags`, `modules/dashboards` (personal). Tables: `tasks` (full schema incl. org columns, CHECK constraint for workspace exclusivity), `tags`, `task_tags`, `task_activity_logs`. Endpoints: `GET/POST /me/tasks`, `GET/PATCH/DELETE /tasks/{id}`, `POST /tasks/{id}/complete|reopen|archive|restore`, `GET/POST/PATCH/DELETE /me/tags`, `GET /me/dashboard?period=`.
- **Permissions:** owner-only via `can_view_task` policy (personal branch).
- **Tests:** CRUD; validation; transition matrix (ADR-015); reopen clears `completed_at`; subtask completion rule; view filters with tz boundaries (UTC+05:30 and UTC−08:00 fixtures); overdue excludes no-deadline and terminal; metrics fixtures; user B gets 404 on user A's task across every endpoint; pagination limits.

## M3 — Organizations, departments, membership *(complete)*

- **User sees:** Create Organization wizard (name, slug, timezone, optional profile; then departments; then join policy/discoverability). Workspace switcher lists Personal + active orgs. Join Organization (search discoverable orgs or open invite link → choose open department → job title/note → Pending screen). Admin: Members, Requests (approve/reject/amend dept/role), Departments (create/edit/archive, "open for join requests"), Invitations, Organization Settings.
- **Backend:** `modules/organizations`, `departments`, `memberships`, `audit_logs`; seed system roles/permissions (data migration). Tables: `organizations`, `departments`, `organization_memberships`, `department_memberships`, `roles`, `permissions`, `role_permissions`, `membership_roles`, `membership_requests`, `organization_invitations`, `audit_logs`.
- **Rules:** create-org + owner membership + owner role in one transaction; approval creates org membership + dept membership + role atomically; pending/rejected/cancelled grant nothing; one active membership per (org, user); one pending request per (org, user).
- **Tests:** atomicity (forced failure rolls back); pending user gets 404 on org resources; amend changes department; only open active departments offered; invitation expiry/scope/single-use; non-admin cannot approve; admin of org A cannot touch org B; switcher excludes pending/suspended orgs; audit rows written.

## M4 — Roles and permissions

- **User sees:** Member detail with role chips, Change role dialog (confirmation), Suspend/Remove/Transfer with impact preview (open assigned tasks, pending update requests), navigation items appear only when permitted.
- **Backend:** complete `modules/permissions` (ADR-010/011): effective-permission resolver incl. department-scoped roles, route dependencies, policy functions; UI gating through `/me/organizations` (delivered in Phase 3, so no separate `me/permissions` route) and each member's `actions`; `PATCH .../members/{id}/roles`, `POST .../members/{id}/suspend|reactivate|remove|transfer`.
- **Tests:** parametrized role × permission matrix against real endpoints; owner-only actions; admin cannot demote owner; dept manager limited to own department; suspended member's existing session gets 404/403 on next call (PRD §13.1); transfer revokes old department access unless another path exists.

## M5 — Department Work Boards

- **User sees:** Department → Work Board (Kanban with drag-and-drop between status columns, respecting ADR-015), List (TanStack Table, sortable, paginated), Calendar (month/week by due date). Filters: assignee, creator, priority, status, due range, tags, overdue — persisted in URL. Create task dialog with assignee picker (eligible members only), collaborators, visibility (Private/Department/Selected users/Organization constrained by permissions), tags. Organization "My Work" and "Team Tasks" views. Task detail panel shared with personal tasks.
- **Backend:** extend `modules/tasks` with org branch: `visible_tasks_query`, `can_*` policies for visibility, assignment eligibility, collaborator management; `task_collaborators`, `task_visibility_grants`; endpoints `GET .../departments/{dept}/board`, `GET/POST /organizations/{org}/tasks`, `POST/DELETE /tasks/{id}/collaborators`, org tags, search `GET /organizations/{org}/tasks?q=`. In-app notification rows for assignment/collaborator added (synchronous insert, ADR-008).
- **Tests:** visibility matrix (4 visibilities × creator/assignee/collaborator/dept member/other dept/org viewer/admin); collaborator cannot list board; non-member 404 on board; department must belong to org; suspended assignee rejected; archived department blocks creation; move between departments recalculates access + audit; search results scoped identically to list.

## M6 — Task collaboration

- **User sees:** Task panel tabs: Comments (Markdown-lite, edit/delete own), Activity timeline, Attachments (drag-drop upload, download), Update requests (Request update dialog; recipient responds from Inbox with optional status change). Inbox page: Assignments, Update Requests, Notifications with unread badges.
- **Backend:** `modules/comments`, `attachments` (StorageBackend, ADR-018), `update_requests`, `notifications`. Tables: `task_comments`, `task_attachments`, `task_update_requests`, `notifications`. Endpoints per PRD §9 plus `GET /inbox`, `POST /notifications/{id}/read`, `POST /notifications/read-all`.
- **Rules:** notifications re-authorized at read time — inaccessible items shown as "You no longer have access" without title; attachment download authorized every time; update request recipient must have task access.
- **Tests:** comment visibility follows task; activity accuracy; update request Pending→Responded/Cancelled; duplicate pending request to same recipient rejected; attachment MIME/size validation and cross-tenant download 404; notification leakage after access loss.

## M7 — Dashboards and reporting

- **User sees:** Organization Overview (open, completed in period, overdue, blocked, workload by department, on-time rate with cohort label, member activity where permitted), Department Summary (by status, by assignee, overdue, blocked, recent completions, workload trend), Member summary (self or authorized manager), date range picker with timezone label on every widget, metric "i" tooltips with formula text. Basic CSV export where permitted.
- **Backend:** `modules/dashboards` aggregate queries built on `visible_tasks_query`; `completed_department_id` attribution (ADR-020); indexes reviewed with EXPLAIN on seeded data.
- **Tests:** metric fixtures (period boundaries in org tz, reopen behavior, no-deadline exclusion, created vs completed in period); permission-gated access; historical attribution after task move; performance test with ~100k tasks seed (p95 < 500 ms).

## M8 — Notifications and scheduled operations

- **Infra:** Redis (Memurai/WSL2 decision) + Celery worker + Beat (ADR-008); rate limiter moves to Redis.
- **Build:** deadline-approaching and overdue notifications, update-request reminders and expiry, membership notifications fan-out, notification preferences (FR-AUTH-04), grouping to avoid overload, optional SMTP email delivery.
- **Tests:** idempotent jobs (dedupe keys; re-running a job creates no duplicates); correct recipients; tz-correct scheduling; failure → retry + log without affecting task writes (PRD §13.10); preference honored.

## M9 — Production readiness

- Security review (IDOR sweep, CSRF/session config, XSS, uploads, rate limits, privilege escalation), dependency audit (`pip-audit`, `npm audit`), migration review, backup + restore drill (mysqldump schedule), Nginx + Gunicorn/Uvicorn systemd deployment runbook, production config validation at startup, error monitoring, uptime checks, accessibility audit (axe + manual keyboard), responsive QA at 375/768/1280+, load test, privacy/retention policy (NFR-10).

## Risks and unresolved decisions

| Risk / decision | Mitigation / owner |
|---|---|
| Cross-tenant leakage (critical) | ADR-010 single scoping path; negative tests every milestone |
| Permission complexity | Predefined roles only (ADR-011); custom builder deferred |
| Metric confusion | ADR-019/020; formulas shown in UI |
| Redis on Windows dev | Decide Memurai vs WSL2 at M8 |
| Retention/deletion/export policy | Open — owner decision before M9 |
| Production hosting and email provider | Open — owner decision before M9 / password reset go-live |
