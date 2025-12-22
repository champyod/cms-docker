# CMS Docker - Change Log

> This file tracks all modifications made to the repository.
> Updated by AI assistant after each change session.

---

## [2025-12-22] Session: Cleanup & CI Enhancement

### Summary
Cleaned up root directory by removing CMS repo files that belong in the submodule, updated Dockerfile for submodule structure, and enhanced GitHub Actions with comprehensive integration testing.

### Changes Made

#### 1. Root Directory Cleanup
**Removed from root** (these files belong in `src/` submodule):
- `install.py` - CMS installer script
- `pyproject.toml` - Python package definition
- `babel_mapping.cfg` - Babel translation mapping
- `constraints.txt` - Pinned dependencies
- `config/` directory - Sample config files
- `scripts/` directory - CMS service scripts

#### 2. Dockerfile Updates
**File:** `Dockerfile`

- Changed from copying individual files to copying entire repository
- Set WORKDIR to `src/` submodule where `install.py` and `pyproject.toml` exist
- Updated relative paths for config file sed commands
- Structure now:
  ```dockerfile
  COPY . /home/cmsuser/cms-docker
  WORKDIR /home/cmsuser/cms-docker/src
  RUN ./install.py venv
  RUN ./install.py cms --devel
  ```

#### 3. Makefile Updates
**File:** `Makefile`

- Changed config paths from `config/cms.sample.toml` → `src/config/cms.sample.toml`
- Added `mkdir -p config` before copying to ensure directory exists
- Same update for `cms.ranking.sample.toml`

#### 4. GitHub Actions Enhancement
**File:** `.github/workflows/docker-build.yml`

**New features:**
- Added `submodules: recursive` to checkout action
- Created new `integration-test` job with full service testing:
  - Setup test environment files (.env.core, .env.admin, etc.)
  - Create minimal CMS config if submodule config missing
  - Start Core services with health checks
  - Initialize database with `cmsInitDB`
  - Create test admin user
  - Start Admin services and verify HTTP response
  - Start Contest services and verify HTTP response
  - Start Worker services (with graceful handling for sandbox restrictions)
  - Collect all service logs for debugging
  - Cleanup all containers and volumes

#### 5. Documentation Created
**Files:** `.agent/ARCHITECTURE.md`, `.agent/CHANGELOG.md`

- Created comprehensive architecture documentation
- Created this changelog for tracking modifications

#### 6. CI Disk Space Fix
**File:** `.github/workflows/docker-build.yml`

- Added "Free disk space" step to both `build` and `integration-test` jobs
- Removes unused packages: dotnet, ghc, boost, android SDK, CodeQL, swift
- Runs `docker system prune -af` and `docker volume prune -f`
- Shows disk space before/after cleanup for debugging
- **Sequential builds**: Changed from parallel compose builds to sequential per-service builds:
  - Core: log-service → resource-service → scoring-service → checker-service → evaluation-service → proxy-service
  - Admin: admin-web-server → ranking-web-server
  - Contest: contest-web-server
  - Worker: worker
  - Each build followed by `docker system prune -f` to free intermediate layers
  - All `compose up` commands now use `--no-build` flag

---

## Template for Future Entries

```markdown
## [YYYY-MM-DD] Session: Brief Title

### Summary
One-line summary of what was accomplished.

### Changes Made

#### 1. Category Name
**File(s):** `filename`

- Bullet point changes
- ...

### Issues Encountered
- Any problems faced and how they were resolved

### TODO / Follow-up
- [ ] Tasks remaining from this session
```
