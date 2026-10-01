# CI/CD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub Actions pipeline that tests every PR and push (backend ∥ frontend, then compose integration + e2e) and, on `main`, deploys to AWS through a GitHub OIDC role and proves the deploy via `/api/health`.

**Architecture:** One workflow, four jobs linked by `needs:`. A new `GET /api/health` reports database status and the running commit (`APP_VERSION`). `infra/deploy.sh` gains `release` (deploy + update to an exact SHA), `verify` (poll health until it reports that SHA) and `oidc` (one-time role setup from `infra/github-oidc.yaml`). The deploy job skips itself until the repository variable `AWS_ROLE_ARN` exists.

**Tech Stack:** GitHub Actions (`actions/checkout@v7`, `actions/setup-node@v7`, `astral-sh/setup-uv@v10`, `aws-actions/configure-aws-credentials@v6`, `actions/upload-artifact@v7`), FastAPI + SQLAlchemy, Vitest 5 + jsdom, CloudFormation, bash, actionlint/cfn-lint/shellcheck via `uvx`.

**Spec:** `docs/superpowers/specs/2026-09-30-ci-cd-pipeline-design.md`

## Global Constraints

- Health: `GET /api/health` → `200 {"status":"ok","database":"ok","version":<APP_VERSION or "dev">}`; `503 {"status":"error","database":"unavailable","version":...}` with no exception text.
- Workflow triggers: `pull_request` and `push` to `main`; default `permissions: contents: read`.
- Deploy job runs only when `github.event_name == 'push'`, ref `refs/heads/main`, and `vars.AWS_ROLE_ARN != ''`; `permissions: id-token: write, contents: read`; `concurrency: {group: aws-deploy, cancel-in-progress: false}`.
- OIDC trust: `aud = sts.amazonaws.com`, `sub = repo:<repo>:ref:refs/heads/main` (exact). Role name `design-sync-github-deploy`; stack `design-sync-github-oidc`.
- Lint is **not** in CI.
- Region default `us-east-1` (`vars.AWS_REGION` / `AWS_REGION`).
- Scripts must keep working from Git Bash on Windows (`MSYS_NO_PATHCONV=1` is already exported in `deploy.sh`; pass repo-relative paths to `aws`).
- `uvx` needs `UV_LINK_MODE=copy` on the dev machine (already set by `make infra-check`).
- Do not use `python3` in `deploy.sh` (on Windows it can be the Microsoft Store stub); parse the health JSON with bash pattern matching (Starlette renders compact JSON: `"key":"value"`, no spaces).

## Review Focus

