# Listify — Testing Strategy

Derived from PRD §14 and the definition of done. Never report a test as passing unless it was executed.

## Layers

| Layer | Tooling | Scope |
|---|---|---|
| Backend unit | Pytest | transitions, due-date/timezone logic, permission resolution, metric formulas, config validation |
| Backend API | Pytest + Starlette TestClient (httpx2) | each endpoint: success, validation failure, unauthenticated, forbidden, **cross-tenant 404** |
| Backend DB integration | Pytest marker `db`, MySQL `listify_test` | transactions, constraints, migrations upgrade/downgrade |
| Frontend unit/component | Vitest + React Testing Library + user-event (jsdom) | API client, hooks, components, routing, forms |
| End-to-end | Playwright + @axe-core/playwright (`frontend/e2e`) | Desktop Chrome and Pixel 7 projects. Isolated backend (:8001) on `listify_test`, reset in global setup. Phase 1: full auth journey + axe scans of the auth pages. Later: workspace switching, task flows, membership approval. |
| Security | API tests + M9 review | IDOR/guessed IDs, stale memberships, CSRF, XSS, upload validation, rate limits, privilege escalation |
| Performance | seeded data + timing (M7/M9) | p95 < 500 ms on lists and dashboards |

## Rules

- Every protected endpoint gets at least one negative authorization test, and every org-scoped endpoint a cross-organization test.
- Metric tests use fixed clocks and fixtures in at least two non-UTC timezones (e.g. `Asia/Kolkata`, `America/Los_Angeles`) across period boundaries.
- Tests needing MySQL are marked `@pytest.mark.db` and skip with a clear reason when the test database is not configured; CI will provide MySQL so they always run there.
- Frontend tests use the real `QueryClient` (with its global 401 handling) minus retries (`src/test/render.tsx`) and stub `fetch` through `src/test/mock-api.ts`, which fails loudly on any unmocked call; no hardcoded sample data in production code.
- Time-dependent backend tests use the `frozen_now` fixture (20:00 UTC = 01:30 next day for the Asia/Kolkata test user).
- E2E saves screenshots to `frontend/test-results/screens/` for visual review.
- Warnings are fixed, not suppressed.
- `tests/test_permissions.py` runs every role against every permission-guarded endpoint on the real API. Each new guarded endpoint adds a case there. That file alone uses cheap Argon2 settings, because each case signs up nine people.
- Tests clear data with `DELETE`, not `TRUNCATE`, which costs about a second per test on InnoDB. Identifiers therefore keep rising between tests, so tests must not assume specific IDs.

## Running

See the "Common commands" table in the README, or run everything with `scripts\check.ps1`.
