SHELL := /bin/bash

# Detect Docker Compose version (keep fallback)
COMPOSE_CMD := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
COMPOSE_FILE := docker-compose.yml
# Compose v5 does not auto-activate the profiles of depends_on targets, so
# stack bring-up must request dependency profiles explicitly. Stop/clean
# targets keep the stack's own profile so teardown never removes dependencies.
ADMIN_UP_PROFILES   := --profile core --profile admin
CONTEST_UP_PROFILES := --profile core --profile contest

.PHONY: setup help env core admin contest worker infra core-stop admin-stop contest-stop contest-down worker-stop infra-stop core-clean admin-clean contest-clean worker-clean infra-clean db-clean clean pull pull-core pull-admin pull-contest pull-worker pull-infra core-img admin-img contest-img worker-img infra-img admin-dev admin-dev-stop contest-down cms-init admin-create prisma-sync lint smoke-test preflight backup db-reset

help:
	@echo "Available commands:"
	@echo "  make env            - Generates .env file from .env.* configuration files"
	@echo "  make core           - Build+start core profile (DEPLOYMENT_TYPE=img → pull+up --no-build, src → up --build)"
	@echo "  make admin          - Build+start admin profile"
	@echo "  make contest        - Build+start contest profile (CONTEST_ID canonical)"
	@echo "  make worker         - Build+start worker profile"
	@echo "  make infra          - Build+start monitor profile (alias: infra → monitor)"
	@echo "  make core-stop      - Stop core profile (down --profile core)"
	@echo "  make admin-stop     - Stop admin profile"
	@echo "  make contest-stop   - Stop contest profile (stop — keeps containers, use contest-down to remove)"
	@echo "  make contest-down   - Down contest profile (removes containers/networks)"
	@echo "  make worker-stop    - Stop worker profile"
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
	@echo "Generating .env file..."
	@# --- Template missing env files from examples with secret generation (only NEW files) ---
	@if [ ! -f .env.core ] && [ -f .env.core.example ]; then \
		CORE_PW=$$(openssl rand -base64 24 2>/dev/null | tr -d "/+= " | cut -c1-24); \
		CORE_PW=$${CORE_PW:-cms$$(date +%s)}; \
		sed "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$CORE_PW|" .env.core.example > .env.core; \
		echo "Templated .env.core from .env.core.example (generated POSTGRES_PASSWORD)"; \
	fi
	@if [ ! -f .env.admin ] && [ -f .env.admin.example ]; then \
		RANK_PW=$$(openssl rand -base64 18 2>/dev/null | tr -d "/+= " | cut -c1-18); \
		RANK_PW=$${RANK_PW:-rank$$(date +%s)}; \
		sed "s|^RANKING_PASSWORD=.*|RANKING_PASSWORD=cms_ranking_$$RANK_PW|" .env.admin.example > .env.admin.tmp_rank && mv .env.admin.tmp_rank .env.admin; \
		echo "Templated .env.admin (generated RANKING_PASSWORD)"; \
		if grep -q "CHANGE_ME_GENERATE" .env.admin 2>/dev/null; then \
			NEW_SECRET=$$(openssl rand -hex 32 2>/dev/null || echo "CHANGE_ME_GENERATE_FAILED"); \
			if [ "$$NEW_SECRET" != "CHANGE_ME_GENERATE_FAILED" ]; then \
				sed -i "s/CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32/$$NEW_SECRET/" .env.admin; \
				echo "Generated AUTH_SECRET for new .env.admin"; \
			fi; \
		fi; \
		echo "Templated .env.admin from .env.admin.example"; \
	fi
	@if [ ! -f .env.contest ] && [ -f .env.contest.example ]; then \
		cp .env.contest.example .env.contest; \
		if grep -q "^SECRET_KEY=$$" .env.contest 2>/dev/null || grep -q "^SECRET_KEY= *$$" .env.contest 2>/dev/null; then \
			NEW_SECRET=$$(openssl rand -hex 32 2>/dev/null || echo ""); \
			if [ -n "$$NEW_SECRET" ]; then \
				sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$$NEW_SECRET/" .env.contest; \
				echo "Generated SECRET_KEY for new .env.contest"; \
			fi; \
		fi; \
		echo "Templated .env.contest from .env.contest.example"; \
	fi
	@if [ ! -f .env.worker ] && [ -f .env.worker.example ]; then \
		cp .env.worker.example .env.worker; \
		echo "Templated .env.worker from .env.worker.example"; \
	fi
	@if [ ! -f .env.infra ] && [ -f .env.infra.example ]; then \
		cp .env.infra.example .env.infra; \
		echo "Templated .env.infra from .env.infra.example"; \
	fi
	@echo "# Auto-generated .env file from .env.* files" > .env
	@echo "" >> .env
	@# Core Environment
	@if [ -f .env.core ]; then \
		echo "### .env.core ###" >> .env; \
		cat .env.core >> .env; \
		echo "" >> .env; \
	elif [ -f .env.core.example ]; then \
		echo "### .env.core.example (Template used - please create .env.core) ###" >> .env; \
		cat .env.core.example >> .env; \
		echo "" >> .env; \
		echo "WARNING: Using .env.core.example template"; \
	fi
	@# Admin Environment
	@if [ -f .env.admin ]; then \
		echo "### .env.admin ###" >> .env; \
		cat .env.admin >> .env; \
		echo "" >> .env; \
	elif [ -f .env.admin.example ]; then \
		echo "### .env.admin.example (Template used - please create .env.admin) ###" >> .env; \
		cat .env.admin.example >> .env; \
		echo "" >> .env; \
		echo "WARNING: Using .env.admin.example template"; \
	fi
	@# Contest Environment
	@if [ -f .env.contest ]; then \
		echo "### .env.contest ###" >> .env; \
		cat .env.contest >> .env; \
		echo "" >> .env; \
	elif [ -f .env.contest.example ]; then \
		echo "### .env.contest.example (Template used - please create .env.contest) ###" >> .env; \
		cat .env.contest.example >> .env; \
		echo "" >> .env; \
		echo "WARNING: Using .env.contest.example template"; \
	fi
	@# Worker Environment
	@if [ -f .env.worker ]; then \
		echo "### .env.worker ###" >> .env; \
		cat .env.worker >> .env; \
		echo "" >> .env; \
	elif [ -f .env.worker.example ]; then \
		echo "### .env.worker.example (Template used - please create .env.worker) ###" >> .env; \
		cat .env.worker.example >> .env; \
		echo "" >> .env; \
		echo "WARNING: Using .env.worker.example template"; \
	fi
	@# Infra Environment
	@if [ -f .env.infra ]; then \
		echo "### .env.infra ###" >> .env; \
		cat .env.infra >> .env; \
		echo "" >> .env; \
	elif [ -f .env.infra.example ]; then \
		echo "### .env.infra.example (Template used - please create .env.infra) ###" >> .env; \
		cat .env.infra.example >> .env; \
		echo "" >> .env; \
		echo "WARNING: Using .env.infra.example template"; \
	fi
	@# Local Environment
	@if [ -f .env.local ]; then \
		echo "### .env.local ###" >> .env; \
		cat .env.local >> .env; \
		echo "" >> .env; \
	fi
	@# Legacy map: ACTIVE_CONTEST_ID → CONTEST_ID
	@ACTIVE_VAL=$$(grep "^ACTIVE_CONTEST_ID=" .env.contest 2>/dev/null | cut -d '=' -f2- | tr -d '\r' | xargs); \
	CONTEST_VAL=$$(grep "^CONTEST_ID=" .env 2>/dev/null | grep -v "^#" | cut -d '=' -f2- | tr -d '\r' | xargs); \
	if [ -n "$$ACTIVE_VAL" ] && [ -z "$$CONTEST_VAL" ]; then \
		echo "CONTEST_ID=$$ACTIVE_VAL" >> .env; \
		echo "[deprecated] ACTIVE_CONTEST_ID is deprecated, use CONTEST_ID (mapped $$ACTIVE_VAL → CONTEST_ID)" >&2; \
	fi
	@chmod 600 .env
	@# Generate admin-panel/.env for Prisma and Next.js
	@echo "Generating admin-panel/.env..."
	@if [ -f .env.core ]; then \
		DB_USER=$$(grep "^POSTGRES_USER=" .env.core | cut -d '=' -f2- | tr -d '\r' | xargs); \
		DB_PASS=$$(grep "^POSTGRES_PASSWORD=" .env.core | cut -d '=' -f2- | tr -d '\r' | xargs); \
		DB_NAME=$$(grep "^POSTGRES_DB=" .env.core | cut -d '=' -f2- | tr -d '\r' | xargs); \
		DB_HOST=$$(grep "^POSTGRES_HOST=" .env.core | cut -d '=' -f2- | tr -d '\r' | xargs); \
		DB_PORT=$$(grep "^POSTGRES_PORT=" .env.core | cut -d '=' -f2- | tr -d '\r' | xargs); \
		DB_PORT=$${DB_PORT:-5432}; \
		echo "DATABASE_URL=\"postgresql://$$DB_USER:$$DB_PASS@localhost:$$DB_PORT/$$DB_NAME\"" > admin-panel/.env; \
		if [ -f .env.admin ]; then \
			AUTH_SECRET=$$(grep "^AUTH_SECRET=" .env.admin | cut -d '=' -f2- | tr -d '\r' | xargs); \
			[ -n "$$AUTH_SECRET" ] && echo "AUTH_SECRET=$$AUTH_SECRET" >> admin-panel/.env; \
		fi; \
		chmod 600 admin-panel/.env 2>/dev/null || true; \
	else \
		echo "# Please configure .env.core first" > admin-panel/.env; \
		chmod 600 admin-panel/.env 2>/dev/null || true; \
	fi
	@# Configuration Files
	@if [ -d config/cms.toml ]; then \
		echo "Removing directory config/cms.toml (created by Docker volumes)..."; \
		rm -rf config/cms.toml; \
	fi
	@if [ ! -f config/cms.toml ]; then \
		echo "Refreshing config/cms.toml from sample..."; \
		cp config/cms.sample.toml config/cms.toml; \
	fi
	@echo "Injecting database configuration and service addresses into config/cms.toml..."; \
	chmod +x scripts/__inject_config.sh && ./scripts/__inject_config.sh;
	@if [ -f config/cms_ranking.toml ]; then \
		echo "Updating config/cms_ranking.toml..."; \
		sed -i 's/"127.0.0.1"/"0.0.0.0"/g' config/cms_ranking.toml; \
	fi
	@mkdir -p backups && touch backups/.gitkeep
	@echo "Ensured backups/.gitkeep exists (monitor mount needs host dir)"
	@echo "Hint: if running monitor non-root, ensure ownership: chown 1000:1000 backups (or match container UID)"
	@echo ".env file generated. You can now run: ./cms   (one-stop bootstrap)"
	@if [ -x scripts/__preflight.sh ]; then \
		echo "Running preflight checks..."; \
		./scripts/__preflight.sh; \
	elif [ -f scripts/__preflight.sh ]; then \
		echo "Running preflight checks..."; \
		bash scripts/__preflight.sh; \
	else \
		echo "preflight.sh missing — skipping preflight checks"; \
	fi

