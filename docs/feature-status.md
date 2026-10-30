# Listify — Feature Status

**Last updated:** 2026-10-30 · **Current phase:** Phase 5 (Department Work Boards) — next up

This is the single list of what is **done** and what is **pending**, feature by feature. It is updated every time a feature is completed or changed. A feature is marked ✅ only after it works end-to-end (UI → API → MySQL) and its tests have been run and passed. Detailed plans live in [`implementation-roadmap.md`](implementation-roadmap.md).

Legend: ✅ done · 🟡 partly done · ⏳ pending · ⏸ deferred (later release)

---

## Summary

| Area | Status |
|---|---|
| Accounts & sign-in | ✅ Done |
| Personal workspace (tasks, views, tags, subtasks, history) | ✅ Done |
| Personal analytics & home page | ✅ Done |
| Organizations, departments, membership | ✅ Done |
| Roles & permissions, member management | ✅ Done |
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

### Organizations, departments & membership
| Feature | Stored in |
|---|---|
| Create an organization (you become Owner) with profile, website, location, timezone | `organizations`, `organization_memberships`, `membership_roles` |
| Organization settings: profile, searchable by name, require task review | `organizations` |
| Departments: create, edit, archive/restore, open or closed to join requests | `departments` |
| Workspace switcher: Personal + your active organizations, with role-based navigation | reads `organization_memberships`, `membership_roles` |
| Find an organization by name (only ones that opted in) | reads `organizations` |
| Request to join with a department, job title and note; cancel a request; see its status | `membership_requests` |
| Review requests: approve, decline with a reason, change department or role before approving | `membership_requests`, `organization_memberships`, `department_memberships`, `membership_roles` |
| Invitations: by email or one-time link, with role, department and 7-day expiry; revoke | `organization_invitations` |
| Accept an invitation from its link | `organization_invitations`, `organization_memberships`, `department_memberships`, `membership_roles` |
| Members directory: search, filter by department (admins see everyone, others their departments) | reads `organization_memberships`, `department_memberships` |
| Activity log of administrative actions (read-only) | `audit_logs` |
| Five predefined roles and 20 permissions, checked on the server | `roles`, `permissions`, `role_permissions` |

### Roles & member management
| Feature | Stored in |
|---|---|
| Member panel: a member's roles, departments and the actions you're allowed to take | reads `organization_memberships`, `membership_roles`, `department_memberships` |
| Change roles: Member or Admin, plus Team Lead or Department Manager per department | `membership_roles` |
| Suspend (with an optional reason) and reactivate: roles and departments come back unchanged | `organization_memberships`, `audit_logs` |
| Remove from the organization: all access ends, history stays | `organization_memberships`, `membership_roles`, `department_memberships`, `audit_logs` |
| Move a member between departments; add to more departments; take out of a department | `department_memberships`, `membership_roles`, `organization_memberships` |
| Impact preview before suspend, remove, move and take-out: departments, roles, departments left with no manager, waiting join requests | computed from the tables above |
| Transfer ownership, confirmed with your password; the old Owner becomes Admin | `membership_roles`, `audit_logs`, `rate_limit_buckets` |
| Filter the Members page by status | reads `organization_memberships` |
| Losing access while a page is open: the next request fails and the page updates itself | — (reloads your organizations) |

### Quality (applies to everything above)
- Responsive: all 15 pages, the member panel and the impact preview checked at phone (375px), tablet (768px) and desktop (1280px) for overflow; screenshots reviewed.
- Accessibility: automated WCAG 2.2 AA scans (axe) on sign-in, task pages, the task panel, all organization pages, the member panel and its dialogs, plus one dark-mode scan; keyboard and screen-reader labels.
- Privacy: other users get "not found" for your tasks, tags and sessions. Outsiders, pending applicants and suspended or removed members get "not found" for everything in an organization. Organizations can never see personal tasks. All tested.
- Permissions: every role tested against every permission-guarded endpoint on the real API.

---

## ⏳ Pending

### Phase 5 — Department work boards *(next)*
- ⏳ Kanban (drag and drop), List and Calendar views per department
- ⏳ Team tasks with assignee, collaborators, visibility, organization tags
- ⏳ "My Work" and "Team Tasks" views, search
- ⏳ Impact preview also counts open assigned tasks; suspended or removed members' tasks are flagged for reassignment (Phase 4 has no organization tasks to count yet)

### Phase 6 — Collaboration
- ⏳ Comments on tasks
- ⏳ Progress update requests and responses
- ⏳ File attachments (also enables profile avatars)
- ⏳ Inbox with notifications and unread badges, including telling people when their role, department or membership changes
- ⏳ Impact preview also counts pending update requests

### Phase 7 — Team & organization dashboards
- ⏳ Organization overview, department summary, member summary, CSV export

### Phase 8 — Reminders & notifications
- ⏳ Deadline-approaching and overdue reminders, update-request reminders
- ⏳ Notification preferences, optional email delivery (SMTP)
- ⏳ Background worker (Redis + Celery)

### Phase 9 — Production readiness
- ⏳ Security review, backups + restore drill, monitoring, deployment runbook
- ⏳ CI run on GitHub (workflow written and the repository is on GitHub; a passing run hasn't been confirmed)
- ⏳ Privacy / data-retention policy

### Small gaps in finished areas
- 🟡 Estimated / actual effort: saved by the API (`tasks`), no input field in the app yet
- 🟡 Profile avatar: waits for file storage (Phase 6)
- ⏸ Recurring tasks, custom role builder, sign-in with Google etc. — later releases (PRD P2)

---

## Change log
| Date | Change |
|---|---|
| 2026-10-30 | Phase 4 (roles & permissions, member management) completed. Shared red colour darkened in light mode and lightened in dark mode to meet the contrast standard. |
| 2026-10-30 | Phase 3 (organizations, departments, membership) completed. Product renamed to **Listify** (new checklist logo, cookies and internal names updated). Borders removed from all cards; cards now separate by shadow on a tinted background. |
| 2026-10-29 | Theme preference moved from browser-only to the database (`user_preferences`); My Day, My Tasks and Upcoming redesigned; responsive fixes (Home overflow on phones, full-width task panel on phones, priority icons, day-strip fade); "Done today" on My Day. |
| 2026-10-29 | Phase 2 (personal workspace) completed. |
| 2026-10-29 | Phase 1 (accounts & sign-in) completed. |
| 2026-10-29 | Phase 0 (foundation) completed. |
