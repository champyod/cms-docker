SHELL := /bin/bash

# Detect Docker Compose version
COMPOSE := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

.PHONY: env help clean core admin contest worker pull pull-core pull-admin pull-contest pull-worker pull-infra

help:
	@echo "Available commands:"
	@echo "  make env            - Generates .env file from .env.* configuration files"
	@echo "  make {service}      - Deploys service (core, admin, contest, worker, infra)"
	@echo "  make {service}-img  - Deploys service using pre-built images"
	@echo "  make {service}-stop - Stops the specified service"
	@echo "  make {service}-clean- Removes the specified service and its volumes"
	@echo "  make pull-{service} - Pull only selected stack images"
	@echo "  make db-clean       - Removes ALL services and volumes (Full Reset)"
	@echo "  make clean          - Removes .env file"


env:
	@echo "Generating .env file..."
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
	@# Generate admin-panel/.env for Prisma
	@echo "Generating admin-panel/.env..."
	@if [ -f .env.core ]; then \
		DB_USER=$$(grep "^POSTGRES_USER=" .env.core | cut -d '=' -f2-); \
		DB_PASS=$$(grep "^POSTGRES_PASSWORD=" .env.core | cut -d '=' -f2-); \
		DB_NAME=$$(grep "^POSTGRES_DB=" .env.core | cut -d '=' -f2-); \
		DB_HOST=$$(grep "^POSTGRES_HOST=" .env.core | cut -d '=' -f2-); \
		DB_PORT=$$(grep "^POSTGRES_PORT=" .env.core | cut -d '=' -f2-); \
		echo "DATABASE_URL=\"postgresql://$$DB_USER:$$DB_PASS@localhost:$$DB_PORT/$$DB_NAME\"" > admin-panel/.env; \
	else \
		echo "# Please configure .env.core first" > admin-panel/.env; \
	fi
	@# Local Environment
	@if [ -f .env.local ]; then \
		echo "### .env.local ###" >> .env; \
		cat .env.local >> .env; \
		echo "" >> .env; \
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
	chmod +x scripts/inject_config.sh && ./scripts/inject_config.sh; \
	
	@if [ -f config/cms_ranking.toml ]; then \
		echo "Updating config/cms_ranking.toml..."; \
		sed -i 's/\"127.0.0.1\"/\"0.0.0.0\"/g' config/cms_ranking.toml; \
	fi
	@echo "Generating per-contest docker-compose configuration..."
	@chmod +x scripts/generate_contest_compose.py && python3 scripts/generate_contest_compose.py
	@echo ".env file generated. You can now run: ./scripts/setup.sh"

core:
	$(COMPOSE) -f docker-compose.core.yml up -d database
	$(COMPOSE) -f docker-compose.core.yml build log-service
	$(COMPOSE) -f docker-compose.core.yml build resource-service
	$(COMPOSE) -f docker-compose.core.yml build scoring-service
	$(COMPOSE) -f docker-compose.core.yml build evaluation-service
	$(COMPOSE) -f docker-compose.core.yml build proxy-service
	$(COMPOSE) -f docker-compose.core.yml build checker-service
	$(COMPOSE) -f docker-compose.core.yml up -d
	@echo "Services started. Use 'make db-reset' for a first-time setup or 'make cms-init' to just initialize the database."

cms-init:
	@chmod +x scripts/cms-db-init.sh && ./scripts/cms-db-init.sh

prisma-sync:
	@echo "Synchronizing Admin Panel schema (forcing Prisma v6)..."
	@export PATH="$(HOME)/.bun/bin:$(PATH)"; \
	if [ -d "admin-panel" ] && command -v bun >/dev/null 2>&1; then \
		cd admin-panel && bun x prisma@6 db push; \
	elif [ -d "admin-panel" ] && command -v npm >/dev/null 2>&1; then \
		cd admin-panel && npx prisma@6 db push; \
	else \
		echo "Skipping Prisma sync: admin-panel not found or no bun/npm available."; \
	fi

admin-create:
	@echo "Creating first Superadmin account..."
	@printf "Username: "; read cmd_user; \
	stty -echo; printf "Password: "; read cmd_pass; stty echo; echo; \
	docker exec -it cms-log-service cmsAddAdmin $$cmd_user -p $$cmd_pass

db-clean:
	@echo "WARNING: This will delete all database data and reset everything."
	$(COMPOSE) -f docker-compose.core.yml -f docker-compose.admin.yml -f docker-compose.contest.yml -f docker-compose.worker.yml -f docker-compose.monitor.yml down -v --remove-orphans

