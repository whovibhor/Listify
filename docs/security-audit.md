# Listify — Security Audit and Improvement Plan

**Date:** 2026-10-30 · **Covers:** everything built so far, Phases 0–5 (frontend, backend, database, configuration, dependencies, repository) · **Status (updated 2026-10-30):** 16 fixed, 2 partly fixed, 6 kept as they are by the owner's decision, 4 waiting on features that don't exist yet.

## Current status

The sections after this one are the original audit, kept as the record of what was found. This section shows where each finding stands today.

### Fixed (16)

Each fix has a regression test in `backend/tests/test_security_fixes.py`, named after its ID.

| ID | What changed |
|---|---|
| S-01 | Losing the right to invite revokes your unused invitations, and acceptance rechecks the creator's authority |
| S-05 | The app won't start unless `APP_ENV` is set |
| S-07 | Invitation tokens are replaced by `<token>` in the request log |
| S-09 | Requests over 1 MB are refused with 413, including chunked ones |
| S-10 | Creation limits per user per hour: 20 organizations, 100 departments, 1,000 tasks, 200 tags |
| S-11 | Admin invitations need an email address and last at most 7 days |
| S-12 | Removing someone clears their collaborator and "Selected people" entries |
| S-13 | Creator rights only apply while you're in the task's department. Past creators can still read their tasks |
| S-15 | Line breaks and control characters are refused in names and titles, and control characters in descriptions. Passwords are untouched |
| S-17 | A `listify.security` log records sign-ins, failures, limits, password changes and session sign-outs, without passwords or typed emails |
| S-18 | The assignee can't approve their own review. Owners and Admins are exempt, so a one-person organization isn't stuck |
| S-19 | Dates outside 1900–2200 and non-ASCII CSRF headers get a clean refusal instead of a 500 |
| S-21 | Invitations to an archived department stop working, and work again if it's restored |
| S-22 | Database values stay out of error logs outside development |
| S-23 | `/health` hides version and environment in production. Development is unchanged |
| S-25 | The website field must be a real http or https address |

### Partly fixed (2)

| ID | Done | Still to do |
|---|---|---|
| S-08 | The API now sends security headers, and the inline theme script moved to `public/theme-init.js` so a Content-Security-Policy can forbid inline scripts | Frontend headers, HTTPS and `__Host-` cookie names, with the production web server (Phase 9) |
| S-27 | Python packages are pinned by hash, and CI actions by commit | Automatic scanning in CI (Phase 9). The 3 low warnings stay: they're in the development-only `shadcn` tool, which is on its newest version, and the only fix offered is a downgrade |

### Kept as they are, by the owner's decision (6)

The app is still in testing, so sign-in stays unchanged until Login with Google arrives, and the MySQL account stays as it is. These remain real risks, so they must be closed before real users or a public launch.

| ID | Risk accepted for now | When to close it |
|---|---|---|
| S-02 | Email addresses aren't verified | With Login with Google. Google accounts arrive verified; any remaining password sign-up still needs a confirmation link |
| S-03 | Accented spellings get around the per-account login limit | With Login with Google, if password sign-in stays |
| S-06 | Anyone can lock a person out with wrong passwords | With Login with Google, if password sign-in stays |
| S-14 | Weak passwords are accepted | With Login with Google, if password sign-in stays |
| S-16 | Registration reveals which emails have accounts | With S-02 |
| S-04 | MySQL root has no password, listens on all interfaces, and production would accept root | Before the app runs anywhere but this PC |

### Waiting on features that don't exist yet (4)

| ID | Waiting for |
|---|---|
| S-20 | Real email (Phase 8): keep links out of invitation emails |
| S-24 | Real email (Phase 8): send in the background |
| S-28 | Real email (Phase 8): alerts on password change. Two-step sign-in comes after Login with Google |
| S-26 | Scheduled jobs (Phase 8) and the retention policy (Phase 9) |

### Small visible changes from the fixes

Everything else works as before. These are the only differences a person could notice:

