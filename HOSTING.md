# Hosting

## Production demo

Design Sync is deployed as a Render Free web service:

- Public URL: <https://design-sync-c6hy.onrender.com>
- Render service: `design-sync`
- Service ID: `srv-db67p6vavr4c739uo070`
- Region: Oregon
- Runtime: Docker
- Plan: Free
- Source repository: <https://github.com/ssudhindra-gg/design-sync>
- Branch: `main`
- Auto-deploy: enabled for new commits on `main`
- Health check: `/openapi.json`

## Deployment configuration

Render uses the repository's [`render.yaml`](render.yaml) Blueprint and [`Dockerfile`](Dockerfile).
The service builds the frontend and serves it from the FastAPI application. The frontend and
backend therefore use the same public origin, including the `/api` routes and WebSocket support.

The Free deployment uses SQLite at `/app/data/whiteboard.db`. The `PORT` is supplied by Render;
the container starts Uvicorn on that port.

## Verification

The deployed service was verified with the following successful responses:

- `GET /` — HTTP 200
- `GET /openapi.json` — HTTP 200
- `GET /docs` — HTTP 200

The live deployment corresponds to commit `8d8b830` (`Add one-click Render deployment link`).

## Redeploying

Push a new commit to `main`; Render will automatically build and deploy it. The service can also
be redeployed manually from the Render dashboard:

<https://dashboard.render.com/web/srv-db67p6vavr4c739uo070>

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
