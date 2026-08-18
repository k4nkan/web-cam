.DEFAULT_GOAL := help

VERCEL_PROJECT ?= web-cam
VERCEL_SCOPE ?= kantas-projects-b4b29432
VERCEL_DEV_ENV_FILE ?= .vercel/.env.development.local
DEV_PID_FILE ?= .dev.pids

.PHONY: help install dev dev-tunnel prepare-dev-env stop

help:
	@echo "Usage:"
	@echo "  make install      Install frontend/backend dependencies"
	@echo "  make dev          Start local frontend and backend"
	@echo "  make dev-tunnel   Start local app with Cloudflare Tunnel"
	@echo "  make stop         Stop local frontend, backend, and Tunnel"

install:
	npm --prefix frontend install
	npm --prefix backend install

prepare-dev-env:
	@npx --yes vercel@latest env pull "$(VERCEL_DEV_ENV_FILE)" --environment=development --yes --project "$(VERCEL_PROJECT)" --scope "$(VERCEL_SCOPE)"
	@if ! grep -Eq '^VERCEL_OIDC_TOKEN=.+$$' "$(VERCEL_DEV_ENV_FILE)" || ! grep -Eq '^BLOB_STORE_ID=.+$$' "$(VERCEL_DEV_ENV_FILE)"; then \
		echo "Blob Store AccessをDevelopmentに接続してから再実行してください。"; \
		exit 1; \
	fi

dev: prepare-dev-env
	@set -a; . "$(VERCEL_DEV_ENV_FILE)"; set +a; \
	dev_shell_pid=$$; \
	trap 'kill $$frontend_pid $$backend_pid 2>/dev/null || true; rm -f "$(DEV_PID_FILE)"' EXIT INT TERM; \
	npm --prefix backend run dev & backend_pid=$$!; \
	npm --prefix frontend run dev -- --host 0.0.0.0 & frontend_pid=$$!; \
	echo "$$dev_shell_pid $$backend_pid $$frontend_pid" > "$(DEV_PID_FILE)"; \
	wait

dev-tunnel: prepare-dev-env
	@set -a; . "$(VERCEL_DEV_ENV_FILE)"; set +a; \
	dev_shell_pid=$$; \
	trap 'kill $$frontend_pid $$backend_pid $$tunnel_pid 2>/dev/null || true; rm -f "$(DEV_PID_FILE)"' EXIT INT TERM; \
	npm --prefix backend run dev & backend_pid=$$!; \
	npm --prefix frontend run dev -- --host 0.0.0.0 & frontend_pid=$$!; \
	cloudflared tunnel --no-autoupdate --url http://127.0.0.1:5173 & tunnel_pid=$$!; \
	echo "$$dev_shell_pid $$backend_pid $$frontend_pid $$tunnel_pid" > "$(DEV_PID_FILE)"; \
	wait

stop:
	@if test -f "$(DEV_PID_FILE)"; then \
		while read -r pid; do kill "$$pid" 2>/dev/null || true; done < "$(DEV_PID_FILE)"; \
		rm -f "$(DEV_PID_FILE)"; \
	fi
	@for port in 3000 5173; do \
		pids=$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null); \
		if test -n "$$pids"; then kill $$pids 2>/dev/null || true; fi; \
	done
