# Listify — Database Optimization Audit

**Date:** 2026-10-30, updated 2026-10-31 · **Covers:** code up to commit `080701a` (Phases 0–7) · **Status:** R-01 to R-08 and R-15 are applied. R-09 onwards are still recommendations.

## Summary

The schema is sound and doesn't need restructuring. Tables, keys, tenant isolation and foreign-key indexes are in good shape, and most requests take 10–40 ms.

The problems are in how the app uses the database, and the most serious fixes are small:

1. **Stalling under load.** At 100 requests in flight, one server process fell from about 100 requests a second to 12, with 30-second waits and errors. Raising the connection pool fixed that level, and a request limiter (R-15) fixed it for good: there were no errors at 400 requests in flight.
2. **Hidden per-task queries.** A department board runs 533 queries, and about 400 of them are one lookup per task. A one-line change takes it to 52.
3. **Slow Team Tasks for ordinary members.** It took over a second at 100,000 tasks. Two changes together brought it to about 220 ms.

Nothing deletes old data yet, so several tables will grow forever. That belongs in Phase 8, when the background worker arrives.

## Step 1 results (2026-10-31)

R-01 to R-04 were applied and measured on the same seeded data, using the real code rather than patches.

| Page | Queries | Time |
|---|---|---|
| Department board, Owner | 533 → 51 | 1,047 → 382 ms |
| Department board, Manager | 531 → 51 | 1,225 → 612 ms |
| Members | 60 → 11 | 74 → 31 ms |
| Personal My Tasks | 30 → 5 | 71 → 38 ms |
| Inbox | 13 → 11 | 29 → 21 ms |
| Task detail | 17 → 15 | 29 → 26 ms |
| Team Tasks, Owner | 45 → 16 | 422 → 391 ms |
| Team Tasks, Member | 48 → 16 | 1,045 → 994 ms |

Team Tasks barely got faster: its time goes on two slow queries, not the number of queries. That is step 2.

| Requests in flight | Before: 15 connections | 40 connections | 40 connections plus limiter (today) |
|---|---|---|---|
| 10 | 93/s, slowest 5% 165 ms | 116/s, 117 ms | 112/s, 122 ms |
| 40 | 104/s, 587 ms | 110/s, 526 ms | 108/s, 550 ms |
| 100 | **12/s, 32 s, 40 errors** | 112/s, 1.3 s, no errors | 115/s, 1.2 s, no errors |
| 140 | Not measured | **27/s, 12 s, 35 errors** | 114/s, 1.6 s, no errors |
| 200 | Not measured | **32/s, 32 s, 94 errors** | 123/s, 2.1 s, no errors |
| 400 | Not measured | Not measured | 136/s, 5.6 s, no errors |

The limiter doesn't make the app faster. Waits still grow with load, but it now keeps working instead of collapsing.

Two things came out of applying the fixes:

- The new query-count tests found a problem the audit missed: task detail still ran one query per subtask. It's fixed.
- Batching subtasks added a query to the Inbox, which only needs task titles. It now asks for just those.

## Steps 2 and 3 results (2026-10-31)

R-05 to R-08 were applied and measured on the same seeded data, using the real code. Task totals matched with and without the sort index on every page.

| Page | Before step 2 | Now |
|---|---|---|
| Team Tasks, Owner | 391 ms | 80 ms |
| Team Tasks, Member | 994 ms | 223 ms |
| Team Tasks, Manager | 1,009 ms | 226 ms |
| Team Tasks, overdue | 504 ms | 230 ms |
| Needs reassignment | 975 ms | 473 ms |
| Department board, Owner | 382 ms | 338 ms |
| Department board, Manager | 612 ms | 512 ms |

**The sort index has a small cost on two rare cases,** compared in the same run with and without it:

| Case | Without the index | With it |
|---|---|---|
| A search matching nothing | 416 ms | 538 ms |
| Page 1,500 | 436 ms | 504 ms |

Other filters stayed within about 10 ms of their old speed, including one person and one tag.

