# WorkPulse — Requirements Analysis

Sources: `docs/WorkPulse_BRD_v1.docx` (BRD v1.0, 29 Oct 2026) and `docs/WorkPulse_PRD_v1.docx` (PRD v1.0, 29 Oct 2026). Both were read in full. Section references below use the documents' own numbering (e.g. BRD §11, PRD §5.6.4).

## 1. Product summary

WorkPulse is a responsive web application combining **private personal task management** with **structured organization collaboration**. One global account (BR-001) gives a user a Personal Workspace plus any number of Organization Workspaces. Organizations contain departments, memberships, roles, department Work Boards, tasks, update requests, notifications and dashboards.

The defining product constraints are:

1. **Privacy by default** — personal tasks never become visible to an organization through membership (BR-002, BRD Rule 1).
2. **Server-side authorization is the source of truth** — frontend hiding is only usability (PRD §2, BR-014).
3. **Explicit, revocable department access** — department membership gates board access; collaboration grants only task-level access (BRD Rules 5, 6, 9).
4. **Trustworthy metrics** — dashboards use `completed_at`, explicit timezones and documented formulas (BRD Rules 10–13, PRD §5.9).
5. **Focused MVP, modular monolith** — no microservices, AI or real-time collaboration in the first release (BRD §6.2).

## 2. Business objectives (BRD §3)

| # | Objective |
|---|---|
| O1 | Single account for personal productivity and work collaboration |
| O2 | Organizations model departments, memberships, roles and reporting boundaries |
| O3 | Each department has a controlled Work Board |
| O4 | Task ownership, deadlines, priority, collaborators and status are explicit |
| O5 | Authorized managers assign work and request progress updates |
| O6 | Personal, department and organization dashboards with consistent definitions |
| O7 | Tenant isolation, auditable changes, predictable access revocation |
| O8 | Maintainable MVP that grows without premature infrastructure |

**Problems addressed (BRD §2):** personal and work task lists are split; SMEs track work in spreadsheets/chat; managers lack visibility into assigned/overdue/blocked/awaiting-update work; departments need access boundaries; managers need bounded (not unrestricted) admin rights; completion analytics must be time-aware and auditable.

**Success KPIs (BRD §4):** activation rate, weekly active users, active organizations, on-time completion rate, overdue count (workspace timezone), update response rate, median completion time (definition displayed), **zero** unauthorized-access incidents, availability/error rate. These shape metric definitions (Milestone 7) and telemetry (Milestone 9); product analytics instrumentation itself is not a feature requirement.

## 3. Scope

**In scope (BRD §6.1, PRD §16 P0/P1):** auth incl. password reset and profile; Personal Workspace (CRUD, complete/reopen/archive, views, filters, analytics); organization creation and profile; departments; discovery/invitations; membership requests with department choice; approval workflow; department Work Boards (Kanban/List/Calendar); RBAC enforced on the backend; assignment, collaborators, tags, priority, due dates, status, comments, activity history; dashboards; update requests; in-app notifications; search, filtering, pagination; audit logging; basic authorized export/reporting.

**Out of scope for initial release (BRD §6.2, PRD §16):** native mobile apps; payroll/leave/attendance/HRIS; portfolio management, budgeting, invoicing; public marketplace; AI planning/forecasting/scoring; real-time multiplayer editing and chat; microservices/event streaming/analytics warehouse.

**P2 / later (PRD §15–16):** recurring tasks, custom role builder, advanced exports, email digests, real-time updates, task templates, integrations, AI summaries, guest/external collaborators.

## 4. Roles and permissions

### 4.1 Roles (BRD §8, PRD §5.4)

| Role | Scope | Summary |
|---|---|---|
| Platform Super Admin | Platform | Operations, support, abuse response. Never auto-assigned to org staff. |
| Organization Owner | Organization | All organization permissions incl. owner transfer and high-impact settings. |
| Organization Admin | Organization | Operational administration (members, departments, roles, settings); owner transfer / destructive actions restricted. |
| Department Manager | Department | Department-scoped task, assignment, update-request and report permissions. |
| Team Lead | Department | Selected assignment and follow-up permissions; fewer member-management rights. |
| Employee / Member | Organization (+ department) | View and update permitted work, collaborate, respond to update requests. |
| Guest / External | Task | *Later.* Explicitly shared tasks only. |

