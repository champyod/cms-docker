SHELL := /bin/bash

# Generated from config.toml by `make env`; gitignored.
-include .env
export

# Detect Docker Compose version (keep fallback)
COMPOSE_CMD := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
# Explicit -f list (auto-merge of docker-compose.override.yml is disabled whenever -f is passed, so the override
COMPOSE_FILES = $(wildcard docker-compose.yml docker-compose.override.yml docker-compose.expose.yml)
COMPOSE_FLAGS = $(foreach f,$(COMPOSE_FILES),-f $(f))
# Compose v5 does not auto-activate dependency profiles; bring-up requests them explicitly.
ADMIN_UP_PROFILES   := --profile core --profile admin
CONTEST_UP_PROFILES := --profile core --profile contest
# WHY monitor carries --profile core: the monitor profile is not just the monitor.
MONITOR_UP_PROFILES := --profile core --profile monitor
# The contest front door is its own profile so `make contest` never publishes host 80/443.
PROXY_UP_PROFILES   := --profile core --profile contest --profile proxy --profile admin

# Additive stacks that publish host ports the default COMPOSE_FILES must never pull in implicitly.
DOMAIN_COMPOSE_FILES := docker-compose.yml docker-compose.domain.yml
WAF_COMPOSE_FILES    := docker-compose.yml docker-compose.domain.yml docker-compose.waf.yml
DOMAIN_COMPOSE_FLAGS := -f docker-compose.yml -f docker-compose.domain.yml
WAF_COMPOSE_FLAGS    := -f docker-compose.yml -f docker-compose.domain.yml -f docker-compose.waf.yml
# The composes ./cms config sync derives from the registry: one container per service row and one tailscale
GENERATED_COMPOSE_FLAGS = $(foreach f,$(wildcard docker-compose.*.generated.yml),-f $(f))

# WHY waf carries --profile core only: grader-waf's BACKEND is http://grader-nginx-proxy:80, the domain stack's
WAF_UP_PROFILES      := --profile core --profile waf

.PHONY: expose setup audit help verify-images env core admin contest worker infra domain waf cert-timer-install proxy proxy-stop proxy-clean core-stop admin-stop contest-stop contest-down worker-stop infra-stop domain-stop waf-stop core-clean admin-clean contest-clean worker-clean infra-clean domain-clean waf-clean security-agent security-state security-unban security-up security-off security-check security-dry-run security-verify security-print db-clean clean pull pull-core pull-admin pull-contest pull-worker pull-infra core-img admin-img contest-img worker-img infra-img admin-dev admin-dev-stop contest-down cms-init admin-create prisma-sync lint test smoke-test preflight backup db-reset icons icons-check

# Regenerate the bind override from .env before a stack comes up.
expose:
	@bash scripts/__render_expose.sh

# --------------------------------------------------------------------------- verify-images — run the signature
verify-images:
	@bash scripts/__verify_images.sh $$($(COMPOSE_CMD) $(COMPOSE_FLAGS) \
		--profile core --profile admin --profile contest --profile worker --profile monitor \
		config --images | sort -u)

