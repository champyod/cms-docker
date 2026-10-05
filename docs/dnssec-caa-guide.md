# DNSSEC + CAA Guide — optional DNS hardening (disabled by default)

> **Status:** `DNSSEC_ENABLED=0` and `CAA_ENABLED=0` by default (see `config.toml.example` `[infra]`).
> No compose change needed — DNS only. Prod stays off unless explicitly enabled.
> TUI prompts in `scripts/__domain.sh` ask, never force. Local overrides gitignored.

> **Examples use `example.com`.** Every zone, host and mailbox below is a
> placeholder — substitute your own at each step. The commands are otherwise
> identical, and the parent-zone and reporting steps depend on whoever operates
> your DNS, not on a fixed registry.

## Why

- **DNSSEC:** signed zone prevents DNS spoofing / BGP hijack at resolver. Required if you serve `grader.example.com` on tailscale + public both.
- **CAA:** restricts which CA may issue for your domain → blocks rogue CA issuance even if an attacker tricks a CA.
- **Cost / trust:** `$0` at DNS provider / registry, but needs DNS control + coordination with computer center (DS at parent) and monitoring.

---

## Prerequisites

- DNS control for `grader.example.com` (your DNS host operator or registrar).
- DNS host that supports DNSSEC signing (Cloudflare signing itself, or BIND9 / Knot with inline-signing, or registrar DNSSEC feature).
- Access to **parent** to publish `DS` (delegation signer) — without DS, chain breaks.
- `dig`, `delv`, `ldns-verify-zone` installed for validation.

---

## DNSSEC Steps

### 1. Generate keys (on DNS primary)

```bash
# For BIND-style inline-signing (adjust algorithm to what your provider expects)
dnssec-keygen -a ECDSAP256SHA256 -f KSK -n ZONE grader.example.com
dnssec-keygen -a ECDSAP256SHA256 -n ZONE grader.example.com   # ZSK

# Or: let Cloudflare / registrar do it for you — skip manual generation
```

### 2. Sign zone and publish DS

1. Publish the KSK's `DS` at the **parent** zone (via your DNS host operator).
   Get DS with:

   ```bash
   dnssec-dsfromkey -a SHA-256 Kgrader.example.com.+013+*.key
   # output: grader.example.com. IN DS 12345 13 2 <hash> — paste to parent
   ```

2. Wait for parent to publish DS + TTL to expire.
3. Verify chain:

   ```bash
   delv @1.1.1.1 grader.example.com A +vtrace
   dig +dnssec grader.example.com @1.1.1.1 | grep -i -E "ad|RRSIG"
   ```

### 3. Rollover maintenance

| Key | Cadence | Action | Risk if skipped |
|-----|---------|--------|-----------------|
| ZSK | ~90 days | re-sign zone, re-publish RRSIGs | stale signatures → SERVFAIL |
| KSK | ~1 year | `dnssec-keygen` new KSK, update DS at parent, retire old after TTL+ | parent DS mismatch → bogus |

Monitor with:

```bash
# should be AD (authentic data) when trust anchor matches
dig +dnssec grader.example.com @1.1.1.1
# ldns-verify-zone should be clean
ldns-verify-zone grader.example.com.signed
```

### 4. Clock skew gotcha

DNSSEC validation is time-sensitive. NTP sync required on DNS host; mis-clocked resolver returns `SERVFAIL` for signed zones.

---

## CAA Steps

### 1. Decide issuer

Default: `letsencrypt.org`. Alternatives: `pki.goog` (Google), `sectigo.com`, `digicert.com`.

### 2. Publish CAA records

At apex `_or` at each subdomain you issue for:

```dns
; restrict apex and wildcards
grader.example.com.        IN CAA 0 issue "letsencrypt.org"
grader.example.com.        IN CAA 0 issuewild "letsencrypt.org"
grader.example.com.        IN CAA 0 iodef "mailto:admin@example.com"
grader.example.com.        IN CAA 0 iodef "https://report.example.com/caa"

; if subdomains need same policy they inherit; or set explicitly
admin.grader.example.com.  IN CAA 0 issue "letsencrypt.org"
ranking.grader.example.com. IN CAA 0 issue "letsencrypt.org"
```

Multiple `issue` lines mean OR (any listed may issue).

### 3. Enable locally

```bash
# config.toml [infra] or .env.local (gitignored)
CAA_ENABLED=1
CAA_ISSUER=letsencrypt.org
```

### 4. Validate

```bash
dig CAA grader.example.com +short
# expect: 0 issue "letsencrypt.org"

# Try a dry-run issuance after publishing — LE checks CAA before issuing
./scripts/__domain.sh renew --dry-run   # will fail fast if CAA mismatch
```

### 5. Reporting

`iodef` causes violating CAs to email/report to `mailto:` or URL. Point to admin mailbox or a reporting endpoint.

---

## Coordination Checklist (for your DNS host operator)

- [ ] Confirm who can publish DS at the parent zone
- [ ] Agree on ZSK/KSK roll calendar and on-call for emergency DS roll
- [ ] Confirm CAA is supported at DNS host (some hosts strip CAA)
- [ ] Test in staging DNS zone before promoting to `grader.example.com`

---

## How to Enable via Env + Check

```bash
# enable (optional, not for prod by default — asked in TUI)
echo 'DNSSEC_ENABLED=1' >> .env.local   # gitignored
echo 'CAA_ENABLED=1'     >> .env.local
echo 'CAA_ISSUER=letsencrypt.org' >> .env.local

# check status (logs without forcing)
./scripts/__domain.sh status
# or during setup — TUI asks Enable DNSSEC? [y/N] / Enable CAA? [y/N]
./scripts/__domain.sh setup --apply
```

No compose profile needed — publish records, then validate with `dig +dnssec` and `dig CAA`.
