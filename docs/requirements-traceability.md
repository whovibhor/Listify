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
| BR-006 | No board without membership/permission | M5 | `test_board_access_denied_non_member`, `test_other_organizations_stay_out` | Done |
| BR-007 | Creator, single assignee, collaborators | M5 | `test_task_roles_distinct` | Done |
| BR-008 | Priority, status, deadline, tags, description, scope | M2, M5 | `test_task_department_must_belong_to_org_and_to_the_creator`, `test_tags_belong_to_the_organization` | Done |
| BR-009 | Comment, collaborate, review history | M6 | `test_comments_are_exactly_as_visible_as_their_task`, `test_comment_lifecycle` | Done |
| BR-010 | Assign to eligible members | M5 | `test_assign_requires_active_member_of_the_department`, `test_assignment_rights` | Done |
| BR-011 | Request status/progress update | M6 | `test_update_request_flow` | Done |
| BR-012 | Dashboards with documented definitions | M2, M7 | `test_organization_metrics`, `test_dashboard.py` | Done |
| BR-013 | Audit membership/permission/assignment/state changes | M3–M6 | `test_audit_written_*` | Planned |
| BR-014 | Server-side, tenant-scoped authorization | M1–M9 | `test_*_cross_org_*` in every module | Planned |
| BR-015 | Mobile + desktop, keyboard accessible | M0–M9 | Playwright viewport + axe checks | Planned |
| BR-016 | Backups, monitoring, logging, recoverable deploys | M0 (logging), M9 | restore drill, health checks | Planned |

## Business rules (BRD §11)