db-reset: db-clean core-img
	@echo "Database has been reset and services restarted."
	@echo "Please wait ~10 seconds for DB to stabilize, then run: make cms-init"

admin:
	$(COMPOSE) -f docker-compose.admin.yml up -d --build

contest:
	@if [ -f docker-compose.contests.generated.yml ] && grep -q "cms-contest-web-server-" docker-compose.contests.generated.yml; then \
		$(COMPOSE) -f docker-compose.contests.generated.yml up -d --build; \
	else \
		$(COMPOSE) -f docker-compose.contest.yml up -d --build; \
	fi

worker:
	$(COMPOSE) -f docker-compose.worker.yml up -d --build

core-stop:
	$(COMPOSE) -f docker-compose.core.yml down

core-clean:
	$(COMPOSE) -f docker-compose.core.yml down -v

admin-stop:
	$(COMPOSE) -f docker-compose.admin.yml down

admin-clean:
	$(COMPOSE) -f docker-compose.admin.yml down -v

contest-stop:
	@if [ -f docker-compose.contests.generated.yml ] && grep -q "cms-contest-web-server-" docker-compose.contests.generated.yml; then \
		$(COMPOSE) -f docker-compose.contests.generated.yml stop; \
	else \
		$(COMPOSE) -f docker-compose.contest.yml stop; \
	fi

contest-clean:
	@if [ -f docker-compose.contests.generated.yml ] && grep -q "cms-contest-web-server-" docker-compose.contests.generated.yml; then \
		$(COMPOSE) -f docker-compose.contests.generated.yml down -v; \
	else \
		$(COMPOSE) -f docker-compose.contest.yml down -v; \
	fi

worker-stop:
	$(COMPOSE) -f docker-compose.worker.yml down

worker-clean:
	$(COMPOSE) -f docker-compose.worker.yml down -v

infra:
	$(COMPOSE) -f docker-compose.monitor.yml up -d --build

infra-stop:
	$(COMPOSE) -f docker-compose.monitor.yml down

infra-clean:
	$(COMPOSE) -f docker-compose.monitor.yml down -v

pull:
	@echo "Pulling core, admin, worker, and monitor images..."
	@$(MAKE) pull-core
	@$(MAKE) pull-admin
	@$(MAKE) pull-contest
	@$(MAKE) pull-worker
	@$(MAKE) pull-infra
	@echo "Pull complete."

pull-core:
	@echo "Pulling core images..."
	@$(COMPOSE) -f docker-compose.core.yml -f docker-compose.core.img.yml pull || true

pull-admin:
	@echo "Pulling admin images..."
	@$(COMPOSE) -f docker-compose.admin.yml -f docker-compose.admin.img.yml pull || true

pull-contest:
	@echo "Pulling contest images..."
	@if [ -f docker-compose.contests.generated.yml ] && grep -q "cms-contest-web-server-" docker-compose.contests.generated.yml; then \
		$(COMPOSE) -f docker-compose.contests.generated.yml pull || true; \
	else \
		$(COMPOSE) -f docker-compose.contest.yml -f docker-compose.contest.img.yml pull || true; \
	fi

pull-worker:
	@echo "Pulling worker images..."
	@$(COMPOSE) -f docker-compose.worker.yml -f docker-compose.worker.img.yml pull || true

pull-infra:
	@echo "Pulling infra images..."
	@$(COMPOSE) -f docker-compose.monitor.yml -f docker-compose.monitor.img.yml pull || true

core-img:
	$(COMPOSE) -f docker-compose.core.yml -f docker-compose.core.img.yml up -d --no-build
	@echo "Core images started."

admin-img:
	$(COMPOSE) -f docker-compose.admin.yml -f docker-compose.admin.img.yml up -d --no-build

contest-img:
	@if [ -f docker-compose.contests.generated.yml ] && grep -q "cms-contest-web-server-" docker-compose.contests.generated.yml; then \
		$(COMPOSE) -f docker-compose.contests.generated.yml up -d --no-build; \
	else \
		$(COMPOSE) -f docker-compose.contest.yml up -d --no-build; \
	fi

contest-down:
	@if [ -f docker-compose.contests.generated.yml ] && grep -q "cms-contest-web-server-" docker-compose.contests.generated.yml; then \
		$(COMPOSE) -f docker-compose.contests.generated.yml down; \
	else \
		$(COMPOSE) -f docker-compose.contest.yml down; \
	fi

worker-img:
	$(COMPOSE) -f docker-compose.worker.yml -f docker-compose.worker.img.yml up -d --no-build

infra-img:
	$(COMPOSE) -f docker-compose.monitor.yml -f docker-compose.monitor.img.yml up -d --no-build

clean:
	rm -f .env