1. **The deploy role escalating its own privileges** — CI must not be able to edit `design-sync-github-deploy` itself or attach arbitrary policies to the instance role. Expect IAM resources scoped to `role/design-sync-InstanceRole-*` / `instance-profile/design-sync-InstanceProfile-*`, `AttachRolePolicy` limited by `iam:PolicyARN` to `AmazonSSMManagedInstanceCore`, `PassRole` limited to `ec2.amazonaws.com`. Pinned by a `test-deploy.sh` grep check in Task 3; the rest is review.
2. **Re-running `make aws-oidc` after it created the provider** — expect the provider kept, not deleted by flipping `CreateOidcProvider`. Pinned by "oidc rerun keeps the provider settings" in Task 3.
3. **`verify` passing while the old code still answers** — expect failure unless `version` equals the released SHA. Pinned by "verify fails while another version answers" in Task 3.
4. **Database down** — expect 503 and no leaked error text (credentials can appear in driver errors). Pinned by `test_health_is_503_without_leaking_the_error` in Task 1.
5. **Deploy running from a PR or another branch** — expect it never runs (job `if:`) and AWS refuses the role anyway (trust `sub`). Checked by actionlint for syntax and by the real-run in Task 5 (PR shows deploy skipped); the trust condition is review.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/app/routers/health.py` (create) | `/api/health` route. |
| `backend/app/store.py` (modify) | `DatabaseStore.ping()`. |
| `backend/app/main.py` (modify) | Register the health router. |
| `backend/tests/test_health.py` (create) | Health endpoint unit tests. |
| `docker-compose.yaml`, `Dockerfile` (modify) | `APP_VERSION` pass-through; healthcheck path. |
| `backend/tests/compose/conftest.py`, `test_stack.py` (modify) | Health-based readiness; version pass-through test. |
| `e2e/stack.ts` (modify) | Health-based readiness. |
| `infra/bootstrap.sh` (modify) | Export `APP_VERSION`; poll health. |
| `frontend/package.json`, `vitest.config.ts`, `src/vite-env.d.ts`, `src/**/*.test.ts` | Vitest, typecheck. |
| `infra/deploy.sh`, `infra/test-deploy.sh` (modify) | `release`, `verify`, `oidc`; health path; `APP_VERSION` in update. |
| `infra/github-oidc.yaml` (create) | OIDC provider + deploy role. |
| `.github/workflows/ci.yml` (create) | The pipeline. |
| `Makefile`, `README.md` (modify) | `aws-oidc`, lint the workflow + OIDC template; CI/CD docs. |

---

### Task 1: Health endpoint and APP_VERSION plumbing

**Files:**
- Create: `backend/app/routers/health.py`, `backend/tests/test_health.py`
- Modify: `backend/app/store.py`, `backend/app/main.py`, `docker-compose.yaml`, `Dockerfile`, `backend/tests/compose/conftest.py`, `backend/tests/compose/test_stack.py`, `e2e/stack.ts`, `infra/bootstrap.sh`, `infra/deploy.sh`, `infra/test-deploy.sh`

**Interfaces:**
- Produces: `DatabaseStore.ping() -> None` (raises `SQLAlchemyError` on failure); `GET /api/health` (and the root alias `/health`, like every router); env `APP_VERSION`; `deploy.sh` `wait_for_url` polls `/api/health`; the update remote script exports `APP_VERSION=$(git rev-parse HEAD)`.

- [ ] **Step 1: Write the failing backend tests** — `backend/tests/test_health.py`:

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.store import InMemoryStore


def test_health_reports_ok_database_and_version(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_VERSION", "abc123")
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok", "version": "abc123"}


def test_health_version_defaults_to_dev(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_VERSION", raising=False)
    assert client.get("/api/health").json()["version"] == "dev"


def test_health_is_503_without_leaking_the_error(
    client: TestClient, store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreachable() -> None:
        raise OperationalError("SELECT 1", {}, Exception("password authentication failed for user sdip"))

    monkeypatch.setattr(store, "ping", unreachable)
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["status"] == "error"
    assert response.json()["database"] == "unavailable"
    assert "password" not in response.text


def test_ping_succeeds_against_a_real_engine(store: InMemoryStore) -> None:
    store.ping()
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run --directory backend pytest tests/test_health.py -q`
Expected: 4 failures — 404s for the route tests and `AttributeError: ... 'ping'` for the store test.

- [ ] **Step 3: Implement**

`backend/app/store.py`: add `text` to the `from sqlalchemy import ...` line, and add inside `class DatabaseStore` (after `_db`):

```python
    def ping(self) -> None:
        with self.engine.connect() as connection: connection.execute(text("SELECT 1"))
```

`backend/app/routers/health.py`:

```python
"""Database-aware health check for container healthchecks and deploy validation."""

import os

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from ..auth import get_store_dependency
from ..store import InMemoryStore

router = APIRouter(tags=["Health"])


@router.get("/health", operation_id="getHealth")
def health(store: InMemoryStore = Depends(get_store_dependency)) -> JSONResponse:
    # The version lets a deploy prove the new code is the one answering.
    version = os.getenv("APP_VERSION", "dev")
    try:
        store.ping()
    except SQLAlchemyError:
        # Driver errors can carry connection details; report the state only.
        return JSONResponse(
            status_code=503,
            content={"status": "error", "database": "unavailable", "version": version},
        )
    return JSONResponse({"status": "ok", "database": "ok", "version": version})
```

`backend/app/main.py`: add `health` to the `from .routers import ...` line and to `route_modules` (first in the list).

- [ ] **Step 4: Run the backend tests**

Run: `uv run --directory backend pytest -q`
Expected: all pass (23 passed, 16 skipped).

- [ ] **Step 5: Write the failing compose and deploy checks**

`backend/tests/compose/conftest.py`: in `Compose.run`, change the env to `env={**os.environ, "APP_PORT": str(APP_PORT), "APP_VERSION": "compose-test"},` and in `wait_until_serving` replace `/openapi.json` with `/api/health`.

Append to `backend/tests/compose/test_stack.py`:

```python
def test_health_reports_the_version_compose_passed_in(new_client: Callable[[], httpx.Client]) -> None:
    body = new_client().get("/api/health").json()
    assert body == {"status": "ok", "database": "ok", "version": "compose-test"}
```

Add to `infra/test-deploy.sh`, before the final `check "bootstrap failure ..."`:

```bash
check "update reports the deployed commit as APP_VERSION" 0 'export APP_VERSION=\$\(git rev-parse HEAD\)' -- \
  fake_aws_and_git env FAKE_STACK_STATUS=CREATE_COMPLETE bash infra/deploy.sh update
check "every readiness check uses the health endpoint" 0 "all use /api/health" -- \
  bash -c 'for f in infra/deploy.sh infra/bootstrap.sh Dockerfile e2e/stack.ts backend/tests/compose/conftest.py; do grep -qF /api/health "$f" || { echo "missing in $f"; exit 1; }; done; echo "all use /api/health"'
```

Run: `make test-compose 2>&1 | tail -3; bash infra/test-deploy.sh | grep -E "FAIL|ok   (update reports|deploy waits)"`
Expected: `test_health_reports_the_version_compose_passed_in` fails (`version` is `dev`, the compose file does not pass it through); both new `test-deploy.sh` checks `FAIL` ("every readiness check" fails on the first file still using `/openapi.json`).

- [ ] **Step 6: Plumb APP_VERSION and switch healthchecks**

`docker-compose.yaml`, app service `environment:` gains:

```yaml
      # The commit being run; /api/health reports it. Set by infra/bootstrap.sh
      # and `make aws-update` on AWS, by the compose tests in CI.
      APP_VERSION: ${APP_VERSION:-dev}
```

`Dockerfile` `HEALTHCHECK`: replace `'/openapi.json'` with `'/api/health'`.

`e2e/stack.ts` `waitUntilServing`: replace `/openapi.json` with `/api/health`.

`infra/bootstrap.sh`: before `docker compose --progress plain up -d --build` add

```bash
# Reported by /api/health, so a deploy can prove which commit is running.
APP_VERSION=$(git -C "$REPO_DIR" rev-parse HEAD)
export APP_VERSION
```

and replace `http://127.0.0.1/openapi.json` with `http://127.0.0.1/api/health`.

`infra/deploy.sh`: in `wait_for_url` replace `"$url/openapi.json"` with `"$url/api/health"`; in `cmd_update`'s `script`, replace `&& docker compose --progress plain up -d --build;` with `&& export APP_VERSION=\$(git rev-parse HEAD) && docker compose --progress plain up -d --build;`.

- [ ] **Step 7: Run everything touched**

Run: `make test && make test-compose && make e2e && make infra-check`
Expected: backend 23 passed; compose 14 passed; e2e 1 passed; infra checks all `ok`.

- [ ] **Step 8: Commit**

```bash
git add backend docker-compose.yaml Dockerfile e2e/stack.ts infra
git commit -m "Add a database-aware /api/health that reports the running commit"
```

---

### Task 2: Frontend tests with Vitest, and a clean type-check

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`
- Create: `frontend/vitest.config.ts`, `frontend/src/vite-env.d.ts`, `frontend/src/lib/diagram-utils.test.ts`, `frontend/src/services/identity.test.ts`

**Interfaces:**
- Produces: `npm test` (= `vitest run`) and `npm run typecheck` (= `tsc --noEmit`) in `frontend/`, both exit 0.

- [ ] **Step 1: See the frontend has no test or typecheck script, and that tsc fails**

Run: `cd frontend && npm test; npx tsc --noEmit | head -3`
Expected: `Missing script: "test"`; three `TS4111` errors in `src/services/api/real-api.ts` (`VITE_API_URL`, `VITE_API_USERNAME`, `VITE_API_PASSWORD`).

- [ ] **Step 2: Add Vitest and the scripts**

Run: `cd frontend && npm install --save-dev vitest@^5.0.3 jsdom@^30.1.1`

In `frontend/package.json` `scripts`, add `"test": "vitest run"` and `"typecheck": "tsc --noEmit"`.

`frontend/vitest.config.ts` (separate from `vite.config.ts`, whose Lovable/TanStack Start wrapper adds build plugins unit tests do not need):

```ts
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Write the tests**