- Inviting an Admin now needs an email address, and the form says so.
- Invitations stop working if the person who sent them was removed, suspended or demoted. They show as Revoked.
- Removing someone and later re-adding them doesn't bring back their old task access.
- After moving to another department, you can read tasks you created in the old one, but not change them.
- With review switched on, an assignee who isn't an Owner or Admin can't approve their own task.
- Names and titles can't contain line breaks, dates must fall between 1900 and 2200, and websites must be real addresses.
- Creating far more than a person normally would in one hour gets a "try again later" message.

---

## Original audit

### Verdict

**No critical holes, and SQL injection is not possible in the code as written.** The foundations are strong: passwords, sessions, CSRF protection, role checks and separation between organizations all held up against direct attack.

The problems are mostly in the rules *around* those foundations. There are **5 high** findings, and the most serious is that a removed admin can get back in. None is an emergency today, because the app only runs on this computer. All five should be closed before anyone else uses it.

| Severity | Count | Meaning |
|---|---|---|
| Critical | 0 | Anyone could take over accounts or read data, with no special access |
| High | 5 | A real attack or dangerous mistake, needing some access or setup |
| Medium | 12 | Weakens protection, or causes harm in a limited way |
| Low | 11 | Hardening and tidying; little direct harm today |

**How this was tested.** Everything marked *Proven* was reproduced by a throwaway attack script against the running API on the test database `listify_test`. The application code and your development data were not changed. Findings marked *Code review* came from reading the code and weren't reproduced.

**"Built in"** shows the phase each weakness comes from, so you can see which ones belong to Phases 0–4 and which to Phase 5.

---

## Findings, highest priority first

### High

#### S-01 A removed admin can get back in with an invitation they made earlier
*Proven · Built in Phase 3 · `memberships/service.py:652`, `memberships/management.py:217`*

Pending invitations stay valid after the person who created them loses their role. An admin who expects to be removed can first create an Admin invitation link. In the test: the admin made the link, the Owner removed them, and a second account then accepted it, became Admin and opened the admin-only activity log.

**Fix:** revoke a person's pending invitations when they're removed, suspended or demoted. Also check at acceptance that the creator can still grant that role.

#### S-02 Anyone can register with an email address they don't own
*Proven · Built in Phase 1 · `auth/service.py`*

Email addresses are never verified. A test account registered as `ceo@acme-corp.example` with the name "The Real CEO" and asked to join an organization. The approver sees that address as if it were genuine, so approvals rest on an identity nobody has proven. It also lets someone squat on a real person's address.

**Fix:** send a confirmation link, and require it before joining or creating an organization. Until then, show "Email not verified" on join requests. The development mailer is enough to build this now.

#### S-03 The login attempt limit can be bypassed with accented letters
*Proven · Built in Phase 1 · `users/models.py:22`, `auth/service.py:113`, `auth/service.py:143`*

The email column ignores accents, so `ádmin@example.com` finds the account `admin@example.com`. The limit, though, counts each spelling separately. After the real address was blocked, `ádmin@`, `àdmin@`, `âdmin@` and `ädmin@` each got fresh attempts, and the correct password logged in through them. The same trick sent 9 reset emails to one person when the limit is 3 per hour. An IP limit of 50 attempts per 15 minutes still applies, but a spread-out attack gets past it.

**Fix:** make `users.email` an exact-match column (`utf8mb4_bin`), since addresses are already stored in lower case. Count limits against the account found, not the text typed. Add a test for accented variants.

#### S-04 MySQL's root account has no password, and production would accept root
*Proven · Environment, plus `core/config.py:59`*

- The app connects as `root` with an empty password.
- MySQL listens on every network interface (`bind_address = *`).
- Root login from the network was refused, so the database isn't open to your network. Any program or person on this PC, however, has full control of it.
- The production safety check allows `DB_USER=root`.

Root also turns any future app bug into full database access.

**Fix:** set a root password, create a `listify_app` account limited to the two Listify databases, and set `bind-address = 127.0.0.1` in `my.ini`. Make production startup refuse `root`.

