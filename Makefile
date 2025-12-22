
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
	@# Local Environment
	@if [ -f .env.local ]; then \
		echo "### .env.local ###" >> .env; \
		cat .env.local >> .env; \
		echo "" >> .env; \
	fi
	@# Configuration Files
	@if [ -d config/cms.toml ]; then rm -rf config/cms.toml; fi
	@if [ ! -f config/cms.toml ]; then \
		echo "Generating config/cms.toml from template using envsubst..."; \
		mkdir -p config; \
		if [ -z "$$SECRET_KEY" ]; then \
			export SECRET_KEY=$$(python3 -c 'import secrets; print(secrets.token_hex(16))'); \
			echo "Generated temporary SECRET_KEY for config generation."; \
		fi; \
		set -a; [ -f .env ] && . ./.env; set +a; \
		envsubst < config/templates/cms.sample.toml > config/cms.toml; \
	fi
	@if [ -d config/cms.ranking.toml ]; then rm -rf config/cms.ranking.toml; fi
	@if [ ! -f config/cms.ranking.toml ]; then \
		echo "Generating config/cms.ranking.toml from template using envsubst..."; \
		mkdir -p config; \
		set -a; [ -f .env ] && . ./.env; set +a; \
		envsubst < config/templates/cms.ranking.sample.toml > config/cms.ranking.toml; \
	fi
	@# For remote workers: if CORE_SERVICES_IP is set, it overrides the hostnames in config
	@set -a; [ -f .env ] && . ./.env; set +a; \
	if [ -n "$$CORE_SERVICES_IP" ]; then \
		echo "Configuring for remote worker: directing traffic to $$CORE_SERVICES_IP..."; \
		sed -i "s/@database:/@$$CORE_SERVICES_IP:/g" config/cms.toml; \
		sed -i "s/cms-log-service/$$CORE_SERVICES_IP/g" config/cms.toml; \
		sed -i "s/cms-resource-service/$$CORE_SERVICES_IP/g" config/cms.toml; \
		sed -i "s/cms-scoring-service/$$CORE_SERVICES_IP/g" config/cms.toml; \
		sed -i "s/cms-evaluation-service/$$CORE_SERVICES_IP/g" config/cms.toml; \
		sed -i "s/cms-checker-service/$$CORE_SERVICES_IP/g" config/cms.toml; \
	fi
	@echo "" >> .env
	@echo "# Docker Compose File Configuration" >> .env
	@echo "COMPOSE_FILE=docker-compose.core.yml:docker-compose.admin.yml:docker-compose.contest.yml:docker-compose.worker.yml" >> .env
	@echo ".env file generated. You can now run: docker compose up -d --build"

core:
	docker compose -f docker-compose.core.yml up -d --build

admin:
	docker compose -f docker-compose.admin.yml up -d --build

contest:
	docker compose -f docker-compose.contest.yml up -d --build

worker:
	docker compose -f docker-compose.worker.yml up -d --build

clean:
	rm -f .env
	rm -f config/cms.toml
	rm -f config/cms.ranking.toml