`frontend/src/lib/diagram-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Diagram, DiagramNode } from "@/services/api";

import { borderPoint, diagramBounds, edgeGeometry, nodeCenter } from "./diagram-utils";

function node(id: string, x: number, y: number, w = 100, h = 50): DiagramNode {
  return { id, kind: "service", label: id, x, y, w, h };
}

describe("nodeCenter", () => {
  it("is the middle of the node's box", () => {
    expect(nodeCenter(node("a", 10, 20))).toEqual({ x: 60, y: 45 });
  });
});

describe("borderPoint", () => {
  const a = node("a", 10, 20); // center (60, 45), 6px gap outside the border

  it("leaves through the right edge toward a point to the right", () => {
    expect(borderPoint(a, { x: 500, y: 45 })).toEqual({ x: 116, y: 45 });
  });

  it("leaves through the bottom edge toward a point below", () => {
    expect(borderPoint(a, { x: 60, y: 500 })).toEqual({ x: 60, y: 76 });
  });

  it("returns the center when the target is the center", () => {
    expect(borderPoint(a, { x: 60, y: 45 })).toEqual({ x: 60, y: 45 });
  });
});

describe("edgeGeometry", () => {
  const diagram: Diagram = { nodes: [node("a", 0, 0), node("b", 300, 0)], edges: [] };

  it("runs border to border with the midpoint between", () => {
    expect(edgeGeometry(diagram, "a", "b")).toEqual({
      a: { x: 106, y: 25 },
      b: { x: 294, y: 25 },
      mid: { x: 200, y: 25 },
    });
  });

  it("is null when an end is missing", () => {
    expect(edgeGeometry(diagram, "a", "missing")).toBeNull();
  });
});

describe("diagramBounds", () => {
  it("has a default frame for an empty diagram", () => {
    expect(diagramBounds({ nodes: [], edges: [] })).toEqual({ x: 0, y: 0, w: 900, h: 600 });
  });

  it("pads around the nodes", () => {
    expect(diagramBounds({ nodes: [node("a", 10, 20)], edges: [] })).toEqual({
      x: -50,
      y: -40,
      w: 220,
      h: 170,
    });
  });
});
```

`frontend/src/services/identity.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { forgetMe, recallMe, rememberMe } from "./identity";

describe("identity", () => {
  beforeEach(() => window.localStorage.clear());

  it("remembers who I am in a session", () => {
    rememberMe("s1", "p_1");
    expect(recallMe("s1")).toBe("p_1");
  });

  it("keeps sessions apart", () => {
    rememberMe("s1", "p_1");
    rememberMe("s2", "p_2");
    expect(recallMe("s1")).toBe("p_1");
    expect(recallMe("s2")).toBe("p_2");
  });

  it("forgets one session only", () => {
    rememberMe("s1", "p_1");
    rememberMe("s2", "p_2");
    forgetMe("s1");
    expect(recallMe("s1")).toBeNull();
    expect(recallMe("s2")).toBe("p_2");
  });
});
```

- [ ] **Step 4: Run the tests, then prove they can fail**

Run: `cd frontend && npm test`
Expected: 2 files, 11 tests passed.

These test existing code, so also prove they bite: change `+ 6` to `+ 0` in both `hw`/`hh` lines of `borderPoint` in `src/lib/diagram-utils.ts`, run `npm test` — expect the `borderPoint` and `edgeGeometry` tests to fail — then revert the change (`git checkout src/lib/diagram-utils.ts`) and re-run: all pass.

- [ ] **Step 5: Fix the type-check**

`frontend/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

// Declared so tsc (with noPropertyAccessFromIndexSignature) knows the
// VITE_* variables src/services/api/real-api.ts reads; all are optional.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_USERNAME?: string;
  readonly VITE_API_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

Run: `cd frontend && npm run typecheck && npm test && VITE_API_URL=/api npm run build`
Expected: no tsc output; 11 tests pass; build writes `.output/public/index.html`. (In Git Bash prefix the build with `MSYS_NO_PATHCONV=1`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/vite-env.d.ts frontend/src/lib/diagram-utils.test.ts frontend/src/services/identity.test.ts
git commit -m "Add Vitest unit tests and a clean type-check to the frontend"
```

---

### Task 3: `release`, `verify` and the OIDC role

**Files:**
- Modify: `infra/deploy.sh`, `infra/test-deploy.sh`, `Makefile`
- Create: `infra/github-oidc.yaml`

**Interfaces:**
- Consumes: `/api/health` contract and `APP_VERSION` (Task 1); existing `cmd_deploy`, `cmd_update`, `stack_parameter`, `app_url`, `check_credentials` in `deploy.sh`.
- Produces: `RELEASE_SHA=<40-hex> bash infra/deploy.sh release`; `bash infra/deploy.sh verify <40-hex>` (env hooks `VERIFY_ATTEMPTS`, default 60, and `VERIFY_INTERVAL`, default 10); `bash infra/deploy.sh oidc` / `make aws-oidc`, printing `AWS_ROLE_ARN=<arn>` and `AWS_REGION=<region>`. Stack `design-sync-github-oidc` (env `OIDC_STACK_NAME`), output `RoleArn`.