#### S-05 A missing setting silently means "development", which turns the safety checks off
*Proven · Built in Phase 0 · `core/config.py:22`*

With no configuration at all, the app runs in development mode: API docs on, cookies not marked Secure, a publicly known secret (`change-me-in-local-env`), and password-reset links written to the logs. All the production safety checks are skipped. Forgetting one setting on a server would expose all of this without any warning.

**Fix:** remove the default, so the app refuses to start unless `APP_ENV` is set.

### Medium

#### S-06 Anyone can lock a person out of their account
*Proven · Phase 1 · `auth/service.py:36`*

Ten wrong passwords in 15 minutes blocks the account, for everyone. After an attacker's 10 attempts, the real owner got a 429 with the **correct** password. Repeating this keeps someone locked out, and all it takes is their email address. The password-reset limit has the same weakness.

**Fix:** limit by account and IP together, keep a much higher overall account limit, and add a growing delay instead of a hard block.

#### S-07 Invitation links are written to the server logs
*Proven · Phase 3 · `core/logging.py:79`*

The secret token is part of the URL path, and every path is logged. Anyone who can read the logs can use an unaccepted invitation.

**Fix:** log the route pattern instead of the real path, or send the token in the request body.

#### S-08 No security headers, and no production web server setup yet
*Proven · Phase 0*

Responses have no Content-Security-Policy, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy or Cache-Control. Without them there's no second line of defence against script injection, the app can be framed for clickjacking, and browsers may keep private data in cache.

**Fix:** add the API headers now and the rest in the production Nginx config. Move the inline theme script in `index.html` into a file so the policy can forbid inline scripts. Use `__Host-` cookie names in production.

#### S-09 No limit on request size
*Proven · Phase 0 · `main.py`*

A 20 MB request was read and processed before being rejected. Repeated large requests could exhaust the server's memory.

**Fix:** reject anything over about 1 MB in the API and at Nginx. File uploads in Phase 6 get their own limit.

#### S-10 Nothing limits how much one account can create
*Proven · Phases 2, 3, 5*

One account created 40 organizations and 120 tasks in 3 seconds, with no resistance. Searchable organizations could also be used to spam the Join page.

**Fix:** a general per-user limit on writes, plus limits on creating organizations, departments and tags.

#### S-11 Admin invitations can be open links that last 30 days
*Proven · Phase 3 · `memberships/schemas.py:155`*

An Admin invitation doesn't have to be tied to an email address, and it can stay valid for 30 days. Whoever gets hold of the link becomes an Admin.

**Fix:** require an email address for roles above Member, and cap those invitations at 7 days.

#### S-12 Rejoining restores access to old private tasks
*Proven · Phase 5 · `memberships/management.py:217`*

Removal is described as a clean start, but task links survive it. A removed collaborator invited back as a new member could open a private task they'd been on before.

**Fix:** clear collaborator and "Selected people" entries on removal, and record that in the activity log.

#### S-13 Someone who moves department keeps control of tasks they created
*Proven · Phase 5 · `tasks/policies.py:118`*

After moving out of Engineering, a member could still edit their old Engineering task, and could even make it private. That hides it from the department they've left.

**Fix:** creator rights should only apply while the person still belongs to the task's department. Past creators can keep read access.

#### S-14 Weak passwords are accepted
*Proven · Phase 1 · `auth/passwords.py`*

`Summer2026!!`, `Welcome@2026` and `abcdefghijkl` were all accepted. The blocklist has only 21 entries.

**Fix:** add a strength estimator such as zxcvbn and a real list of common passwords.

#### S-15 Line breaks and invisible characters are stored in names and titles
*Proven · Phases 1–5*

An organization named `Acme\r\nBcc: victim@example.com`, a user name with a line break, and a task title containing a null byte were all saved. It's harmless today, but it becomes email header injection risk once real email is sent in Phase 8, and it can break exports and logs.

**Fix:** one shared rule that rejects control characters in single-line fields.

#### S-16 Registration reveals which emails have accounts
*Proven · Phase 1 · `auth/service.py:80`*

Login and password reset carefully hide this, but registration answers 409 `email_taken`.

