
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
	@if [ -d config/cms.conf ]; then \
		echo "Removing directory config/cms.conf (created by Docker volumes)..."; \
		rm -rf config/cms.conf; \
	fi
	@if [ ! -f config/cms.conf ]; then \
		echo "Copying config/cms.conf.sample to config/cms.conf..."; \
		cp config/cms.conf.sample config/cms.conf; \
	fi
	@if [ -d config/cms.ranking.conf ]; then \
		echo "Removing directory config/cms.ranking.conf (created by Docker volumes)..."; \
		rm -rf config/cms.ranking.conf; \
	fi
	@if [ ! -f config/cms.ranking.conf ]; then \
		echo "Copying config/cms.ranking.conf.sample to config/cms.ranking.conf..."; \
		cp config/cms.ranking.conf.sample config/cms.ranking.conf; \
	fi
	@echo "Generating and proactively setting a secure SECRET_KEY in config/cms.conf..."; \
	SECRET=$$(python3 -c 'import secrets; print(secrets.token_hex(16))'); \
	sed -i 's/"secret_key":             "8e045a51e4b102ea803c06f92841a1fb",/"secret_key":             "'$${SECRET}'",/' config/cms.conf
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
