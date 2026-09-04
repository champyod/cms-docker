# WAF Tuning Guide — OWASP ModSecurity CRS (Plan-First, Optional)

> WAF is **available but disabled by default** (`WAF_ENABLED=0`). It never replaces CAPTCHA — both can run together. This document explains tuning, price, wiring, and how to enable safely.

---

## 1. What Is Tuning?

WAF (Web Application Firewall) with OWASP CRS inspects every HTTP request against ~200 rules that detect OWASP Top 10 payloads (SQL injection, XSS, path traversal, RCE, etc.). Each matching rule adds to an **anomaly score**. If the inbound score exceeds `ANOMALY_INBOUND` (default 5) the request is blocked — **but only when `SecRuleEngine On`**.

Tuning means: run in `DetectionOnly` first, watch the audit log for **false positives** (legitimate traffic that looks like an attack), then whitelist those patterns or raise thresholds so legitimate users are not blocked when you flip to `On`.

Without tuning, a contest submission containing `<script>` or `SELECT * FROM` would be blocked as XSS/SQLi.

---

## 2. Price

| Item | Cost |
|------|------|
| Software/license | **0** — OWASP CRS is open source, `owasp/modsecurity-crs:nginx-alpine` is free |
| Initial tuning | **2–3 days** of log review (DetectionOnly week, 30 min/day) |
| Ongoing maintenance | **~1 h/week** for the first month, then **~1 h/month** (rule updates, FP checks) |
| Latency | **5–10 ms** per request (ModSecurity inspection) |

No vendor, no subscription.

---

## 3. Pros

- **Blocks OWASP Top 10**: SQLi, XSS, RFI/LFI, RCE, SSTI, SSRF probes, scanner fingerprints — before they reach nginx/app.
- **Anomaly scoring**: fine-grained `PARANOIA` 1→4 and `ANOMALY_INBOUND`/`ANOMALY_OUTBOUND` thresholds per deployment.
- **Adaptive rate control**: WAF anomaly score can feed stricter `limit_req` (e.g., score ≥3 → tighter burst) — see section 8.
- **Defense in depth**: runs alongside CAPTCHA, per-user buckets, Redis rate limit, fail2ban.
- **Auditable**: every alert logged with rule ID, score, matched payload.

## 4. Cons

- **False positives**: source-code submissions, markdown, ranking JSON often trigger CRS (941xxx XSS, 942xxx SQLi).
- **Log volume**: audit log grows fast in DetectionOnly; rotate via Docker `json-file` limits or `waf-logs` volume.
- **Maintenance**: CRS updates can add rules that need re-tuning; pin image tag and review changelogs.
- **Latency**: +5–10 ms; negligible for contest traffic, measurable under load test.

---

## 5. Increase / Lost (Tradeoff Table)

| Increase | Lost |
|----------|------|
| Security coverage (WAF blocks exploit payloads nginx/CMS would otherwise log and forward) | 5–10 ms latency per request |
| Visibility (audit log of attack attempts) | Log volume / disk (rotate `waf-logs`) |
| Configurability (per-path / per-rule bypasses) | Weekly tuning time until stable |

---

## 6. Maintenance

- **Weekly**: `docker compose -f docker-compose.domain.yml -f docker-compose.waf.yml --profile waf logs grader-waf | grep ModSecurity` — scan for new FP spikes.
- **Rule update**: bump `owasp/modsecurity-crs:nginx-alpine` tag monthly; re-run DetectionOnly for 24 h after upgrade.
- **Threshold**: if FPs cluster just above 5, raise `WAF_ANOMALY_INBOUND=8` for that deployment, or whitelist per-location (section 8).
- **Log rotation**: `waf-logs` is a Docker volume; cap with `docker system prune` or add a logrotate sidecar if needed.

---

## 7. Wiring (How WAF Sits in Front of Nginx)

Default: **no wiring change**. With `WAF_ENABLED=0` (default), `grader-waf` is not started; host 80/443 stay on `grader-nginx-proxy`.