- [ ] **Step 1: Extend the fakes and write the failing checks**

In `infra/test-deploy.sh`'s fake `aws` heredoc, add these cases before the `*) echo "fake aws: unexpected call` line:

```bash
  *"iam list-open-id-connect-providers"*) echo "${FAKE_OIDC_PROVIDER:-None}" ;;
```

and inside the `describe-stacks` inner `case`, add `*RoleArn*) echo "arn:aws:iam::123456789012:role/design-sync-github-deploy" ;;`.

Replace the fake `curl` line with one that serves a canned health body unless `-o` is given:

```bash
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\ncase " $* " in *" -o "*) ;; *) printf "%%s" "${FAKE_HEALTH_BODY:-}" ;; esac\n' > "$FAKE/bin/curl"
```

Add before the final `bootstrap failure` check:

```bash
SHA=0123456789abcdef0123456789abcdef01234567
check "release needs the full commit SHA" 1 "RELEASE_SHA" -- \
  fake_aws_and_git bash infra/deploy.sh release
check "release creates a new stack from main" 0 "deploy .*GitRef=main" -- \
  fake_aws_and_git env RELEASE_SHA=$SHA bash infra/deploy.sh release
check "release updates the instance to the SHA" 0 "update to $SHA" -- \
  fake_aws_and_git env RELEASE_SHA=$SHA bash infra/deploy.sh release
check "release keeps an existing stack's pinned ref" 0 "deploy .*--parameter-overrides CloudFrontPrefixListId=pl-fake$" -- \
  fake_aws_and_git env FAKE_STACK_STATUS=CREATE_COMPLETE FAKE_GITREF=v1 RELEASE_SHA=$SHA bash infra/deploy.sh release
check "verify passes when the released SHA answers" 0 "healthy" -- \
  fake_aws env FAKE_STACK_STATUS=CREATE_COMPLETE VERIFY_ATTEMPTS=2 VERIFY_INTERVAL=0 \
    FAKE_HEALTH_BODY="{\"status\":\"ok\",\"database\":\"ok\",\"version\":\"$SHA\"}" bash infra/deploy.sh verify $SHA
check "verify fails while another version answers" 1 "never reported" -- \
  fake_aws env FAKE_STACK_STATUS=CREATE_COMPLETE VERIFY_ATTEMPTS=2 VERIFY_INTERVAL=0 \
    FAKE_HEALTH_BODY='{"status":"ok","database":"ok","version":"old"}' bash infra/deploy.sh verify $SHA
check "verify fails while the database is down" 1 "never reported" -- \
  fake_aws env FAKE_STACK_STATUS=CREATE_COMPLETE VERIFY_ATTEMPTS=2 VERIFY_INTERVAL=0 \
    FAKE_HEALTH_BODY="{\"status\":\"error\",\"database\":\"unavailable\",\"version\":\"$SHA\"}" bash infra/deploy.sh verify $SHA
check "oidc on a new account creates the GitHub provider" 0 "deploy .*github-oidc.*CreateOidcProvider=true" -- \
  fake_aws bash infra/deploy.sh oidc
check "oidc reuses an existing GitHub provider" 0 "ExistingOidcProviderArn=arn:aws:iam::1:oidc-provider/token" -- \
  fake_aws env FAKE_OIDC_PROVIDER=arn:aws:iam::1:oidc-provider/token.actions.githubusercontent.com bash infra/deploy.sh oidc
check "oidc rerun keeps the provider settings" 0 "deploy .*--parameter-overrides GitHubRepository=[^ ]+$" -- \
  fake_aws env FAKE_STACK_STATUS=CREATE_COMPLETE bash infra/deploy.sh oidc
check "oidc prints the role ARN to configure" 0 "AWS_ROLE_ARN=arn:aws:iam::123456789012:role/design-sync-github-deploy" -- \
  fake_aws bash infra/deploy.sh oidc
check "deploy role cannot edit itself or attach arbitrary policies" 0 "InstanceRole-\*" -- \
  bash -c '! grep -qE "role/design-sync-\*" infra/github-oidc.yaml && grep -q "iam:PolicyARN" infra/github-oidc.yaml && grep -o "role/design-sync-InstanceRole-\*" infra/github-oidc.yaml'
```

Run: `bash infra/test-deploy.sh | grep -E "^(FAIL|ok)"`
Expected: the 12 new checks `FAIL` (unknown commands print usage / template missing); all earlier checks `ok`.

