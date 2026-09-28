# AWS CloudFormation Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command deploys design-sync to a public HTTPS URL on AWS (one EC2 instance running `docker-compose.yaml`, behind CloudFront), and one command tears it down.

**Architecture:** A single CloudFormation stack creates a VPC, a CloudFront-only security group, an EC2 instance and a CloudFront distribution. The instance's user data clones the public GitHub repo and runs `infra/bootstrap.sh`, which installs Docker and starts compose on port 80, then signals CloudFormation. `infra/deploy.sh` wraps the AWS CLI for deploy / update / url / e2e / destroy, and the existing Playwright test is pointed at the live URL via `E2E_BASE_URL`.

**Tech Stack:** AWS CloudFormation (YAML), Amazon Linux 2023, Docker Compose v5.5.1 + Buildx v0.37.1, CloudFront, SSM, bash (Git Bash on Windows), AWS CLI v2, Playwright, cfn-lint and shellcheck via `uvx`.

**Spec:** `docs/superpowers/specs/2026-09-27-aws-cloudformation-deploy-design.md`

## Global Constraints

- Region default `us-east-1` (`AWS_REGION` overrides); stack name default `design-sync` (`STACK_NAME`); git ref default `main` (`GIT_REF`).
- Exactly one app instance (WebSocket fan-out is in memory).
- The app must be served over HTTPS (clipboard Share link needs a secure context).
- Security group: inbound TCP 80 only, only from `com.amazonaws.global.cloudfront.origin-facing`. No SSH.
- CloudFront: `CachingDisabled` (`4135ea2d-6df8-44a3-9df3-4b5a84be39ad`), `AllViewerExceptHostHeader` (`b689b0a8-53d0-40ab-baf2-68738e2966ac`), redirect HTTP to HTTPS, all methods, `PriceClass_100`.
- Instance: AL2023 x86_64 from SSM parameter, `t3.small`, 20 GB gp3, role with `AmazonSSMManagedInstanceCore`, `CreationPolicy` timeout `PT25M`.
- Scripts must work from Git Bash on Windows: set `MSYS_NO_PATHCONV=1` before passing `/opt/...` strings to `aws`, and pass file paths to `aws` relative to the repo root (a `/c/...` path is not readable by the Windows `aws.exe`).
- `uvx` needs `UV_LINK_MODE=copy` on this machine (hardlinks fail in the uv cache).
- The instance deploys what is on GitHub, not the working tree: infra files must be pushed before the first live deploy.
- Nothing is created in AWS before Task 4, and Task 4 starts only after the user has configured credentials and approved pushing.

## Review Focus

1. **`GIT_REF` that GitHub does not have** (typo, unpushed branch) — expect `deploy`/`update` to fail immediately with a clear message, not a 25-minute bootstrap timeout. Pinned by `infra/test-deploy.sh` in Task 3.
2. **No AWS credentials** — expect a one-line "run aws configure" error before any AWS call that would create anything. Pinned by `infra/test-deploy.sh` in Task 3 (with credentials forcibly hidden, so the test can never deploy for real).
3. **Re-running `make aws-deploy` with nothing changed** — expect success ("No changes to deploy") and the same instance ID, not a failure or an instance replacement. Checked live in Task 4, Step 6.
4. **Bootstrap fails on the instance** (e.g. image build error) — expect the stack to fail (ERR trap sends a failure signal) and roll back, not hang. The trap is asserted by `infra/test-deploy.sh` in Task 3 via a template grep; the live path is observed only if it occurs.
5. **`make aws-update` from Git Bash** — expect `/opt/design-sync` to reach the instance unmangled and a failed remote build to exit non-zero with the remote stderr printed. Exercised live in Task 4, Step 7.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `e2e/stack.ts` (modify) | Choose between a compose-managed stack and an external `E2E_BASE_URL`. |
| `e2e/global-setup.ts`, `e2e/global-teardown.ts` (modify) | Skip compose when the URL is external. |
| `infra/cloudformation.yaml` (create) | All AWS resources. |
| `infra/bootstrap.sh` (create) | Runs on the instance: swap, Docker + plugins, compose up, health wait. |
| `infra/deploy.sh` (create) | Operator CLI: `deploy`, `update`, `url`, `e2e`, `destroy`. |
| `infra/test-deploy.sh` (create) | Offline checks of `deploy.sh` preflight and template invariants. |
| `Makefile` (modify) | `aws-deploy`, `aws-update`, `aws-url`, `aws-destroy`, `e2e-aws`, `infra-check`. |
| `README.md` (modify) | "Deploy to AWS" section. |