### 4.2 Permission keys (PRD §5.4)

`task.create`, `task.view_own`, `task.view_department`, `task.view_organization`, `task.assign`, `task.update`, `task.delete`, `task.comment`, `task.manage_collaborators`, `task.request_update`, `member.view`, `member.approve`, `member.manage`, `department.create`, `department.update`, `role.assign`, `report.view_personal`, `report.view_department`, `report.view_organization`, `organization.settings.update`.

Predefined roles map to these in code and are tested (PRD §5.4: "configurable in code and tested"). The proposed baseline matrix is in `architecture-decisions.md` (ADR-011) and will be finalized in Milestone 4.

## 5. Principal user journeys

| ID | Journey | Source | Key rules |
|---|---|---|---|
| J1 | Register → onboarding (Personal / Create org / Join org / Skip) → land in Personal Workspace | PRD §6.1 | Unique email, password rules, secure session |
| J2 | Personal task lifecycle: create → view in My Day/My Tasks/Upcoming → status change → complete/reopen → dashboard updates | BRD §10.1, PRD §5.2 | Owner-only; user timezone for metrics |
| J3 | Create organization → becomes Owner (transaction) → create departments → configure join policy → invite | BRD §10.2, PRD §6.2 | Atomic owner assignment |
| J4 | Join organization: search/invite → choose department → note/job title → Pending → admin Approve/Reject/Amend → access recalculated | BRD §10.3, PRD §6.3 | Pending grants nothing; approval atomic |
| J5 | Create and assign department task → validation → transaction + activity log → notify after commit | BRD §10.4, PRD §6.4 | Assignee must be active member; dept ∈ org |
| J6 | Update and complete task; reopen | PRD §6.5 | Transition rules; `completed_at` set/cleared; history kept |
| J7 | Request progress update → recipient responds from Inbox → requester sees response while authorized | PRD §6.6 | `task.request_update`; recipient must have access |
| J8 | Department transfer or removal with impact preview, audit, revocation, reassignment policy | PRD §6.7 | No task deletion; no leaking in notifications |
| J9 | Workspace switching between Personal and each organization | PRD §7, FR-AUTH-05 | Switcher lists only authorized workspaces |
| J10 | Dashboards: personal / department / organization / member summary | PRD §5.9 | Requester-scoped aggregates; documented formulas |

## 6. Functional requirements (consolidated)

Full list with IDs, priorities and acceptance criteria is in `requirements-traceability.md`. Groups:

- **Identity & account:** FR-AUTH-01…05.
- **Personal workspace:** FR-PER-01…06 (06 recurrence is P2).
- **Organization & membership:** FR-ORG-01…08.
- **Roles & permissions:** PRD §5.4.
- **Work Boards:** PRD §5.5 (Kanban/List/Calendar, filters, department isolation, task visibility, collaborator scope).
- **Task management:** PRD §5.6 (fields, assignee vs collaborator, visibility, state transitions).
- **Comments, activity, audit:** PRD §5.7.
- **Update requests & notifications:** PRD §5.8.
- **Dashboards & analytics:** PRD §5.9.
- **UI & interaction:** PRD §7.
- **Edge cases:** PRD §13 (ten explicit scenarios).

## 7. Non-functional requirements (PRD §12, BRD BR-014–016)

| ID | Area | Target |
|---|---|---|
| NFR-01 | Security | No access outside authorized scope; automated tenant-isolation tests |
| NFR-02 | Performance | p95 < 500 ms for common lists/dashboards at MVP volumes |
| NFR-03 | Availability | ~99.5% monthly initially |
| NFR-04 | Scalability | Pagination, indexed queries, background jobs; never load an org's full history |
| NFR-05 | Accessibility | WCAG 2.2 AA practices for core flows |
| NFR-06 | Usability | Task creation and status update with minimal navigation and clear feedback |
| NFR-07 | Maintainability | Modular code, tests, migration discipline, documented permissions |
| NFR-08 | Recovery | Automated backups + tested restore before production |
| NFR-09 | Observability | Central logs, exception reporting, uptime checks, queue-failure monitoring |
| NFR-10 | Privacy | Retention, deletion, export and access policies defined before production |

## 8. Principal data entities

Based on PRD §8 (logical model). Full design will be written in `docs/database-design.md` per milestone.

