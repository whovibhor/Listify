# Listify — Requirements Traceability Matrix

Milestones (M0–M9) are defined in `implementation-roadmap.md`. Status values: **Planned**, **In progress**, **Done**, **Deferred**. Test IDs are planned names; they become real file paths as milestones are implemented.

## Business requirements (BRD §9)

| ID | Requirement (short) | Milestone | Planned tests | Status |
|---|---|---|---|---|
| BR-001 | One global account across workspaces | M1, M3 | `test_register_*` (unique email), `test_me_workspaces` (M3) | In progress (account done) |
| BR-002 | Personal tasks private from employers | M2, M3 | `test_personal_tasks_are_invisible_to_other_users` (done), `test_org_admin_cannot_read_personal` (M3) | In progress |
| BR-003 | Create organization, profile, departments | M3 | `test_creator_becomes_owner_with_departments_and_audit`, `test_department_lifecycle` | Done |
| BR-004 | Membership via invitation or approval | M3 | `test_pending_request_grants_nothing_until_approved`, `test_email_invitation_flow`, `e2e/organizations.spec.ts` | Done |
| BR-005 | Requested department approve/reject/change | M3 | `test_approver_can_amend_department_and_role`, `test_rejection_grants_no_access_and_allows_a_new_request` | Done |
| BR-006 | No board without membership/permission | M5 | `test_board_access_denied_non_member` | Planned |
| BR-007 | Creator, single assignee, collaborators | M5 | `test_task_roles_distinct` | Planned |
| BR-008 | Priority, status, deadline, tags, description, scope | M2, M5 | `test_task_fields_validation` | Planned |
| BR-009 | Comment, collaborate, review history | M6 | `test_comments_visibility`, `test_activity_log` | Planned |
| BR-010 | Assign to eligible members | M5 | `test_assign_requires_active_member` | Planned |
| BR-011 | Request status/progress update | M6 | `test_update_request_lifecycle` | Planned |
| BR-012 | Dashboards with documented definitions | M2, M7 | `test_metrics_*` fixtures | Planned |
| BR-013 | Audit membership/permission/assignment/state changes | M3–M6 | `test_audit_written_*` | Planned |
| BR-014 | Server-side, tenant-scoped authorization | M1–M9 | `test_*_cross_org_*` in every module | Planned |
| BR-015 | Mobile + desktop, keyboard accessible | M0–M9 | Playwright viewport + axe checks | Planned |
| BR-016 | Backups, monitoring, logging, recoverable deploys | M0 (logging), M9 | restore drill, health checks | Planned |

## Business rules (BRD §11)

| Rule | Summary | Milestone | Planned tests |
|---|---|---|---|
| 1 | Personal tasks: no org/dept scope, private | M2 | DB CHECK test, isolation tests |
| 2 | Org task in valid org; dept ∈ org | M5 | `test_task_department_must_belong_to_org` |
| 3 | Only active members assignable | M5 | `test_assign_suspended_member_rejected` |
| 4 | Creator/assignee/collaborator distinct | M5 | `test_task_roles_distinct` |
| 5 | Collaborator → task-only access | M5 | `test_collaborator_cannot_list_board` |
| 6 | Dept membership → board per role/visibility | M5 | `test_private_task_hidden_on_board` |
| 7 | Admin authority bounded | M3, M4 | `test_admin_of_one_org_cannot_reach_into_another`, `test_department_manager_is_limited_to_their_department` |
| 8 | Request ≠ membership | M3 | `test_pending_request_grants_nothing_until_approved` |
| 9 | Dept removal revokes derived access | M3, M5 | `test_removed_member_loses_board` |
| 10 | Completion uses completed_at; reopen | M2, M7 | `test_reopen_clears_completed_at`, `test_completed_in_period` |
| 11 | Overdue definition | M2, M7 | `test_overdue_excludes_no_due`, `test_overdue_terminal_excluded` |
| 12 | Explicit deadline timezone | M2 | `test_due_at_timezone_roundtrip` |
| 13 | Historical attribution | M7 | `test_completed_department_snapshot` |
| 14 | Checks on reads/search/exports/notifications/attachments/aggregates | M5–M8 | per-surface negative tests |

## Functional requirements (PRD §5)

