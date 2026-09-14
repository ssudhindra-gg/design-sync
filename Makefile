.DEFAULT_GOAL := help

.PHONY: help install run test compile

help:
	@echo "Whiteboard IV backend commands:"
	@echo "  make install  Install backend dependencies with uv"
	@echo "  make run      Start the FastAPI development server"
	@echo "  make test     Run the backend test suite"
	@echo "  make compile  Compile-check the backend and tests"

install:
	uv sync --directory backend

run:
	uv run --directory backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

test:
	uv run --directory backend pytest

compile:
	uv run --directory backend python -m compileall -q app tests