**Fix:** once S-02 exists, always answer "check your email", and tell the existing owner by email instead.

#### S-17 Security events aren't recorded
*Code review · Phase 1*

Failed logins, lockouts, password changes and sessions being signed out appear nowhere you could review them. An attack in progress would go unnoticed.

**Fix:** a structured security log, with alerts at launch.

### Low

| ID | Finding | Evidence | Built in | Fix |
|---|---|---|---|---|
| S-18 | **Someone can approve their own review.** The "assignee can't approve their own work" rule doesn't apply when the same person created the task. | Proven | Phase 5 | The approver must not be the assignee. `feature-status.md` overstates this until it's fixed. |
| S-19 | **Crafted input causes server errors (500).** A start date in year 1, `due_from` in year 1, `due_to` in year 9999, and a non-ASCII CSRF header, which needs no sign-in. No data is affected. | Proven | Phases 1, 2, 5 | Limit dates to 1970–2100. Make `tokens_match` safe for non-ASCII input. |
| S-20 | **Invitation emails can carry a phishing message.** The organization name goes straight into the subject: "You're invited to join URGENT verify at http://evil.example/login now". | Proven | Phase 3 | Refuse links in organization names, and keep the 50 per hour limit on invitations. |
| S-21 | **Invitations can be accepted into an archived department.** | Proven | Phase 3 | Check the department at acceptance. |
| S-22 | **Error logs may contain database values,** because `hide_parameters` isn't set on the database engine. | Code review | Phase 0 | Set it outside development. |
| S-23 | **`/health` reveals the environment and version** to anyone. | Proven | Phase 0 | Return only status publicly. |
| S-24 | **A small timing difference on password reset** (about 20 ms against 15 ms) hints at whether an account exists. Real email will widen it. | Proven | Phase 1 | Send email in the background, which Phase 8 plans anyway. |
| S-25 | **The website field accepts junk** such as `http://x"><script>`. Harmless today, because it's never shown as a link. | Proven | Phase 3 | Validate it as a real URL before ever displaying it as a link. |
| S-26 | **Old data is never cleaned up.** Sessions with IP addresses, reset tokens and rate-limit rows stay forever, and there's no retention policy, which the PRD requires before production. | Code review | Phases 1–3 | Add scheduled cleanup and a written policy. |
| S-27 | **Dependency hygiene.** Python packages aren't pinned by hash, CI actions are pinned by tag, and `npm audit` shows 3 low advisories in the development-only `shadcn` tool. | Proven | Phase 0 | Pin hashes and action commits, and update `shadcn`. |
| S-28 | **No two-step sign-in, and no alert on password change.** | Code review | Phase 1 | Add alerts with Phase 8; offer two-step sign-in to Owners and Admins later. |

---

## What's left, in priority order

### Before anyone outside the team uses it

| Order | Work | Finding |
|---|---|---|
| 1 | Login with Google, with verified emails | S-02, S-16 |
| 2 | If password sign-in stays: exact-match email column, account-based limits, fairer lockouts, stronger passwords | S-03, S-06, S-14 |

**Careful with Google sign-in:** because emails aren't verified today, someone can register a victim's address with a password first. If a Google sign-in then links to that account automatically, the attacker's password keeps working. Link accounts only when the existing email was verified, or remove the password and sign out all sessions when linking.

### With Phase 8 (email and scheduled jobs)

| Order | Work | Finding |
|---|---|---|
| 1 | Keep user-entered text out of email headers, and block links in organization names | S-20 |
| 2 | Send email in the background | S-24 |
| 3 | Alerts for password changes and new sign-ins | S-28 |
| 4 | Scheduled cleanup of old sessions, tokens and rate-limit rows | S-26 |

### With Phase 9 (going public)