- [ ] **Step 2: Write `infra/github-oidc.yaml`**

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  One-time setup letting GitHub Actions on design-sync's main branch deploy
  via OIDC (no stored AWS keys). Deploy with `make aws-oidc` using admin
  credentials. See docs/superpowers/specs/2026-09-30-ci-cd-pipeline-design.md.

Parameters:
  GitHubRepository:
    Type: String
    Default: ssudhindra-gg/design-sync
    AllowedPattern: "[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"
  CreateOidcProvider:
    Type: String
    AllowedValues: ["true", "false"]
    Default: "true"
    Description: >-
      An account holds one provider for token.actions.githubusercontent.com;
      false reuses ExistingOidcProviderArn instead.
  ExistingOidcProviderArn:
    Type: String
    Default: ""

Conditions:
  CreateProvider: !Equals [!Ref CreateOidcProvider, "true"]

Resources:
  GitHubOidcProvider:
    Type: AWS::IAM::OIDCProvider
    Condition: CreateProvider
    Properties:
      Url: https://token.actions.githubusercontent.com
      ClientIdList: [sts.amazonaws.com]

  DeployRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: design-sync-github-deploy
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Federated: !If [CreateProvider, !Ref GitHubOidcProvider, !Ref ExistingOidcProviderArn]
            Action: sts:AssumeRoleWithWebIdentity
            Condition:
              StringEquals:
                token.actions.githubusercontent.com:aud: sts.amazonaws.com
                # Exact match: pull requests and other branches cannot deploy.
                token.actions.githubusercontent.com:sub: !Sub repo:${GitHubRepository}:ref:refs/heads/main
      ManagedPolicyArns:
        - !Sub arn:${AWS::Partition}:iam::aws:policy/PowerUserAccess
      Policies:
        # PowerUserAccess excludes IAM. The app stack (infra/cloudformation.yaml,
        # stack name design-sync) creates one role and one instance profile;
        # allow exactly those, never this role itself, and only the SSM policy.
        - PolicyName: design-sync-stack-iam
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - iam:CreateRole
                  - iam:DeleteRole
                  - iam:GetRole
                  - iam:TagRole
                  - iam:UntagRole
                  - iam:ListAttachedRolePolicies
                  - iam:ListRolePolicies
                  - iam:ListInstanceProfilesForRole
                Resource: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:role/design-sync-InstanceRole-*
              - Effect: Allow
                Action:
                  - iam:AttachRolePolicy
                  - iam:DetachRolePolicy
                Resource: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:role/design-sync-InstanceRole-*
                Condition:
                  ArnEquals:
                    iam:PolicyARN: !Sub arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore
              - Effect: Allow
                Action: iam:PassRole
                Resource: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:role/design-sync-InstanceRole-*
                Condition:
                  StringEquals:
                    iam:PassedToService: ec2.amazonaws.com
              - Effect: Allow
                Action:
                  - iam:CreateInstanceProfile
                  - iam:DeleteInstanceProfile
                  - iam:GetInstanceProfile
                  - iam:TagInstanceProfile
                  - iam:AddRoleToInstanceProfile
                  - iam:RemoveRoleFromInstanceProfile
                Resource: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:instance-profile/design-sync-InstanceProfile-*

Outputs:
  RoleArn:
    Description: Set as the GitHub repository variable AWS_ROLE_ARN.
    Value: !GetAtt DeployRole.Arn
