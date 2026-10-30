# Listify — Feature Status

**Last updated:** 2026-10-30 · **Current phase:** Phase 6 (Collaboration) — next up

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
| Department work boards (team tasks) | ✅ Done |
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

### Department work boards & team tasks
| Feature | Stored in |
|---|---|
| Create team tasks with department, assignee, collaborators, visibility, tags, priority and deadline | `tasks`, `task_collaborators`, `task_visibility_grants`, `task_tags`, `task_activity_logs` |
| Department board: drag cards between columns, or use each card's Move menu (works by keyboard and on phones) | `tasks` |
| List view: sort by task, priority or deadline; pagination | reads `tasks` |
| Calendar view: month grid by deadline on larger screens, agenda on phones | reads `tasks` |
| Filters kept in the page URL: assignee, creator, priority, status, tags, overdue, deadline range, search | — (URL state) |
| My Work: assigned to you, and tasks you're collaborating on | reads `tasks`, `task_collaborators` |
| Team Tasks: everything you can see, across departments, with search and an Archived view | reads `tasks` |
| Four visibility levels: Private, Department, Selected people, Organization | `tasks`, `task_visibility_grants` |
| Assign, reassign, or pick up an unassigned task; add and remove collaborators | `tasks`, `task_collaborators` |
| Move a task to another department: access changes at once, and it's in the activity log | `tasks`, `audit_logs` |
| Organization tags, separate from personal tags | `tags` |
| Subtasks on team tasks, following the parent task's access | `tasks` |
| Review workflow: when the organization turns it on, work goes through In Review and the assignee can't approve their own (Owners and Admins can) | `organizations`, `tasks` |
| Tasks of suspended, removed or moved members are flagged for reassignment and nothing is lost; the impact preview counts them | computed from `tasks` and memberships |
| Team tasks are archived, never deleted | `tasks`, `audit_logs` |

### Quality (applies to everything above)
- Responsive: all 20 pages, the member panel and the impact preview checked at phone (375px), tablet (768px) and desktop (1280px) for overflow; screenshots reviewed.
- Accessibility: automated WCAG 2.2 AA scans (axe) on sign-in, task pages, the task panel, all organization pages, the member panel and its dialogs, the board in all three layouts, My Work, Team Tasks and the create dialog, plus dark-mode scans of the panels; dragging always has a menu alternative; keyboard and screen-reader labels.
- Privacy: other users get "not found" for your tasks, tags and sessions. Outsiders, pending applicants and suspended or removed members get "not found" for everything in an organization. Organizations can never see personal tasks. All tested.
- Permissions: every role tested against every permission-guarded endpoint on the real API, and each visibility level tested against eight kinds of viewer across reading, listing and search.

---

## ⏳ Pending

### Phase 6 — Collaboration *(next)*
- ⏳ Comments on tasks
- ⏳ Progress update requests and responses
- ⏳ File attachments (also enables profile avatars)
- ⏳ Inbox with notifications and unread badges, including telling people when they're assigned or added to a task, and when their role, department or membership changes
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

### Security improvements
- ✅ 16 of the 28 audit findings fixed, 2 more partly fixed: see [`security-audit.md`](security-audit.md)
- ⏸ Kept as they are by the owner's decision until Login with Google, or until the app leaves this PC: email verification, login limits, password strength, and the MySQL root account
- ⏳ Waiting on real email and scheduled jobs (Phase 8) and the production web server (Phase 9)

### Future — Sign-in with Google and other providers
- ⏳ Login with Google, then other providers (`user_identities` table, ADR-005)
- ⏳ Safe account linking, verified emails, and a decision on whether password sign-in stays

### Small gaps in finished areas
- 🟡 Estimated / actual effort: saved by the API (`tasks`), no input field in the app yet
- 🟡 Board cards don't keep a custom order within a column; they sort by deadline, then priority
- 🟡 Calendar shows the first 100 tasks in a month and says so; the List view has them all
- 🟡 A member can't leave an organization by themselves; an administrator removes them
- 🟡 Profile avatar: waits for file storage (Phase 6)
- ⏸ Recurring tasks, custom role builder, sign-in with Google etc. — later releases (PRD P2)

---

## Change log
| Date | Change |
|---|---|
| 2026-10-30 | Fixed a Phase 2 bug: a subtask entered while the previous one was still saving was silently lost. |
| 2026-10-30 | Security fixes: 16 audit findings closed and 2 partly closed, with regression tests. Sign-in and the MySQL account left unchanged by the owner's decision. Login with Google added to future plans. |
| 2026-10-30 | Security audit of Phases 0–5 written; no critical findings, 5 high. Desktop launcher `Start Listify.bat` added. |
| 2026-10-30 | Phase 5 (department work boards) completed. Added a `task.view_all` permission; every member now holds `task.view_organization`. Status colours darkened so they stay readable on tinted backgrounds. |
| 2026-10-30 | Phase 4 (roles & permissions, member management) completed. Shared red colour darkened in light mode and lightened in dark mode to meet the contrast standard. |
| 2026-10-30 | Phase 3 (organizations, departments, membership) completed. Product renamed to **Listify** (new checklist logo, cookies and internal names updated). Borders removed from all cards; cards now separate by shadow on a tinted background. |
| 2026-10-29 | Theme preference moved from browser-only to the database (`user_preferences`); My Day, My Tasks and Upcoming redesigned; responsive fixes (Home overflow on phones, full-width task panel on phones, priority icons, day-strip fade); "Done today" on My Day. |
| 2026-10-29 | Phase 2 (personal workspace) completed. |
| 2026-10-29 | Phase 1 (accounts & sign-in) completed. |
| 2026-10-29 | Phase 0 (foundation) completed. |