help:
	@echo "Available commands:"
	@echo "  make env            - Generates .env file from config.toml"
	@echo "  make core           - Build+start core profile (DEPLOYMENT_TYPE=img → pull+up --no-build, src → up --build)"
	@echo "  make admin          - Build+start admin profile"
	@echo "  make contest        - Build+start contest profile (CONTEST_ID canonical)"
	@echo "  make worker         - Deploy worker fleet (pull/build + per-shard deploy)"
	@echo "  make infra          - Build+start monitor profile (alias: infra → monitor)"
	@echo "  make domain         - Start domain stack: grader-nginx-proxy (host 80/443) + certbot + redis-rate-limit"
	@echo "  make waf            - Start WAF profile on top of the domain stack (OWASP CRS, DetectionOnly by default)"
	@echo "  make security-up    - Start the security stack (monitoring + security + security-signal) WITHOUT touching a running container"
	@echo "  make security-dry-run - Print the container set, ports, volumes and image digests it would use; no side effects"
	@echo "  make security-check - Run only the prerequisite gate (token, webhook, loopback ports, prometheus DNS from the panel)"
	@echo "  make security-off   - Stop ONLY the overlay containers (findings/waivers survive in the panel database)"
	@echo "  make proxy          - Start the optional contest nginx front (publishes 80/443 only if NGINX_BIND_IP is set)"
	@echo "  make core-stop      - Stop core profile (down --profile core)"
	@echo "  make admin-stop     - Stop admin profile"
	@echo "  make contest-stop   - Stop contest profile (stop — keeps containers, use contest-down to remove)"
	@echo "  make worker-stop    - Stop worker fleet (all local shards)"
	@echo "  make infra-stop     - Stop monitor profile"
	@echo "  make domain-stop    - Stop domain stack (grader-nginx-proxy, certbot, redis-rate-limit)"
	@echo "  make waf-stop       - Stop the WAF profile (domain stack left running)"
	@echo "  make core-clean     - Down -v core profile"
	@echo "  make admin-clean    - Down -v admin profile"
	@echo "  make contest-clean  - Down -v contest profile"
	@echo "  make worker-clean   - Down -v worker profile"
	@echo "  make infra-clean    - Down -v monitor profile"
	@echo "  make domain-clean   - Down -v domain stack"
	@echo "  make waf-clean      - Down -v WAF profile + domain stack"
	@echo "  make db-clean       - Down -v ALL profiles (full reset)"
	@echo "  make db-reset       - Reset DB (db-clean + core with DEPLOYMENT_TYPE=img override)"
	@echo "  make clean          - Removes .env file"
	@echo "  make pull           - Pull images for all profiles (offline-tolerant, warns on failure)"
	@echo "  make cms-init       - Initialize CMS database"
	@echo "  make admin-create   - Create first superadmin account"
	@echo "  make prisma-sync    - Apply Prisma migrations (migrate deploy) + seed permissions"
	@echo "  make db-migrate     - Migrate the active DB (cms-init + prisma-sync) and verify schema + RLS"
	@echo "  make lint           - Run shellcheck/hadolint/yamllint + compose config validation"
	@echo "  make test           - Run the developer suites in tests/ (needs a checkout, not a stack)"
	@echo "  make smoke-test     - Run scripts/__smoke-test.sh"
	@echo "  make preflight      - Run scripts/__preflight.sh"
	@echo "  make backup         - Run cms-monitor backup"
	@echo ""
	@echo "Deprecated aliases (print warning, still work):"
	@echo "  make core-img, admin-img, contest-img, worker-img, infra-img  (deprecated) use 'make <stack>' — DEPLOYMENT_TYPE already defaults to img"
	@echo "  make pull-core, pull-admin, pull-contest, pull-worker, pull-infra (deprecated) use 'docker compose --profile <stack> pull'"
	@echo "  make admin-dev, admin-dev-stop, contest-down                     (deprecated — contest-down now alias for down)"

# ---------------------------------------------------------------- env — hardened merge flow
env:
	@echo "[deprecated] 'make env' is now an alias for './cms config sync'"
	@echo "  Edit config.toml, then run: ./cms config sync"
	@bash scripts/__config_sync.sh

# WHY: `up -d` replaces a container when its image or config moves, so the proxy reloads after.
DOMAIN_PROXY_RELOAD := bash scripts/__domain_proxy_reload.sh

# ---------------------------------------------------------------- canonical profile targets
.PHONY: setup audit
setup:
	@./cms $(CMS_ARGS)

