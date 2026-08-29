# Release Notes - v1.1.2 (23 December 2024)

## Fixed Ranking Page Bug

This release fixes the **Ranking Web Server** not displaying the scoreboard properly due to missing static files.

## Release Information
- **Version:** v1.1.2
- **Release Date:** 23 December 2024
- **Based on:** [cms-dev/cms](https://github.com/cms-dev/cms)

## Bug Fixes

### Ranking Page Static Files Missing
- **Issue:** The ranking scoreboard page showed a blank page with 404 errors for `raphael.js` and other JavaScript libraries
- **Root Cause:** `.gitignore` had `lib/` which ignored ALL folders named `lib`, including `src/cmsranking/static/lib/` containing required JS files
- **Fix:** Changed `.gitignore` from `lib/` to `/lib/` to only ignore the root lib folder
- **Files Added:**
  - `src/cmsranking/static/lib/raphael.js`
  - `src/cmsranking/static/lib/jquery.js`
  - `src/cmsranking/static/lib/eventsource.js`
  - `src/cmsranking/static/lib/explorercanvas.js`

### Configuration and Packaging Improvements
- Added `[tool.setuptools.package-data]` to `pyproject.toml` for proper static file packaging
- Added `MANIFEST.in` to ensure static files are included in Python packages
- Fixed `install.py` to use correct config filename (`cms.ranking.sample.toml`)

## Enhancements

### Docker Build Configuration
- Added `APT_MIRROR` and `APT_PORTS_MIRROR` build arguments to all Docker Compose files
- Allows configuring Ubuntu mirror for faster builds (default: `th.archive.ubuntu.com` for Thailand)

## Upgrade Instructions

```bash
git pull
docker compose -f docker-compose.admin.yml build --no-cache ranking-web-server
docker compose -f docker-compose.admin.yml up -d ranking-web-server
docker compose -f docker-compose.core.yml restart proxy-service
```

## Known Issues
- VPS may require periodic disk cleanup (`docker system prune -a --volumes`) due to build cache

## Contributors
- CMS Docker Team