| Entity | Notes |
|---|---|
| users | email unique; password_hash (Argon2id); timezone; avatar |
| sessions | *added* — server-side session records for revocable cookie auth (ADR-004) |
| password_reset_tokens | *added* — hashed, single-use, expiring (FR-AUTH-03) |
| organizations | slug unique; timezone; status; `is_discoverable` (ADR-014) |
| departments | org-scoped; status (active/archived); `open_for_join_requests` (FR-ORG-05) |
| organization_memberships | unique (organization_id, user_id); status; primary_department_id |
| department_memberships | org_id + dept_id + user_id; supports multiple |
| roles, permissions, role_permissions, membership_roles | predefined roles seeded; membership_roles optionally department-scoped |
| membership_requests | Pending/Approved/Rejected/Cancelled; requested department/role |
| organization_invitations | token_hash, expiry, accepted_at |
| tasks | workspace_type; owner_user_id (personal) xor organization_id (org); department_id; created_by; assigned_to; parent_task_id (subtasks, ADR-016); status; priority; visibility; start_at; due_at; completed_at; completion attribution snapshot (Rule 13); estimates; deleted_at |
| task_collaborators, task_visibility_grants | collaborators; selected-users visibility list |
| tags, task_tags | personal vs organization scoped |
| task_comments, task_attachments, task_activity_logs | |
| task_update_requests | Pending/Responded/Cancelled/Expired |
| notifications | user-scoped; read_at; re-authorized at read time |
| audit_logs | append-only for ordinary users |
| user_preferences | key/value JSON |

## 9. Key business rules (BRD §11, PRD §5–8, §13)

1. Personal tasks: `owner_user_id` set, `organization_id`/`department_id` NULL; owner-only.
2. Org tasks: valid organization; department (if set) must belong to that organization.
3. Only active members can be assignees of organization tasks.
4. Creator ≠ assignee ≠ collaborator — distinct relationships.
5. Collaborator access is task-only and does not reveal the board.
6. Department membership grants board visibility subject to role and task visibility.
7. Admin authority bounded by organization and assigned permissions.
8. Membership request ≠ membership; no access before approval.
9. Removal from department revokes department-derived access; other paths evaluated separately.
10. Completion reports use `completed_at`; reopen clears current completion, history preserved.
11. Overdue = non-terminal status AND `due_at` < now (evaluated instant; display/period boundaries in workspace timezone). No `due_at` → never overdue.
12. Deadline timezone explicit or derived from workspace/user settings, shown consistently.
13. Historical reports preserve completion-time department/organization attribution.
14. Permission checks apply to reads, writes, search, exports, notifications, attachments and aggregates.
15. Archived department: no new tasks; existing tasks remain accessible per policy.
16. Suspended/departed assignee: tasks flagged for reassignment, not deleted.
17. Notification failure must not fail the task update; retried and logged separately.

**Status transitions (PRD §5.6.4):** Not Started → In Progress; In Progress ↔ Blocked; In Progress → In Review (if review enabled); In Review → Completed; any non-terminal → Cancelled; Completed → In Progress (reopen, if allowed). See ADR-015 for the gaps this table leaves.

## 10. BRD ↔ PRD cross-document analysis

### 10.1 Conflicts

| # | Conflict | BRD | PRD | Resolution |
|---|---|---|---|---|
| C1 | **Backend stack** | — | Recommends Laravel + Sanctum (§10, §19) | **FastAPI** chosen by product owner (ADR-001). Laravel-provided capabilities (policies, queues, scheduler, mail) built explicitly. |
| C2 | Attachments priority | In scope implicitly (Rule 14 mentions attachments) | P1 in §16 but "Later" in §15 roadmap | Build in Milestone 6 with local storage behind an interface (ADR-018). |
| C3 | Release phase order | — | §15 puts Reporting (Ph4) before Collaboration (Ph5) | Roadmap keeps collaboration before full reporting because update-response metrics depend on update requests; personal dashboard stays in Personal MVP. Documented in roadmap. |
| C4 | Background processing | "queue failures" KPI implies a queue | Redis "when needed; database queue initially is possible" | Redis + Celery + Beat, introduced at Milestone 8 (ADR-008). Notifications before M8 written synchronously after commit. |
| C5 | Login identity provider | Not mentioned | FR-AUTH-01 "or an approved identity provider" | Email + password for MVP; IdP deferred (ADR-005). |