**Reports and writes held steady.** The organization report took 287 ms for 30 days and 780 ms for a year. Creating a task took 40 ms, and load results stayed the same, with no errors at 400 requests in flight.

**The table's indexes shrank overall.** At 125,000 tasks the three report indexes fell from 36.8 MB to 29.5 MB, and the new sort index added 5.5 MB.

Non-Owners now run two more small queries per request that touches tasks, to find what's shared with them. That's a fixed cost, not one that grows with the data.

## How this was measured

- **Data:** `listify_test` only, seeded with 100,000 tasks in one organization, 20,000 subtasks, 5,000 personal tasks, 300,000 activity rows, 100,000 notifications, 50,000 comments, 50,000 audit rows, 20,000 expired sessions and 20,000 old rate-limit rows. `listify` wasn't touched, and the test database was emptied afterwards.
- **Method:** every SQL statement behind each main request was recorded, slow ones were explained, and each candidate fix was tried against the same data.
- **Candidates were checked through the real app,** because hand-written SQL proved misleading: two fixes that looked excellent in raw SQL did nothing or made things worse in the app. See "Don't do these".

**Read the numbers as comparisons, not promises.** This is one laptop running WAMP with a 256 MB buffer pool and one server process, and the same request varied between runs (Owner Team Tasks measured 422–636 ms). One organization holding 100,000 tasks is also a deliberate worst case. Fixes were applied by temporarily patching the running app, so **they haven't been through the test suite yet**.

## What requests cost today

| Request | Time | SQL queries |
|---|---|---|
| Any signed-in request, minimum | 10 ms | 2 |
| Inbox summary | 12 ms | 4 |
| Inbox | 29 ms | 13 |
| Task detail | 29 ms | 17 |
| Comments / activity | 21–24 ms | 11–12 |
| Create a task / edit a task / add a comment | 36–38 ms | 17–22 |
| Personal My Tasks | 71 ms | 30 |
| Members | 74 ms | 60 |
| Organization report, 30 days | 295 ms | 11 |
| Team Tasks, Owner | 422 ms | 45 |
| **Team Tasks, Member or Manager** | **1,045 ms** | **48** |
| **Department board** | **1,047 ms** | **533** |

## Recommendations

### Do first: no schema change, biggest gain

**R-01 Raise the connection pool. Critical, small. ✅ Applied:** 20 + 20, a 10-second timeout, and production refuses to start with fewer than 40. `build_engine` previously used SQLAlchemy's default of 5 connections plus 10 overflow.

| Pool | Requests in flight | Requests/s | Typical wait | Slowest 5% | Errors |
|---|---|---|---|---|---|
| 5+10 | 40 | 104 | 383 ms | 587 ms | 0 |
| **5+10** | **100** | **12** | **31 s** | **32 s** | **40** |
| 10+10 | 100 | 14 | 31 s | 32 s | 34 |
| 15+15 | 100 | 23 | 2.9 s | 31 s | 6 |
| 20+20 | 100 | 90 | 1.0 s | 2.1 s | 0 |
| 30+30 | 100 | 100 | 1.0 s | 1.5 s | 0 |

Requests hold a connection while waiting for a thread, and others hold a thread while waiting for a connection, until a timeout breaks the stalemate. FastAPI uses 40 threads for these routes, and 40 connections was the smallest pool that survived this test. The load test ran non-stop clients, so 100 in flight means many more real people than that.

**Correction:** this audit first said the failure only happens below 40 connections. That was wrong. Testing the real change showed the same stall at 140 requests in flight, so a bigger pool only raises the limit. R-15 removed it.

- `pool_timeout` is 10 seconds, so an overload fails quickly rather than hanging for 30.
- At deployment, keep `workers × 40` below MySQL's `max_connections`, which is 151 today.

**R-02 Load subtasks in one batch. High, one line. ✅ Applied.** `Task.subtasks` is marked `lazy="selectin"`, but SQLAlchemy skips that on a relationship from a table to itself unless `join_depth` is set, so each task fetches its subtasks separately. Add `join_depth=1`.

