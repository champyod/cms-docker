
.PHONY: env help clean core admin contest worker

help:
	@echo "Available commands:"
	@echo "  make env      - Generates .env file from .env.* configuration files"
	@echo "  make core     - Deploys only CMS Core services"
	@echo "  make admin    - Deploys only CMS Admin services"
	@echo "  make contest  - Deploys only CMS Contest services"
	@echo "  make worker   - Deploys only CMS Worker services"
	@echo "  make clean    - Removes .env file"

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
	@# Generate admin-panel/.env for Prisma
	@echo "Generating admin-panel/.env..."
	@if [ -f .env.core ]; then \
		DB_USER=$$(grep "^POSTGRES_USER=" .env.core | cut -d '=' -f2); \
		DB_PASS=$$(grep "^POSTGRES_PASSWORD=" .env.core | cut -d '=' -f2); \
		DB_NAME=$$(grep "^POSTGRES_DB=" .env.core | cut -d '=' -f2); \
		echo "DATABASE_URL=\"postgresql://$$DB_USER:$$DB_PASS@localhost:5432/$$DB_NAME\"" > admin-panel/.env; \
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
		echo "Copying config/cms.sample.toml to config/cms.toml..."; \
		cp config/cms.sample.toml config/cms.toml; \
		echo "Setting bind address to 0.0.0.0 in config/cms.toml..."; \
		sed -i 's/"127.0.0.1"/"0.0.0.0"/g' config/cms.toml; \
		sed -i 's/\["127.0.0.1"\]/\["0.0.0.0"\]/g' config/cms.toml; \
	fi
	@if [ -d config/cms_ranking.toml ]; then \
		echo "Removing directory config/cms_ranking.toml (created by Docker volumes)..."; \
		rm -rf config/cms_ranking.toml; \
	fi
	@if [ ! -f config/cms_ranking.toml ]; then \
		echo "Copying config/cms_ranking.sample.toml to config/cms_ranking.toml..."; \
		cp config/cms_ranking.sample.toml config/cms_ranking.toml; \
		echo "Setting bind address to 0.0.0.0 in config/cms_ranking.toml..."; \
		sed -i 's/"127.0.0.1"/"0.0.0.0"/g' config/cms_ranking.toml; \
	fi
	@echo "Generating and proactively setting a secure SECRET_KEY in config/cms.toml..."; \
	SECRET=$$(python3 -c 'import secrets; print(secrets.token_hex(16))'); \
	sed -i 's/secret_key = "8e045a51e4b102ea803c06f92841a1fb"/secret_key = "'$${SECRET}'"/' config/cms.toml
	@if grep -q "POSTGRES_PASSWORD=" .env.core; then \
		echo "Injecting database password from .env.core into config/cms.toml..."; \
		DB_PASS=$$(grep "POSTGRES_PASSWORD=" .env.core | cut -d '=' -f2); \
		sed -i "s/your_password_here/$$DB_PASS/" config/cms.toml; \
	fi
	@echo "" >> .env
	@echo "# Docker Compose File Configuration" >> .env
	@echo "COMPOSE_FILE=docker-compose.core.yml:docker-compose.admin.yml:docker-compose.contest.yml:docker-compose.worker.yml" >> .env
	@echo ".env file generated. You can now run: docker compose up -d --build"

core:
	docker compose -f docker-compose.core.yml up -d database
	docker compose -f docker-compose.core.yml build log-service
	docker compose -f docker-compose.core.yml build resource-service
	docker compose -f docker-compose.core.yml build scoring-service
	docker compose -f docker-compose.core.yml build evaluation-service
	docker compose -f docker-compose.core.yml build proxy-service
	docker compose -f docker-compose.core.yml build checker-service
	docker compose -f docker-compose.core.yml up -d
	@echo "Services started. Use 'make db-reset' for a first-time setup or 'make cms-init' to just initialize the database."

cms-init:
	@echo "Initializing CMS core database schema..."
	@docker exec -it cms-log-service cmsInitDB
	@$(MAKE) prisma-sync

prisma-sync:
	@echo "Synchronizing Admin Panel schema (forcing Prisma v6)..."
	@if [ -d "admin-panel" ] && command -v bun >/dev/null 2>&1; then \
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
	docker compose -f docker-compose.core.yml -f docker-compose.admin.yml -f docker-compose.contest.yml -f docker-compose.worker.yml down -v

db-reset: db-clean core-img
	@echo "Database has been reset and services restarted."
	@echo "Please wait ~10 seconds for DB to stabilize, then run: make cms-init"

admin:
	docker compose -f docker-compose.admin.yml up -d --build

contest:
	docker compose -f docker-compose.contest.yml up -d --build

worker:
	docker compose -f docker-compose.worker.yml up -d --build

pull:
	docker compose -f docker-compose.core.yml -f docker-compose.core.img.yml pull
	docker compose -f docker-compose.admin.yml -f docker-compose.admin.img.yml pull
	docker compose -f docker-compose.contest.yml -f docker-compose.contest.img.yml pull
	docker compose -f docker-compose.worker.yml -f docker-compose.worker.img.yml pull

core-img:
	docker compose -f docker-compose.core.yml -f docker-compose.core.img.yml up -d --no-build
	@echo "Core images started."

admin-img:
	docker compose -f docker-compose.admin.yml -f docker-compose.admin.img.yml up -d --no-build

contest-img:
	docker compose -f docker-compose.contest.yml -f docker-compose.contest.img.yml up -d --no-build

worker-img:
	docker compose -f docker-compose.worker.yml -f docker-compose.worker.img.yml up -d --no-build

clean:
	rm -f .env
