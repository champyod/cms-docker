# Progress Log

This file tracks what has been done and what we're currently working on.

---

## Current Focus
- **Fixing RankingWebServer** - Found issues: `raphael.js` 404 and missing config file. Created `cms.ranking.toml`. Need to rebuild/restart on VPS.

---

## Completed Work

### 2025-12-22: Ranking Page Fix
- Investigated why RankingWebServer shows empty scoreboard
- **Found Issue 1**: `raphael.js` returns 404 - CMS static files not properly installed
- **Found Issue 2**: `cms.ranking.toml` config file was missing (only sample existed)
- Created `config/cms.ranking.toml` from sample with bind_address set to `0.0.0.0`
- ProxyService logs show data IS being sent successfully to ranking
- Next: Rebuild ranking-web-server container to fix static file installation

### 2025-12-22: Agent Documentation Created
- Created `.agent/README.md` with repository structure and service overview
- Created `.agent/progress.md` (this file)
- Created `.agent/environment.md` with Fedora/VPS/Pi separation

### 2025-12-21: CMS Submodule Refactoring

- Converted local `src` directory to Git submodule from `cms-dev/cms`
- Verified `raphael.js` is vendored within CMS source
- Confirmed `isolate` is installed via package manager (not submodule)
- Updated Dockerfile, Makefile, and docker-compose files for new structure

### Prior: Remote Worker Setup
- Configured Raspberry Pi as remote worker
- Set up Tailscale VPN for secure worker connection
- Fixed evaluation issues with remote workers
- Resolved submission status showing "N/A"

---

## Known Issues

1. **RankingWebServer Empty** - Data sent by ProxyService but not appearing
   - Possible causes: lib_dir configuration, credential mismatch, data storage path
   
2. **Hidden Participations** - Users with `hidden=True` won't appear on ranking

---

## Environment Notes

- Development: Fedora (code editing only, no testing)
- VPS: Main CMS deployment (SSH available)
- Raspberry Pi: Remote worker (SSH available)

> See `environment.md` for detailed environment setup