---

### Task 1: Let the Playwright suite target an already running deployment

**Files:**
- Modify: `e2e/stack.ts`
- Modify: `e2e/global-setup.ts`
- Modify: `e2e/global-teardown.ts`

**Interfaces:**
- Produces: env var `E2E_BASE_URL` — when set, the suite runs against that URL (trailing slashes ignored) and never runs docker compose. `stack.ts` exports `EXTERNAL_URL: string | undefined` and `BASE_URL: string`.

- [ ] **Step 1: Start a stack on port 8000 to act as the "external" deployment**

Run: `docker compose --progress plain up -d --build && until curl -sf -o /dev/null http://localhost:8000/openapi.json; do sleep 1; done`
Expected: returns once the app answers.

- [ ] **Step 2: Run the suite with `E2E_BASE_URL` and confirm it currently ignores it**

Run: `E2E_BASE_URL=http://localhost:8000/ npm test --prefix e2e 2>&1 | grep -c "design-sync-e2e"`
Expected: a number greater than 0 — global setup still started its own `design-sync-e2e` compose project. This is the failing behavior.

- [ ] **Step 3: Implement external-URL mode**

In `e2e/stack.ts`, replace the `BASE_URL` line and the `throw` in `waitUntilServing`:

```ts
export const APP_PORT = process.env.E2E_APP_PORT ?? "18001";
// E2E_BASE_URL runs the suite against an already running deployment (such as
// the AWS stack from infra/deploy.sh) instead of starting docker compose here.
export const EXTERNAL_URL = process.env.E2E_BASE_URL?.replace(/\/+$/, "") || undefined;
export const BASE_URL = EXTERNAL_URL ?? `http://localhost:${APP_PORT}`;
```

```ts
  const logs = EXTERNAL_URL ? "" : `:\n${compose("logs", "--tail", "50")}`;
  throw new Error(`app did not answer on ${BASE_URL} within ${timeoutMs / 1000}s${logs}`);
```

`e2e/global-setup.ts`:

```ts
import { compose, EXTERNAL_URL, waitUntilServing } from "./stack";

export default async function globalSetup(): Promise<void> {
  if (EXTERNAL_URL) {
    await waitUntilServing();
    return;
  }
  // Clear anything a previous, interrupted run left behind.
  compose("down", "-v", "--remove-orphans");
  try {
    compose("up", "-d", "--build");
    await waitUntilServing();
  } catch (error) {
    // Don't leave a half-started stack behind for globalTeardown to maybe miss.
    compose("down", "-v", "--remove-orphans");
    throw error;
  }
}
```

`e2e/global-teardown.ts`:

```ts
import { compose, EXTERNAL_URL } from "./stack";

export default async function globalTeardown(): Promise<void> {
  if (EXTERNAL_URL) return;
  compose("down", "-v", "--remove-orphans");
}
```

- [ ] **Step 4: Re-run against port 8000 and confirm compose is not touched**

Run: `E2E_BASE_URL=http://localhost:8000/ npm test --prefix e2e 2>&1 | tee /dev/stderr | grep -c "design-sync-e2e"`
Expected: output shows `1 passed`, and the count is `0`. (The trailing slash checks that the join-link comparison still matches.)

- [ ] **Step 5: Stop the port-8000 stack and run the regression suite**

Run: `docker compose down && make e2e`
Expected: `1 passed`; `docker ps -a --filter name=design-sync-e2e` prints nothing afterwards.

