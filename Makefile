.DEFAULT_GOAL := help

PRODUCTION_API_URL ?= https://web-cam-blue.vercel.app

.PHONY: help install dev dev-tunnel-prod backend backend-install build preview docker docker-tunnel docker-config docker-tunnel-config audit check stop clean

help:
	@echo "Usage:"
	@echo "  make install              Install frontend/backend dependencies"
	@echo "  make dev                  Start the frontend Vite dev server"
	@echo "  make dev-tunnel-prod     Start local frontend with production API and Tunnel"
	@echo "  make backend              Start the local backend API"
	@echo "  make build                Build frontend production assets"
	@echo "  make preview              Preview built frontend assets"
	@echo "  make docker               Start frontend and backend with Docker"
	@echo "  make docker-tunnel        Start app with Cloudflare Tunnel"
	@echo "  make docker-config        Validate docker compose config"
	@echo "  make docker-tunnel-config Validate tunnel compose config"
	@echo "  make audit                Run npm audit"
	@echo "  make check                Run build/audit/compose config checks"
	@echo "  make stop                 Stop Docker services"
	@echo "  make clean                Remove build output"

install:
	npm --prefix frontend install
	npm --prefix backend install

dev:
	npm --prefix frontend run dev -- --host 0.0.0.0

dev-tunnel-prod:
	@trap 'kill $$frontend_pid 2>/dev/null || true' EXIT INT TERM; \
	VITE_API_PROXY_TARGET="$(PRODUCTION_API_URL)" npm --prefix frontend run dev -- --host 0.0.0.0 & \
	frontend_pid=$$!; \
	cloudflared tunnel --no-autoupdate --url http://127.0.0.1:5173

backend:
	npm --prefix backend run dev

backend-install:
	npm --prefix backend install

build:
	npm --prefix frontend run build

preview:
	npm --prefix frontend run preview

docker:
	docker compose up --build

docker-tunnel:
	docker compose --profile tunnel up --build

docker-config:
	docker compose config --quiet

docker-tunnel-config:
	docker compose --profile tunnel config --quiet

audit:
	npm --prefix frontend audit
	npm --prefix backend audit

check: build audit docker-config docker-tunnel-config

stop:
	docker compose down

clean:
	rm -rf frontend/dist
