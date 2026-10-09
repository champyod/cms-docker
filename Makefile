SHELL := /bin/bash

# Generated from config.toml by `make env`; gitignored. Pull it into make's own
# environment so a recipe reading $${VAR} sees the same value the stack runs
# with. WHY -include and not include: a fresh checkout has no .env yet, and a
# plain include would make every target fail with "No such file or directory"
# before an operator ever ran `make env`. WHY export: without it the values are
# make variables only, and a shell recipe expands $${VAR} from the environment
# it inherited rather than from make's own tables.
-include .env
export

# Detect Docker Compose version (keep fallback)
COMPOSE_CMD := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
# Explicit -f list (auto-merge of docker-compose.override.yml is disabled
# whenever -f is passed, so the override must be included here when present)
# WHY recursive (= not :=): the `expose` target writes or removes
# docker-compose.expose.yml, so both lists must re-evaluate after it runs.
COMPOSE_FILES = $(wildcard docker-compose.yml docker-compose.override.yml docker-compose.expose.yml)
COMPOSE_FLAGS = $(foreach f,$(COMPOSE_FILES),-f $(f))
# Compose v5 does not auto-activate the profiles of depends_on targets, so
# stack bring-up must request dependency profiles explicitly. Stop/clean
# targets keep the stack's own profile so teardown never removes dependencies.
ADMIN_UP_PROFILES   := --profile core --profile admin
CONTEST_UP_PROFILES := --profile core --profile contest
# WHY monitor carries --profile core: the monitor profile is not just the monitor.
# It also holds cms-scheduler, whose depends_on is `database: service_healthy`, and
# database sits behind profiles: [core]. Compose validates the whole project before
# starting anything and rejects a depends_on whose target is not in the enabled model,
# so `--profile monitor` alone failed with `service "scheduler" depends on undefined
# service "database": invalid compose project` and nothing in the profile ever started.
# That left every monitor setting (BACKUP_MAX_*, thresholds, retention, webhook target)
# frozen at whatever the container was first created with.
MONITOR_UP_PROFILES := --profile core --profile monitor
# The contest front door is its own profile so `make contest` never publishes host
# 80/443. It depends on the contest services, so starting it activates those too.
# WHY --profile admin: nginx-proxy's depends_on lists admin-panel-next and
# ranking-web-server, both gated behind profiles: [admin], and Compose rejects a project
# whose depends_on target is missing from the enabled model. Without admin enabled the
# proxy target failed validation the same way `make infra` did.
PROXY_UP_PROFILES   := --profile core --profile contest --profile proxy --profile admin

# Additive stacks that publish host ports the default COMPOSE_FILES must never
# pull in implicitly. WHY separate: docker-compose.domain.yml and
# docker-compose.waf.yml define services with no `profiles:` key (the
# grader-nginx-proxy service binds host 80/443, grader-certbot and
# grader-redis-rate-limit always start), so folding them into COMPOSE_FILES would
# make `make core` issue certificates and bind 443 on a workstation. These targets
# opt in per-stack.
DOMAIN_COMPOSE_FILES := docker-compose.yml docker-compose.domain.yml
WAF_COMPOSE_FILES    := docker-compose.yml docker-compose.domain.yml docker-compose.waf.yml
DOMAIN_COMPOSE_FLAGS := -f docker-compose.yml -f docker-compose.domain.yml
WAF_COMPOSE_FLAGS    := -f docker-compose.yml -f docker-compose.domain.yml -f docker-compose.waf.yml

# WHY waf carries --profile core only: grader-waf's BACKEND is
# http://grader-nginx-proxy:80, the domain stack's proxy, which has no profile.
# --profile contest stays OUT because it would bring up the whole contest stack,
# which WAF does not front.
WAF_UP_PROFILES      := --profile core --profile waf

.PHONY: expose setup audit help env core admin contest worker infra domain waf cert-timer-install proxy proxy-stop proxy-clean core-stop admin-stop contest-stop contest-down worker-stop infra-stop domain-stop waf-stop core-clean admin-clean contest-clean worker-clean infra-clean domain-clean waf-clean security-agent security-state security-unban db-clean clean pull pull-core pull-admin pull-contest pull-worker pull-infra core-img admin-img contest-img worker-img infra-img admin-dev admin-dev-stop contest-down cms-init admin-create prisma-sync lint test smoke-test preflight backup db-reset