- [ ] **Step 6: Commit**

```bash
git add e2e/stack.ts e2e/global-setup.ts e2e/global-teardown.ts
git commit -m "Let the e2e suite run against an existing deployment via E2E_BASE_URL"
```

---

### Task 2: CloudFormation template and instance bootstrap

**Files:**
- Create: `infra/cloudformation.yaml`
- Create: `infra/bootstrap.sh`

**Interfaces:**
- Produces: stack parameters `GitRepository`, `GitRef`, `InstanceType`, `CloudFrontPrefixListId`, `LatestAmiId`; outputs `AppUrl`, `InstanceId`, `ShellCommand`. The repo is cloned to `/opt/design-sync` on the instance; `bootstrap.sh` writes `/opt/design-sync/.env` with `APP_PORT=80` so later `docker compose` runs there use port 80. Bootstrap log: `/var/log/design-sync-bootstrap.log`.

- [ ] **Step 1: Run the linters to see them fail**

Run: `UV_LINK_MODE=copy uvx cfn-lint infra/cloudformation.yaml; UV_LINK_MODE=copy uvx --from shellcheck-py shellcheck infra/bootstrap.sh`
Expected: both fail because the files do not exist.

- [ ] **Step 2: Write `infra/bootstrap.sh`**

```bash
#!/bin/bash
# First-boot setup on the EC2 instance. The user data in
# infra/cloudformation.yaml clones this repository and runs this script as
# root. It installs Docker, starts docker-compose.yaml on port 80 and waits
# until the app answers, so CloudFormation only reports success for a working
# app. Safe to re-run.
set -euo pipefail

COMPOSE_VERSION=v5.5.1
BUILDX_VERSION=v0.37.1
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# The frontend build does not fit in a t3.small's 2 GB of RAM on its own.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap defaults 0 0' >> /etc/fstab
fi

dnf install -y docker
systemctl enable --now docker

# Amazon Linux's Docker package ships neither the compose nor the buildx plugin.
plugins=/usr/local/lib/docker/cli-plugins
mkdir -p "$plugins"
curl -fsSL -o "$plugins/docker-compose" \
  "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-x86_64"
curl -fsSL -o "$plugins/docker-buildx" \
  "https://github.com/docker/buildx/releases/download/$BUILDX_VERSION/buildx-$BUILDX_VERSION.linux-amd64"
chmod +x "$plugins/docker-compose" "$plugins/docker-buildx"

# compose reads .env from the project directory, so `make aws-update` gets the
# same port without repeating it.
echo "APP_PORT=80" > "$REPO_DIR/.env"
cd "$REPO_DIR"
docker compose --progress plain up -d --build

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1/openapi.json; then
    echo "design-sync is serving on port 80"
    exit 0
  fi
  sleep 5
done
echo "design-sync did not answer on port 80 within 5 minutes" >&2
docker compose logs --tail 100 >&2
exit 1
```

- [ ] **Step 3: Write `infra/cloudformation.yaml`**

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  design-sync course demo: one EC2 instance running docker-compose.yaml behind
  CloudFront for HTTPS. See docs/superpowers/specs/2026-09-27-aws-cloudformation-deploy-design.md.

Parameters:
  GitRepository:
    Type: String
    Default: https://github.com/ssudhindra-gg/design-sync.git
    Description: Public repository the instance clones at first boot.
  GitRef:
    Type: String
    Default: main
    Description: >-
      Branch, tag or commit deployed at first boot. Changing it replaces the
      instance and deletes its database; use `make aws-update` for code updates.
  InstanceType:
    Type: String
    Default: t3.small
    AllowedValues: [t3.small, t3.medium]
  CloudFrontPrefixListId:
    Type: String
    AllowedPattern: "pl-[0-9a-f]+"
    Description: >-
      ID of the com.amazonaws.global.cloudfront.origin-facing managed prefix
      list in this region; infra/deploy.sh looks it up.
  LatestAmiId:
    Type: AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>
    Default: /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64

