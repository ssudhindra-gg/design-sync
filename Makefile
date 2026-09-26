.DEFAULT_GOAL := help

.PHONY: help install install-frontend run run-backend run-backend-pg run-frontend start test test-pg compile db-up db-down db-logs db-reset psql

PG_CONTAINER := interview-canvas-db
PG_VOLUME := interview-canvas-pgdata
PG_IMAGE := postgres:16-alpine
PG_URL := postgresql+psycopg://sdip:sdip@localhost:5432/sdip

help:
	@echo "Whiteboard IV backend commands:"
	@echo "  make install        Install backend dependencies with uv"
	@echo "  make run            Start the FastAPI development server (SQLite)"
	@echo "  make run-backend-pg Start the backend against the local Postgres"
	@echo "  make start          Start both backend and frontend development servers"
	@echo "  make test           Run the backend test suite"
	@echo "  make test-pg        Run it again including the Postgres integration tests"
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