# ---------------------------------------------------------------------------
# Canonical profile targets — DEPLOYMENT_TYPE=img → pull + up --no-build, src → up --build
# DEPLOYMENT_TYPE_OVERRIDE env var (set by *-img aliases) takes precedence over files.
# ---------------------------------------------------------------------------
# One-stop orchestrator — see ./cms --help  (env -> core -> init -> admin -> contest -> worker -> monitor -> verify)
.PHONY: setup
setup:
	@./cms $(CMS_ARGS)

core:
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling core images..."; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile core pull || true; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile core up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building core images..."; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile core up -d --build; \
	fi
	@echo "Core profile started."

admin:
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling admin images..."; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) $(ADMIN_UP_PROFILES) pull || true; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) $(ADMIN_UP_PROFILES) up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building admin images..."; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) $(ADMIN_UP_PROFILES) up -d --build; \
	fi
	@echo "Admin profile started."

contest:
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling contest images..."; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) $(CONTEST_UP_PROFILES) pull || true; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) $(CONTEST_UP_PROFILES) up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building contest images..."; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) $(CONTEST_UP_PROFILES) up -d --build; \
	fi
	@echo "Contest profile started (CONTEST_ID canonical)."

worker:
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling worker images..."; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile worker pull || true; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile worker up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building worker images..."; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile worker up -d --build; \
	fi
	@echo "Worker profile started."