```

- [ ] **Step 3: Add `release`, `verify`, `oidc` to `infra/deploy.sh`**

Header comment: add lines

```bash
#   infra/deploy.sh release   CI: deploy, then update to RELEASE_SHA (full SHA)
#   infra/deploy.sh verify S  wait until /api/health reports commit S, database ok
#   infra/deploy.sh oidc      one-time: GitHub OIDC deploy role (admin credentials)
```

After `GIT_REF="${GIT_REF:-main}"` add:

```bash
OIDC_STACK="${OIDC_STACK_NAME:-design-sync-github-oidc}"
# How long `verify` polls (overridable for the offline checks).
VERIFY_ATTEMPTS="${VERIFY_ATTEMPTS:-60}"
VERIFY_INTERVAL="${VERIFY_INTERVAL:-10}"
```

Make `stack_status` take an optional stack name:

```bash
# Empty when the stack does not exist.
stack_status() {  # stack_status [stack name]
  cfn describe-stacks --stack-name "${1:-$STACK}" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true
}
```

Add before the `case "${1:-}" in` dispatcher:

```bash
cmd_release() {
  [[ "${RELEASE_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA must be the full commit SHA to release"
  check_credentials
  # deploy applies template changes under the ref the stack was created with
  # (main for a new stack); update then moves the instance to the exact commit.
  local status
  status=$(stack_status)
  if [ -n "$status" ] && [ "$status" != ROLLBACK_COMPLETE ]; then
    GIT_REF=$(stack_parameter GitRef)
  else
    GIT_REF=main
  fi
  cmd_deploy
  GIT_REF=$RELEASE_SHA
  cmd_update
}

# True when a /api/health body reports status and database ok and version $2.
# Pattern matching, not a JSON parser: the app renders compact JSON.
health_ok() {
  [[ "$1" == *'"status":"ok"'* && "$1" == *'"database":"ok"'* && "$1" == *"\"version\":\"$2\""* ]]
}

cmd_verify() {
  local want=${1:-} url body=""
  [[ "$want" =~ ^[0-9a-f]{40}$ ]] || die "usage: $0 verify <full commit sha>"
  check_credentials
  url=$(app_url)
  for _ in $(seq 1 "$VERIFY_ATTEMPTS"); do
    body=$(curl -fsS "$url/api/health" 2>/dev/null || true)
    if health_ok "$body" "$want"; then
      echo "healthy: $url runs $want"
      return 0
    fi
    sleep "$VERIFY_INTERVAL"
  done
  die "$url/api/health never reported $want with the database ok; last response: ${body:-<none>}"
}

github_repository() {
  git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##'
}

cmd_oidc() {
  check_credentials
  local provider arn
  local params=("GitHubRepository=$(github_repository)")
  if [ -z "$(stack_status "$OIDC_STACK")" ]; then
    # One provider per URL per account: reuse an existing one. Decided at
    # create only; later runs keep the stack's values, so a provider this
    # stack created is never handed over and deleted.
    provider=$(aws iam list-open-id-connect-providers \
      --query "OpenIDConnectProviderList[?ends_with(Arn, '/token.actions.githubusercontent.com')].Arn | [0]" \
      --output text)
    if [[ "$provider" == arn:* ]]; then
      params+=("CreateOidcProvider=false" "ExistingOidcProviderArn=$provider")
    else
      params+=("CreateOidcProvider=true")
    fi
  fi
  cfn deploy --template-file infra/github-oidc.yaml --stack-name "$OIDC_STACK" \
    --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset \
    --parameter-overrides "${params[@]}"
  arn=$(cfn describe-stacks --stack-name "$OIDC_STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text)
  echo "Set these GitHub repository variables (Settings > Secrets and variables > Actions > Variables):"
  echo "  AWS_ROLE_ARN=$arn"
  echo "  AWS_REGION=$REGION"
}
```

In the dispatcher add `release) cmd_release ;;`, `verify) cmd_verify "${2:-}" ;;`, `oidc) cmd_oidc ;;` and update the usage line to `usage: $0 deploy|update|release|verify|url|e2e|oidc|destroy`.

- [ ] **Step 4: Make targets**

`Makefile`: add `aws-oidc` to `.PHONY`; in `help` add `@echo "  make aws-oidc       One-time: create the GitHub OIDC deploy role (admin credentials)"`; add the target next to `aws-deploy`:

```make
aws-oidc:
	bash infra/deploy.sh oidc