# Regenerate the bind override from .env before a stack comes up. The base compose
# file publishes front-door ports on 0.0.0.0 — except the contest nginx front, which
# publishes none — and this override rebinds them to the configured *_BIND_IP
# addresses, one entry per address, so a comma list expands.
expose:
	@bash scripts/__render_expose.sh

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

# ---------------------------------------------------------------------------
# env — hardened merge flow
# ---------------------------------------------------------------------------
env:
	@echo "[deprecated] 'make env' is now an alias for './cms config sync'"
	@echo "  Edit config.toml, then run: ./cms config sync"
	@bash scripts/__config_sync.sh

# WHY every recreate-capable deploy refreshes the domain proxy: `up -d` replaces
# a container whenever its image or config changed, the replacement is a new
# container on a new address, and grader-nginx-proxy resolved the old address
# when it loaded its upstreams at startup. Without a reload the domain keeps
# proxying a stale IP and 502s until someone runs './cms domain proxy --apply'.
# WHY invoked plainly rather than with '|| true': the script always exits 0 and
# only warns when nginx itself refuses the reload, so a failed reload cannot fail
# the deploy. A script that cannot run at all still does fail the deploy, which
# is what the Rust deploy path does too.
DOMAIN_PROXY_RELOAD := bash scripts/__domain_proxy_reload.sh

# ---------------------------------------------------------------------------
# Canonical profile targets — DEPLOYMENT_TYPE=img → pull + up --no-build, src → up --build
# DEPLOYMENT_TYPE_OVERRIDE env var (set by *-img aliases) takes precedence over files.
# ---------------------------------------------------------------------------
# One-stop orchestrator — see ./cms --help  (env -> core -> init -> admin -> contest -> worker -> monitor -> verify)
.PHONY: setup audit
setup:
	@./cms $(CMS_ARGS)

core: expose
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
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

admin: expose
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
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
	@$(DOMAIN_PROXY_RELOAD)
	@echo "Admin profile started."

contest: expose
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
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
	@bash scripts/__contest_dns_refresh.sh
	@$(DOMAIN_PROXY_RELOAD)
	@echo "Contest profile started (CONTEST_ID canonical)."

worker: expose
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
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

infra: expose
	@DEPLOY_TYPE="$${DEPLOYMENT_TYPE_OVERRIDE:-}"; \
	if [ -z "$$DEPLOY_TYPE" ]; then DEPLOY_TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env 2>/dev/null | cut -d '=' -f2- | cut -d '#' -f1 | tr -d ' \r'); fi; \
	DEPLOY_TYPE=$${DEPLOY_TYPE:-img}; \
	if [ "$$DEPLOY_TYPE" = "img" ]; then \
		echo "DEPLOYMENT_TYPE=img → pulling monitor images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(MONITOR_UP_PROFILES) pull || true; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(MONITOR_UP_PROFILES) up -d --no-build; \
	else \
		echo "DEPLOYMENT_TYPE=src → building monitor images..."; \
		$(COMPOSE_CMD) $(COMPOSE_FLAGS) $(MONITOR_UP_PROFILES) up -d --build; \
	fi
	@echo "Infra (monitor) profile started."

# ---------------------------------------------------------------------------
# Additive stacks — domain + WAF
#
# WHY these are separate targets: both compose files define services with no
# `profiles:` key, so merging them into COMPOSE_FILES (line 7) would make every
# default target bind host 80/443 and start certbot. `./cms domain setup`
# renders config/grader.nginx.conf and requests certificates; these targets are
# what actually serve them.
#
# WHY waf depends on nothing but compose: grader-waf's BACKEND is
# http://grader-nginx-proxy:80, the domain stack's proxy, so the domain stack must
# already be up. The merged project now holds two distinct proxies — the domain
# `grader-nginx-proxy` and the contest `nginx-proxy` (cms-nginx-contest, contest
# profile) — instead of one key that merged two definitions into a single service.
# ---------------------------------------------------------------------------
domain:
	@if [ ! -f config/grader.nginx.conf ]; then \
		echo "config/grader.nginx.conf is missing — run './cms domain setup --apply' first" >&2; \
		exit 1; \
	fi
	$(COMPOSE_CMD) $(DOMAIN_COMPOSE_FLAGS) up -d
	@echo "Domain stack started (grader-nginx-proxy + certbot + redis-rate-limit)."