| Rule | Summary | Milestone | Planned tests |
|---|---|---|---|
| 1 | Personal tasks: no org/dept scope, private | M2 | DB CHECK test, isolation tests |
| 2 | Org task in valid org; dept ∈ org | M5 | `test_task_department_must_belong_to_org_and_to_the_creator`, `test_the_database_refuses_a_task_with_mixed_scope` |
| 3 | Only active members assignable | M5 | `test_assign_suspended_member_rejected` |
| 4 | Creator/assignee/collaborator distinct | M5 | `test_task_roles_distinct` |
| 5 | Collaborator → task-only access | M5 | `test_collaborator_cannot_list_board` |
| 6 | Dept membership → board per role/visibility | M5 | `test_private_task_hidden_on_board` |
| 7 | Admin authority bounded | M3, M4 | `test_admin_of_one_org_cannot_reach_into_another`, `test_department_manager_is_limited_to_their_department` |
| 8 | Request ≠ membership | M3 | `test_pending_request_grants_nothing_until_approved` |
| 9 | Dept removal revokes derived access | M3, M5 | `test_removed_member_loses_board` |
| 10 | Completion uses completed_at; reopen | M2, M7 | `test_reopening_removes_a_completion_from_its_department`, `test_organization_metrics` |
| 11 | Overdue definition | M2, M7 | `test_organization_metrics`, `test_now_is_used_for_overdue_not_the_end_of_the_period` |
| 12 | Explicit deadline timezone | M2 | `test_due_at_timezone_roundtrip` |
| 13 | Historical attribution | M7 ✅ | `test_completed_department_snapshot` |
| 14 | Checks on reads/search/exports/notifications/attachments/aggregates | M5–M7 ✅ | `test_visibility_matrix`, `test_a_notification_never_reveals_a_task_after_access_is_lost`, `test_every_download_checks_access_again`, `test_private_work_never_reaches_a_department_report` |

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
| FR-ORG-02 | P0 | Create/edit/archive departments | M3 | `test_department_lifecycle`, `test_only_open_active_departments_can_be_requested` , `test_archived_department_blocks_new_tasks_but_keeps_old_ones` | Done |
| FR-ORG-03 | P1 | Invite by email/link, expiring | M3 | `tests/test_invitations.py`, `e2e/organizations.spec.ts` | Done |
| FR-ORG-04 | P0 | Request membership; pending = no access | M3 | `test_pending_request_grants_nothing_until_approved` | Done |
| FR-ORG-05 | P0 | Choose department; only open active depts | M3 | `test_only_open_active_departments_can_be_requested`, `test_department_is_required_when_some_are_open` | Done |
| FR-ORG-06 | P0 | Approve/reject/amend atomically | M3 | `test_approval_is_atomic`, `test_approver_can_amend_department_and_role` | Done |
| FR-ORG-07 | P1 | Suspend/remove member; prompt revocation | M4 | `test_suspended_member_requests_fail`, `test_removing_revokes_access_and_keeps_history`, `e2e/organizations.spec.ts` | Done |
| FR-ORG-08 | P1 | Department transfer | M4 | `test_transfer_revokes_old_dept`, `test_transfer_leaves_org_wide_access_in_place` | Done |
| PRD §5.4 | P0 | Permission-based RBAC, predefined roles | M3 (roles, checks), M4 (role changes) | `test_seeded_roles_match_the_code_catalog`, `test_role_permission_matrix` | Done |
| PRD §5.5 | P0 | Work Boards: Kanban/List; filters; isolation | M5 | `test_board_groups_by_status_and_filters`, `work.test.tsx`, `e2e/work.spec.ts` | Done |
| PRD §5.5 | P1 | Calendar view | M5 | `work.test.tsx`, `e2e/work.spec.ts` | Done |
| PRD §5.6.1 | P0 | Task fields & validation | M2, M5 | `test_tasks.py`, `test_organization_tasks.py` | Done |
| PRD §5.6.2 | P0 | Assignee vs collaborator | M5 | `test_task_roles_distinct`, `test_collaborators_can_edit_but_not_reassign` | Done |
| PRD §5.6.3 | P0 | Visibility Private/Department/Selected/Org | M5 | `test_visibility_matrix` | Done |
| PRD §5.6.4 | P0 | State transitions (ADR-015) | M2, M5 | `test_transitions_matrix`, `test_review_required_routes_work_through_review` | Done |
| PRD §5.7 | P1 | Comments, activity, audit | M6 (comments), M2+ (activity) | `test_comment_lifecycle`, `test_deleting_hides_the_text_everywhere` | Done |
| PRD §5.8 | P1 | Update requests | M6 | `test_update_request_flow`, `test_one_open_request_per_person_per_task` | Done |
| PRD §5.8 | P1 | In-app notifications (no leakage) | M6, M8 (deadlines) | `test_a_notification_never_reveals_a_task_after_access_is_lost`, `test_comment_text_is_never_stored_in_a_notification` | Partly done |
| PRD §5.6.1 | P1 | Attachments with per-download authz | M6 | `test_every_download_checks_access_again`, `test_unsafe_or_mismatched_files_are_refused` | Done |
| PRD §5.9 | P0/P1 | Personal / dept / org / member dashboards | M2, M7 | `test_reports.py`, `reports.test.tsx`, `reports.spec.ts` | Done |
| PRD §6.7 | P1 | Transfer/removal impact preview | M4 (departments, roles, requests), M5 (tasks), M6 (update requests, notifications) | `test_transfer_preview`, `test_suspending_an_assignee_flags_their_tasks_without_touching_them`, `test_transfer_flags_only_the_old_departments_tasks`, `test_removing_someone_closes_requests_waiting_on_them` | Done |
| PRD §7 | — | Switcher, task panel, states, confirmations, a11y | M0–M9 | RTL + Playwright | Planned |
| PRD §13 | — | Edge cases 1–10 | M3–M8 | one test per edge case | Planned |

## Non-functional requirements (PRD §12)

| ID | Milestone | Verification |
|---|---|---|
| NFR-01 Security | every milestone | cross-tenant negative tests; M9 security review |
| NFR-02 Performance | M7, M9 | `scripts/perf_reports.py` on 100,000 tasks: 7 of 8 reports under 500 ms, full-year organization report about 780 ms. Task lists are still to be measured in M9 |
| NFR-03 Availability | M9 | uptime monitoring |
| NFR-04 Scalability | M2+ | pagination enforced; index review per migration |
| NFR-05 Accessibility | M0+, M9 audit | axe in Playwright; keyboard tests |
| NFR-06 Usability | M2, M5 | quick-add + inline status change journeys |
| NFR-07 Maintainability | M0+ | Ruff, ESLint, type checks in CI |
| NFR-08 Recovery | M9 | backup + restore drill documented |
| NFR-09 Observability | M0 (structured logs), M9 | request IDs, error reporting |
| NFR-10 Privacy | M9 (policy), open decision | retention/deletion/export policy doc |
