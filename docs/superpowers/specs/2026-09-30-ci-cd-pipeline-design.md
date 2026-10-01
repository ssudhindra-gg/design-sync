# CI/CD pipeline for design-sync

Date: 2026-09-30. Status: design approved in conversation, awaiting spec review.

## Goal

Every pull request and every push to `main` is tested automatically; every
push to `main` that passes is deployed to AWS and proven live.

The user's requirements:

1. Backend and frontend tests run in parallel.
2. The Docker Compose stack is built and the integration and end-to-end tests
   run against it.
3. Deploy to AWS using a GitHub OIDC role (no stored AWS keys).
4. Validate the deploy by checking a health endpoint.

Decisions taken with the user:

- Frontend tests: add **Vitest** with real unit tests, plus type-check and
  production build. Lint stays out of CI until its pre-existing Prettier
  failures are fixed (separate work).
- Deploy trigger: **every push to `main`** after all tests pass. Pull
  requests run tests only and never deploy.
- One workflow file (not separate CI/deploy workflows), so deploy can only
  run on the exact commit that passed every test job.

## Starting point (found in the code)

- No `.github/` directory; no CI exists.
- `frontend/package.json` has no test script; `lint` fails on pre-existing
  formatting.
- No health endpoint. The Dockerfile `HEALTHCHECK`, `infra/bootstrap.sh` and
  `infra/deploy.sh` all poll `/openapi.json`, which proves only that uvicorn
  answers, not that the database works.
- AWS has never been deployed, and no OIDC role exists. The deploy stack and
  `infra/deploy.sh` exist (spec
  `2026-09-27-aws-cloudformation-deploy-design.md`): GitRef and AMI are pinned
  at first deploy, code ships via `deploy.sh update`.

## Design

### 1. Health endpoint

`GET /api/health` (new router `backend/app/routers/health.py`):

- `200 {"status": "ok", "database": "ok", "version": "<APP_VERSION>"}` when a
  `SELECT 1` through the store's engine succeeds.
- `503 {"status": "error", "database": "unavailable", "version": ...}` when it
  raises. The response never includes exception text.
- `version` is the `APP_VERSION` environment variable, default `"dev"`.
- `DatabaseStore` gains `ping() -> None` (runs `SELECT 1`; raises on failure).
- No authentication; listed in the OpenAPI document.

`APP_VERSION` plumbing:

- `docker-compose.yaml` app service: `APP_VERSION: ${APP_VERSION:-dev}`.
- On the instance, `infra/bootstrap.sh` and the `deploy.sh update` remote
  script export `APP_VERSION=$(git rev-parse HEAD)` before
  `docker compose up -d --build`, so the running container reports the
  deployed commit.