# Install the certificate-renewal timer from THIS checkout.
# WHY here and not in src/install.py: that installer substitutes @CMS_DIR@ to
# ~/cms, a directory this fork does not have, and its `systemd` verb has no caller
# on the host (the image runs only `install.py venv` and `install.py cms`). The
# shipped pair therefore kept its literal placeholder, which systemd cannot parse,
# so renewal never fired.
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
ADMIN_SERVICES := admin-panel-next admin-web-server ranking-web-server
# redis-rate-limit is here because `make contest` starts it (the login failure
# counters are configured to use it), so stop/down has to take it with them or a
# stale instance outlives the stack. It shares container_name and volume with the
# domain stack's copy, but the two are mutually exclusive by profile.
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
# It publishes nothing on the host until NGINX_BIND_IP is set: the expose override then
# adds 80/443, and until then only the loopback funnel gateways are reachable.
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

# WHY the dependency profile and the service list both appear, as in admin-stop above:
# --profile core is what makes the project graph validate, and the explicit service
# list is what keeps the teardown from reaching into core now that core is enabled.
# Without the list, `down` would act on every service the enabled profiles cover.
MONITOR_SERVICES := monitor scheduler

infra-stop:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile monitor down $(MONITOR_SERVICES)

infra-clean:
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile monitor down -v $(MONITOR_SERVICES)

# Scoped by service name so a domain teardown never reaches into core/contest,
# whose containers share the project. WHY an explicit list: the domain compose
# file has no profiles, so an unscoped `down` would take every service it sees.
DOMAIN_SERVICES := grader-nginx-proxy certbot redis-rate-limit

domain-stop:
	$(COMPOSE_CMD) $(DOMAIN_COMPOSE_FLAGS) down $(DOMAIN_SERVICES)

domain-clean:
	$(COMPOSE_CMD) $(DOMAIN_COMPOSE_FLAGS) down -v $(DOMAIN_SERVICES)

waf-stop:
	$(COMPOSE_CMD) $(WAF_COMPOSE_FLAGS) $(WAF_UP_PROFILES) rm -f -s grader-waf

# The host-side half of the security surface: the panel validates a request and writes
# it under .security-agent/queue; this agent applies it (unban, certificate renewal).
security-agent:
	@bash scripts/__security-agent.sh --install-timer

security-state:
	@bash scripts/__security-agent.sh --state

security-unban:
	@[ -n "$(JAIL)" ] && [ -n "$(IP)" ] || { echo "usage: make security-unban JAIL=<jail> IP=<address>" >&2; exit 2; }
	@bash scripts/__security-agent.sh --unban "$(JAIL)" "$(IP)"

waf-clean:
	$(COMPOSE_CMD) $(WAF_COMPOSE_FLAGS) $(WAF_UP_PROFILES) rm -f -s -v grader-waf

db-clean: expose
	@echo "WARNING: This will delete all database data and reset everything."
	$(COMPOSE_CMD) $(COMPOSE_FLAGS) --profile core --profile admin --profile contest --profile proxy --profile worker --profile monitor down -v --remove-orphans

db-reset: db-clean
	@$(MAKE) -e DEPLOYMENT_TYPE_OVERRIDE=img core
	@echo "Database has been reset and services restarted."
	@echo "Please wait ~10 seconds for DB to stabilize, then run: make cms-init"

# ---------------------------------------------------------------------------
# Pull — offline-tolerant but LOUD
# ---------------------------------------------------------------------------
pull: expose
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

# ---------------------------------------------------------------------------
# Infra / DB / admin helpers (unchanged contract)
# ---------------------------------------------------------------------------
cms-init:
	@chmod +x scripts/__cms-db-init.sh && ./scripts/__cms-db-init.sh