**R-03 Stop loading preferences with every person. High, small. ✅ Applied.** `User.preferences` loads for every user read, though only the profile uses it. Change it to load on demand, and batch `OrganizationMembership.user`.

**R-04 Add query-count tests. High, small. ✅ Applied.** R-02's problem passed every test because tests check answers, not cost. `tests/test_query_counts.py` now checks that busy pages run the same number of queries as data grows, and stay under a ceiling. Undoing each of the fixes above makes it fail.

**R-15 Add a request limiter. High, small. ✅ Applied.** 35 requests per server process run at once, and the rest wait without holding a thread or a connection. After 30 seconds, a waiting request gets a "server busy" reply (503) rather than hanging.

Building this exposed two more risks, both tested on a real server:

- **Slow uploads could freeze the app.** Uploads kept a database connection while waiting for the file, so 45 paused uploads held all 40 connections, and even `GET /me` failed after 10 seconds. Uploads now give the connection back first: the same test holds none, and `GET /me` takes 7 ms.
- **A simple limiter would have added a new way to block everyone.** A slow client would have held a slot while sending, which needs no sign-in. Requests now take a slot only after their body has arrived, and give it back when their response starts. With 100 sign-in forms paused half way, none held anything and `GET /me` took 11 ms.

### Next: small schema additions, each needing careful tests

**R-05 Add a sort index for task lists. High, medium. ✅ Applied.** Each list sorts every matching task to show 25. An index in the same order can read the first 25 directly.

- **Result:** Owner Team Tasks 364 → 80 ms in the same run.
- **Catch:** MySQL uses it only if the index expression matches the app's `ORDER BY` exactly. A version with an extra `ELSE` was silently ignored, so `tests/test_indexes.py` checks the real query plan.
- **Limits:** it helps the default due-date sort, not other sorts or very deep pages.

**R-06 Stop checking sharing row by row. High, medium, security-sensitive. ✅ Applied.** For non-Owners, `visible_tasks` runs two sub-lookups per task. Instead, fetch the short list of tasks shared with that person once, then compare against it.

| Member Team Tasks | Time |
|---|---|
| Today | 1,267 ms |
| R-05 sort index only | 752 ms |
| This change only | 563 ms |
| **Both, as a trial** | **282 ms** |
| **Both, in the real code** | **223 ms** |

This is the rule that protects private work, so the visibility matrix now runs both ways of checking, person by person. Someone with over 1,000 tasks shared with them falls back to the old row-by-row check. The list is looked up per organization and only when a request needs it.

**R-07 Slim the report indexes. Medium, small. ✅ Applied.** My Phase 7 indexes are the largest on `tasks`, each carrying a `workspace_type` column it doesn't need: the database's own rules already guarantee that an `organization_id` means an organization task. The column is gone, and `visible_tasks` no longer filters on it. They measured 93 MB against 57 MB at 425,000 tasks, and report speed didn't change.

**R-08 Remove one duplicate index. Low, small. ✅ Applied.** `ix_organization_invitations_organization_id` is covered by `fk_organization_invitations_department`.

### Phase 8: with the background worker

**R-09 Clean up old data. High for the long term, medium.** Nothing deletes anything today.

| Table | Suggested rule | Index needed |
|---|---|---|
| `user_sessions` | Delete 30 days after expiry | `expires_at` |
| `rate_limit_buckets` | Delete after the window passes | `window_start` |
| `password_reset_tokens` | Delete after expiry | `expires_at` |
| `notifications` | Delete read items after 90 days, pending your retention decision | `created_at` |
| `task_activity_logs`, `audit_logs` | Keep until the retention policy is decided (S-26) | None yet |

Delete in small batches to avoid long locks.

**R-10 Move rate limits to Redis. Medium.** Each limit check is an extra write and commit, already planned for Phase 8 (ADR-009).

**R-11 Send notifications from the worker. Medium.** They're written inside the request today, which is fine for a few people but not for large groups (ADR-008).

### Before production: Phase 9

**R-12 Tune MySQL. High.** WAMP's defaults suit a laptop, not a server.

