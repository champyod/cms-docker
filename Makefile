SHELL := /bin/bash

# Detect Docker Compose version (keep fallback)
COMPOSE_CMD := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
# Explicit -f list (auto-merge of docker-compose.override.yml is disabled
# whenever -f is passed, so the override must be included here when present)
COMPOSE_FILES := $(wildcard docker-compose.yml docker-compose.override.yml)
COMPOSE_FLAGS := $(foreach f,$(COMPOSE_FILES),-f $(f))
# Compose v5 does not auto-activate the profiles of depends_on targets, so
# stack bring-up must request dependency profiles explicitly. Stop/clean
# targets keep the stack's own profile so teardown never removes dependencies.
ADMIN_UP_PROFILES   := --profile core --profile admin
CONTEST_UP_PROFILES := --profile core --profile contest

.PHONY: setup audit help env core admin contest worker infra core-stop admin-stop contest-stop contest-down worker-stop infra-stop core-clean admin-clean contest-clean worker-clean infra-clean db-clean clean pull pull-core pull-admin pull-contest pull-worker pull-infra core-img admin-img contest-img worker-img infra-img admin-dev admin-dev-stop contest-down cms-init admin-create prisma-sync lint smoke-test preflight backup db-reset

help:
	@echo "Available commands:"
	@echo "  make env            - Generates .env file from .env.* configuration files"
	@echo "  make core           - Build+start core profile (DEPLOYMENT_TYPE=img → pull+up --no-build, src → up --build)"
	@echo "  make admin          - Build+start admin profile"
	@echo "  make contest        - Build+start contest profile (CONTEST_ID canonical)"
	@echo "  make worker         - Deploy worker fleet (pull/build + per-shard deploy)"
	@echo "  make infra          - Build+start monitor profile (alias: infra → monitor)"
	@echo "  make core-stop      - Stop core profile (down --profile core)"
	@echo "  make admin-stop     - Stop admin profile"
	@echo "  make contest-stop   - Stop contest profile (stop — keeps containers, use contest-down to remove)"
	@echo "  make worker-stop    - Stop worker fleet (all local shards)"
	@echo "  make infra-stop     - Stop monitor profile"
	@echo "  make core-clean     - Down -v core profile"
	@echo "  make admin-clean    - Down -v admin profile"
	@echo "  make contest-clean  - Down -v contest profile"
	@echo "  make worker-clean   - Down -v worker profile"
	@echo "  make infra-clean    - Down -v monitor profile"
	@echo "  make db-clean       - Down -v ALL profiles (full reset)"
	@echo "  make db-reset       - Reset DB (db-clean + core with DEPLOYMENT_TYPE=img override)"
	@echo "  make clean          - Removes .env file"
	@echo "  make pull           - Pull images for all profiles (offline-tolerant, warns on failure)"
	@echo "  make cms-init       - Initialize CMS database"
	@echo "  make admin-create   - Create first superadmin account"
	@echo "  make prisma-sync    - Sync Prisma schema to DB (fail+instruct on missing deps)"
	@echo "  make lint           - Run shellcheck/hadolint/yamllint + compose config validation"
	@echo "  make smoke-test     - Run scripts/__smoke-test.sh"
	@echo "  make preflight      - Run scripts/__preflight.sh"
	@echo "  make backup         - Run cms-monitor backup"
	@echo ""
	@echo "Deprecated aliases (print warning, still work):"
	@echo "  make core-img, admin-img, contest-img, worker-img, infra-img  (deprecated) use 'make <stack>' with DEPLOYMENT_TYPE=img or IMG override"
	@echo "  make pull-core, pull-admin, pull-contest, pull-worker, pull-infra (deprecated) use 'docker compose --profile <stack> pull'"
	@echo "  make admin-dev, admin-dev-stop, contest-down                     (deprecated — contest-down now alias for down)"

# ---------------------------------------------------------------------------
# env — hardened merge flow
# ---------------------------------------------------------------------------
env:
	@echo "[deprecated] 'make env' is now an alias for './cms config sync'"
	@echo "  Edit config.toml, then run: ./cms config sync"
	@bash scripts/__config_sync.sh

# ---------------------------------------------------------------------------
# Canonical profile targets — DEPLOYMENT_TYPE=img → pull + up --no-build, src → up --build
# DEPLOYMENT_TYPE_OVERRIDE env var (set by *-img aliases) takes precedence over files.
# ---------------------------------------------------------------------------
# One-stop orchestrator — see ./cms --help  (env -> core -> init -> admin -> contest -> worker -> monitor -> verify)
.PHONY: setup audit
setup:
	@./cms $(CMS_ARGS)

core:
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling core images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core pull || true; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building core images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core up -d --build; \
	fi
	@echo "Core profile started."

admin:
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling admin images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(ADMIN_UP_PROFILES) pull || true; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(ADMIN_UP_PROFILES) up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building admin images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(ADMIN_UP_PROFILES) up -d --build; \
	fi
	@echo "Admin profile started."