prisma-sync:
	@echo "Synchronizing Admin Panel schema via Prisma Migrate (forcing Prisma v6)..."
	@# WHY: schema sync is a migration operation that needs DDL, so it runs as the owner role — never the runtime DML role.
	@# WHY: both tools are located by scripts/__resolve_tool.sh, which walks every plausible location on both sides of the container boundary — the image, the host bind-mount, a global install, and the package runners the image already carries — and accepts the first candidate that actually runs. A deployment host has no admin-panel/node_modules and an out-of-date image carries no bundled runner, so a miss inside the container must fall through to the host: an inline probe that stops at the first miss leaves the update unable to finish.
	@# WHY: the resolver reports which side it found the tool on, because the database is reached by service name from the container and by loopback from the host.
	@# WHY: a failed migration and a failed seed are both fatal — without the seed the administrators hold groups that grant nothing.
	@# WHY: seeding is system initialisation, so it also runs as the owner; it must work before the runtime roles exist.
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
	echo "Checking if baseline is needed (P3005 mitigation)..."; \
	_need_baseline=0; \
	if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^cms-database$$'; then \
		if docker exec -i -e PGPASSWORD="$$POSTGRES_PASSWORD" cms-database psql -U "$${POSTGRES_USER:-cmsuser}" -d "$${POSTGRES_DB:-cmsdb}" -tAc "SELECT (to_regclass('public._prisma_migrations') IS NULL AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public'))" 2>/dev/null | grep -q "t"; then _need_baseline=1; fi; \
	elif command -v psql >/dev/null 2>&1; then \
		if PGPASSWORD="$$POSTGRES_PASSWORD" psql -h localhost -p "$${POSTGRES_PORT:-5432}" -U "$${POSTGRES_USER:-cmsuser}" -d "$${POSTGRES_DB:-cmsdb}" -tAc "SELECT (to_regclass('public._prisma_migrations') IS NULL AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public'))" 2>/dev/null | grep -q "t"; then _need_baseline=1; fi; \
	fi; \
	if [ "$$_need_baseline" = "1" ]; then \
		echo "Baseline needed — marking 20260910000000_baseline_marker as applied..."; \
		run_tool "$$PRISMA_WHERE" "$$PRISMA_DIR" "$$PRISMA_CMD migrate resolve --applied 20260910000000_baseline_marker --schema=./prisma/schema.prisma"; \
		st=$$?; if [ $$st -ne 0 ]; then echo "Baseline resolve failed — check logs above" >&2; exit $$st; fi; \
	else \
		echo "Baseline not needed (empty DB or already migrated)"; \
	fi; \
	echo "Running prisma migrate deploy (owner credentials)..."; \
	run_tool "$$PRISMA_WHERE" "$$PRISMA_DIR" "$$PRISMA_CMD migrate deploy --schema=./prisma/schema.prisma"; \
	st=$$?; if [ $$st -ne 0 ]; then echo "Migration deploy failed — check logs above" >&2; exit $$st; fi; \
	echo "Seeding permission groups and permissions..."; \
	run_tool "$$SEED_WHERE" "$$SEED_DIR" "$$SEED_CMD prisma/seed-permissions.ts"; \
	st=$$?; if [ $$st -ne 0 ]; then echo "Permission seed failed — admins have no effective permissions until seeding succeeds; check logs above and rerun make prisma-sync." >&2; exit $$st; fi

admin-create:
	@echo "Creating first Superadmin account..."
	@printf "Username: "; read cmd_user; \
	stty -echo; printf "Password: "; read cmd_pass; stty echo; echo; \
	docker exec -it cms-log-service cmsAddAdmin $$cmd_user -p $$cmd_pass

# ---------------------------------------------------------------------------
# New utility targets
# ---------------------------------------------------------------------------
# WHY the file lists below are built by globbing and filtered with [ -f ]/[ -e ]
# rather than handed to the tool raw: `make lint` must stay green on a checkout
# where one of the optional directories (src/tools/, src/docker/) is empty or
# absent, and a tool handed a non-matching path fails before it lints anything.
#
# WHY overlay_base: an overlay stack references services defined in its base,
# so `config -q` only succeeds for the pair. docker-compose.waf.yml declares
# depends_on grader-nginx-proxy, the domain stack's proxy, so its base is
# docker-compose.domain.yml; only docker-compose.tailscale.yml depends on
# contest-web-server, so only its base is docker-compose.yml. A profile-gated
# target also needs its profiles enabled (overlay_profiles) or compose reports
# the gated service as undefined instead of validating it.
# Validating an overlay standalone reports a false failure; this mirrors the
# merge .github/workflows/ci.yml performs.
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
		); \
		declare -A overlay_profiles=( \
			[docker-compose.tailscale.yml]="--profile core --profile contest" \
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
# env -i: the suites stage their own .env, so make's exported .env vars must not leak in.
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