### 10.2 Ambiguities and gaps (with adopted defaults)

| # | Gap | Adopted default | Confirmed |
|---|---|---|---|
| A1 | Organization discovery policy (BRD §12, PRD §18) | Private by default; invitations always; owner may opt in to name search | Yes (owner) |
| A2 | Departments per member | One primary in UI; schema supports many | Yes |
| A3 | "In Review" optional ("if review is enabled") | Per-organization setting `review_required`; off → In Progress → Completed allowed | Yes |
| A4 | Missing transitions (Not Started → Completed? Blocked → Cancelled? Cancelled → reopen?) | See ADR-015 | Yes (defaults) |
| A5 | Subtask model and parent completion | Child tasks via `parent_task_id`; parent cannot complete with open subtasks | Yes |
| A6 | Task deletion | Org tasks soft-deleted with audit; personal tasks archive then permanent delete | Yes |
| A7 | Admin visibility of private org tasks | Not visible unless creator/assignee/collaborator; stated in UI | Yes |
| A8 | Who changes assignee | Creator or holder of `task.assign` in scope | Yes |
| A9 | Completion metric on reopen | Current-state reports exclude reopened tasks; history keeps events | Yes |
| A10 | Personal-task statuses | Same status set as org tasks; "In Review" hidden in personal workspace | Default |
| A11 | Actual effort manual vs timer | Manual numeric (minutes) in MVP | Default |
| A12 | Rich text description | Plain text / Markdown-lite rendered safely in MVP; no raw HTML | Default |
| A13 | Comment edit/delete policy | Author may edit/delete own comment; edit sets `edited_at`; delete is soft with audit trace | Default |
| A14 | Update request "Expired" state | Supported when `due_at` passes, set by scheduler (M8) | Default |
| A15 | Email delivery | Console/log mailer in dev behind an interface; SMTP/provider later | Yes |
| A16 | Password rules | Min 12 chars, max 128, no composition rules, block very common passwords (NIST 800-63B style) | Default |
| A17 | Session lifetime | 12 h idle timeout, 7-day absolute; "remember me" not in MVP | Default |
| A18 | Terms acceptance at registration (PRD §6.1) | Checkbox + timestamp stored; legal text placeholder until provided | Default |
| A19 | Platform Super Admin UI (PRD §4) | Role modeled; admin UI deferred past MVP | Default |
| A20 | Retention, deletion, export policies (NFR-10) | **Open** — must be defined before production | No |
| A21 | Pricing / plan limits | **Open** — do not build | No |
| A22 | Final product name | "WorkPulse" working name | No |

### 10.3 Features in one document only

- PRD only: My Day/Upcoming views, calendar view, recurring tasks, estimated/actual effort, attachments detail, subtasks, platform admin area, specific permission keys, data model.
- BRD only: KPIs (activation, WAU, update response rate, median completion time), product administrator stakeholder, operational resilience requirement (BR-016) beyond PRD NFRs.

### 10.4 Security implications

- Multi-tenant isolation is the critical risk (BRD §13). Every query in `modules/*` must go through scoped repository/policy helpers; negative tests for guessed IDs and stale memberships are mandatory per milestone.
- Notifications must be re-authorized at read time so they never leak titles after access loss (PRD §5.8).
- Dashboards aggregate only rows the requester can access (Rule 14).
- Rate limiting required on login, password reset, invitations and membership requests (PRD §11.1).
- Cookie session + CSRF protection; CORS limited to known origins (ADR-004, ADR-006).

### 10.5 Schema-affecting decisions

Workspace type + owner/organization exclusivity (CHECK constraint), completion attribution snapshot columns, server-side sessions, selected-users visibility table, subtask self-reference, org timezone + review setting, department `open_for_join_requests`, organization `is_discoverable`.

## 11. Open questions (non-blocking for foundation)

1. Retention, account deletion and data export policy (NFR-10, A20).
2. Legal terms text for registration (A18).
3. Production hosting target (VPS provider, domain) — needed by Milestone 9.
4. Email provider for production — needed before password reset goes live.
5. Whether managers may see member summaries for members outside their department when they hold org-wide report permission (PRD §5.9 "explicitly authorized manager") — proposed: requires `report.view_organization`.