Resources:
  Vpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
      EnableDnsSupport: true
      # CloudFront needs the instance's public DNS name as its origin.
      EnableDnsHostnames: true
      Tags: [{ Key: Name, Value: !Ref AWS::StackName }]

  InternetGateway:
    Type: AWS::EC2::InternetGateway
    Properties:
      Tags: [{ Key: Name, Value: !Ref AWS::StackName }]

  GatewayAttachment:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties:
      VpcId: !Ref Vpc
      InternetGatewayId: !Ref InternetGateway

  PublicSubnet:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref Vpc
      CidrBlock: 10.0.1.0/24
      AvailabilityZone: !Select [0, !GetAZs ""]
      MapPublicIpOnLaunch: true
      Tags: [{ Key: Name, Value: !Ref AWS::StackName }]

  RouteTable:
    Type: AWS::EC2::RouteTable
    Properties:
      VpcId: !Ref Vpc

  DefaultRoute:
    Type: AWS::EC2::Route
    DependsOn: GatewayAttachment
    Properties:
      RouteTableId: !Ref RouteTable
      DestinationCidrBlock: 0.0.0.0/0
      GatewayId: !Ref InternetGateway

  SubnetRouteTableAssociation:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties:
      SubnetId: !Ref PublicSubnet
      RouteTableId: !Ref RouteTable

  AppSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: HTTP from CloudFront only
      VpcId: !Ref Vpc
      SecurityGroupIngress:
        - Description: CloudFront origin-facing servers
          IpProtocol: tcp
          FromPort: 80
          ToPort: 80
          SourcePrefixListId: !Ref CloudFrontPrefixListId

  InstanceRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal: { Service: ec2.amazonaws.com }
            Action: sts:AssumeRole
      # Session Manager shell access and `make aws-update` (SSM Run Command).
      ManagedPolicyArns:
        - !Sub arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore

  InstanceProfile:
    Type: AWS::IAM::InstanceProfile
    Properties:
      Roles: [!Ref InstanceRole]

  Instance:
    Type: AWS::EC2::Instance
    # The user data needs the internet (dnf, GitHub) as soon as it boots.
    DependsOn: [DefaultRoute, SubnetRouteTableAssociation]
    CreationPolicy:
      ResourceSignal:
        Count: 1
        Timeout: PT25M
    Properties:
      ImageId: !Ref LatestAmiId
      InstanceType: !Ref InstanceType
      IamInstanceProfile: !Ref InstanceProfile
      SubnetId: !Ref PublicSubnet
      SecurityGroupIds: [!Ref AppSecurityGroup]
      MetadataOptions:
        HttpTokens: required
      BlockDeviceMappings:
        - DeviceName: /dev/xvda
          Ebs:
            VolumeSize: 20
            VolumeType: gp3
            Encrypted: true
      Tags: [{ Key: Name, Value: !Ref AWS::StackName }]
      UserData:
        Fn::Base64: !Sub |
          #!/bin/bash
          # Clone the repository, hand over to infra/bootstrap.sh, and report
          # the outcome to CloudFormation either way.
          set -euo pipefail
          exec > >(tee -a /var/log/design-sync-bootstrap.log) 2>&1
          signal() {
            /opt/aws/bin/cfn-signal -e "$1" --stack ${AWS::StackName} --resource Instance --region ${AWS::Region} || true
          }
          trap 'signal 1' ERR
          dnf install -y git aws-cfn-bootstrap
          git clone ${GitRepository} /opt/design-sync
          git -C /opt/design-sync checkout ${GitRef}
          bash /opt/design-sync/infra/bootstrap.sh
          signal 0

  Distribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Enabled: true
        Comment: !Sub ${AWS::StackName} course demo
        PriceClass: PriceClass_100
        HttpVersion: http2
        Origins:
          - Id: app
            DomainName: !GetAtt Instance.PublicDnsName
            CustomOriginConfig:
              HTTPPort: 80
              OriginProtocolPolicy: http-only
        DefaultCacheBehavior:
          TargetOriginId: app
          ViewerProtocolPolicy: redirect-to-https
          AllowedMethods: [GET, HEAD, OPTIONS, PUT, PATCH, POST, DELETE]
          CachedMethods: [GET, HEAD]
          Compress: true
          # Managed-CachingDisabled: API responses must never be cached.
          CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad
          # Managed-AllViewerExceptHostHeader: cookies, query strings and the
          # WebSocket upgrade headers reach the app.
          OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac

