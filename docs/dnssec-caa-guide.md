# DNSSEC + CAA Guide — optional DNS hardening (disabled by default)

> **Status:** `DNSSEC_ENABLED=0` and `CAA_ENABLED=0` by default (see `config.toml.example` `[infra]`).
> No compose change needed — DNS only. Prod stays off unless explicitly enabled.
> TUI prompts in `scripts/__domain.sh` ask, never force. Local overrides gitignored.

## Why

- **DNSSEC:** signed zone prevents DNS spoofing / BGP hijack at resolver. Required if you serve `grader.mwit.ac.th` on tailscale + public both.
- **CAA:** restricts which CA may issue for your domain → blocks rogue CA issuance even if an attacker tricks a CA.
- **Cost / trust:** `$0` at DNS provider / registry, but needs DNS control + coordination with computer center (DS at parent) and monitoring.

---

## Prerequisites

- DNS control for `grader.mwit.ac.th` (MWIT computer center or your registrar).
- DNS host that supports DNSSEC signing (Cloudflare signing itself, or BIND9 / Knot with inline-signing, or registrar DNSSEC feature).
- Access to **parent** to publish `DS` (delegation signer) — without DS, chain breaks.
- `dig`, `delv`, `ldns-verify-zone` installed for validation.

---

## DNSSEC Steps

### 1. Generate keys (on DNS primary)

```bash
# For BIND-style inline-signing (adjust algorithm to what your provider expects)
dnssec-keygen -a ECDSAP256SHA256 -f KSK -n ZONE grader.mwit.ac.th
dnssec-keygen -a ECDSAP256SHA256 -n ZONE grader.mwit.ac.th   # ZSK

# Or: let Cloudflare / registrar do it for you — skip manual generation
```

### 2. Sign zone and publish DS

1. Publish the KSK's `DS` at the **parent** (`.ac.th` via MWIT computer center).
   Get DS with:

   ```bash
   dnssec-dsfromkey -a SHA-256 Kgrader.mwit.ac.th.+013+*.key
   # output: grader.mwit.ac.th. IN DS 12345 13 2 <hash> — paste to parent
   ```

2. Wait for parent to publish DS + TTL to expire.
3. Verify chain:

   ```bash
   delv @1.1.1.1 grader.mwit.ac.th A +vtrace
   dig +dnssec grader.mwit.ac.th @1.1.1.1 | grep -i -E "ad|RRSIG"
   ```

### 3. Rollover maintenance

| Key | Cadence | Action | Risk if skipped |
|-----|---------|--------|-----------------|
| ZSK | ~90 days | re-sign zone, re-publish RRSIGs | stale signatures → SERVFAIL |
| KSK | ~1 year | `dnssec-keygen` new KSK, update DS at parent, retire old after TTL+ | parent DS mismatch → bogus |

Monitor with:

```bash
# should be AD (authentic data) when trust anchor matches
dig +dnssec grader.mwit.ac.th @1.1.1.1
# ldns-verify-zone should be clean
ldns-verify-zone grader.mwit.ac.th.signed
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
grader.mwit.ac.th.        IN CAA 0 issue "letsencrypt.org"
grader.mwit.ac.th.        IN CAA 0 issuewild "letsencrypt.org"
grader.mwit.ac.th.        IN CAA 0 iodef "mailto:admin@mwit.ac.th"
grader.mwit.ac.th.        IN CAA 0 iodef "https://report.example.com/caa"

; if subdomains need same policy they inherit; or set explicitly
admin.grader.mwit.ac.th.  IN CAA 0 issue "letsencrypt.org"
ranking.grader.mwit.ac.th. IN CAA 0 issue "letsencrypt.org"
```

Multiple `issue` lines mean OR (any listed may issue).

### 3. Enable locally

```bash
# .env.infra or .env.local (gitignored)
CAA_ENABLED=1
CAA_ISSUER=letsencrypt.org
```

### 4. Validate

```bash
dig CAA grader.mwit.ac.th +short
# expect: 0 issue "letsencrypt.org"

# Try a dry-run issuance after publishing — LE checks CAA before issuing
./scripts/__domain.sh renew --dry-run   # will fail fast if CAA mismatch
```

### 5. Reporting

`iodef` causes violating CAs to email/report to `mailto:` or URL. Point to admin mailbox or a reporting endpoint.

---

## Coordination Checklist (for MWIT / computer center)

- [ ] Confirm who can publish DS at `.ac.th` parent
- [ ] Agree on ZSK/KSK roll calendar and on-call for emergency DS roll
- [ ] Confirm CAA is supported at DNS host (some .ac.th hosts strip CAA)
- [ ] Test in staging DNS zone before promoting to `grader.mwit.ac.th`

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
