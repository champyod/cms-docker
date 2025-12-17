# Release Notes - v1.0.0

## Initial Release with Docker Compose Support

This is the initial release of **cms-docker**, a Dockerized version of the [Contest Management System (CMS)](https://github.com/cms-dev/cms).
This release focuses on providing a robust **Docker Compose** setup to easily deploy and manage CMS environments.

## Release Information
- **Version:** 1.0.0
- **Release Date:** 2025-12-17
- **Based on:** [cms-dev/cms](https://github.com/cms-dev/cms)

## Key Features

### Docker & Docker Compose Support
- **Full Dockerization:** All CMS services (Core, Admin, Contest, Worker) are containerized.
- **Docker Compose:** Easy deployment using `docker-compose.yml` files for different environments (Core, Admin, Contest, Worker).
- **Simplified Setup:** `Makefile` commands (`make env`, `make core`, etc.) to streamline configuration and deployment.

### Project Structure
- The repository has been restructured for better maintainability in this dockerized context:
    - Source code relocated to `src/`.
    - Documentation moved to `docs/`.
    - Helper scripts moved to `scripts/`.
    - **Cleanup:** Unnecessary test suites and development artifacts from the original repo have been removed to keep the image light.

## Usage
Please refer to the `README.md` and the guides in `docs/` for detailed installation and deployment instructions.