Outputs:
  AppUrl:
    Value: !Sub https://${Distribution.DomainName}
  InstanceId:
    Value: !Ref Instance
  ShellCommand:
    Description: Needs the Session Manager plugin for the AWS CLI.
    Value: !Sub aws ssm start-session --target ${Instance} --region ${AWS::Region}
```

- [ ] **Step 4: Run the linters to see them pass**

Run: `UV_LINK_MODE=copy uvx cfn-lint infra/cloudformation.yaml && UV_LINK_MODE=copy uvx --from shellcheck-py shellcheck infra/bootstrap.sh && echo LINT_OK`
Expected: `LINT_OK` with no findings. Fix any finding before continuing.

- [ ] **Step 5: Commit**

```bash
git add infra/cloudformation.yaml infra/bootstrap.sh
git commit -m "Add CloudFormation template and instance bootstrap for the AWS demo"
```

---

### Task 3: Operator script, offline checks, make targets and README

**Files:**
- Create: `infra/deploy.sh`
- Create: `infra/test-deploy.sh`
- Modify: `Makefile` (`.PHONY`, `help`, new targets at the end)
- Modify: `README.md` (new "Deploy to AWS" section after "Use Postgres")

**Interfaces:**
- Consumes: template outputs `AppUrl`, `InstanceId` and parameters `GitRef`, `CloudFrontPrefixListId` (Task 2); `/opt/design-sync` and its `.env` on the instance (Task 2); `E2E_BASE_URL` (Task 1).
- Produces: `bash infra/deploy.sh deploy|update|url|e2e|destroy`; exit 2 on bad usage, 1 with `error: ...` on failures. Env: `AWS_REGION`, `STACK_NAME`, `GIT_REF`.

- [ ] **Step 1: Write the offline checks `infra/test-deploy.sh`**

```bash
#!/usr/bin/env bash
# Offline checks for infra/deploy.sh and the template. Never talks to AWS in a
# way that could create anything: credentials are hidden from every call.
set -uo pipefail
cd "$(dirname "$0")/.."

failures=0
check() {  # check <name> <expected exit> <expected output regex> -- <command...>
  local name=$1 want_status=$2 want_output=$3
  shift 4
  local output status
  output=$("$@" 2>&1)
  status=$?
  if [ "$status" -eq "$want_status" ] && grep -Eq "$want_output" <<<"$output"; then
    echo "ok   $name"
  else
    echo "FAIL $name (exit $status, wanted $want_status matching /$want_output/):"
    sed 's/^/     /' <<<"$output"
    failures=$((failures + 1))
  fi
}

# Hide every credential source so no check can ever deploy for real.
no_aws() {
  env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE \
    AWS_SHARED_CREDENTIALS_FILE=/nonexistent AWS_CONFIG_FILE=/nonexistent \
    AWS_EC2_METADATA_DISABLED=true "$@"
}

check "unknown command prints usage" 2 "usage:" -- \
  no_aws bash infra/deploy.sh bogus
check "GIT_REF missing on GitHub fails fast" 1 "not on GitHub" -- \
  no_aws env GIT_REF=no-such-branch-zz9 bash infra/deploy.sh deploy
check "missing credentials fail before any AWS change" 1 "aws configure" -- \
  no_aws bash infra/deploy.sh deploy
check "bootstrap failure is signalled to CloudFormation" 0 "trap 'signal 1' ERR" -- \
  grep -F "trap 'signal 1' ERR" infra/cloudformation.yaml

