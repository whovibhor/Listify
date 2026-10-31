# Denote — Feature Status

**Last updated:** 2026-10-31 · **Current work:** UI & journey rework, Batch 5 (task page) next · Phase 8 follows the rework

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
| Comments, update requests, attachments, inbox | ✅ Done |
| Team & organization dashboards | ✅ Done |
| UI & journey rework | 🟡 In progress: Batches 1 to 4 of 6 done |
| Reminders, notifications, email | ⏳ Pending (Phase 8) |
| Production readiness (deploy, backups, monitoring) | ⏳ Pending (Phase 9) |

---

## ✅ Done

Every item below is saved in and loaded from MySQL (database `denote`). The "Stored in" column names the table.

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
| Home: today's numbers, today's tasks, quick add | reads `tasks` |

### Organizations, departments & membership
| Feature | Stored in |
|---|---|
| Create an organization (you become Owner) with profile, website, location, timezone | `organizations`, `organization_memberships`, `membership_roles` |
| Organization settings: profile, searchable by name, require task review | `organizations` |
| Departments: create, edit, archive/restore, open or closed to join requests. Department Managers do this from their department page | `departments` |
| Department page: description, manager, team totals, 30-day trend and members with roles and job titles. Everyone in the department can open it, and it shows no one person's numbers | computed from `tasks`, reads `departments`, `membership_roles` |
| Sidebar: Departments for Owner and Admin, Department for everyone else, who go straight to their own page, with a switcher if they're in two | reads `department_memberships` |
| Header workspace button: one click between Personal and your organization, a list if you have several, role-based navigation | reads `organization_memberships`, `membership_roles` |
| Reopens the workspace you last used; pages such as Settings stay in it | `user_preferences` |
| Collapsible sidebar with an icon rail, saved to your account | `user_preferences` |
| Create and Join: in the header until you've joined an organization, then only in Account settings > Organizations | reads `organization_memberships` |
| Find an organization by name (only ones that opted in) | reads `organizations` |
| Request to join with a department, job title and note; cancel a request; see its status | `membership_requests` |
| Review requests: approve, decline with a reason, change department or role before approving | `membership_requests`, `organization_memberships`, `department_memberships`, `membership_roles` |
| Invitations: by email or one-time link, with role, department and 7-day expiry; revoke | `organization_invitations` |
| Accept an invitation from its link | `organization_invitations`, `organization_memberships`, `department_memberships`, `membership_roles` |
| All members tab on Departments for Owner and Admin: search, filter by department. Everyone else sees colleagues on their department page | reads `organization_memberships`, `department_memberships` |
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
| Filter All members by status | reads `organization_memberships` |
| Losing access while a page is open: the next request fails and the page updates itself | — (reloads your organizations) |

### Department work boards & team tasks
| Feature | Stored in |
|---|---|
| Create team tasks with department, assignee, collaborators, visibility, tags, priority and deadline | `tasks`, `task_collaborators`, `task_visibility_grants`, `task_tags`, `task_activity_logs` |
| Department board: drag cards between columns, or use each card's Move menu (works by keyboard and on phones) | `tasks` |
| Board columns run Not Started, In Progress, In Review, Completed. Blocked and Cancelled stay hidden until switched on, with their counts on the toggles | reads `tasks` |
| Completed column shows the last 30 days, newest first, with a link to older tasks in the List view | reads `tasks` |
| List view: sort by task, priority or deadline; pagination | reads `tasks` |
| Calendar view: month grid by deadline on larger screens, agenda on phones | reads `tasks` |
| Filters kept in the page URL: assignee, creator, priority, status, tags, overdue, deadline range, search | — (URL state) |
| My Work: assigned to you, and tasks you're collaborating on. Opens on open work, with Show finished | reads `tasks`, `task_collaborators` |
| Team Tasks and the board's List view open on active work, with Show finished. Team Tasks works across departments, with an Archived view. Search always includes finished tasks | reads `tasks` |
| Four visibility levels: Private, Department, Selected people, Organization | `tasks`, `task_visibility_grants` |
| Assign, reassign, or pick up an unassigned task; add and remove collaborators | `tasks`, `task_collaborators` |
| Move a task to another department: access changes at once, and it's in the activity log | `tasks`, `audit_logs` |
| Organization tags, separate from personal tags | `tags` |
| Subtasks on team tasks, following the parent task's access | `tasks` |
| Review workflow: when the organization turns it on, work goes through In Review and the assignee can't approve their own (Owners and Admins can) | `organizations`, `tasks` |
| Tasks of suspended, removed or moved members are flagged for reassignment and nothing is lost; the impact preview counts them | computed from `tasks` and memberships |
| Team tasks are archived, never deleted | `tasks`, `audit_logs` |

