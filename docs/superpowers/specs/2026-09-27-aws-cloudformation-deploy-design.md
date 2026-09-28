# Deploy design-sync to AWS with CloudFormation

Date: 2026-09-27. Status: approved in conversation, awaiting spec review.

## Goal

A public HTTPS URL where the app works end to end — create a room, share the
link, candidate joins and is admitted, live canvas updates — for a course
demo. It is expected to run for a while and then be torn down.

Agreed with the user:

- Purpose: course demo / homework, not production.
- Approach: one EC2 instance running the repository's `docker-compose.yaml`,
  behind CloudFront. (Fargate + RDS + ALB was considered and declined: about
  2-3x the cost and more moving parts, for resilience a demo does not need.)
- Region: `us-east-1`, overridable.

## Constraints found in the code

- **One app process only.** WebSocket fan-out is in memory
  (`InMemoryStore._connections` in `backend/app/store.py`). A second app
  instance would not see the first one's events. One EC2 instance with one
  app container satisfies this.
- **HTTPS is required.** The Share link button calls
  `navigator.clipboard.writeText`, which browsers only allow in a secure
  context. Plain `http://` on a public host breaks it.
- **WebSocket idle timeout is not a concern.** The client pings every 20 s
  (`frontend/src/services/api/real-api.ts`), well inside CloudFront's idle
  timeout.
- The GitHub repository `ssudhindra-gg/design-sync` is public, so the
  instance can clone it without credentials and no image registry is needed.

## Architecture

One CloudFormation stack, `infra/cloudformation.yaml`, named `design-sync` by
default.

```
browser ──HTTPS──> CloudFront (*.cloudfront.net) ──HTTP:80──> EC2 (public subnet)
                                                                └─ docker compose
                                                                     ├─ app  (published on :80)
                                                                     └─ db   (Postgres, compose network only)
```

### Network

- VPC `10.0.0.0/16`, one public subnet `10.0.1.0/24` in the first AZ,
  internet gateway, route table with `0.0.0.0/0` to the gateway. The stack
  does not depend on the account's default VPC.
- Security group: inbound TCP 80 **only** from the CloudFront origin-facing
  managed prefix list (`com.amazonaws.global.cloudfront.origin-facing`).
  No other inbound rules; no SSH. Its ID is region specific, so it is a stack
  parameter that the deploy script resolves.

### Instance

- Amazon Linux 2023, x86_64, latest AMI via the public SSM parameter
  `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64`.
- `t3.small` (parameter), 20 GB gp3 root volume.
- Instance role with `AmazonSSMManagedInstanceCore`, for shell access via
  `aws ssm start-session` and for `make aws-update`.
- Public IP from the subnet (no Elastic IP, see Limitations).
- `CreationPolicy` with a 25 minute resource signal: the stack only reaches
  `CREATE_COMPLETE` once the app answers locally, so a failed bootstrap fails
  the deploy instead of leaving a silently broken instance.

### Bootstrap (user data)

1. Add a 2 GB swap file (the frontend build is memory hungry on 2 GB RAM).
2. Install `docker`, `git`, `aws-cfn-bootstrap`; enable and start Docker.
3. Install the Docker Compose and Buildx CLI plugins from their GitHub
   releases into `/usr/local/lib/docker/cli-plugins` (Amazon Linux's Docker
   package does not ship them).
4. Clone the repository at the `GitRef` parameter (default `main`) into
   `/opt/design-sync`.
5. `APP_PORT=80 docker compose --progress plain up -d --build`.
6. Poll `http://127.0.0.1/openapi.json` until it answers, then `cfn-signal`
   success; any failed step signals failure.

Containers use `restart: unless-stopped` and Docker is enabled at boot, so a
reboot brings the app back. Postgres keeps its data in the `pgdata` volume on
the root disk.

### CloudFront

- One distribution; origin is the instance's public DNS name, HTTP only,
  port 80.
- Viewer protocol policy: redirect HTTP to HTTPS. Default
  `*.cloudfront.net` certificate; no custom domain.
- Cache policy: managed `CachingDisabled`, so API responses are never cached.
- Origin request policy: managed `AllViewerExceptHostHeader`, which forwards
  cookies, query strings and headers (including the WebSocket upgrade) while
  letting CloudFront set `Host` for the origin.
- Allowed methods: all (GET, HEAD, OPTIONS, PUT, PATCH, POST, DELETE).
- Price class 100 (cheapest edge locations).

### Outputs

`AppUrl` (the `https://…cloudfront.net` URL), `InstanceId`, and
`ShellCommand` (`aws ssm start-session --target <id> --region <region>`).

## Operator workflow

`infra/deploy.sh` (bash, runs in Git Bash) and Makefile targets:

| Target | Does |
| --- | --- |
| `make aws-deploy` | Resolve the prefix list ID, `aws cloudformation deploy`, wait for `AppUrl` to answer over HTTPS, print it. |
| `make aws-update` | Via SSM Run Command: `git fetch && git checkout <ref> && git pull`, then `docker compose up -d --build`. Updates code without replacing the instance, so data is kept. |
| `make aws-url` | Print `AppUrl`. |
| `make aws-destroy` | Delete the stack and wait for completion. |

`AWS_REGION` (default `us-east-1`), `STACK_NAME` (default `design-sync`) and
`GIT_REF` (default `main`) are overridable.

Changing the template's instance properties (for example `GitRef` or user
data) replaces the instance and **loses the database**; code updates go
through `make aws-update` instead. The README says so.

## Verification

- Before any AWS call: lint the template with `cfn-lint` (run through `uvx`,
  nothing installed in the project).
- After deploying: run the existing Playwright test against the live URL.
  This needs one change in `e2e/`: when `E2E_BASE_URL` is set, global setup
  and teardown skip docker compose and the tests use that URL. Exposed as
  `make e2e-aws`, which reads `AppUrl` from the stack. Passing it proves
  HTTPS, the clipboard Share link, join and admit, and WebSocket updates
  through CloudFront.
- The existing `make e2e` and `make test-compose` must still pass.

## Limitations (accepted for a demo)

- **Open to anyone with the URL.** The demo account's credentials are
  compiled into the frontend bundle, so anyone who finds the URL can create
  rooms. Tear the stack down after the demo.
- **Data lives on one disk.** No backups; `make aws-destroy` or an instance
  replacement deletes it.
- **Do not stop/start the instance.** Its public DNS name changes on
  stop/start (not on reboot), which would leave CloudFront pointing at the old
  name. Keep it running or destroy it.
- **No reconnect.** If a WebSocket drops, the frontend does not reconnect;
  the user reloads the page. Pre-existing behavior, unchanged here.
- Postgres uses the fixed `sdip`/`sdip` credentials from
  `docker-compose.yaml`. It is not reachable from outside the compose
  network, so this is acceptable for the demo.

## Cost (approximate, us-east-1, while running)

`t3.small` ~$15/month, public IPv4 ~$3.60/month, 20 GB gp3 ~$1.60/month.
CloudFront's free tier covers demo traffic. Roughly $20/month; nothing left
behind after `make aws-destroy`.

## What the user provides

- AWS CLI credentials with permission to create the resources above
  (CloudFormation, EC2/VPC, IAM role + instance profile, CloudFront, SSM).
  Needed before `make aws-deploy`, not before.

## Out of scope

Custom domain and ACM certificate, RDS, backups, multiple app instances,
CI/CD, authentication changes.