contest:
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling contest images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(CONTEST_UP_PROFILES) pull || true; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(CONTEST_UP_PROFILES) up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building contest images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(CONTEST_UP_PROFILES) up -d --build; \
	fi
	@echo "Contest profile started (CONTEST_ID canonical)."

worker:
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling worker images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile worker pull || true; \
	else \
		echo "DEPLOYMENT_TYPE=src → building worker image..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile worker build; \
	fi; \
	bash scripts/__worker_tui.sh deploy all
	@echo "Worker fleet deployed."

infra:
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling monitor images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile monitor pull || true; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile monitor up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building monitor images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile monitor up -d --build; \
	fi
	@echo "Infra (monitor) profile started."

# ---------------------------------------------------------------------------
# Stop / clean / down variants per stack
# ---------------------------------------------------------------------------
core-stop:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core down

core-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core down -v

# Teardown targets pass dependency profiles plus an explicit service list:
# the core profile is required for project-graph validation, while the
# service list keeps the operation scoped so dependencies are never touched.
ADMIN_SERVICES := admin-panel-next admin-web-server ranking-web-server printing-service
CONTEST_SERVICES := evaluation-service proxy-service contest-web-server nginx-proxy

admin-stop:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile admin down $(ADMIN_SERVICES)

admin-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile admin down -v $(ADMIN_SERVICES)

contest-stop:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile contest stop $(CONTEST_SERVICES)

contest-down:
	@echo "[deprecated] use 'make contest-stop' for stop or 'docker compose --profile core --profile contest down <services>' for down — contest-down runs a scoped down" >&2
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile contest down $(CONTEST_SERVICES)

contest-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile contest down -v $(CONTEST_SERVICES)

worker-stop:
	bash scripts/__worker_tui.sh stop all

worker-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile worker down -v

infra-stop:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile monitor down

infra-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile monitor down -v

db-clean:
	@echo "WARNING: This will delete all database data and reset everything."
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile admin --profile contest --profile worker --profile monitor down -v --remove-orphans

db-reset: db-clean
	@$(MAKE) -e DEPLOYMENT_TYPE_OVERRIDE=img core
	@echo "Database has been reset and services restarted."
	@echo "Please wait ~10 seconds for DB to stabilize, then run: make cms-init"

