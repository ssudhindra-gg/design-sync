from __future__ import annotations

import os
from collections.abc import Callable
from urllib.parse import unquote

from fastapi import Request
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter as OTLPHTTPMetricExporter
from opentelemetry.metrics import CallbackOptions, Observation
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import DEPLOYMENT_ENVIRONMENT, SERVICE_NAME, SERVICE_VERSION, Resource


def _environment() -> str:
    configured = os.getenv("DEPLOYMENT_ENVIRONMENT") or os.getenv("ENVIRONMENT")
    if configured:
        return configured

    # Render does not provide a generic environment variable for image-backed
    # services. The service name keeps production metrics distinguishable even
    # when the service has not been given an explicit DEPLOYMENT_ENVIRONMENT.
    render_service = os.getenv("RENDER_SERVICE_NAME", "").lower()
    if "prod" in render_service:
        return "production"
    return "development"


def _deployed_version() -> str:
    return (
        os.getenv("DEPLOYED_VERSION")
        or os.getenv("APP_VERSION")
        or os.getenv("RENDER_GIT_COMMIT")
        or "local"
    )


def _export_interval() -> int:
    try:
        return max(1_000, int(os.getenv("OTEL_METRIC_EXPORT_INTERVAL", "5000")))
    except ValueError:
        return 5_000


def _headers() -> dict[str, str]:
    """Parse the standard OTEL_EXPORTER_OTLP_HEADERS format."""
    raw = os.getenv("OTEL_EXPORTER_OTLP_METRICS_HEADERS") or os.getenv("OTEL_EXPORTER_OTLP_HEADERS", "")
    headers: dict[str, str] = {}
    for item in raw.split(","):
        key, separator, value = item.partition("=")
        if separator and key.strip():
            headers[unquote(key.strip())] = unquote(value.strip())
    return headers


def _metric_exporter(endpoint: str):
    protocol = (
        os.getenv("OTEL_EXPORTER_OTLP_METRICS_PROTOCOL")
        or os.getenv("OTEL_EXPORTER_OTLP_PROTOCOL")
        or "grpc"
    ).lower()
    # Grafana Cloud's OTLP gateway uses OTLP/HTTP. Keep gRPC as the local
    # default, while allowing a cloud endpoint to be configured entirely by
    # environment variables.
    use_http = protocol in {"http/protobuf", "http/json"} or endpoint.startswith("https://")
    headers = _headers()
    if use_http:
        metrics_endpoint = endpoint.rstrip("/")
        if not metrics_endpoint.endswith("/v1/metrics"):
            metrics_endpoint = f"{metrics_endpoint}/v1/metrics"
        return OTLPHTTPMetricExporter(endpoint=metrics_endpoint, headers=headers)
    return OTLPMetricExporter(
        endpoint=endpoint.rstrip("/"),
        insecure=endpoint.startswith("http://"),
        headers=headers,
    )


class ApplicationMetrics:
    """Application-level metrics exported through the local OTLP collector."""

    def __init__(self, active_participant_count: Callable[[], int]) -> None:
        self.environment = _environment()
        self.deployed_version = _deployed_version()
        self.attributes = {
            "environment": self.environment,
            "deployed_version": self.deployed_version,
        }

        resource = Resource.create(
            {
                SERVICE_NAME: os.getenv("OTEL_SERVICE_NAME", "design-sync-backend"),
                SERVICE_VERSION: self.deployed_version,
                DEPLOYMENT_ENVIRONMENT: self.environment,
            }
        )
        readers = []
        endpoint = os.getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        if endpoint:
            readers.append(
                PeriodicExportingMetricReader(
                    _metric_exporter(endpoint),
                    export_interval_millis=_export_interval(),
                )
            )

        self.provider = MeterProvider(resource=resource, metric_readers=readers)
        meter = self.provider.get_meter("design-sync.application")
        self.interview_rooms_created = meter.create_counter(
            "interview_rooms_created",
            unit="{room}",
            description="Number of interview rooms created.",
        )
        self.canvas_elements_created = meter.create_counter(
            "canvas_elements_created",
            unit="{element}",
            description="Number of canvas components created.",
        )
        self.component_creation_failures = meter.create_counter(
            "component_creation_failures",
            unit="{failure}",
            description="Number of rejected canvas component creation writes.",
        )
        self.active_interview_participants = meter.create_observable_gauge(
            "active_interview_participants",
            callbacks=[self._observe_active_participants],
            unit="{participant}",
            description="Admitted participants in non-ended interview rooms.",
        )
        self._active_participant_count = active_participant_count

    def _observe_active_participants(self, _options: CallbackOptions) -> list[Observation]:
        try:
            count = self._active_participant_count()
        except Exception:
            # Telemetry must not affect request handling if the backing store is
            # temporarily unavailable during an export cycle.
            return []
        return [Observation(count, self.attributes)]

    def shutdown(self) -> None:
        self.provider.shutdown()


def get_metrics_dependency(request: Request) -> ApplicationMetrics:
    return request.app.state.application_metrics