exit "$failures"
```

- [ ] **Step 2: Run it to see it fail**

Run: `bash infra/test-deploy.sh`
Expected: the three `deploy.sh` checks print `FAIL` (script missing); the grep check prints `ok`; exit code 3.

- [ ] **Step 3: Write `infra/deploy.sh`**

```bash
#!/usr/bin/env bash
# Deploy, update and tear down the AWS demo stack (infra/cloudformation.yaml).
#
#   infra/deploy.sh deploy    create or update the stack, print the HTTPS URL
#   infra/deploy.sh update    pull GIT_REF on the instance and rebuild (keeps data)
#   infra/deploy.sh url       print the HTTPS URL
#   infra/deploy.sh e2e       run the Playwright suite against the URL
#   infra/deploy.sh destroy   delete the stack and everything in it
#
# Settings: AWS_REGION (us-east-1), STACK_NAME (design-sync), GIT_REF (main).
# The instance clones the repository from GitHub, so it runs what is pushed
# there, not what is in this working tree.
set -euo pipefail

# Git Bash would otherwise rewrite /opt/... inside arguments into Windows paths.
export MSYS_NO_PATHCONV=1

REGION="${AWS_REGION:-us-east-1}"
STACK="${STACK_NAME:-design-sync}"
GIT_REF="${GIT_REF:-main}"
# Relative paths from here on: the Windows aws.exe cannot read /c/... paths.
cd "$(dirname "$0")/.."

die() { echo "error: $*" >&2; exit 1; }
cfn() { aws cloudformation --region "$REGION" "$@"; }

output() {  # output <OutputKey>
  cfn describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

check_ref_pushed() {
  # Fail now on a ref GitHub does not have, rather than 25 minutes into boot.
  if ! git ls-remote --exit-code origin "$GIT_REF" >/dev/null 2>&1 \
    && ! git fetch -q origin "$GIT_REF" >/dev/null 2>&1; then
    die "GIT_REF '$GIT_REF' is not on GitHub (origin); push it first"
  fi
  if [ "$GIT_REF" = "$(git rev-parse --abbrev-ref HEAD)" ] \
    && [ -n "$(git log --oneline "origin/$GIT_REF..HEAD" 2>/dev/null)" ]; then
    echo "warning: local $GIT_REF has commits not pushed to origin; they will not be deployed" >&2
  fi
}

check_credentials() {
  aws sts get-caller-identity >/dev/null 2>&1 \
    || die "no AWS credentials; run 'aws configure' (or 'aws sso login') first"
}

cloudfront_prefix_list() {
  local id
  id=$(aws ec2 describe-managed-prefix-lists --region "$REGION" \
    --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
    --query 'PrefixLists[0].PrefixListId' --output text)
  [[ "$id" == pl-* ]] || die "CloudFront origin-facing prefix list not found in $REGION"
  echo "$id"
}

wait_for_url() {
  local url=$1
  echo "waiting for $url (CloudFront can take 5-10 minutes on first deploy)..." >&2
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null "$url/openapi.json" 2>/dev/null; then return 0; fi
    sleep 10
  done
  die "$url did not answer within 15 minutes"
}

cmd_deploy() {
  check_ref_pushed
  check_credentials
  local prefix_list url
  prefix_list=$(cloudfront_prefix_list)
  cfn deploy --template-file infra/cloudformation.yaml --stack-name "$STACK" \
    --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset \
    --parameter-overrides "GitRef=$GIT_REF" "CloudFrontPrefixListId=$prefix_list"
  url=$(output AppUrl)
  wait_for_url "$url"
  echo "$url"
}

cmd_update() {
  check_ref_pushed
  check_credentials
  local instance command_id status
  instance=$(output InstanceId)
  # No double quotes inside: this string is embedded in JSON below.
  local script="cd /opt/design-sync && git fetch origin && git checkout -f \$(git rev-parse --verify -q origin/$GIT_REF || echo $GIT_REF) && docker compose --progress plain up -d --build"
  command_id=$(aws ssm send-command --region "$REGION" --instance-ids "$instance" \
    --document-name AWS-RunShellScript --comment "design-sync update to $GIT_REF" \
    --parameters "{\"commands\":[\"$script\"],\"executionTimeout\":[\"1800\"]}" \
    --query Command.CommandId --output text)
  echo "updating $instance to $GIT_REF (SSM command $command_id)..." >&2
  for _ in $(seq 1 180); do
    sleep 10
    status=$(aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
      --instance-id "$instance" --query Status --output text 2>/dev/null || echo Pending)
    case "$status" in
      Success)
        wait_for_url "$(output AppUrl)"
        echo "updated"
        return 0
        ;;
      Failed | Cancelled | TimedOut)
        aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
          --instance-id "$instance" --query StandardErrorContent --output text >&2
        die "update $status"
        ;;
    esac
  done
  die "update still running after 30 minutes; check SSM command $command_id"
}