| Setting | Today | Suggested |
|---|---|---|
| `innodb_buffer_pool_size` | 256 MB | 60–70% of a dedicated server's memory |
| `innodb_redo_log_capacity` | 100 MB | 1–2 GB |
| `slow_query_log`, `long_query_time` | Off, 10 s | On, 0.2–0.5 s |
| `max_connections` | 151 | Match R-01 |
| `log_bin` | Off | On, for point-in-time recovery |

**R-13 Protect migrations from lock waits. High, small.** During this audit a `CREATE INDEX` waited 10 minutes behind one idle read transaction and would have kept waiting, because MySQL's default `lock_wait_timeout` is a year. Meanwhile, new requests to that table can queue behind it. Set a short `lock_wait_timeout` in migrations and retry at a quiet time. Building an index took 1–5 seconds at this scale.

**R-14 Monitor real queries. Medium.** Review the slowest queries from `performance_schema` and unused indexes from `sys.schema_unused_indexes` every few weeks. Real usage will show which of the "later" items matter.

### Later: only if measurements call for it

| Idea | Why it can wait |
|---|---|
| Full-text title search | Rare terms went from 189 to 1.4 ms, but common ones only from 190 to 151 ms. It adds a 9-second build at this size and changes how matching works |
| Page-free scrolling for long lists | Audit log page 1,500 took 145 ms against 33 ms for page 1. Nobody browses that deep often |
| Pre-calculated report totals | The 30-day report is fine. Only very large organizations are slow, at about 1 second for 300,000 tasks |
| Redis caching | Fix queries first. Caching permissions also risks acting on outdated access |
| Read replica | Worth considering once reports slow down everyday work |

## Don't do these

These were tested and are recorded so that nobody repeats them.

| Idea | Result |
|---|---|
| Visibility indexes without code changes | **Worse:** 1,267 → 1,975 ms |
| Rewriting `visible_tasks` as `IN (UNION ...)` | **Much worse:** 1,425 → 4,682 ms, and 3,607 ms with new indexes. The same idea looked like 83 ms in hand-written SQL |
| A covering index for visibility | No gain: 563 ms with and without |
| Forcing an index on the report query | Not needed: with several organizations MySQL chose correctly by itself, and the report took 149 ms |

These were ruled out on reasoning, without testing:

| Idea | Why not |
|---|---|
| Table partitioning | MySQL doesn't allow foreign keys on partitioned tables, and they protect this app's data |
| Converting status columns to numbers | A large, risky migration for a small saving |
| `innodb_flush_log_at_trx_commit=2` | Faster, but a crash could lose recently confirmed changes |
| Changing the transaction isolation level | The app's locking was built and tested around the current level |

## Checked and fine

- **File downloads don't hold database connections:** none were held with 45 paused downloads.
- **Foreign keys** all have supporting indexes.
- **Tenant separation holds up at scale:** with 300,000 tasks in another organization, MySQL used the right index and the first organization's report took 149 ms.
- **Reports** have no per-row queries, at 11 per request.
- **Writes** are healthy at 36–38 ms, even with 13 indexes on `tasks`.
- **`pool_pre_ping` and `pool_recycle`** stayed as they were.
- **Column types** suit the app: `BIGINT` ids, `DATETIME(6)` and `utf8mb4` will scale.

## Suggested order

| Step | Items | Risk | Expected result |
|---|---|---|---|
| 1 ✅ | R-01 to R-04 | Low | Steady to 100 requests in flight, board about 64% faster, far fewer queries |
| 1b ✅ | R-15 | Low | No stall at any tested load |
| 2 ✅ | R-05, R-06 | Medium, needs the visibility matrix | Member Team Tasks about 220 ms |
| 3 ✅ | R-07, R-08 | Low | Smaller indexes |
| 4 | R-09 to R-11 | Medium | Part of Phase 8 |
| 5 | R-12 to R-14 | Low | Part of Phase 9 |

Each step should run the full backend, frontend and browser tests, then repeat these measurements, because several ideas here behaved differently once they were inside the app.
