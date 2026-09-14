.DEFAULT_GOAL := help

.PHONY: help install install-frontend run run-backend run-frontend start test compile

help:
	@echo "Whiteboard IV backend commands:"
	@echo "  make install  Install backend dependencies with uv"
	@echo "  make run      Start the FastAPI development server"
	@echo "  make start    Start both backend and frontend development servers"
	@echo "  make test     Run the backend test suite"
	@echo "  make compile  Compile-check the backend and tests"

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