infra:
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling monitor images..."; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile monitor pull || true; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile monitor up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building monitor images..."; \
		$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile monitor up -d --build; \
	fi
	@echo "Infra (monitor) profile started."

# ---------------------------------------------------------------------------
# Stop / clean / down variants per stack
# ---------------------------------------------------------------------------
core-stop:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile core down

core-clean:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile core down -v

admin-stop:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile admin down

admin-clean:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile admin down -v

contest-stop:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile contest stop

contest-down:
	@echo "[deprecated] use 'make contest-stop' for stop or 'docker compose --profile contest down' for down — contest-down runs down" >&2
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile contest down

contest-clean:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile contest down -v

worker-stop:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile worker down

worker-clean:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile worker down -v

infra-stop:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile monitor down

infra-clean:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile monitor down -v

db-clean:
	@echo "WARNING: This will delete all database data and reset everything."
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile core --profile admin --profile contest --profile worker --profile monitor down -v --remove-orphans

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
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile core --profile admin --profile contest --profile worker --profile monitor pull || { echo "[WARN] pull failed — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
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
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile core pull || { echo "[WARN] pull failed for core — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

pull-admin:
	@echo "[deprecated] use 'docker compose --profile admin pull'" >&2
	@pull_failed=0; \
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile admin pull || { echo "[WARN] pull failed for admin — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

pull-contest:
	@echo "[deprecated] use 'docker compose --profile contest pull'" >&2
	@pull_failed=0; \
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile contest pull || { echo "[WARN] pull failed for contest — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

pull-worker:
	@echo "[deprecated] use 'docker compose --profile worker pull'" >&2
	@pull_failed=0; \
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile worker pull || { echo "[WARN] pull failed for worker — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

pull-infra:
	@echo "[deprecated] use 'docker compose --profile monitor pull'" >&2
	@pull_failed=0; \
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) --profile monitor pull || { echo "[WARN] pull failed for monitor — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
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
	if [ ! -d "admin-panel" ]; then \
		echo "ERROR: admin-panel directory not found. Clone the repository with admin-panel/ or check your working directory." >&2; \
		exit 1; \
	elif command -v bun >/dev/null 2>&1; then \
		cd admin-panel && bun x prisma@6 db push; \
	elif command -v npm >/dev/null 2>&1; then \
		cd admin-panel && npx prisma@6 db push; \
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
