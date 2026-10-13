# Hosting

## Environments

The infrastructure is split into two independent Render web services. Both are linked to `main`,
but only development auto-deploys; production is updated through the manual promotion workflow.

### Development

- Public URL: <https://design-sync-c6hy.onrender.com>
- Render service: `design-sync`
- Service ID: `srv-db67p6vavr4c739uo070`
- Dashboard: <https://dashboard.render.com/web/srv-db67p6vavr4c739uo070>

### Production

- Public URL: <https://design-sync-production.onrender.com>
- Render service: `design-sync-production`
- Service ID: `srv-db687ip42hec73b9ghg0`
- Dashboard: <https://dashboard.render.com/web/srv-db687ip42hec73b9ghg0>

### Service settings

- Region: Oregon
- Runtime: Docker
- Plan: Free
- Source repository: <https://github.com/ssudhindra-gg/design-sync>
- Health check: `/openapi.json`

The development service tracks `main` with auto-deploy enabled. The production service also uses
`main` as its linked branch, but auto-deploy is disabled so production changes only go through the
manual promotion workflow below.

## Deployment configuration

GitHub Actions builds the repository's [`Dockerfile`](Dockerfile) once, pushes the resulting
`linux/amd64` image to Amazon ECR, and asks Render to pull that image. The production service was
created as an independent clone of the development service. Each service pulls and serves its own
image-backed FastAPI process; the frontend and backend therefore use the same public origin,
including the `/api` routes and WebSocket support.

The original [`render.yaml`](render.yaml) Blueprint describes the initial Docker-built service.
The CI workflows configure the existing Render services as image-backed services on their first
successful run. Keep the Render Blueprint from re-syncing the old `runtime: docker` definition
after that migration, or update the Blueprint with the ECR image URL and registry credential.

The Free deployment uses SQLite at `/app/data/whiteboard.db`. The `PORT` is supplied by Render;
the container starts Uvicorn on that port.

## Verification

Both deployed services were verified with the following successful responses:

- `GET /` — HTTP 200
- `GET /openapi.json` — HTTP 200
- `GET /docs` — HTTP 200

The initial live deployment was verified at commit `8d8b830` (`Add one-click Render deployment link`).
The production copy was verified live at commit `3844500` (`Clarify deployment verification note`).

## Image pipeline

The [`Build image and deploy dev`](.github/workflows/build-and-deploy-dev.yml) workflow runs on
pushes to `main` (and can also be started manually). It has two jobs:

1. **Build** — creates an immutable ECR image tagged as `YYYYMMDD-HHMMSS-shortsha`, for example
   `20260818-163457-83242da`, and pushes it to ECR.
2. **Deploy** — refreshes Render's ECR credential, configures the dev service to pull the image,
   deploys it, and checks `/openapi.json`.

Production remains on its last promoted image until the manual promotion workflow is run. Both
services can also be redeployed manually from their dashboards:

- Development: <https://dashboard.render.com/web/srv-db67p6vavr4c739uo070>
- Production: <https://dashboard.render.com/web/srv-db687ip42hec73b9ghg0>

To validate the Blueprint locally with the Render CLI:

```powershell
render blueprints validate render.yaml
```

## Manual production promotion

The [`Promote dev to production`](.github/workflows/promote-production.yml) GitHub Actions
workflow is started manually from the Actions tab. It:

1. Finds the image currently serving the development service.
2. Refreshes Render's ECR pull credential.
3. Configures production with and deploys that exact image.
4. Waits for Render to report success and checks `/openapi.json`.

Before the first run, configure:

- Repository variable `AWS_ROLE_ARN`: an AWS GitHub OIDC role with ECR push permissions.
- Optional repository variable `AWS_REGION` (defaults to `us-east-1`).
- Optional repository variable `ECR_REPOSITORY` (defaults to `design-sync`).
- Repository secret `RENDER_API_KEY`: a Render API key that can update registry credentials and
  services.
- Optional repository variables `RENDER_OWNER_ID` and `RENDER_REGISTRY_CREDENTIAL_NAME`.

The repeatable AWS bootstrap is [`infra/ecr-github-oidc.yaml`](infra/ecr-github-oidc.yaml). From
an AWS administrator session, deploy it once and copy its `GitHubActionsRoleArn` output into the
`AWS_ROLE_ARN` repository variable:

```powershell
aws cloudformation deploy `
  --stack-name design-sync-ecr-cicd `
  --template-file infra/ecr-github-oidc.yaml `
  --parameter-overrides CreateOidcProvider=true `
  --capabilities CAPABILITY_NAMED_IAM
```

If the account already has a GitHub OIDC provider, pass its ARN and leave
`CreateOidcProvider` at `false`. If it does not, use
`--parameter-overrides CreateOidcProvider=true` instead. The role is restricted to this
repository's `main` branch and the repository's ECR image writes.

The workflows create the ECR repository if needed, enforce immutable image tags, and refresh the
Render AWS ECR credential before every deployment. ECR pull passwords expire after 12 hours, so
the refresh step is required. For an additional approval gate, configure required reviewers for
the GitHub `production` environment.

## Free-tier limitations

This deployment is intended for demos and evaluation:

- The service may spin down after a period of inactivity, so the first request can be slow.
- The container filesystem is ephemeral. SQLite data can be lost after a restart, redeploy, or
  spin-down.
- A persistent production deployment should use a managed database and a paid service or another
  host with durable storage.