| ID | Pri | Requirement (short) | Milestone | Planned tests | Status |
|---|---|---|---|---|---|
| FR-AUTH-01 | P0 | Register (email/password; IdP deferred) | M1 | `tests/test_auth.py::test_register_*`, `e2e/auth.spec.ts` | Done (IdP deferred, ADR-005) |
| FR-AUTH-02 | P0 | Login/logout; session invalidated | M1 | `test_login_*`, `test_logout_invalidates_the_session_server_side`, `test_expired_and_idle_sessions_are_rejected` | Done |
| FR-AUTH-03 | P0 | Password reset; expiring single-use tokens | M1 | `test_password_reset_flow_and_single_use`, `test_reset_token_expires_and_only_newest_link_works` | Done |
| FR-AUTH-04 | P1 | Update name, avatar, timezone, notification prefs | M1 (name/tz), M6 (avatar), M8 (notif prefs) | `tests/test_me.py::test_update_profile_*`, `settings.test.tsx` | Partial: name + timezone done |
| FR-AUTH-05 | P0 | Multiple orgs; switcher shows authorized only | M3 | `test_losing_membership_takes_effect_on_the_next_request`, `organizations.test.tsx` | Done |
| FR-PER-01 | P0 | CRUD, complete, reopen, archive personal tasks | M2 | `test_tasks.py::test_create_*`, `test_complete_reopen_cancel_restore`, `test_archive_*`, `test_personal_tasks_are_invisible_to_other_users`, `e2e/personal-tasks.spec.ts` | Done |
| FR-PER-02 | P0 | Title, description, priority, status, dates, tags, subtasks | M2 | `test_deadlines_are_converted_from_the_users_timezone`, `test_subtasks_*`, `test_update_fields_and_record_changes` | Done |
| FR-PER-03 | P0 | My Day / My Tasks / Upcoming / Completed | M2 | `test_views_use_the_users_local_day`, `personal-tasks.test.tsx` | Done |
| FR-PER-04 | P1 | Filter & sort status/priority/due/tag | M2 | `test_filters_search_sort_and_pagination`, filter URL test | Done |
| FR-PER-05 | P0 | Personal dashboard counts and trends | M2 | `test_dashboard.py`, `analytics.test.tsx` | Done |
| FR-PER-06 | P2 | Recurring tasks | Later | — | Deferred |
| FR-ORG-01 | P0 | Create org; creator = owner | M3 | `test_creator_becomes_owner_with_departments_and_audit`, `test_organization_creation_is_atomic` | Done |
| FR-ORG-02 | P0 | Create/edit/archive departments | M3 | `test_department_lifecycle`, `test_only_open_active_departments_can_be_requested` (blocking new tasks: M5) | Done |
| FR-ORG-03 | P1 | Invite by email/link, expiring | M3 | `tests/test_invitations.py`, `e2e/organizations.spec.ts` | Done |
| FR-ORG-04 | P0 | Request membership; pending = no access | M3 | `test_pending_request_grants_nothing_until_approved` | Done |
| FR-ORG-05 | P0 | Choose department; only open active depts | M3 | `test_only_open_active_departments_can_be_requested`, `test_department_is_required_when_some_are_open` | Done |
| FR-ORG-06 | P0 | Approve/reject/amend atomically | M3 | `test_approval_is_atomic`, `test_approver_can_amend_department_and_role` | Done |
| FR-ORG-07 | P1 | Suspend/remove member; prompt revocation | M4 | `test_suspended_member_requests_fail` | Planned |
| FR-ORG-08 | P1 | Department transfer | M4 | `test_transfer_revokes_old_dept` | Planned |
| PRD §5.4 | P0 | Permission-based RBAC, predefined roles | M3 (roles, checks), M4 (role changes) | `test_seeded_roles_match_the_code_catalog`, `test_members_cannot_administer`; `test_role_matrix_*` (M4) | In progress |
| PRD §5.5 | P0 | Work Boards: Kanban/List; filters; isolation | M5 | board tests | Planned |
| PRD §5.5 | P1 | Calendar view | M5 | UI test | Planned |
| PRD §5.6.1 | P0 | Task fields & validation | M2, M5 | schema tests | Planned |
| PRD §5.6.2 | P0 | Assignee vs collaborator | M5 | `test_task_roles_distinct` | Planned |
| PRD §5.6.3 | P0 | Visibility Private/Department/Selected/Org | M5 | `test_visibility_matrix` | Planned |
| PRD §5.6.4 | P0 | State transitions (ADR-015) | M2 | `test_transitions_matrix` | Planned |
| PRD §5.7 | P1 | Comments, activity, audit | M6 (comments), M2+ (activity) | `test_activity_events` | Planned |
| PRD §5.8 | P1 | Update requests | M6 | `test_update_request_lifecycle` | Planned |
| PRD §5.8 | P1 | In-app notifications (no leakage) | M6, M8 | `test_notification_hidden_after_access_loss` | Planned |
| PRD §5.6.1 | P1 | Attachments with per-download authz | M6 | `test_attachment_download_forbidden` | Planned |
| PRD §5.9 | P0/P1 | Personal / dept / org / member dashboards | M2, M7 | metric fixture tests | Planned |
| PRD §6.7 | P1 | Transfer/removal impact preview | M4 | `test_transfer_preview` | Planned |
| PRD §7 | — | Switcher, task panel, states, confirmations, a11y | M0–M9 | RTL + Playwright | Planned |
| PRD §13 | — | Edge cases 1–10 | M3–M8 | one test per edge case | Planned |

## Non-functional requirements (PRD §12)

| ID | Milestone | Verification |
|---|---|---|
| NFR-01 Security | every milestone | cross-tenant negative tests; M9 security review |
| NFR-02 Performance | M7, M9 | seeded load data; p95 < 500 ms on lists/dashboards |
| NFR-03 Availability | M9 | uptime monitoring |
| NFR-04 Scalability | M2+ | pagination enforced; index review per migration |
| NFR-05 Accessibility | M0+, M9 audit | axe in Playwright; keyboard tests |
| NFR-06 Usability | M2, M5 | quick-add + inline status change journeys |
| NFR-07 Maintainability | M0+ | Ruff, ESLint, type checks in CI |
| NFR-08 Recovery | M9 | backup + restore drill documented |
| NFR-09 Observability | M0 (structured logs), M9 | request IDs, error reporting |
| NFR-10 Privacy | M9 (policy), open decision | retention/deletion/export policy doc |