Callers switch from `/openapi.json` to `/api/health`: the Dockerfile
`HEALTHCHECK`, `infra/bootstrap.sh`, `infra/deploy.sh` `wait_for_url`, the
pytest compose harness and the e2e `waitUntilServing` (both only need "is it
up", so any 200 suffices there).

### 2. Frontend tests

- Add `vitest` and `jsdom` as dev dependencies; `npm test` runs
  `vitest run`. Config via a `test` block in the existing Vite config, or a
  separate `vitest.config.ts` if the TanStack Start Vite config does not load
  under Vitest.
- Tests (in `frontend/src/**/*.test.ts`):
  - `lib/diagram-utils.ts`: `nodeCenter`, `borderPoint` (point lies on the
    node border toward the target), `edgeGeometry`, `diagramBounds` (empty
    diagram and padding).
  - `services/identity.ts`: `rememberMe`/`recallMe` round-trip per session
    and isolation between sessions (jsdom `localStorage`).
- `npm run typecheck` = `tsc --noEmit`.

### 3. Workflow `.github/workflows/ci.yml`

Triggers: `pull_request` and `push` to `main`. Default permissions
`contents: read`.

| Job | Needs | Runs |
| --- | --- | --- |
| `backend` | — | `astral-sh/setup-uv`, Postgres 16 service container, `make test-pg` (whole suite incl. Postgres integration tests). |
| `frontend` | — | Node 22, `npm ci`, `npm test`, `npm run typecheck`, `npm run build` (with `VITE_API_URL=/api`). |
| `compose` | backend, frontend | `make test-compose`, then the Playwright suite (`npx playwright install --with-deps chromium`, `npm test --prefix e2e`). Uploads `e2e/test-results` on failure. |
| `deploy` | compose | Only when `github.event_name == 'push'`, ref is `refs/heads/main`, and repository variable `AWS_ROLE_ARN` is non-empty; otherwise skipped (CI stays green). Permissions `id-token: write`, `contents: read`. `concurrency: {group: aws-deploy, cancel-in-progress: false}`. |

`deploy` steps:

1. `aws-actions/configure-aws-credentials` with `role-to-assume:
   ${{ vars.AWS_ROLE_ARN }}`, `aws-region: ${{ vars.AWS_REGION || 'us-east-1' }}`.
2. `RELEASE_SHA=${{ github.sha }} bash infra/deploy.sh release`.
3. `bash infra/deploy.sh verify ${{ github.sha }}` — the health validation.
4. `bash infra/deploy.sh e2e` — Playwright against the live URL (smoke).

Actions are pinned to major versions (`actions/checkout@v4`, etc.).

### 4. `infra/deploy.sh` additions

- `release`: run `deploy` with `GIT_REF` = the stack's pinned GitRef if the
  stack exists, else `main` (creates it); then `update` with
  `GIT_REF=$RELEASE_SHA` (required, full SHA). On the very first release this
  builds twice; accepted.
- `verify <sha>`: poll `<AppUrl>/api/health` (every 10 s, up to 10 min) until
  it returns 200 with `database == "ok"` and `version == <sha>`; on timeout
  print the last response and exit 1. JSON is parsed with `python3`
  (present on GitHub runners and the dev machine).
- Offline checks in `infra/test-deploy.sh` (fake `aws`): `release` on a new
  stack deploys with `GitRef=main` then sends an update for the SHA;
  `release` on an existing stack keeps its pinned ref; `release` without
  `RELEASE_SHA` fails; `verify` fails on a version mismatch and passes on a
  match (fake `curl` serving a canned body).

### 5. One-time OIDC setup

`infra/github-oidc.yaml`, deployed with `make aws-oidc` (stack
`design-sync-github-oidc`), by the user once, with admin credentials:

- Parameters: `GitHubRepository` (default `ssudhindra-gg/design-sync`),
  `CreateOidcProvider` (`true`/`false`; an account can hold only one provider
  for `token.actions.githubusercontent.com`), `ExistingOidcProviderArn`.
- `AWS::IAM::OIDCProvider` for `https://token.actions.githubusercontent.com`,
  client ID `sts.amazonaws.com` (conditional).
- `AWS::IAM::Role` named `design-sync-github-deploy`, trust policy:
  `token.actions.githubusercontent.com:aud = sts.amazonaws.com` and
  `token.actions.githubusercontent.com:sub = repo:<repo>:ref:refs/heads/main`
  (exact match: pull requests and other branches cannot assume it).
- Permissions: managed `PowerUserAccess`, plus an inline policy allowing the
  IAM actions the app stack needs (create/delete/get/tag roles and instance
  profiles, attach/detach role policies, add/remove role to instance profile,
  `iam:PassRole`) on `role/design-sync-*` and `instance-profile/design-sync-*`
  only. Accepted as broad-but-bounded for a demo account.
- Output: `RoleArn`. `make aws-oidc` prints it plus the two repository
  variables to set: `AWS_ROLE_ARN=<arn>`, `AWS_REGION=us-east-1`.

## Verification

- Backend: pytest for `/api/health` — healthy (200, `database: ok`,
  `version` from `APP_VERSION`), database down (503, no exception text);
  compose harness asserts `version` is passed through (`dev` by default).
- Frontend: the Vitest suite itself, watched failing first.
- `infra-check`: cfn-lint covers `github-oidc.yaml`; shellcheck and
  `test-deploy.sh` cover `release`/`verify`; `actionlint` (via `uvx`
  or its release binary) lints the workflow.
- Real run: push a branch, open a PR, watch `backend`/`frontend`/`compose`
  pass on GitHub; merge; on `main` the `deploy` job reports skipped while
  `AWS_ROLE_ARN` is unset. A live deploy run requires the user's one-time OIDC
  setup and is not part of this work's acceptance.

## Limitations

- Lint is not in CI (pre-existing failures).
- The first release builds the image twice.
- The deploy role is PowerUser-level plus scoped IAM; tighter least-privilege
  is out of scope.
- Health checks the database only; it does not check WebSocket fan-out.

## Out of scope

Lint fixes, preview environments per PR, rollback automation, notifications,
dependency caching beyond what `setup-node`/`setup-uv` provide by default.
