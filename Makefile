
.PHONY: env help clean core admin contest worker

help:
	@echo "Available commands:"
	@echo "  make env      - Generates .env file by merging .env.* files"
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
	@if [ -f .env.core.local ]; then \
		echo "### .env.core.local (Override) ###" >> .env; \
		cat .env.core.local >> .env; \
		echo "" >> .env; \
	elif [ -f .env.core ]; then \
		echo "### .env.core (Template) ###" >> .env; \
		cat .env.core >> .env; \
		echo "" >> .env; \
	fi
	@# Admin Environment
	@if [ -f .env.admin.local ]; then \
		echo "### .env.admin.local (Override) ###" >> .env; \
		cat .env.admin.local >> .env; \
		echo "" >> .env; \
	elif [ -f .env.admin ]; then \
		echo "### .env.admin (Template) ###" >> .env; \
		cat .env.admin >> .env; \
		echo "" >> .env; \
	fi
	@# Contest Environment
	@if [ -f .env.contest.local ]; then \
		echo "### .env.contest.local (Override) ###" >> .env; \
		cat .env.contest.local >> .env; \
		echo "" >> .env; \
	elif [ -f .env.contest ]; then \
		echo "### .env.contest (Template) ###" >> .env; \
		cat .env.contest >> .env; \
		echo "" >> .env; \
	fi
	@# Worker Environment
	@if [ -f .env.worker.local ]; then \
		echo "### .env.worker.local (Override) ###" >> .env; \
		cat .env.worker.local >> .env; \
		echo "" >> .env; \
	elif [ -f .env.worker ]; then \
		echo "### .env.worker (Template) ###" >> .env; \
		cat .env.worker >> .env; \
		echo "" >> .env; \
	fi
	@# Local Environment
	@if [ -f .env.local ]; then \
		echo "### .env.local ###" >> .env; \
		cat .env.local >> .env; \
		echo "" >> .env; \
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