When `WAF_ENABLED=1` + `--profile waf`:

```
client → grader-waf:80 (inside cms-network) → grader-nginx-proxy:80 → cms-contest / admin / ranking / oj_backend
                ↑
         host 127.0.0.1:${WAF_PORT:-8080}:80  (default 8080 for safe testing alongside 443)
```

**Production option A — WAF on separate test port** (recommended first week):
Keep host 443 on `grader-nginx-proxy`; test via `curl http://127.0.0.1:8080/` through WAF. No TLS impact, no clash.

**Production option B — WAF fronts 443**:
Set `WAF_PORT=443` and move `DOMAIN_NGINX_HTTPS_PORT` off 443 (e.g., 8443), or run a host LB in front. Only do this after DetectionOnly is clean. Document choice in your runbook; nothing forces it.

**Alternative**: point `grader-nginx-proxy` BACKEND-style from WAF via `BACKEND=http://grader-nginx-proxy:80` (already wired). No nginx `upstream` change needed — nginx continues to terminate TLS.

---

## 8. CAPTCHA Still Works with WAF

WAF and CAPTCHA are **independent layers**:

- **CAPTCHA (Upgrade-2)**: per-IP failed-login counter → challenge at threshold 3, ban at 5. Handles brute-force.
- **WAF**: per-request payload scoring → blocks exploit payloads at any endpoint.
- **Both on**: WAF score can tighten `limit_req` (e.g., map WAF `X-ModSec-Score` to a lower `limit_req` burst) but CAPTCHA still handles credential stuffing even if WAF whitelists `/login` payloads. WAF **does not** replace CAPTCHA; CAPTCHA stays active when `WAF_ENABLED=0` and also when `WAF_ENABLED=1`.
- **Policy**: leave `CAPTCHA_ENABLED` as before; WAF enablement does not change CAPTCHA files or envs.

---

## 9. Tuning Steps (Runbook)

### Step 1 — DetectionOnly (1 week)

`config/modsecurity/modsecurity.conf` already sets `SecRuleEngine DetectionOnly`. Start WAF:

```bash
cp .env.infra.example .env.infra   # ensure WAF_ENABLED=0 initially
# when ready to observe:
WAF_ENABLED=1 WAF_PORT=8080 docker compose -f docker-compose.domain.yml -f docker-compose.waf.yml --profile waf up -d
# or: echo WAF_ENABLED=1 >> .env.infra && docker compose --profile waf -f docker-compose.yml -f docker-compose.domain.yml -f docker-compose.waf.yml up -d
```

Verify: `curl -i http://127.0.0.1:8080/` should return the grader page via WAF; `docker logs grader-waf` shows CRS init.

### Step 2 — Review Audit Log

```bash
docker exec grader-waf cat /var/log/modsec_audit.log | less
# or via volume:
docker compose -f docker-compose.waf.yml --profile waf logs grader-waf
```

Look for legitimate requests that scored >0. Common FP in this repo: contest code with `<script>`, `eval(`, `UNION SELECT`, markdown backticks. Note the `id` values (e.g., `941100`, `942100`).

### Step 3 — Whitelist per Location / Rule

Create a local exclusion file `config/modsecurity/crs-exclusions.conf` (create if needed) and mount it, or add to `crs-setup.conf` via tuning. Examples:

```apache
# Exclude ranking and static assets from SQLi/XSS paranoia (ranking JSON, images)
SecRule REQUEST_URI "@beginsWith /ranking/" "id:1000,phase:1,pass,nolog,ctl:ruleRemoveById=941100,ctl:ruleRemoveById=942100"

# Exclude contest submission endpoint from XSS rule that trips on `<script>` in code
SecRule REQUEST_URI "@beginsWith /api/submissions" "id:1001,phase:1,pass,nolog,ctl:ruleRemoveByTag=attack-xss"

# Lower paranoia for a specific IP range (e.g., campus / grading bots)
SecRule REMOTE_ADDR "@ipMatch 10.0.0.0/8,192.168.0.0/16" "id:1002,phase:1,pass,nolog,ctl:ruleEngine=DetectionOnly"

# Raise threshold globally instead of per-rule (alternative)
# WAF_ANOMALY_INBOUND=8  in .env.infra and restart grader-waf
```

