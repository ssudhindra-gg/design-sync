# Design Sync observability

This directory is a separate Docker Compose project for local observability. It does not share a Compose file, network, or lifecycle with the application stack in the repository root.

For cloud use, the recommended separate observability stack is Grafana Cloud
Free. It avoids trying to run five stateful containers on Render Free while
keeping the application and observability lifecycles independent.

## Included services

- OpenTelemetry Collector: receives OTLP traces, metrics, and logs on ports `4317` (gRPC) and `4318` (HTTP).
- Prometheus: stores metrics and scrapes the Collector's own metrics plus its Prometheus exporter.
- Loki: stores logs forwarded by the Collector.
- Tempo: stores traces forwarded by the Collector.
- Grafana: provides a UI with Prometheus, Loki, and Tempo datasources provisioned automatically.

The backend emits these application metrics through OTLP. Each measurement includes
`environment` and `deployed_version` attributes:

- `interview_rooms_created_total`
- `active_interview_participants`
- `canvas_elements_created_total`
- `component_creation_failures_total`

## Start

From the repository root:

```powershell
docker compose -f observability/docker-compose.yaml up -d
```

Check service status and logs:

```powershell
docker compose -f observability/docker-compose.yaml ps
docker compose -f observability/docker-compose.yaml logs -f otel-collector
```

Open the UIs:

- Grafana: <http://localhost:3000> (`admin` / `admin` by default)
- Prometheus: <http://localhost:9090>
- Loki readiness: <http://localhost:3100/ready>
- Tempo: <http://localhost:3200>

Grafana loads the **Design Sync application metrics** dashboard automatically.
Use its `Environment` and `Deployed version` dropdowns to filter all four panels.

Set `GRAFANA_ADMIN_PASSWORD` before starting the project to use a different Grafana password. The default is intended only for local development.

## Lowest-cost cloud deployment: Grafana Cloud Free

Grafana Cloud Free is the recommended cloud target for this project. It is
always free for small projects and includes managed Grafana, metrics, logs, and
traces with usage limits and 14-day retention. This avoids an always-on VM,
disks, TLS, backups, and operating-system maintenance.

The application currently emits the four application metrics listed above. The
same OTLP connection can later carry application logs and traces when those
signals are instrumented.

### Configure the cloud stack

1. Create a Grafana Cloud Free stack and open its **OpenTelemetry** connection
   instructions.
2. Create a Cloud Access Policy/token with `metrics:write`, `logs:write`, and
   `traces:write` scopes. Keep the resulting Basic Authorization header secret.
3. Add these GitHub repository settings:

   - Variable: `GRAFANA_CLOUD_OTLP_ENDPOINT` — the HTTPS OTLP base endpoint
     ending in `/otlp`.
   - Secret: `GRAFANA_CLOUD_OTLP_HEADERS` — for example,
     `Authorization=Basic%20<base64-credentials>`.

4. Run the manual **Connect Render environments to observability** workflow.
   It configures and redeploys both `development` and `production`, using
   `http/protobuf` over HTTPS and preserving the existing application image.
5. Import `grafana/dashboards/application-metrics.json` into the Grafana Cloud
   stack. Select the Prometheus-compatible Grafana Cloud metrics datasource
   when prompted, then use the dashboard's environment and deployed-version
   filters.

The workflow updates only the required direct Render variables. The OTLP
headers never enter the repository or workflow logs.

## Cloud cost comparison

| Option | Expected monthly cost | Fit for this project |
| --- | ---: | --- |
| Grafana Cloud Free | $0 | Best overall: managed metrics, logs, traces, and Grafana |
| One small self-hosted VM | About $12/month for 2 GB on DigitalOcean, before backups/domains | Lowest-cost self-hosted option; requires hardening and maintenance |
| AWS Lightsail nano | $5/month, 0.5 GB RAM | Too small for the complete Prometheus/Loki/Tempo/Grafana stack |
| Render Free services | $0 compute | Not suitable: one service per container, idle spin-down, and ephemeral storage |

If self-hosting is required later, deploy this Compose project on a dedicated
2–4 GB VM with HTTPS and authentication. Keep it as its own infrastructure
stack and point both Render services at its authenticated OTLP/HTTP endpoint.

## Connect an application

Applications running directly on the host can send OTLP to:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

For OTLP/HTTP, use port `4318` instead. Because this is intentionally a separate Compose project, an application container in the root Compose project should use `host.docker.internal` rather than a service name:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4317
```

The root application Compose file configures the backend to send metrics to this
collector through `host.docker.internal`. Applications started outside Docker
must set `OTEL_EXPORTER_OTLP_ENDPOINT` themselves.

## Stop and reset

Stop the services while preserving data:

```powershell
docker compose -f observability/docker-compose.yaml down
```

Stop the services and remove this project's stored metrics, logs, traces, and Grafana state:

```powershell
docker compose -f observability/docker-compose.yaml down -v
```