### Collaboration & inbox
| Feature | Stored in |
|---|---|
| Comments on tasks: add, edit or delete your own, with line breaks kept. Owners and Admins can remove any comment. Personal tasks can hold notes too | `task_comments`, `task_activity_logs` |
| Mention someone in a comment. They must be able to see the task | `notifications` |
| File attachments up to 10 MB: PDF, images, text, CSV, Word, Excel, PowerPoint, ZIP. Drag and drop or pick files | `task_attachments`, files in `backend/storage/` |
| Request an update from the assignee or a collaborator, with an optional answer-by date | `task_update_requests` |
| Respond from the Inbox or the task, optionally changing the task's status | `task_update_requests`, `tasks` |
| Inbox: All, Unread, Assignments and Update requests, plus a list of updates waiting for you. Each organization has its own inbox | `notifications`, `task_update_requests` |
| Personal inbox: notices from organizations you've left, were turned down by or are suspended from | `notifications` |
| Notifications for assignments, collaborators, comments, mentions, update requests, join decisions, and changes to your role, departments or membership | `notifications` |
| Unread count on the bell and in the sidebar for the current workspace, refreshed every minute, and a dot on the workspace button when another workspace has something waiting | reads `notifications` |
| Items you can no longer see show "You no longer have access", with no task details | worked out when read |
| Impact preview also counts update requests waiting for that person; removing them closes those requests | `task_update_requests` |

### Reports
| Feature | Stored in |
|---|---|
| Organization report for Owners and Admins: open, completed, created, overdue, blocked, on-time rate, tasks per day, workload by department | reads `tasks` |
| Member activity list, by name and never ranked | reads `tasks`, `organization_memberships` |
| Department report: all of the above for one department, plus open by status, by assignee, overdue, blocked and recent completions | reads `tasks` |
| Member summary, for yourself or someone in a department you report on: assigned, completed, overdue, blocked, waiting update requests, open work by status, priority and department. Deliberately no score | reads `tasks`, `task_update_requests` |
| Periods: 7, 30 or 90 days, 1 year, or your own dates up to 366 days. Reports linked from one another keep the same period | kept in the page address |
| Every report shows its dates, the organization's timezone, whose tasks it covers, and how each number is worked out | definitions come from the backend |
| Completed work stays with the department that finished it, even if the task moves later | `tasks.completed_department_id` |
| CSV export for Owners, Admins and department report readers, recorded in the Activity log | `audit_logs` |
| Key numbers on the Overview page, and a Report button on department boards | reads `tasks` |

### Quality (applies to everything above)
- Responsive: all 24 pages, the member panel and the impact preview checked at phone (375px), tablet (768px) and desktop (1280px) for overflow; screenshots reviewed.
- Accessibility: automated WCAG 2.2 AA scans (axe) on sign-in, task pages, the task panel, all organization pages, the member panel and its dialogs, the board in all three layouts, My Work, Team Tasks, the Inbox and the create dialog, plus dark-mode scans of the panels; dragging always has a menu alternative; keyboard and screen-reader labels.
- Privacy: other users get "not found" for your tasks, tags and sessions. Outsiders, pending applicants and suspended or removed members get "not found" for everything in an organization. Organizations can never see personal tasks. All tested.
- Permissions: every role tested against every permission-guarded endpoint on the real API, and each visibility level tested against eight kinds of viewer across reading, listing and search.

---

## ⏳ Pending

### UI & journey rework *(next)*
The agreed plan, with the owner's decisions, is in [`implementation-roadmap.md`](implementation-roadmap.md). These existing features will change:

**Batch 5: Task page**
- ⏳ Full task page replaces the side panel everywhere, for personal and organization tasks
- ⏳ Details rail plus tabs with their own links: Overview, Comments, Files, Update requests, Activity
- ⏳ Status and Complete stay one click; everything else goes through an Edit button
- ⏳ Subtasks get the same page, with a link to the parent
- ⏳ Real links on cards and rows, Back keeps list filters, old `?task=` links redirect

**Batch 6: Final pass**
- ⏳ Full journey for each role, accessibility checks, docs, and a complete E2E run

### Planned additions (agreed 2026-10-31, after the rework)
- ⏳ Time estimates on the task page and reports
- ⏳ Bulk actions on Team Tasks: change status, assignee or deadline together
- ⏳ Global search (Ctrl+K) across tasks, people and pages
- ⏳ Recurring tasks and task dependencies, after Phase 8

### Phase 8 — Reminders & notifications
- ⏳ Deadline-approaching and overdue reminders, update-request reminders
- ⏳ Notification preferences, optional email delivery (SMTP)
- ⏳ Background worker (Redis + Celery)
- ⏳ Cleanup of old notifications, and files left behind by failed deletes

