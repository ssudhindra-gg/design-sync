# Hosting

## Environments

The infrastructure is split into two independent Render web services. Both currently deploy
from `main`, so a commit pushed to `main` is automatically deployed to both environments.

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

### Shared service settings

- Region: Oregon
- Runtime: Docker
- Plan: Free
- Source repository: <https://github.com/ssudhindra-gg/design-sync>
- Branch: `main`
- Auto-deploy: enabled for new commits on `main`
- Health check: `/openapi.json`

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

Push a new commit to `main`; Render will automatically build and deploy both services. They can
also be redeployed manually from their dashboards:

- Development: <https://dashboard.render.com/web/srv-db67p6vavr4c739uo070>
- Production: <https://dashboard.render.com/web/srv-db687ip42hec73b9ghg0>

To validate the Blueprint locally with the Render CLI:

```powershell
render blueprints validate render.yaml
```

## Free-tier limitations

This deployment is intended for demos and evaluation:

- The service may spin down after a period of inactivity, so the first request can be slow.
- The container filesystem is ephemeral. SQLite data can be lost after a restart, redeploy, or
  spin-down.
- A persistent production deployment should use a managed database and a paid service or another
  host with durable storage.