cmd_e2e() {
  check_credentials
  E2E_BASE_URL="$(output AppUrl)" npm test --prefix e2e
}

cmd_destroy() {
  check_credentials
  cfn delete-stack --stack-name "$STACK"
  echo "deleting $STACK (CloudFront takes several minutes)..." >&2
  cfn wait stack-delete-complete --stack-name "$STACK"
  echo "deleted"
}

case "${1:-}" in
  deploy) cmd_deploy ;;
  update) cmd_update ;;
  url) check_credentials; output AppUrl ;;
  e2e) cmd_e2e ;;
  destroy) cmd_destroy ;;
  *)
    echo "usage: $0 deploy|update|url|e2e|destroy" >&2
    exit 2
    ;;
esac
```

- [ ] **Step 4: Run the checks and shellcheck to see them pass**

Run: `bash infra/test-deploy.sh && UV_LINK_MODE=copy uvx --from shellcheck-py shellcheck infra/deploy.sh infra/test-deploy.sh infra/bootstrap.sh && echo CHECKS_OK`
Expected: four `ok` lines and `CHECKS_OK`. (The "missing credentials" check also prints the unpushed-commits warning, since these commits are local; that is expected.)

- [ ] **Step 5: Add the make targets**

In `Makefile`, append to the `.PHONY` line: `aws-deploy aws-update aws-url aws-destroy e2e-aws infra-check`. Add to `help` after the `e2e` line:

```make
	@echo "  make infra-check    Lint the AWS template and scripts (no AWS access needed)"
	@echo "  make aws-deploy     Deploy to AWS (CloudFormation) and print the HTTPS URL"
	@echo "  make aws-update     Pull GIT_REF on the AWS instance and rebuild, keeping data"
	@echo "  make aws-url        Print the deployed HTTPS URL"
	@echo "  make e2e-aws        Run the Playwright suite against the deployed URL"
	@echo "  make aws-destroy    Delete the AWS stack and everything in it"
```

Append at the end of the file:

```make
# AWS demo deployment; see infra/deploy.sh. AWS_REGION, STACK_NAME and GIT_REF
# pass through from the environment.
infra-check: export UV_LINK_MODE := copy
infra-check:
	uvx cfn-lint infra/cloudformation.yaml
	uvx --from shellcheck-py shellcheck infra/bootstrap.sh infra/deploy.sh infra/test-deploy.sh
	bash infra/test-deploy.sh

aws-deploy:
	bash infra/deploy.sh deploy

aws-update:
	bash infra/deploy.sh update

aws-url:
	bash infra/deploy.sh url

aws-destroy:
	bash infra/deploy.sh destroy

e2e-aws:
	npm ci --prefix e2e
	npm run install-browsers --prefix e2e
	bash infra/deploy.sh e2e
