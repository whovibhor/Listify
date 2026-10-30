# Listify — Database Design

Status: **Phase 3 schema applied** (head revision `fa2cb7581b65`; Phase 4 needed no schema change). Databases: `listify` (development) and `listify_test` (automated tests and E2E).

## Server and conventions

- MySQL 8.4.7 (WAMP, port 3306), InnoDB, `utf8mb4` / `utf8mb4_0900_ai_ci` set explicitly on every table (ADR-003). The `listify` database itself defaults to `utf8mb4_unicode_ci`; table-level settings make that irrelevant.
- **WAMP defaults are unsafe for this app** (default engine MyISAM, empty `sql_mode`). Every connection therefore runs `SET time_zone='+00:00', sql_mode='STRICT_TRANS_TABLES,ONLY_FULL_GROUP_BY,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION', default_storage_engine='InnoDB'`, and every model declares `MYSQL_TABLE_ARGS` (InnoDB, utf8mb4).
- Local development uses MySQL `root` without a password (owner's choice). Production must use a dedicated least-privilege account; startup validation rejects an empty `DB_PASSWORD` in production.
- Driver `mysql+pymysql`.
- Timestamps: `DATETIME(6)` holding **naive UTC** (`app.db.base.UtcDateTime`, `utc_now()`); converted to user/org timezone only at the edges (ADR-019).
- Primary keys: `BIGINT UNSIGNED AUTO_INCREMENT` internally. Public identifiers exposed in URLs will be decided in M1 (proposal: keep integer IDs, rely on object-level authorization returning 404; revisit if enumeration becomes a concern).
- Constraint naming convention is defined in `app/db/base.py` so Alembic diffs stay stable.
- Every migration must have a working `downgrade()`; destructive changes need a data-migration note in this file.
- Tests run against `listify_test`, never the development database.

## Phase 1 tables

| Table | Columns (type) | Keys & indexes | Delete behavior / notes |
|---|---|---|---|
| `users` | `id` BIGINT UNSIGNED PK; `email` VARCHAR(254) NOT NULL (normalized lower-case); `name` VARCHAR(100); `password_hash` VARCHAR(255) (Argon2id); `timezone` VARCHAR(64) default `UTC`; `is_active` BOOL; `terms_accepted_at`, `password_changed_at` DATETIME(6) NOT NULL; `last_login_at` DATETIME(6) NULL; `created_at`, `updated_at` | `uq_users_email` | Users are deactivated (`is_active=false`), not deleted, in MVP. |
| `user_sessions` | `id` PK; `user_id` FK; `token_hash` CHAR(64) (SHA-256 of cookie); `created_at`, `last_seen_at`, `expires_at` NOT NULL; `revoked_at` NULL; `ip_address` VARCHAR(45); `user_agent` VARCHAR(255) | `uq_user_sessions_token_hash`; `ix_user_sessions_user_id_revoked_at` | `ON DELETE CASCADE` from users. Valid = not revoked, `expires_at > now`, `last_seen_at > now − idle`. |
| `password_reset_tokens` | `id` PK; `user_id` FK; `token_hash` CHAR(64); `created_at`, `expires_at`; `used_at` NULL; `requested_ip` | `uq_password_reset_tokens_token_hash`; `ix_password_reset_tokens_user_id` | CASCADE from users. Issuing a new token marks older unused ones used. |
| `rate_limit_buckets` | `bucket_key` VARCHAR(100) PK (`action:sha256(identity)`); `window_start` DATETIME(6); `hits` INT | PK | Fixed windows updated with one atomic upsert; replaced by Redis in Phase 8. |

Migration note: the downgrade drops tables without dropping their indexes first, because MySQL refuses to drop an index a foreign key depends on.

## Phase 2 tables (revision `2cc57b884713`)

| Table | Key columns | Keys, checks & indexes | Delete behavior / notes |
|---|---|---|---|
| `tasks` | `id`; `workspace_type` (personal\|organization); `owner_user_id` (personal only); `created_by`; `parent_task_id`; `title` VARCHAR(200); `description` TEXT; `status`, `priority` (VARCHAR+CHECK); `start_at`, `due_at` DATETIME(6) UTC; `due_all_day`; `estimated_minutes`, `actual_minutes`; `sort_order`; `completed_at`, `completed_by`; `archived_at`; timestamps | CHECK `ck_tasks_personal_has_owner` (personal ⇒ owner set); CHECK `ck_tasks_title_not_empty`; enum CHECKs; `ix_tasks_owner_archived_status_due`, `ix_tasks_owner_completed_at`, `ix_tasks_parent_task_id` | `owner_user_id` **RESTRICT** (MySQL forbids referential actions on columns used in a CHECK; users are deactivated, not deleted); `parent_task_id` CASCADE (subtasks go with the parent); `completed_by` SET NULL; `created_by` RESTRICT. Organization columns (`organization_id`, `department_id`, `assigned_to`, `visibility`, completion attribution) arrive in Phase 5. |
| `tags` | `id`, `owner_user_id`, `name` VARCHAR(40), `color`, `created_at` | unique (`owner_user_id`, `name`) — case-insensitive via collation | CASCADE from users. Organization-scoped tags arrive in Phase 5. |
| `task_tags` | (`task_id`, `tag_id`) PK | `ix_task_tags_tag_id` | CASCADE from both sides. |
| `task_activity_logs` | `id`, `task_id`, `actor_id`, `event_type`, `old_value`/`new_value` JSON, `created_at` | `ix_task_activity_logs_task_id_created_at` | CASCADE with the task; actor SET NULL. Events: created, updated, status_changed, completed, reopened, archived, restored, subtask_added, subtask_deleted. |

Enums are stored as VARCHAR + CHECK (not native `ENUM`) so later phases can add values without `ALTER … ENUM`.

## User preferences (revision `004bd59b961b`)

| Table | Columns | Keys | Notes |
|---|---|---|---|
| `user_preferences` | `user_id` PK/FK, `theme` (light\|dark\|system, VARCHAR+CHECK), `updated_at` | PK = `user_id` (one row per user) | CASCADE from users. Created on first save; absent row = defaults (`system`). Typed columns (not key/value) so the database validates values; notification preferences join this table in Phase 8. |

## Phase 3 tables (revision `fa2cb7581b65`)

| Table | Key columns | Keys & constraints | Notes |
|---|---|---|---|
| `organizations` | `name`, `slug`, `description`, `website`, `location`, `timezone`, `is_discoverable`, `review_required`, `status`, `created_by` | `slug` unique | Never hard-deleted; RESTRICT everywhere. |
| `departments` | `organization_id`, `name`, `description`, `status`, `open_for_join_requests` | unique (`organization_id`, `name`); unique (`organization_id`, `id`) | The second unique key is the target of composite foreign keys. |
| `organization_memberships` | `organization_id`, `user_id`, `status`, `primary_department_id`, `job_title`, `joined_at` | unique (`organization_id`, `user_id`); composite FK to `departments` | Only `active` grants access. |
| `department_memberships` | `organization_id`, `department_id`, `user_id`, `joined_at` | unique (`department_id`, `user_id`); composite FK | A row can't point at another organization's department. |
| `roles`, `permissions`, `role_permissions` | seeded by the migration | `key` unique | Reference data: not cleared by test resets. `tests` compare it with `permissions/catalog.py`. |
| `membership_roles` | `membership_id`, `role_id`, `department_id`, `assigned_by` | unique (`membership_id`, `role_id`, `department_id`) | `department_id` set = role applies in that department only. |
| `membership_requests` | `organization_id`, `user_id`, `requested_department_id`, `job_title`, `note`, `status`, `pending_user_id`, review fields | composite FK; unique (`organization_id`, `pending_user_id`) | `pending_user_id` is a stored generated column (`user_id` while pending, else NULL): MySQL has no partial unique index, so this makes "one pending request per person" a database guarantee. |
| `organization_invitations` | `organization_id`, `email`, `token_hash`, `role_id`, `department_id`, `expires_at`, `accepted_at`, `accepted_by`, `revoked_at` | `token_hash` unique; composite FK | Only the SHA-256 of the token is stored. |
| `audit_logs` | `organization_id`, `actor_id`, `action`, `target_type`, `target_id`, `details`, `created_at` | index (`organization_id`, `created_at`) | Append-only: the API has no update or delete. |

**Phase 4 uses these tables as they are.** Suspending changes only `organization_memberships.status`, so roles and departments survive for reactivation. Removing sets `status = removed` and deletes the member's `membership_roles` and `department_memberships` rows, so the membership row and `audit_logs` stay as history and rejoining starts clean. Ownership is a role row: a transfer swaps Owner and Admin in one transaction. Member changes take a row lock on the organization, so two administrators can't race each other into an invalid state.

**Persistence rule:** every piece of user-entered data lives in MySQL. The browser keeps only a cached copy of the theme (to avoid a flash on load; the account value wins) and URL state for filters. See `feature-status.md` for the table behind each feature.

## Planned entities

The logical model follows PRD §8 with the additions listed in `requirements-analysis.md` §8 (sessions, password reset tokens, rate-limit buckets, task visibility grants, completion attribution columns, organization `is_discoverable`, department `open_for_join_requests`, organization `review_required`).

| Milestone | Tables |
|---|---|
| M1 ✅ | users, user_sessions, password_reset_tokens, rate_limit_buckets (`user_preferences` moved to M8 with notification preferences) |
| M2 ✅ | tasks, tags, task_tags, task_activity_logs |
| M3 ✅ | organizations, departments, organization_memberships, department_memberships, roles, permissions, role_permissions, membership_roles, membership_requests, organization_invitations, audit_logs |
| M5 | task_collaborators, task_visibility_grants |
| M6 | task_comments, task_attachments, task_update_requests, notifications |

## Personal vs organization tasks (design intent)

One `tasks` table with `workspace_type ENUM('personal','organization')` and a CHECK constraint:

- `personal` → `owner_user_id NOT NULL`, `organization_id IS NULL`, `department_id IS NULL`, visibility fixed to `private`.
- `organization` → `organization_id NOT NULL`, `owner_user_id IS NULL`; `department_id` optional but validated (in the service layer, and via a composite FK `(organization_id, department_id) → departments(organization_id, id)`) to belong to the same organization.

Authorization takes different code paths per workspace type (ADR-010): personal tasks are visible only to `owner_user_id`; organization tasks go through membership, role permissions, visibility and collaborator checks. Organization roles never reach personal tasks.

Detailed per-table definitions (columns, nullability, unique keys, indexes, FK delete behavior) are added here at the start of each milestone.
