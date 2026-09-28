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