core: expose
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		bash scripts/__verify_images.sh $$($(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core config --images | sort -u) || { \
			echo "REFUSED: core image signature verification failed (reason above) — nothing was pulled." >&2; \
			exit 1; }; \
		echo "DEPLOYMENT_TYPE=img → pulling core images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core pull || true; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building core images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core up -d --build; \
	fi
	@echo "Core profile started."

admin: expose
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		bash scripts/__verify_images.sh $$($(COMPOSE_CMD) $(COMPOSE_FLAGS) $(ADMIN_UP_PROFILES) config --images | sort -u) || { \
			echo "REFUSED: admin image signature verification failed (reason above) — nothing was pulled." >&2; \
			exit 1; }; \
		echo "DEPLOYMENT_TYPE=img → pulling admin images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(ADMIN_UP_PROFILES) pull || true; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(ADMIN_UP_PROFILES) up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building admin images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(ADMIN_UP_PROFILES) up -d --build; \
	fi
	@# The reconciler writes config/generated as the panel's uid; hand the directory over first.
	@bash -c '. scripts/__lib/common.sh && ensure_generated_dir_perms "$$PWD"' || true
	@# A rebuilt tag never reaches a running overlay; reconcile moves it onto the image its tag names.
	@bash scripts/__security_stack.sh reconcile
	@$(DOMAIN_PROXY_RELOAD)
	@echo "Admin profile started."

contest: expose
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		bash scripts/__verify_images.sh $$($(COMPOSE_CMD) $(COMPOSE_FLAGS) $(CONTEST_UP_PROFILES) config --images | sort -u) || { \
			echo "REFUSED: contest image signature verification failed (reason above) — nothing was pulled." >&2; \
			exit 1; }; \
		echo "DEPLOYMENT_TYPE=img → pulling contest images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(CONTEST_UP_PROFILES) pull || true; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(CONTEST_UP_PROFILES) up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building contest images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(CONTEST_UP_PROFILES) up -d --build; \
	fi
	@bash scripts/__contest_dns_refresh.sh
	@$(DOMAIN_PROXY_RELOAD)
	@echo "Contest profile started (CONTEST_ID canonical)."

worker: expose
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		bash scripts/__verify_images.sh $$($(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile worker config --images | sort -u) || { \
			echo "REFUSED: worker image signature verification failed (reason above) — nothing was pulled." >&2; \
			exit 1; }; \
		echo "DEPLOYMENT_TYPE=img → pulling worker images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile worker pull || true; \
	else \
		echo "DEPLOYMENT_TYPE=src → building worker image..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile worker build; \
	fi; \
	bash scripts/__worker_tui.sh deploy all
	@echo "Worker fleet deployed."

infra: expose
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		bash scripts/__verify_images.sh $$($(COMPOSE_CMD) $(COMPOSE_FLAGS) $(MONITOR_UP_PROFILES) config --images | sort -u) || { \
			echo "REFUSED: infra image signature verification failed (reason above) — nothing was pulled." >&2; \
			exit 1; }; \
		echo "DEPLOYMENT_TYPE=img → pulling monitor images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(MONITOR_UP_PROFILES) pull || true; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(MONITOR_UP_PROFILES) up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building monitor images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(MONITOR_UP_PROFILES) up -d --build; \
	fi
	@echo "Infra (monitor) profile started."

# --------------------------------------------------------------------------- Additive stacks — domain + WAF WHY
domain:
	@if [ ! -f config/grader.nginx.conf ]; then \
		echo "config/grader.nginx.conf is missing — run './cms domain setup --apply' first" >&2; \
		exit 1; \
	fi
	$(COMPOSE_CMD) $(DOMAIN_COMPOSE_FLAGS) up -d
	@echo "Domain stack started (grader-nginx-proxy + certbot + redis-rate-limit)."

# Install the certificate-renewal timer from THIS checkout.
cert-timer-install:
	@bash scripts/__cert_timer.sh --apply

waf:
	@if [ "$${WAF_ENABLED:-0}" != "1" ]; then \
		echo "WAF_ENABLED is not 1 — the WAF is opt-in." >&2; \
		echo "Read from .env (generated). Set WAF_ENABLED = 1 in config.toml ([infra]), run './cms config sync' to regenerate .env, then 'make waf'." >&2; \
		echo "DetectionOnly is the setting to tune against first — see docs/waf-tuning.md before turning it on." >&2; \
		exit 1; \
	fi; \
	if [ ! -f config/grader.nginx.conf ]; then \
		echo "config/grader.nginx.conf is missing — run './cms domain setup --apply' first" >&2; \
		exit 1; \
	fi
	$(COMPOSE_CMD) $(WAF_COMPOSE_FLAGS) $(WAF_UP_PROFILES) up -d
	@echo "WAF profile started. SecRuleEngine is DetectionOnly by default — see docs/waf-tuning.md."

# ---------------------------------------------------------------- stop / clean / down variants per stack
core-stop:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core down

core-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core down -v

# Teardown passes dependency profiles plus an explicit service list; other profiles require core.
ADMIN_SERVICES := admin-panel-next admin-web-server ranking-web-server
# redis-rate-limit is here because `make contest` starts it (the login failure counters are configured to use it)
CONTEST_SERVICES := evaluation-service proxy-service contest-web-server nginx-proxy redis-rate-limit

admin-stop:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile admin down $(ADMIN_SERVICES)

admin-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile admin down -v $(ADMIN_SERVICES)

contest-stop:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile contest --profile proxy --profile admin stop $(CONTEST_SERVICES)

contest-down:
	@echo "[deprecated] use 'make contest-stop' for stop or 'docker compose --profile core --profile contest down <services>' for down — contest-down runs a scoped down" >&2
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile contest --profile proxy --profile admin down $(CONTEST_SERVICES)

contest-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile contest --profile proxy --profile admin down -v $(CONTEST_SERVICES)

# The contest front door has its own target because it is not part of `make contest`.
proxy: expose
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(PROXY_UP_PROFILES) up -d nginx-proxy
	@echo "Contest nginx front started (set NGINX_BIND_IP + NGINX_HTTP_PORT to publish 80/443)."

proxy-stop:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(PROXY_UP_PROFILES) stop nginx-proxy

proxy-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(PROXY_UP_PROFILES) down -v nginx-proxy

worker-stop:
	bash scripts/__worker_tui.sh stop all

worker-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile worker down -v

# WHY the dependency profile and the service list both appear, as in admin-stop above: --profile core is what makes
MONITOR_SERVICES := monitor scheduler

infra-stop:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile monitor down $(MONITOR_SERVICES)

infra-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile monitor down -v $(MONITOR_SERVICES)

# Scoped by service name so a domain teardown never reaches into core/contest, whose containers share the project.
DOMAIN_SERVICES := grader-nginx-proxy certbot redis-rate-limit

domain-stop:
	$(COMPOSE_CMD) $(DOMAIN_COMPOSE_FLAGS) down $(DOMAIN_SERVICES)

domain-clean:
	$(COMPOSE_CMD) $(DOMAIN_COMPOSE_FLAGS) down -v $(DOMAIN_SERVICES)

waf-stop:
	$(COMPOSE_CMD) $(WAF_COMPOSE_FLAGS) $(WAF_UP_PROFILES) rm -f -s grader-waf

# The host-side half of the security surface: the panel validates a request and writes it under
security-agent:
	@bash scripts/__security-agent.sh --install-timer

security-state:
	@bash scripts/__security-agent.sh --state

security-unban:
	@[ -n "$(JAIL)" ] && [ -n "$(IP)" ] || { echo "usage: make security-unban JAIL=<jail> IP=<address>" >&2; exit 2; }
	@bash scripts/__security-agent.sh --unban "$(JAIL)" "$(IP)"

# ---------------------------------------------------------------- security stack — Renovate, Diun, scanner
SECURITY_ARGS ?=

security-check:
	@bash scripts/__security_stack.sh check $(SECURITY_ARGS)

security-dry-run:
	@bash scripts/__security_stack.sh dry-run $(SECURITY_ARGS)

security-up:
	@bash scripts/__security_stack.sh up $(SECURITY_ARGS)

security-verify:
	@bash scripts/__security_stack.sh verify $(SECURITY_ARGS)

security-off:
	@bash scripts/__security_stack.sh off

security-print:
	@bash scripts/__security_stack.sh print $(SECURITY_ARGS)

# Install the fail2ban jails (nginx-http-auth, nginx-limit-req) with the log path resolved to the nginx Docker
fail2ban:
	@bash scripts/__fail2ban-setup.sh --apply

fail2ban-check:
	@bash scripts/__fail2ban-setup.sh --check

waf-clean:
	$(COMPOSE_CMD) $(WAF_COMPOSE_FLAGS) $(WAF_UP_PROFILES) rm -f -s -v grader-waf

db-clean: expose
	@echo "WARNING: This will delete all database data and reset everything."
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile admin --profile contest --profile proxy --profile worker --profile monitor down -v --remove-orphans

db-reset: db-clean
	@$(MAKE) -e DEPLOYMENT_TYPE_OVERRIDE=img core
	@echo "Database has been reset and services restarted."
	@echo "Please wait ~10 seconds for DB to stabilize, then run: make cms-init"

# ---------------------------------------------------------------- pull — offline-tolerant but loud
pull: expose
	@echo "Pulling images for all profiles..."
	@pull_failed=0; \
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile admin --profile contest --profile worker --profile monitor pull || { echo "[WARN] pull failed — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ -n "$(GENERATED_COMPOSE_FLAGS)" ]; then $(COMPOSE_CMD) $(GENERATED_COMPOSE_FLAGS) pull || { echo "[WARN] generated-compose pull failed — continuing with local images (may be stale)" >&2; pull_failed=1; }; fi; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

# The composes ./cms config sync derives from the registry: one container per service row and one tailscale
.PHONY: registry-up
registry-up:
	@if [ -n "$(GENERATED_COMPOSE_FLAGS)" ]; then \
		echo "Starting the services the registry declares..."; \
		$(COMPOSE_CMD) $(GENERATED_COMPOSE_FLAGS) up -d --no-build; \
	else \
		echo "No generated compose to apply — run './cms config sync' first."; \
	fi

# ---------------------------------------------------------------- deprecated aliases
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
	@echo "[deprecated] use 'docker compose $(MONITOR_UP_PROFILES) pull'" >&2
	@pull_failed=0; \
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(MONITOR_UP_PROFILES) pull || { echo "[WARN] pull failed for monitor — continuing with local images (may be stale)" >&2; pull_failed=1; }; \
	if [ "$$pull_failed" -eq 0 ]; then echo "Pull complete."; else echo "Pull finished WITH FAILURES (see above)" >&2; fi

admin-dev:
	@echo "[deprecated] use 'make admin' (DEPLOYMENT_TYPE=src builds from source)" >&2
	@$(MAKE) admin

admin-dev-stop:
	@echo "[deprecated] use 'make admin-stop'" >&2
	@$(MAKE) admin-stop

# ---------------------------------------------------------------- infra / db / admin helpers
cms-init:
	@chmod +x scripts/__cms-db-init.sh && ./scripts/__cms-db-init.sh

prisma-sync:
	@echo "Synchronizing Admin Panel schema via Prisma Migrate (forcing Prisma v6)..."
	@# Schema sync needs DDL, so it runs as the owner role, never the runtime role.
	@bash scripts/__apply_sql.sh --bootstrap-roles || echo "WARN: role bootstrap failed — retry after restart" >&2;
	@set -a; [ -f .env ] && . ./.env; set +a; \
	OWNER_URL_NET="postgresql://$${POSTGRES_USER:-cmsuser}:$${POSTGRES_PASSWORD}@database:5432/$${POSTGRES_DB:-cmsdb}"; \
	OWNER_URL_LOCAL="postgresql://$${POSTGRES_USER:-cmsuser}:$${POSTGRES_PASSWORD}@localhost:5432/$${POSTGRES_DB:-cmsdb}"; \
	export PATH="$$HOME/.bun/bin:$$PATH"; \
	run_tool() { \
		if [ "$$1" = "container" ]; then \
			docker exec -e DATABASE_URL="$$OWNER_URL_NET" cms-admin-panel-next sh -lc "cd $$2 && $$3"; \
		else \
			( cd "$$2" && DATABASE_URL="$$OWNER_URL_LOCAL" $$3 ); \
		fi; \
	}; \
	SEED_RESOLVE="$$(bash scripts/__resolve_tool.sh tsx)" || exit 1; \
	IFS=$$'\t' read -r SEED_WHERE SEED_DIR SEED_CMD <<< "$$SEED_RESOLVE"; \
	echo "  Permission seed: $$SEED_CMD prisma/seed-permissions.ts (cwd $$SEED_DIR, $$SEED_WHERE)"; \
	PRISMA_RESOLVE="$$(bash scripts/__resolve_tool.sh prisma)" || exit 1; \
	IFS=$$'\t' read -r PRISMA_WHERE PRISMA_DIR PRISMA_CMD <<< "$$PRISMA_RESOLVE"; \
	echo "  Prisma CLI: $$PRISMA_CMD (cwd $$PRISMA_DIR, $$PRISMA_WHERE)"; \
	PRISMA_SCHEMA="./prisma/schema.prisma"; \
	if [ "$$PRISMA_WHERE" = "container" ]; then PRISMA_SCHEMA="/repo-root/admin-panel/prisma/schema.prisma"; fi; \
	echo "  Migration history: $$PRISMA_SCHEMA"; \
	echo "Checking if baseline is needed (P3005 mitigation)..."; \
	_need_baseline=0; \
	if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^cms-database$$'; then \
		if PGPASSWORD="$$POSTGRES_PASSWORD" docker exec -i -e PGPASSWORD cms-database psql -U "$${POSTGRES_USER:-cmsuser}" -d "$${POSTGRES_DB:-cmsdb}" -tAc "SELECT (to_regclass('public._prisma_migrations') IS NULL AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public'))" 2>/dev/null | grep -q "t"; then _need_baseline=1; fi; \
	elif command -v psql >/dev/null 2>&1; then \
		if PGPASSWORD="$$POSTGRES_PASSWORD" psql -h localhost -p "$${POSTGRES_PORT:-5432}" -U "$${POSTGRES_USER:-cmsuser}" -d "$${POSTGRES_DB:-cmsdb}" -tAc "SELECT (to_regclass('public._prisma_migrations') IS NULL AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public'))" 2>/dev/null | grep -q "t"; then _need_baseline=1; fi; \
	fi; \
	if [ "$$_need_baseline" = "1" ]; then \
		echo "Baseline needed — marking 20260910000000_baseline_marker as applied..."; \
		run_tool "$$PRISMA_WHERE" "$$PRISMA_DIR" "$$PRISMA_CMD migrate resolve --applied 20260910000000_baseline_marker --schema=$$PRISMA_SCHEMA"; \
		st=$$?; if [ $$st -ne 0 ]; then echo "Baseline resolve failed — check logs above" >&2; exit $$st; fi; \
	else \
		echo "Baseline not needed (empty DB or already migrated)"; \
	fi; \
	echo "Running prisma migrate deploy (owner credentials)..."; \
	run_tool "$$PRISMA_WHERE" "$$PRISMA_DIR" "$$PRISMA_CMD migrate deploy --schema=$$PRISMA_SCHEMA"; \
	st=$$?; if [ $$st -ne 0 ]; then echo "Migration deploy failed — check logs above" >&2; exit $$st; fi; \
	echo "Seeding permission groups and permissions..."; \
	run_tool "$$SEED_WHERE" "$$SEED_DIR" "$$SEED_CMD prisma/seed-permissions.ts"; \
	st=$$?; if [ $$st -ne 0 ]; then echo "Permission seed failed — admins have no effective permissions until seeding succeeds; check logs above and rerun make prisma-sync." >&2; exit $$st; fi

# Migrate the ACTIVE database and verify the result.
db-migrate:
	@chmod +x scripts/__db_migrate.sh && ./scripts/__db_migrate.sh

admin-create:
	@echo "Creating first Superadmin account..."
	@printf "Username: "; read cmd_user; \
	stty -echo; printf "Password: "; read cmd_pass; stty echo; echo; \
	docker exec -it cms-log-service cmsAddAdmin $$cmd_user -p $$cmd_pass

# ---------------------------------------------------------------- new utility targets
lint:
	@echo "Running lint checks..."
	@echo "→ spec parity"
	@bash scripts/__check_spec_parity.sh
	@echo "→ variable coverage"
	@bash scripts/__check_var_coverage.sh
	@echo "→ audit coverage"
	@bash scripts/__check_audit_coverage.sh
	@echo "→ permission parity"
	@bash scripts/__check_permission_parity.sh
	@echo "→ RLS coverage"
	@bash scripts/__check_rls_coverage.sh
	@echo "→ RLS SQL freshness"
	@bash scripts/__generate_rls_sql.sh --check
	@echo "→ lib contract"
	@bash scripts/__check_lib_contract.sh
	@if command -v shellcheck >/dev/null 2>&1; then \
		echo "→ shellcheck"; \
		files=(); \
		for pattern in scripts/*.sh tools/*.sh src/tools/*.sh docker/*.sh src/docker/*.sh tests/*.sh tests/__lib/*.sh tests/fixtures/*; do \
			for f in $$pattern; do \
				[ -f "$$f" ] && files+=("$$f"); \
			done; \
		done; \
		if [ $${#files[@]} -eq 0 ]; then \
			echo "no shell scripts found to lint"; \
		else \
			printf 'linting:\n'; printf '  %s\n' "$${files[@]}"; \
			shellcheck -S error -x "$${files[@]}"; \
		fi; \
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
		yamls=(); \
		for y in .yamllint.yml .github/workflows .github/dependabot.yml docker-compose*.yml docker examples src/.readthedocs.yml; do \
			[ -e "$$y" ] && yamls+=("$$y"); \
		done; \
		if [ $${#yamls[@]} -eq 0 ]; then \
			echo "no yaml files found to lint"; \
		else \
			printf 'linting:\n'; printf '  %s\n' "$${yamls[@]}"; \
			yamllint -c .yamllint.yml "$${yamls[@]}"; \
		fi; \
	else \
		echo "→ yamllint not found, skipping (install: pip install yamllint)"; \
	fi
	@if command -v docker >/dev/null 2>&1; then \
		echo "→ compose config validation"; \
		bash scripts/__config_sync.sh --no-secrets >/dev/null 2>&1 || { echo "config sync failed — using dummy env vars" >&2; }; \
		if [ -f .env ]; then \
			env_args=(--env-file .env); \
		else \
			env_args=(); \
			export POSTGRES_PASSWORD=x AUTH_SECRET=x SECRET_KEY=x CONTEST_ID=1; \
		fi; \
		declare -A overlay_base=( \
			[docker-compose.tailscale.yml]=docker-compose.yml \
			[docker-compose.waf.yml]=docker-compose.domain.yml \
			[docker-compose.security.yml]=docker-compose.yml \
		); \
		declare -A overlay_profiles=( \
			[docker-compose.tailscale.yml]="--profile core --profile contest" \
			[docker-compose.security.yml]="--profile security" \
		); \
		compose_failed=0; \
		for f in docker-compose*.yml docker/docker-compose*.yml; do \
			[ -f "$$f" ] || continue; \
			base="$${overlay_base[$$f]:-}"; \
			if [ -n "$$base" ]; then \
				echo "compose config -- $$base + $$f"; \
				docker compose "$${env_args[@]}" -f "$$base" -f "$$f" $${overlay_profiles[$$f]:-} config -q || { echo "compose config FAILED ($$f)" >&2; compose_failed=1; }; \
			else \
				echo "compose config -- $$f"; \
				docker compose "$${env_args[@]}" -f "$$f" config -q || { echo "compose config FAILED ($$f)" >&2; compose_failed=1; }; \
			fi; \
		done; \
		if [ $$compose_failed -ne 0 ]; then exit 1; fi; \
		echo "compose config OK"; \
	else \
		echo "→ docker not found, skipping compose validation"; \
	fi

# Developer/CI checks: they need a checkout, not a running stack (see preflight/smoke-test).
test:
	@status=0; \
	suites_ran=0; \
	for suite_file in tests/test_*.sh tests/test_*.py; do \
		[ -f "$$suite_file" ] || continue; \
		suites_ran=1; \
		case "$$suite_file" in *.py) interpreter=python3 ;; *) interpreter=bash ;; esac; \
		printf '\n== %s ==\n' "$$suite_file"; \
		env -i PATH="$$PATH" HOME="$${HOME:-/tmp}" TMPDIR="$${TMPDIR:-/tmp}" LC_ALL=C "$$interpreter" "$$suite_file" \
			|| { echo "[FAIL] $$suite_file" >&2; status=1; }; \
	done; \
	if [ "$$suites_ran" -eq 0 ]; then \
		echo "ERROR: no tests/test_*.sh or tests/test_*.py found — run from the repository root." >&2; \
		exit 1; \
	fi; \
	if [ "$$status" -ne 0 ]; then \
		echo ""; echo "FAILED: one or more suites failed" >&2; \
		exit 1; \
	fi; \
	echo ""; echo "all suites passed"

# Regenerate the committed favicons/logos from the single source in brand/.
icons:
	@cd admin-panel && bun run icons

# WHY: the served icons are committed copies of brand/, so drift must fail here.
icons-check:
	@cd admin-panel && bun run icons:check

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
		BACKUP_HOST_DIR="$${BACKUP_HOST_DIR:-$$(pwd)/backups}"; \
		./scripts/__backup.sh --root "$$BACKUP_HOST_DIR"; \
	else \
		echo "ERROR: cms-monitor not running and scripts/__backup.sh not found or not executable." >&2; \
		exit 1; \
	fi

clean:
	rm -f .env

# --------------------------------------------------------------------------- Audit-log durability — verify the
AUDIT_TSX := ./node_modules/.bin/tsx
audit-run = { \
	if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "cms-audit-retention"; then \
		docker exec "cms-audit-retention" $(AUDIT_TSX) scripts/audit-log.ts $(1); \
	elif docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "cms-admin-panel-next"; then \
		docker exec "cms-admin-panel-next" $(AUDIT_TSX) scripts/audit-log.ts $(1); \
	elif command -v bun >/dev/null 2>&1; then \
		cd admin-panel && bun run scripts/audit-log.ts $(1); \
	else \
		echo "ERROR: no audit runner — start the panel (make admin) or install bun." >&2; exit 1; \
	fi; }

# Exits 1 when the chain is broken, 2 when it cannot be checked at all.
.PHONY: audit-verify
audit-verify:
	@$(call audit-run,verify)

# What retention has actually done, and the backlog when it has not run.
.PHONY: audit-status
audit-status:
	@$(call audit-run,status)

# Manual prune. Dry run unless APPLY=1 names the window's backlog as the thing being removed.
.PHONY: audit-retention
audit-retention:
	@$(call audit-run,prune $(if $(filter 1 yes true,$(APPLY)),--apply,))

# Prove a backup's audit archive restores and verifies: needs the dump path, and a scratch database it may create
.PHONY: audit-restore-verify
audit-restore-verify:
	@bash scripts/__audit_restore_proof.sh $(if $(DUMP),--dump "$(DUMP)",)

# The one-time owner separation (CREATE ROLE + ALTER TABLE OWNER).
.PHONY: audit-owner-bootstrap
audit-owner-bootstrap:
	@bash scripts/__audit_owner_bootstrap.sh $(if $(filter 1 yes true,$(CONFIRM)),--yes,)

# ---------------------------------------------------------------- regression audit — stale paths
.PHONY: audit
audit:
	@python3 scripts/__regression_audit.py
.PHONY: audit
