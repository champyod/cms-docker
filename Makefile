SHELL := /bin/bash

# Detect Docker Compose version
COMPOSE := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

.PHONY: env help clean core admin contest worker

help:
	@echo "Available commands:"
	@echo "  make env            - Generates .env file from .env.* configuration files"
	@echo "  make {service}      - Deploys service (core, admin, contest, worker, infra)"
	@echo "  make {service}-img  - Deploys service using pre-built images"
	@echo "  make {service}-stop - Stops the specified service"
	@echo "  make {service}-clean- Removes the specified service and its volumes"
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
		echo "Removing directory config/cms.toml (created by Docker volumes)...\"; \
		rm -rf config/cms.toml; \
	fi
	@echo "Refreshing config/cms.toml from sample..."
	@cp config/cms.sample.toml config/cms.toml
	
	@if [ -d config/cms_ranking.toml ]; then \
		echo "Removing directory config/cms_ranking.toml (created by Docker volumes)...\"; \
		rm -rf config/cms_ranking.toml; \
	fi
	@if [ ! -f config/cms_ranking.toml ]; then \
		echo "Copying config/cms_ranking.sample.toml to config/cms_ranking.toml..."; \
		cp config/cms_ranking.sample.toml config/cms_ranking.toml; \
		echo "Setting bind address to 0.0.0.0 in config/cms_ranking.toml..."; \
		sed -i 's/\"127.0.0.1\"/\"0.0.0.0\"/g' config/cms_ranking.toml; \
	fi
	@echo "Generating a secure SECRET_KEY in config/cms.toml..."
	@SECRET=$$(python3 -c 'import secrets; print(secrets.token_hex(16))'); \
	sed -i "s/secret_key = \"8e045a51e4b102ea803c06f92841a1fb\"/secret_key = \"$$SECRET\"/" config/cms.toml
	@# Inject database configuration and service addresses into config/cms.toml...
	@chmod +x scripts/inject_config.sh && ./scripts/inject_config.sh
	@# Generate Multi-Contest Compose
	@if [ -f .env.contest ]; then \
		CONFIG=$$(grep "^CONTESTS_DEPLOY_CONFIG=" .env.contest | cut -d '=' -f2-); \
		TYPE=$$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- || echo "img"); \
		export CONTESTS_DEPLOY_CONFIG="$$CONFIG"; \
		export DEPLOYMENT_TYPE="$$TYPE"; \
		bash scripts/generate-contest-compose.sh; \
	fi
	@echo "" >> .env
	@echo "" >> .env
	@echo "# Docker Compose File Configuration" >> .env
	@echo "COMPOSE_FILE=docker-compose.core.yml:docker-compose.admin.yml:docker-compose.contests.generated.yml:docker-compose.worker.yml:docker-compose.monitor.yml" >> .env
	@echo ".env file generated. You can now run: $(COMPOSE) up -d --build"

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
	@echo "Initializing CMS core database schema..."
	@docker exec -it cms-log-service cmsInitDB
	@echo "Patching database schema for Admin Panel..."
	@docker exec -i cms-database psql -U cmsuser -d cmsdb < scripts/fix_db_schema.sql

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
	@if [ -f docker-compose.contests.generated.yml ] && grep -q "contest-web-server-" docker-compose.contests.generated.yml; then \
		$(COMPOSE) -f docker-compose.contests.generated.yml up -d --build; \
	elif [ -f docker-compose.contest.yml ]; then \
		$(COMPOSE) -f docker-compose.contest.yml up -d --build; \
	else \
		echo "No contests configured. Skip deployment."; \
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
	@if [ -f docker-compose.contests.generated.yml ] && grep -q "contest-web-server-" docker-compose.contests.generated.yml; then \
		$(COMPOSE) -f docker-compose.contests.generated.yml down; \
	elif [ -f docker-compose.contest.yml ]; then \
		$(COMPOSE) -f docker-compose.contest.yml down; \
	fi

contest-clean:
	@if [ -f docker-compose.contests.generated.yml ] && grep -q "contest-web-server-" docker-compose.contests.generated.yml; then \
		$(COMPOSE) -f docker-compose.contests.generated.yml down -v; \
	elif [ -f docker-compose.contest.yml ]; then \
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
	$(COMPOSE) \
		-f docker-compose.core.yml -f docker-compose.core.img.yml \
		-f docker-compose.admin.yml -f docker-compose.admin.img.yml \
		-f docker-compose.contest.yml -f docker-compose.contest.img.yml \
		-f docker-compose.worker.yml -f docker-compose.worker.img.yml \
		-f docker-compose.monitor.yml -f docker-compose.monitor.img.yml \
		pull

core-img:
	$(COMPOSE) -f docker-compose.core.yml -f docker-compose.core.img.yml up -d --no-build
	@echo "Core images started."

admin-img:
	$(COMPOSE) -f docker-compose.admin.yml -f docker-compose.admin.img.yml up -d --no-build

contest-img:
	@if [ -f docker-compose.contests.generated.yml ] && grep -q "contest-web-server-" docker-compose.contests.generated.yml; then \
		$(COMPOSE) -f docker-compose.contests.generated.yml up -d --no-build; \
	elif [ -f docker-compose.contest.yml ]; then \
		$(COMPOSE) -f docker-compose.contest.yml -f docker-compose.contest.img.yml up -d --no-build; \
	else \
		echo "No contests configured. Skip deployment."; \
	fi

worker-img:
	$(COMPOSE) -f docker-compose.worker.yml -f docker-compose.worker.img.yml up -d --no-build

infra-img:
	$(COMPOSE) -f docker-compose.monitor.yml -f docker-compose.monitor.img.yml up -d --no-build

clean:
	rm -f .env