.DEFAULT_GOAL := help

.PHONY: help install dev build preview docker docker-tunnel docker-config docker-tunnel-config audit check stop clean

help:
	@echo "Usage:"
	@echo "  make install              Install npm dependencies"
	@echo "  make dev                  Start local Vite dev server"
	@echo "  make build                Build production assets"
	@echo "  make preview              Preview built assets"
	@echo "  make docker               Start app with Docker"
	@echo "  make docker-tunnel        Start app with Cloudflare Tunnel"
	@echo "  make docker-config        Validate docker compose config"
	@echo "  make docker-tunnel-config Validate tunnel compose config"
	@echo "  make audit                Run npm audit"
	@echo "  make check                Run build/audit/compose config checks"
	@echo "  make stop                 Stop Docker services"
	@echo "  make clean                Remove build output"

install:
	npm install

dev:
	npm run dev -- --host 0.0.0.0

build:
	npm run build

preview:
	npm run preview

docker:
	docker compose up --build app

docker-tunnel:
	docker compose --profile tunnel up --build

docker-config:
	docker compose config

docker-tunnel-config:
	docker compose --profile tunnel config

audit:
	npm audit

check: build audit docker-config docker-tunnel-config

stop:
	docker compose down

clean:
	rm -rf dist