| Order | Work | Finding |
|---|---|---|
| 1 | Dedicated MySQL account with a password, local-only binding, encrypted connection, and refuse root in production | S-04 |
| 2 | Nginx with HTTPS, frontend headers, size limits, clickjacking protection and `__Host-` cookies | S-08 |
| 3 | Trusted proxy setup, so rate limits see real visitor addresses | S-03, S-06, S-10 |
| 4 | Written retention policy, including notifications and attachments | S-26 |
| 5 | Automatic dependency scanning in CI | S-27 |
| 6 | Virus scanning for attachments, and file storage outside the application server | — |
| 7 | Tested backups that include `backend/storage/`, and an independent penetration test | — |

**Added since the audit (Phase 6):** uploads have type, content and size checks, and every download is authorized. Notifications store no task details, so they can't show any to someone who has lost access. These were tested, but not independently reviewed. Attachments still need virus scanning and storage outside the application server before launch.

**Added since the audit (Phase 7):** reports and CSV exports follow `visible_tasks`, and exports neutralise spreadsheet formulas, are rate limited and are audited. Tested, but not independently reviewed.

---

## What held up

| Attack | Result | Evidence |
|---|---|---|
| **SQL injection** | Not possible | 11 payloads, including `UNION`, `DROP TABLE` and time-delay attacks, against 9 inputs. No extra data, no delay, tables intact. All queries are parameterized; the only 2 raw statements in the app are fixed text with bound values. Sort options are a fixed list. |
| **Sign-in bypass** | Blocked | All 70 routes swept. Only `/health`, `/auth/csrf` and the sign-in, registration and password routes work without a session. |
| **CSRF** | Blocked | All 46 state-changing routes refused a request with no token. Tokens are tied to the session. |
| **Script injection (XSS)** | No route found | React escapes all text. The frontend has no `dangerouslySetInnerHTML`, `eval` or raw HTML. Checked by code review, not in a browser. |
| **Access to other people's data** | Blocked | Organizations, tasks, tags and sessions by guessed ID all answer "not found". Covered by the 408 backend tests, including 175 role and action checks and every visibility level against 8 kinds of viewer. |
| **Changing protected fields** | Blocked | Attempts to set `is_active`, `email`, a task's owner and organization `status` were all refused. |
| **Password storage** | Strong | Argon2id, with reset tokens and session tokens stored only as hashes. |
| **Sessions** | Strong | HttpOnly, SameSite, replaced at login, dead after logout. Replaying an old cookie failed. |
| **Login account discovery** | Blocked | Same message and almost identical time: 80 ms for a real account, 77 ms for an unknown one. |
| **Cross-site requests (CORS)** | Blocked | Other origins, including `null`, were refused. |
| **Open redirect** | Blocked | The sign-in `next` value is limited to paths inside the app. |
| **Secrets in the repository** | Clean | `.env` is ignored, and git history contains only placeholders. The real session secret is random and 64 characters long. |
| **Database hardening** | Good | Remote root login refused, `local_infile` off, file access restricted, all 23 tables are InnoDB. |
| **Malformed data** | Handled | Huge numbers, deeply nested JSON and wrong content types all return clean errors. Server errors reveal nothing. |
| **Dependencies** | Clean | `pip-audit` found no known vulnerabilities; `npm audit` found 0 in production packages. |
| **Reset-link leakage** | Good | The token is removed from the address bar as soon as the page reads it. |
| **Path traversal, SSRF, command injection, unsafe uploads** | Not applicable yet | The app has no code that touches files or makes outbound requests. Phase 6 uploads change this. |

## What this audit did not cover

- **Production setup:** HTTPS, Nginx and hosting don't exist yet, so they couldn't be tested.
- **Real email:** SMTP isn't built, so delivery and header handling are untested. S-15 is a warning for that work.
- **Heavy load and flooding:** the size and creation tests show no limit exists, not how much it would take to bring the app down.
- **Simultaneous requests:** the row locks and race conditions were reviewed in code, not attacked. Two people adding the same collaborator at the same moment may produce a server error.
- **Script injection in a real browser:** this was a code review.
- **Your computer:** Windows, WAMP's other services (such as Apache and phpMyAdmin) and network settings were out of scope, apart from MySQL.
- **Independent review:** I built this code, so an outside tester should still look at it before launch. That's the last step of Stage 4.
