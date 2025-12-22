
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
	@if [ -d config/cms.toml ]; then \
		echo "Removing directory config/cms.toml (created by Docker volumes)..."; \
		rm -rf config/cms.toml; \
	fi
	@if [ ! -f config/cms.toml ]; then \
		echo "Copying src/config/cms.sample.toml to config/cms.toml..."; \
		mkdir -p config; \
		cp src/config/cms.sample.toml config/cms.toml; \
		echo "Setting bind address to 0.0.0.0 in config/cms.toml..."; \
		sed -i 's/"127.0.0.1"/"0.0.0.0"/g' config/cms.toml; \
		sed -i 's/\["127.0.0.1"\]/\["0.0.0.0"\]/g' config/cms.toml; \
	fi
	@if [ -d config/cms.ranking.toml ]; then \
		echo "Removing directory config/cms.ranking.toml (created by Docker volumes)..."; \
		rm -rf config/cms.ranking.toml; \
	fi
	@if [ ! -f config/cms.ranking.toml ]; then \
		echo "Copying src/config/cms.ranking.sample.toml to config/cms.ranking.toml..."; \
		mkdir -p config; \
		cp src/config/cms.ranking.sample.toml config/cms.ranking.toml; \
		echo "Setting bind address to 0.0.0.0 in config/cms.ranking.toml..."; \
		sed -i 's/"127.0.0.1"/"0.0.0.0"/g' config/cms.ranking.toml; \
	fi
	@echo "Generating and proactively setting a secure SECRET_KEY in config/cms.toml..."; \
	SECRET=$$(python3 -c 'import secrets; print(secrets.token_hex(16))'); \
	sed -i 's/secret_key = "8e045a51e4b102ea803c06f92841a1fb"/secret_key = "'$${SECRET}'"/' config/cms.toml
	@if grep -q "POSTGRES_PASSWORD=" .env.core; then \
		echo "Injecting database password from .env.core into config/cms.toml..."; \
		DB_PASS=$$(grep "POSTGRES_PASSWORD=" .env.core | cut -d '=' -f2); \
		sed -i "s/your_password_here/$$DB_PASS/" config/cms.toml; \
	fi
	@# For remote workers: replace 'database' hostname with CORE_SERVICES_IP
	@if [ -f .env.worker ] && grep -q "CORE_SERVICES_IP=" .env.worker; then \
		CORE_IP=$$(grep "CORE_SERVICES_IP=" .env.worker | cut -d '=' -f2); \
		if [ -n "$$CORE_IP" ]; then \
			echo "Configuring remote worker: replacing 'database' with $$CORE_IP in config/cms.toml..."; \
			sed -i "s/@database:/@$$CORE_IP:/g" config/cms.toml; \
			echo "Replacing service hostnames with $$CORE_IP for remote connection..."; \
			sed -i "s/cms-log-service/$$CORE_IP/g" config/cms.toml; \
			sed -i "s/cms-resource-service/$$CORE_IP/g" config/cms.toml; \
			sed -i "s/cms-scoring-service/$$CORE_IP/g" config/cms.toml; \
			sed -i "s/cms-evaluation-service/$$CORE_IP/g" config/cms.toml; \
			sed -i "s/cms-checker-service/$$CORE_IP/g" config/cms.toml; \
		fi; \
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