```

Run: `make infra-check`
Expected: cfn-lint and shellcheck print nothing; four `ok` lines; exit 0.

- [ ] **Step 6: Add the README section**

Insert after the "Use Postgres" section (before "## Tests" / the testing section):

````markdown
## Deploy to AWS

A course-demo deployment: one EC2 instance runs `docker-compose.yaml` behind
CloudFront, which provides the HTTPS the Share link button needs. Defined in
`infra/cloudformation.yaml`; the design is in
`docs/superpowers/specs/2026-09-27-aws-cloudformation-deploy-design.md`.

```bash
aws configure                  # once: credentials for the AWS CLI
make aws-deploy                # ~15 min first time; prints https://….cloudfront.net
make e2e-aws                   # Playwright against the live URL
make aws-update                # deploy newly pushed code, keeping the database
make aws-destroy               # delete everything
```

- The instance clones **GitHub**, not your working tree: push first.
  `GIT_REF` picks a branch, tag or commit (default `main`), `AWS_REGION` the
  region (default `us-east-1`).
- Use `make aws-update` for code changes. Changing `GIT_REF` on
  `make aws-deploy` replaces the instance, which deletes the database.
- Anyone with the URL can create rooms (the demo login is in the bundle), the
  data has no backups, and a stop/start of the instance breaks CloudFront's
  origin. Keep it running or destroy it. Roughly $20/month while it runs.
- Shell on the instance: the `ShellCommand` stack output
  (`aws ssm start-session …`, needs the Session Manager plugin). Bootstrap log:
  `/var/log/design-sync-bootstrap.log`.
````

- [ ] **Step 7: Confirm nothing else regressed, then commit**

Run: `make test && make infra-check`
Expected: backend suite passes as before; infra checks pass.

```bash
git add infra/deploy.sh infra/test-deploy.sh Makefile README.md
git commit -m "Add AWS deploy script, offline checks and make targets"
```

---

### Task 4: Live deploy and verification (needs the user)

Creates billable AWS resources. Do not start until the user has (a) configured
credentials and (b) approved pushing `main` to GitHub.

**Interfaces:**
- Consumes: everything above, pushed to `origin/main`.

- [ ] **Step 1: Confirm credentials**

Run: `aws sts get-caller-identity --query Account --output text`
Expected: an account ID. If not, ask the user to run `! aws configure` (or `! aws sso login`).

- [ ] **Step 2: Push (after the user approves)**

Run: `git push origin main`
Expected: `origin/main` includes `infra/bootstrap.sh`.

- [ ] **Step 3: Deploy**

Run: `make aws-deploy` (timeout 30 min)
Expected: ends with an `https://<id>.cloudfront.net` URL. On failure, read the
stack events (`aws cloudformation describe-stack-events --stack-name design-sync --max-items 20`)
and, if the instance booted, `/var/log/design-sync-bootstrap.log` via SSM.

- [ ] **Step 4: Smoke-check the URL**

Run: `url=$(make -s aws-url); curl -sI "$url/" | head -1; curl -s -o /dev/null -w "%{http_code}\n" "$url/openapi.json"; curl -s -o /dev/null -w "%{http_code}\n" "${url/https/http}/"`
Expected: `HTTP/2 200`, `200`, and `301` (HTTP redirects to HTTPS).

- [ ] **Step 5: Run the browser test against AWS**

Run: `make e2e-aws`
Expected: `1 passed` — Share link over HTTPS, join, admit, and the live canvas update through CloudFront's WebSocket.

- [ ] **Step 6: Re-deploy with no changes (Review Focus 3)**

Run:

```bash
instance_id() { aws cloudformation describe-stacks --stack-name design-sync --region us-east-1   --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text; }
id1=$(instance_id); make aws-deploy; id2=$(instance_id)
[ "$id1" = "$id2" ] && echo SAME_INSTANCE
```
Expected: "No changes to deploy", the URL, `SAME_INSTANCE`.

- [ ] **Step 7: Update in place (Review Focus 5)**

Run: `make aws-update && make e2e-aws`
Expected: `updated`, then `1 passed`; a room created before the update is still there afterwards (open it via its `/room/<id>` URL).

- [ ] **Step 8: Hand back to the user**

Report the URL and cost, and ask whether to keep the stack for the demo or run `make aws-destroy` now. Run `make aws-destroy` only on their instruction.
