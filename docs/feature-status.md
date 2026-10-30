# WorkPulse — Feature Status

**Last updated:** 2026-10-29 · **Current phase:** Phase 3 (Organizations) — next up

This is the single list of what is **done** and what is **pending**, feature by feature. It is updated every time a feature is completed or changed. A feature is marked ✅ only after it works end-to-end (UI → API → MySQL) and its tests have been run and passed. Detailed plans live in [`implementation-roadmap.md`](implementation-roadmap.md).

Legend: ✅ done · 🟡 partly done · ⏳ pending · ⏸ deferred (later release)

---

## Summary

| Area | Status |
|---|---|
| Accounts & sign-in | ✅ Done |
| Personal workspace (tasks, views, tags, subtasks, history) | ✅ Done |
| Personal analytics & home page | ✅ Done |
| Organizations, departments, membership | ⏳ Pending (Phase 3) |
| Roles & permissions | ⏳ Pending (Phase 4) |
| Department work boards (team tasks) | ⏳ Pending (Phase 5) |
| Comments, update requests, attachments, inbox | ⏳ Pending (Phase 6) |
| Team & organization dashboards | ⏳ Pending (Phase 7) |
| Reminders, notifications, email | ⏳ Pending (Phase 8) |
| Production readiness (deploy, backups, monitoring) | ⏳ Pending (Phase 9) |

---

## ✅ Done

Every item below is saved in and loaded from MySQL (database `listify`). The "Stored in" column names the table.

### Accounts & security
| Feature | Stored in |
|---|---|
| Register (name, email, password, timezone, terms acceptance) | `users` |
| Sign in / sign out, sessions in secure cookies, sign out other devices | `user_sessions` |
| Forgot / reset password (single-use, 60-minute link) | `password_reset_tokens` |
| Change password | `users` |
| Profile: name, timezone | `users` |
| Theme (light / dark / system) — follows you to every device | `user_preferences` |
| Brute-force protection on sign-in, registration, password reset/change | `rate_limit_buckets` |
| Onboarding screen after registration | — (navigation only) |

### Personal tasks
| Feature | Stored in |
|---|---|
| Create, edit, complete/reopen, cancel/restore, archive/restore, delete tasks | `tasks` |
| Title, description, priority, status, start date, deadline (all-day or timed) | `tasks` |
| Subtasks (one level) | `tasks` (`parent_task_id`) |
| Tags (create, colour, attach to tasks) | `tags`, `task_tags` |
| Activity history per task (who changed what, when) | `task_activity_logs` |
| **My Day** — today hero with progress ring, Overdue / Due today / Starting today sections, Done today | reads `tasks` |
| **My Tasks** — summary chips, planner grouped by Overdue / Today / Tomorrow / This week / Later / No deadline, Archived tab | reads `tasks` |
| **Upcoming** — 14-day strip, pick a day to add to it, agenda by day | reads `tasks` |
| **Completed** list | reads `tasks` |
| Filters (status, priority, tags, overdue, search), sorting, pagination — kept in the page URL | — (URL state) |
| Quick add, task detail side panel | writes `tasks` |

### Analytics & home
| Feature | Stored in |
|---|---|
| Personal analytics (7/30/90 days): completed, on-time rate, overdue, open, completed-per-day chart (+ table), by priority/status | computed from `tasks` |
| Home: today's numbers, today's tasks, quick add, system status | reads `tasks` |

### Quality (applies to everything above)
- Responsive: phone (375px), tablet (768px), desktop (1280px) — automatically checked for overflow, screenshots reviewed.
- Accessibility: automated WCAG 2.2 AA scans (axe) on sign-in, task pages and the task panel; keyboard and screen-reader labels.
- Privacy: other users get "not found" for your tasks, tags and sessions (tested on every endpoint).

---

## ⏳ Pending

### Phase 3 — Organizations, departments & membership *(next)*
- ⏳ Create an organization (you become Owner), profile, timezone
- ⏳ Departments: create, edit, archive; choose which accept join requests
- ⏳ Workspace switcher with your organizations
- ⏳ Invite by email / link; optional "searchable by name"
- ⏳ Request to join + choose a department → Pending until approved
- ⏳ Approve / reject / amend requests; members list; audit log

### Phase 4 — Roles & permissions
- ⏳ Owner, Admin, Department Manager, Team Lead, Member roles
- ⏳ Change roles; suspend, reactivate, remove, transfer members (with impact preview)
- ⏳ Navigation limited to what your role allows; every rule enforced by the server

### Phase 5 — Department work boards
- ⏳ Kanban (drag and drop), List and Calendar views per department
- ⏳ Team tasks with assignee, collaborators, visibility, organization tags
- ⏳ "My Work" and "Team Tasks" views, search

### Phase 6 — Collaboration
- ⏳ Comments on tasks
- ⏳ Progress update requests and responses
- ⏳ File attachments (also enables profile avatars)
- ⏳ Inbox with notifications and unread badges

### Phase 7 — Team & organization dashboards
- ⏳ Organization overview, department summary, member summary, CSV export

### Phase 8 — Reminders & notifications
- ⏳ Deadline-approaching and overdue reminders, update-request reminders
- ⏳ Notification preferences, optional email delivery (SMTP)
- ⏳ Background worker (Redis + Celery)

### Phase 9 — Production readiness
- ⏳ Security review, backups + restore drill, monitoring, deployment runbook
- ⏳ CI run on GitHub (workflow written; needs a GitHub remote)
- ⏳ Privacy / data-retention policy

### Small gaps in finished areas
- 🟡 Estimated / actual effort: saved by the API (`tasks`), no input field in the app yet
- 🟡 Profile avatar: waits for file storage (Phase 6)
- ⏸ Recurring tasks, custom role builder, sign-in with Google etc. — later releases (PRD P2)

---

## Change log
| Date | Change |
|---|---|
| 2026-10-29 | Theme preference moved from browser-only to the database (`user_preferences`); My Day, My Tasks and Upcoming redesigned; responsive fixes (Home overflow on phones, full-width task panel on phones, priority icons, day-strip fade); "Done today" on My Day. |
| 2026-10-29 | Phase 2 (personal workspace) completed. |
| 2026-10-29 | Phase 1 (accounts & sign-in) completed. |
| 2026-10-29 | Phase 0 (foundation) completed. |