Or use CRS update-target helpers:

```apache
SecRuleUpdateTargetById 941100 !ARGS:code
SecRuleUpdateTargetById 942100 !REQUEST_URI
```

Mount the exclusions file in `docker-compose.waf.yml` by adding to `volumes`:

```yaml
- ./config/modsecurity/crs-exclusions.conf:/etc/modsecurity/crs/crs-exclusions.conf:ro
```

And include it from `modsecurity.conf` with `Include /etc/modsecurity/crs/crs-exclusions.conf` (add at end).

### Step 4 — Switch to On

Only after FP review shows zero legitimate blocks for 24–48 h:

```bash
# Option A: env override
WAF_RULE_ENGINE=On docker compose --profile waf -f docker-compose.domain.yml -f docker-compose.waf.yml up -d

# Option B: edit config/modsecurity/modsecurity.conf → SecRuleEngine On
# then:
docker compose -f docker-compose.domain.yml -f docker-compose.waf.yml --profile waf restart grader-waf
```

Monitor `modsec_audit.log` for blocked legitimate traffic; if any, revert to DetectionOnly, add exclusion, re-enable.

### Step 5 — Tighten / Maintain

- Pin WAF image tag in `docker-compose.waf.yml` (avoid `:latest` drift).
- After CRS upgrades, re-run DetectionOnly for a day.
- Periodically review `WAF_PARANOIA` — raising from 1 → 2 adds coverage but needs new FP pass.

---

## 10. Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `WAF_ENABLED` | `0` | Plan-first gate: `0` = WAF not started; `1` = require `--profile waf` to start grader-waf. Does NOT auto-start container without profile. |
| `WAF_PORT` | `8080` | Host port for grader-waf (bound to `WAF_BIND_IP`). Use 8080 for testing alongside existing 443; change to 443 only when intentionally fronting prod. |
| `WAF_BIND_IP` | `127.0.0.1` | Bind IP for WAF port. `127.0.0.1` keeps WAF internal; use Tailscale IP to expose via tailnet. |
| `WAF_PARANOIA` | `1` | CRS paranoia level 1–4. 1 = least FP. Maps to `PARANOIA` in container. |
| `WAF_ANOMALY_INBOUND` | `5` | Inbound anomaly threshold (block when score > this, with `On`). Lower = stricter. |
| `WAF_ANOMALY_OUTBOUND` | `4` | Outbound threshold (response scoring; requires `SecResponseBodyAccess On`). |
| `WAF_RULE_ENGINE` | `DetectionOnly` | `DetectionOnly` or `On`. Start DetectionOnly, switch to On after tuning. |

All are optional; missing values fall back to defaults. `WAF_ENABLED=0` means even if `--profile waf` is passed, nothing forces WAF to proxy production 443.

---

## 11. Quick Reference

```bash
# Validate compose
docker compose -f docker-compose.waf.yml config > /dev/null
docker compose -f docker-compose.domain.yml -f docker-compose.waf.yml config > /dev/null

# Start WAF in DetectionOnly (safe)
WAF_ENABLED=1 docker compose -f docker-compose.domain.yml -f docker-compose.waf.yml --profile waf up -d

# Check WAF health
docker ps | grep grader-waf
curl -i http://127.0.0.1:8080/

# Logs
docker logs -f grader-waf
docker exec grader-waf cat /var/log/modsec_audit.log

# Disable WAF (back to pre-WAF, no break)
docker compose -f docker-compose.domain.yml -f docker-compose.waf.yml --profile waf down
# or: WAF_ENABLED=0 docker compose ... up -d  (without --profile waf, grader-waf never starts)
```

WAF is optional, tuning-first, and never forced for prod. CAPTCHA stays authoritative for brute-force protection.
