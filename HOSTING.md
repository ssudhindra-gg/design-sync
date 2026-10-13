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

Render uses the repository's [`render.yaml`](render.yaml) Blueprint and [`Dockerfile`](Dockerfile)
for the service configuration. The production service was created as an independent clone of the
development service. Each service builds the frontend and serves it from its own FastAPI process;
the frontend and backend therefore use the same public origin, including the `/api` routes and
WebSocket support.

The Free deployment uses SQLite at `/app/data/whiteboard.db`. The `PORT` is supplied by Render;
the container starts Uvicorn on that port.

## Verification

Both deployed services were verified with the following successful responses:

- `GET /` — HTTP 200
- `GET /openapi.json` — HTTP 200
- `GET /docs` — HTTP 200

The initial live deployment was verified at commit `8d8b830` (`Add one-click Render deployment link`).
The production copy was verified live at commit `3844500` (`Clarify deployment verification note`).

## Redeploying

Push a new commit to `main`; Render automatically builds and deploys the development service.
Production remains on its last promoted commit until the workflow is run. Both services can also
be redeployed manually from their dashboards:

- Development: <https://dashboard.render.com/web/srv-db67p6vavr4c739uo070>
- Production: <https://dashboard.render.com/web/srv-db687ip42hec73b9ghg0>

To validate the Blueprint locally with the Render CLI:

```powershell
render blueprints validate render.yaml
```

## Manual production promotion

The [`Promote dev to production`](.github/workflows/promote-production.yml) GitHub Actions
workflow is started manually from the Actions tab. It:

1. Finds the latest live deployment on the development service.
2. Optionally accepts a specific live dev commit SHA.
3. Deploys that exact commit to the production service.
4. Waits for Render to report success and checks `/openapi.json`.

Before the first run, add a repository Actions secret named `RENDER_API_KEY`. Create the key in
Render Account Settings and keep it out of the repository. The workflow already contains the two
Render service IDs. For an additional approval gate, configure required reviewers for the GitHub
`production` environment.

## Free-tier limitations

This deployment is intended for demos and evaluation:

- The service may spin down after a period of inactivity, so the first request can be slow.
- The container filesystem is ephemeral. SQLite data can be lost after a restart, redeploy, or
  spin-down.
- A persistent production deployment should use a managed database and a paid service or another
  host with durable storage.