# ---------------------------------------------------------------------------
# Pull — offline-tolerant but LOUD
# ---------------------------------------------------------------------------
pull:
	@echo "Pulling images for all profiles..."
	@pull_failed=0; \
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile admin --profile contest --profile worker --profile monitor pull || { echo "[WARN] pull failed — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

# ---------------------------------------------------------------------------
# Deprecated aliases — each prints [deprecated] to stderr then delegates
# *-img aliases FORCE image mode via DEPLOYMENT_TYPE_OVERRIDE
# ---------------------------------------------------------------------------
core-img:
	@echo "[deprecated] use 'make core' (DEPLOYMENT_TYPE controls img/src)" >&2
	@$(MAKE) -e DEPLOYMENT_TYPE_OVERRIDE=img core

admin-img:
	@echo "[deprecated] use 'make admin'" >&2
	@$(MAKE) -e DEPLOYMENT_TYPE_OVERRIDE=img admin

contest-img:
	@echo "[deprecated] use 'make contest'" >&2
	@$(MAKE) -e DEPLOYMENT_TYPE_OVERRIDE=img contest

worker-img:
	@echo "[deprecated] use 'make worker'" >&2
	@$(MAKE) -e DEPLOYMENT_TYPE_OVERRIDE=img worker

infra-img:
	@echo "[deprecated] use 'make infra'" >&2
	@$(MAKE) -e DEPLOYMENT_TYPE_OVERRIDE=img infra

pull-core:
	@echo "[deprecated] use 'docker compose --profile core pull'" >&2
	@pull_failed=0; \
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core pull || { echo "[WARN] pull failed for core — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

pull-admin:
	@echo "[deprecated] use 'make pull-admin' (adds core profile for graph validation)" >&2
	@pull_failed=0; \
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile admin pull || { echo "[WARN] pull failed for admin — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

pull-contest:
	@echo "[deprecated] use 'make pull-contest' (adds core profile for graph validation)" >&2
	@pull_failed=0; \
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile contest pull || { echo "[WARN] pull failed for contest — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

pull-worker:
	@echo "[deprecated] use 'docker compose --profile worker pull'" >&2
	@pull_failed=0; \
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile worker pull || { echo "[WARN] pull failed for worker — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

pull-infra:
	@echo "[deprecated] use 'docker compose --profile monitor pull'" >&2
	@pull_failed=0; \
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile monitor pull || { echo "[WARN] pull failed for monitor — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

admin-dev:
	@echo "[deprecated] use 'make admin' (DEPLOYMENT_TYPE=src builds from source)" >&2
	@$(MAKE) admin

admin-dev-stop:
	@echo "[deprecated] use 'make admin-stop'" >&2
	@$(MAKE) admin-stop

# ---------------------------------------------------------------------------
# Infra / DB / admin helpers (unchanged contract)
# ---------------------------------------------------------------------------
cms-init:
	@chmod +x scripts/__cms-db-init.sh && ./scripts/__cms-db-init.sh

prisma-sync:
	@echo "Synchronizing Admin Panel schema (forcing Prisma v6)..."
	@export PATH="$(HOME)/.bun/bin:$(PATH)"; \
	DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ] && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^cms-admin-panel-next$$'; then \
		echo "img mode -> running prisma db push inside cms-admin-panel-next (no host toolchain needed)"; \
		docker exec cms-admin-panel-next sh -lc "cd /repo-root/admin-panel && { ./node_modules/.bin/prisma db push $${PRISMA_ARGS:-} || npx --yes prisma@6 db push $${PRISMA_ARGS:-}; }"; \
		st=$$?; \
		if [ $$st -ne 0 ]; then echo "Schema sync needs confirmation? Re-run with: make prisma-sync PRISMA_ARGS=--accept-data-loss" >&2; fi; \
	elif [ ! -d "admin-panel" ]; then \
		echo "ERROR: admin-panel directory not found. Clone the repository with admin-panel/ or check your working directory." >&2; \
		exit 1; \
	elif command -v bun >/dev/null 2>&1; then \
		cd admin-panel && bun x prisma@6 db push $${PRISMA_ARGS:-}; \
	elif command -v npm >/dev/null 2>&1; then \
		cd admin-panel && npx prisma@6 db push $${PRISMA_ARGS:-}; \
	else \
		echo "ERROR: Neither 'bun' nor 'npm' found in PATH. Install Bun (https://bun.sh) or Node.js/npm, then run: make prisma-sync" >&2; \
		echo "  Fix: curl -fsSL https://bun.sh/install | bash && export PATH=\"\$$HOME/.bun/bin:\$$PATH\"" >&2; \
		exit 1; \
	fi

admin-create:
	@echo "Creating first Superadmin account..."
	@printf "Username: "; read cmd_user; \
	stty -echo; printf "Password: "; read cmd_pass; stty echo; echo; \
	docker exec -it cms-log-service cmsAddAdmin $$cmd_user -p $$cmd_pass

# ---------------------------------------------------------------------------
# New utility targets
# ---------------------------------------------------------------------------
lint:
	@echo "Running lint checks..."
	@if command -v shellcheck >/dev/null 2>&1; then \
		echo "→ shellcheck"; \
		shellcheck scripts/*.sh; \
	else \
		echo "→ shellcheck not found, skipping (install: apt install shellcheck)"; \
	fi
	@if command -v hadolint >/dev/null 2>&1; then \
		echo "→ hadolint"; \
		hadolint Dockerfile docker/*/Dockerfile || hadolint Dockerfile; \
	else \
		echo "→ hadolint not found, skipping (install: https://github.com/hadolint/hadolint)"; \
	fi
	@if command -v yamllint >/dev/null 2>&1; then \
		echo "→ yamllint"; \
		yamllint docker-compose.yml; \
	else \
		echo "→ yamllint not found, skipping (install: pip install yamllint)"; \
	fi
	@if command -v docker >/dev/null 2>&1; then \
		echo "→ compose config validation"; \
		docker compose --env-file .env.core.example -f docker-compose.yml config -q && echo "compose config OK" || { echo "compose config FAILED" >&2; exit 1; }; \
	else \
		echo "→ docker not found, skipping compose validation"; \
	fi

smoke-test:
	@if [ -x scripts/__smoke-test.sh ]; then \
		./scripts/__smoke-test.sh; \
	elif [ -f scripts/__smoke-test.sh ]; then \
		bash scripts/__smoke-test.sh; \
	else \
		echo "ERROR: scripts/__smoke-test.sh not found. Run 'make setup-tools' or create the script first." >&2; \
		exit 1; \
	fi

preflight:
	@if [ -x scripts/__preflight.sh ]; then \
		./scripts/__preflight.sh; \
	elif [ -f scripts/__preflight.sh ]; then \
		bash scripts/__preflight.sh; \
	else \
		echo "ERROR: scripts/__preflight.sh not found." >&2; \
		exit 1; \
	fi

backup:
	@if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^cms-monitor$$"; then \
		docker exec cms-monitor /usr/local/bin/cms-backup.sh; \
	elif [ -x scripts/__backup.sh ]; then \
		echo "cms-monitor not running, running backup script directly..."; \
		./scripts/__backup.sh; \
	else \
		echo "ERROR: cms-monitor not running and scripts/__backup.sh not found or not executable." >&2; \
		exit 1; \
	fi

clean:
	rm -f .env

# ---------------------------------------------------------------------------
# Regression audit — catches stale paths, exec-bit loss, bind-mount perms,
# invalid compose profile graphs, and CLI-contract drift (P1-P5 class bugs).
# ---------------------------------------------------------------------------
.PHONY: audit
audit:
	@python3 scripts/__regression_audit.py
.PHONY: audit
