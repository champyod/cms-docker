# Release Notes - v1.0.0

## Release Information
- **Version:** 1.0.0
- **Release Date:** 2025-12-17

## Major Changes

### Project Restructuring
- The project file structure has been significantly reorganized for better maintainability.
- Source code has been moved to the `src/` directory.
- `cms`, `cmscommon`, `cmscontrib`, `cmsranking`, `cmstaskenv`, and `isolate` packages are now located in `src/`.
- Utility scripts `prerequisites.py` and `copy_translations.py` have been moved to `scripts/`.
- `setup.py` and `Dockerfile` have been updated to reflect these path changes.

### Cleanup
- Root directory has been decluttered.
- Documentation files (`ACCESS-CONFIGURATION.md`, `PORTAINER-GUIDE.md`, `QUICK-REFERENCE.md`, `SETUP-GUIDE.md`, `TROUBLESHOOTING.md`, `WORKER-SETUP.md`) have been moved to the `docs/` directory.
- **Removed Tests:** Test suites (`cmstestsuite`) and test-related scripts (`_*test*.sh`, `cms-test.sh`, `docker-compose.test.yml`, `pytest.ini`) have been removed from the repository to streamline the production release.

## Installation
The installation process remains largely the same, but internal paths have changed. `setup.py` handles the new package location transparently.

## Usage
Refer to the `README.md` and documentation in the `docs/` directory for usage instructions.