```

and change the cfn-lint line in `infra-check` to `uvx cfn-lint infra/cloudformation.yaml infra/github-oidc.yaml`.

- [ ] **Step 5: Run the checks**

Run: `make infra-check`
Expected: cfn-lint and shellcheck silent; every `test-deploy.sh` check `ok`; exit 0. (Each `release` check sleeps 10 s in the update poll; ~40 s total is expected.)

- [ ] **Step 6: Commit**

```bash
git add infra/deploy.sh infra/test-deploy.sh infra/github-oidc.yaml Makefile
git commit -m "Add release/verify deploy commands and the GitHub OIDC deploy role"
```

---

### Task 4: The workflow, its lint, and docs

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `Makefile` (`infra-check`), `README.md`

**Interfaces:**
- Consumes: `make test-pg`, `make test-compose` (Task 1), `npm test`/`npm run typecheck` (Task 2), `deploy.sh release`/`verify`/`e2e` (Task 3), repository variables `AWS_ROLE_ARN`, `AWS_REGION`.

- [ ] **Step 1: Lint a workflow that does not exist yet**

Add to `infra-check` in `Makefile` (after the shellcheck line): `uvx --from actionlint-py actionlint .github/workflows/ci.yml`.

Run: `make infra-check`
Expected: fails — actionlint cannot read `.github/workflows/ci.yml`.

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```yaml
# Tests every pull request and push to main; deploys main to AWS.
# See docs/superpowers/specs/2026-09-30-ci-cd-pipeline-design.md.
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: sdip
          POSTGRES_PASSWORD: sdip
          POSTGRES_DB: sdip
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U sdip -d sdip"
          --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10
      # The whole suite, including the Postgres integration tests.
      - run: make test-pg

  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run typecheck
      - run: npm run build
        env:
          VITE_API_URL: /api

  compose:
    needs: [backend, frontend]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: e2e/package-lock.json
      - name: Integration tests against docker-compose.yaml
        run: make test-compose
      - name: Install Playwright
        working-directory: e2e
        run: |
          npm ci
          npx playwright install --with-deps chromium
      - name: End-to-end tests against docker-compose.yaml
        working-directory: e2e
        run: npm test
      - if: failure()
        uses: actions/upload-artifact@v7
        with:
          name: playwright-results
          path: |
            e2e/test-results
            e2e/playwright-report
          if-no-files-found: ignore

  deploy:
    needs: compose
    # Skipped (not failed) until the one-time OIDC setup has set AWS_ROLE_ARN.
    if: github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.AWS_ROLE_ARN != ''
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    concurrency:
      group: aws-deploy
      cancel-in-progress: false
    env:
      AWS_REGION: ${{ vars.AWS_REGION || 'us-east-1' }}
    steps:
      - uses: actions/checkout@v7
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}
      - name: Release this commit
        run: bash infra/deploy.sh release
        env:
          RELEASE_SHA: ${{ github.sha }}
      - name: Verify /api/health reports this commit
        run: bash infra/deploy.sh verify "$GITHUB_SHA"
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: e2e/package-lock.json
      - name: Smoke test the live URL
        run: |
          npm ci --prefix e2e
          (cd e2e && npx playwright install --with-deps chromium)
          bash infra/deploy.sh e2e
```

- [ ] **Step 3: Lint it**

Run: `make infra-check`
Expected: actionlint silent; everything else as before; exit 0.

- [ ] **Step 4: README**

Add a `## CI/CD` section after `## Deploy to AWS`:

````markdown
## CI/CD

`.github/workflows/ci.yml` runs on every pull request and push to `main`:

| Job | Runs |
| --- | --- |
| `backend` | `make test-pg` against a Postgres service container |
| `frontend` (parallel) | Vitest, `tsc --noEmit`, production build |
| `compose` | `make test-compose`, then the Playwright suite, against `docker-compose.yaml` |
| `deploy` | `main` only: `deploy.sh release`, then `deploy.sh verify` until `/api/health` reports the commit, then Playwright against the live URL |

The deploy job assumes an AWS role through GitHub OIDC (no stored keys) and
is **skipped** until that role exists. One-time setup, with admin
credentials:

```bash
make aws-oidc     # prints AWS_ROLE_ARN and AWS_REGION
```

Add both as repository variables (Settings > Secrets and variables >
Actions > Variables). Only pushes to `main` of this repository can assume the
role. Lint is not part of CI yet: `npm run lint` has pre-existing formatting
failures.

`GET /api/health` returns `{"status":"ok","database":"ok","version":"<commit>"}`
(503 when the database is unreachable); `version` is `dev` outside a deploy.
````

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml Makefile README.md
git commit -m "Add the CI/CD workflow"
```

---

### Task 5: Prove it on GitHub

Pushes a feature branch and opens a PR (no merge — that is the user's call at the end).

- [ ] **Step 1: Push and open the PR**

Run: `git push -u origin HEAD && gh pr create --base main --title "Add CI/CD pipeline" --body-file <(printf 'Implements docs/superpowers/specs/2026-09-30-ci-cd-pipeline-design.md.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n')`
Expected: a PR URL.

- [ ] **Step 2: Watch the checks**

Run: `gh pr checks --watch --interval 30`
Expected: `backend`, `frontend`, `compose` pass; `deploy` shows skipped (not a push to main). Any failure: read `gh run view --log-failed`, fix under systematic debugging, commit, push, watch again.

- [ ] **Step 3: Report**

Report the PR URL and per-job results. Merging, and seeing `deploy` skipped on `main` with `AWS_ROLE_ARN` unset, follow at the user's go-ahead.
