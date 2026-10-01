.DEFAULT_GOAL := help

.PHONY: help install install-frontend build-frontend run run-backend run-backend-pg run-frontend start test test-pg test-compose test-e2e e2e aws-deploy aws-update aws-url aws-destroy aws-oidc e2e-aws infra-check compile db-up db-down db-logs db-reset psql

PG_CONTAINER := interview-canvas-db
PG_VOLUME := interview-canvas-pgdata
PG_IMAGE := postgres:16-alpine
PG_URL := postgresql+psycopg://sdip:sdip@localhost:5432/sdip

# Same-origin by default, since the backend serves the built bundle itself.
FRONTEND_API_URL := /api

help:
	@echo "Whiteboard IV backend commands:"
	@echo "  make install        Install backend dependencies with uv"
	@echo "  make build-frontend Build the frontend the backend serves at /"
	@echo "  make run            Start the FastAPI development server (SQLite)"
	@echo "  make run-backend-pg Start the backend against the local Postgres"
	@echo "  make start          Start both backend and frontend development servers"
	@echo "  make test           Run the backend test suite"
	@echo "  make test-pg        Run it again including the Postgres integration tests"
	@echo "  make test-compose   Run the tests against docker-compose.yaml (builds the image)"
	@echo "  make test-e2e       Run the Playwright browser tests against docker-compose.yaml (alias: make e2e)"
	@echo "  make infra-check    Lint the AWS template and scripts (no AWS access needed)"
	@echo "  make aws-deploy     Deploy to AWS (CloudFormation) and print the HTTPS URL"
	@echo "  make aws-update     Pull GIT_REF on the AWS instance and rebuild, keeping data"
	@echo "  make aws-url        Print the deployed HTTPS URL"
	@echo "  make e2e-aws        Run the Playwright suite against the deployed URL"
	@echo "  make aws-destroy    Delete the AWS stack and everything in it"
	@echo "  make aws-oidc       One-time: create the GitHub OIDC deploy role (admin credentials)"
	@echo "  make compile        Compile-check the backend and tests"
	@echo "  make db-up          Start (or create) the local Postgres container"
	@echo "  make db-down        Stop it, keeping the data volume"
	@echo "  make db-logs        Follow its logs"
	@echo "  make db-reset       Delete the container and its data volume"
	@echo "  make psql           Open a psql shell on it"

install:
	uv sync --directory backend
	$(MAKE) install-frontend

install-frontend:
	npm install --prefix frontend

# MSYS_NO_PATHCONV keeps Git Bash from rewriting a leading-slash value such as
# "/api" into a Windows path (C:/Program Files/Git/api), which Vite would then
# bake into the bundle as the API origin, breaking every request at runtime.
build-frontend: export MSYS_NO_PATHCONV := 1
build-frontend: export VITE_API_URL := $(FRONTEND_API_URL)
build-frontend:
	npm run build --prefix frontend

run:
	$(MAKE) run-backend

run-backend:
	uv run --directory backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

run-frontend:
	npm run dev --prefix frontend

ifeq ($(OS),Windows_NT)
start:
	cmd /c start "Whiteboard Backend" cmd /k "uv run --directory backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
	cmd /c start "Whiteboard Frontend" cmd /k "npm run dev --prefix frontend"
else
start:
	$(MAKE) --no-print-directory run-backend & \
	$(MAKE) --no-print-directory run-frontend & \
	wait
endif

test:
	uv run --directory backend pytest

compile:
	uv run --directory backend python -m compileall -q app tests

# Target-specific exports reach the recipe whatever shell make picked, which
# `set VAR=` / `VAR=` prefixes do not on both cmd and sh.
run-backend-pg: export DATABASE_URL := $(PG_URL)
run-backend-pg: run-backend

test-pg: export TEST_DATABASE_URL := $(PG_URL)
test-pg: test

# Starts its own compose project on port 18000 and removes it afterwards, so a
# stack you already have running is left alone.
test-compose: export COMPOSE_TESTS := 1
test-compose:
	uv run --directory backend pytest tests/compose

# Browser tests on their own compose project and port 18001; see e2e/stack.ts.
test-e2e:
	npm ci --prefix e2e
	npm run install-browsers --prefix e2e
	npm test --prefix e2e

# Must stay .PHONY: the e2e/ directory would otherwise satisfy the target, and
# `make e2e` would report "Nothing to be done" without running anything.
e2e: test-e2e

db-up:
	docker start $(PG_CONTAINER) || docker run -d --name $(PG_CONTAINER) \
		-e POSTGRES_USER=sdip -e POSTGRES_PASSWORD=sdip -e POSTGRES_DB=sdip \
		-p 5432:5432 -v $(PG_VOLUME):/var/lib/postgresql/data $(PG_IMAGE)

db-down:
	docker stop $(PG_CONTAINER)

db-logs:
	docker logs -f $(PG_CONTAINER)

db-reset:
	docker rm -f $(PG_CONTAINER)
	docker volume rm $(PG_VOLUME)

psql:
	docker exec -it $(PG_CONTAINER) psql -U sdip -d sdip

# AWS demo deployment; see infra/deploy.sh. AWS_REGION, STACK_NAME and GIT_REF
# pass through from the environment.
infra-check: export UV_LINK_MODE := copy
infra-check:
	uvx cfn-lint infra/cloudformation.yaml infra/github-oidc.yaml
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

aws-oidc:
	bash infra/deploy.sh oidc

e2e-aws:
	npm ci --prefix e2e
	npm run install-browsers --prefix e2e
	bash infra/deploy.sh e2e