### Phase 9 — Production readiness
- ⏳ Security review, backups + restore drill, monitoring, deployment runbook
- ⏳ CI run on GitHub (workflow written and the repository is on GitHub; a passing run hasn't been confirmed)
- ⏳ Privacy / data-retention policy
- ⏳ Virus scanning for attachments, and file storage outside the application server

### Security improvements
- ✅ 16 of the 28 audit findings fixed, 2 more partly fixed: see [`security-audit.md`](security-audit.md)
- ⏸ Kept as they are by the owner's decision until Login with Google, or until the app leaves this PC: email verification, login limits, password strength, and the MySQL root account
- ⏳ Waiting on real email and scheduled jobs (Phase 8) and the production web server (Phase 9)

### Future — Sign-in with Google and other providers
- ⏳ Login with Google, then other providers (`user_identities` table, ADR-005)
- ⏳ Safe account linking, verified emails, and a decision on whether password sign-in stays

### Small gaps in finished areas
- 🟡 Estimated / actual effort: saved by the API (`tasks`), no input field in the app yet (planned, see Time estimates above)
- 🟡 Board cards don't keep a custom order within a column; they sort by deadline, then priority
- 🟡 Calendar shows the first 100 tasks in a month and says so; the List view has them all
- 🟡 A member can't leave an organization by themselves; an administrator removes them
- 🟡 Profile avatar: file storage now exists, but avatars aren't built
- 🟡 Comments are plain text, and mentions are chosen from a list rather than typed with @
- 🟡 The BRD's Median completion time and Update response rate aren't on any report. Neither is in the PRD's report list, and the response rate needs the response window that arrives with Phase 8
- 🟡 Update requests don't expire on their own (optional in the PRD; comes with reminders in Phase 8)
- ⏸ Custom role builder — later release (PRD P2)

---

## Change log
| Date | Change |
|---|---|
| 2026-10-31 | Boards and lists now open on current work: new column order, Blocked and Cancelled hidden until asked for, Completed limited to 30 days, and Show finished on task lists. Boards load about 45% faster for Members on very large organizations. |
| 2026-10-31 | Department page added. The Members sidebar item is gone: Owners and Admins use the All members tab on Departments. Boards moved to `/org/:id/boards/:id`, and old links still work. |
| 2026-10-31 | Inbox per workspace: each organization has its own inbox and counts, Personal keeps notices from organizations you can't open any more, and a dot shows when another workspace has something waiting. Clicking Inbox no longer jumps to Personal. |
| 2026-10-31 | Renamed the product from Listify to Denote: interface, emails, cookies, logs, config, packages, docs and the MySQL databases (`denote`, `denote_test`). Everyone signs in once more. |
| 2026-10-31 | App shell rework: System Status removed from Home, workspace button moved to the header, collapsible sidebar, new sidebar order, Create and Join moved to Account settings, last workspace remembered. |
| 2026-10-31 | Sample data added to Shoolini University for hands-on testing: 16 more members and 131 tasks with history. See the README. |
| 2026-10-31 | Database speed, steps 2 and 3: Team Tasks is about four times faster at 100,000 tasks, using a new sort index and a quicker sharing check. Report indexes are smaller. No visible feature changes. |
| 2026-10-31 | Request limiter: the app stays up under heavy load, with a "server busy" reply after 30 seconds. Fixed a freeze caused by slow uploads. |
| 2026-10-31 | Database speed, step 1: a larger connection pool, far fewer queries on busy pages, and tests that keep it that way. No visible feature changes. |
| 2026-10-30 | Phase 7 (reports) completed: organization, department and member reports, date ranges, CSV export. Three new indexes on `tasks`, no new tables. |
| 2026-10-30 | Phase 6 (collaboration) completed: comments, attachments, update requests, notifications and the Inbox. |
| 2026-10-30 | Fixed a Phase 2 bug: a subtask entered while the previous one was still saving was silently lost. |
| 2026-10-30 | Security fixes: 16 audit findings closed and 2 partly closed, with regression tests. Sign-in and the MySQL account left unchanged by the owner's decision. Login with Google added to future plans. |
| 2026-10-30 | Security audit of Phases 0–5 written; no critical findings, 5 high. Desktop launcher `Start Denote.bat` added. |
| 2026-10-30 | Phase 5 (department work boards) completed. Added a `task.view_all` permission; every member now holds `task.view_organization`. Status colours darkened so they stay readable on tinted backgrounds. |
| 2026-10-30 | Phase 4 (roles & permissions, member management) completed. Shared red colour darkened in light mode and lightened in dark mode to meet the contrast standard. |
| 2026-10-30 | Phase 3 (organizations, departments, membership) completed. Product renamed to **Denote** (new checklist logo, cookies and internal names updated). Borders removed from all cards; cards now separate by shadow on a tinted background. |
| 2026-10-29 | Theme preference moved from browser-only to the database (`user_preferences`); My Day, My Tasks and Upcoming redesigned; responsive fixes (Home overflow on phones, full-width task panel on phones, priority icons, day-strip fade); "Done today" on My Day. |
| 2026-10-29 | Phase 2 (personal workspace) completed. |
| 2026-10-29 | Phase 1 (accounts & sign-in) completed. |
| 2026-10-29 | Phase 0 (foundation) completed. |
