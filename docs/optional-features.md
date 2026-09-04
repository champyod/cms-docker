# Optional Features — HSM / Vault / DNSSEC-CAA / mTLS

All four are **available but disabled by default** (`=0`), asked in `scripts/__domain.sh` TUI (max customizability, never forced), local overrides gitignored, so prod stays off unless explicitly enabled. No breaking change when off — existing domain/redis/captcha/prometheus behavior is unchanged.

| # | Feature | Env flag (default) | Enable via | Compose profile |
|---|---------|--------------------|------------|-----------------|
| 1 | HSM | `HSM_ENABLED=0` | `HSM_ENABLED=1 ./scripts/__domain.sh setup --apply` — prompts for `HSM_MODULE`/`HSM_PIN`/`HSM_KEY_LABEL` | `hsm` — `docker compose -f docker-compose.domain.yml --profile hsm up -d` |
| 2 | Vault | `VAULT_ENABLED=0` | `VAULT_ENABLED=1` with `VAULT_ADDR`/`VAULT_TOKEN`/`VAULT_PATH` | `vault` — `docker compose -f docker-compose.vault.yml --profile vault up -d` |
| 3 | DNSSEC + CAA | `DNSSEC_ENABLED=0`, `CAA_ENABLED=0` | `DNSSEC_ENABLED=1` / `CAA_ENABLED=1` (`CAA_ISSUER=letsencrypt.org`) | none — DNS only (see `docs/dnssec-caa-guide.md`) |
| 4 | mTLS workers | `MTLS_WORKERS_ENABLED=0` | `MTLS_WORKERS_ENABLED=1` with `MTLS_CA_CERT` etc. | worker service env `MTLS_*` — no extra profile; volumes documented in `docker-compose.yml` |

Local real secrets/artefacts are **gitignored**: `.env.local`, `.env.*.local`, `config/hsm/*`, `*.db`, `config/vault/data/`, `config/mtls/*`, `*.pem.local`, `config/*.pem` (see `.gitignore`).

---

## 1. HSM — Hardware Security Module for TLS key

- **Why / where:** practical use is `certbot --hsm` with PKCS#11 URI so grader private key never lives on disk.
- **Price:** `$0` SoftHSM (software emulation, dev) | ~`$800` YubiHSM 2 (USB HSM) | ~`$30/mo` AWS CloudHSM (managed).
- **Pros:** key never on disk, survives disk leak; PKCS#11 `pkcs11:token=grader;object=grader-privkey` flow.
- **Cons:** renewal switches from file to PKCS#11 URI; PIN rotation; backup ceremony.
- **Maintenance:** SoftHSM token DB at `config/hsm/tokens/*` + `*.db` (backup that directory); YubiHSM export wrapped key; CloudHSM AWS backup. Rotate PINs separately.
- **Increase / lost:** without HSM, TLS key on filesystem could leak via backup/log snapshot; with HSM, even host compromise without PIN does not yield key — but loss of token without backup loses key permanently (keep wrapped backup).
- **How to enable:**
  ```bash
  # local (gitignored)
  echo 'HSM_ENABLED=1' >> .env.local
  echo 'HSM_MODULE=softhsm' >> .env.local   # softhsm | yubihsm | cloudhsm
  echo 'HSM_PIN=1234'        >> .env.local
  echo 'HSM_KEY_LABEL=grader-privkey' >> .env.local
  # or TUI: ./scripts/__domain.sh setup --apply  # asks Enable HSM? [y/N]

  # run with profile
  docker compose -f docker-compose.domain.yml --profile hsm up -d
  # certbot HSM issuance (example)
  certbot certonly --hsm --hsm-module /usr/lib/softhsm/libsofthsm2.so --hsm-pin "$HSM_PIN" -d "$DOMAIN_NAME"
  ```
  When disabled: `scripts/__domain.sh` logs `HSM disabled (set HSM_ENABLED=1 to enable)`.

## 2. Vault — HashiCorp Vault for secrets

- **Why:** centralize `POSTGRES_PASSWORD` / `AUTH_SECRET` / ranking creds with lease + auto-rotation, audit log, instead of scattered `.env` files.
- **Price:** `$0` self-host `hashicorp/vault:1.15` | ~`$0.40/secret/mo` AWS Secrets Manager alternative.
- **Pros:** auto-rotation, audit, renewal leases, single source; `vault kv put secret/cms POSTGRES_PASSWORD=...`.
- **Cons:** another stateful service to operate (unseal, token lifecycle, raft storage).
- **Maintenance:** storage at `config/vault/data` (raft/file, gitignored); backup `vault operator raft snapshot save vault.snap`; rotate root token via `vault token create`.
- **Increase / lost:** secrets become auditable + rotatable without redeploy; but Vault downtime blocks rotation/lookup — keep `.env` fallback documented.
- **How to enable:**
  ```bash
  echo 'VAULT_ENABLED=1' >> .env.local
  echo 'VAULT_ADDR=http://vault:8200' >> .env.local
  echo 'VAULT_TOKEN=hvs....'     >> .env.local
  echo 'VAULT_PATH=secret/cms'   >> .env.local

  docker compose -f docker-compose.vault.yml --profile vault up -d
  # alternative inline: docker compose -f docker-compose.domain.yml --profile vault up -d
  # without Vault: keep using __secrets-rotate.sh (header mentions Vault as alternative)
  ```
  When disabled: logs `Vault disabled (set VAULT_ENABLED=1 … alternative: scripts/__secrets-rotate.sh)`. `.env.local` / `.env.*.local` are gitignored.

## 3. DNSSEC + CAA — DNS integrity + CA restriction (DNS only)

- **Why:** DNSSEC signs the zone (spoof/BGP hijack resistance); CAA says “only `letsencrypt.org` may issue for `grader.mwit.ac.th`”.
- **Price:** `$0` at registry/DNS, but needs DNS control + computer center coordination for `DS` at parent (`.ac.th`).
- **Pros:** resolver-validated DNS; CAA blocks rogue CA issuance.
- **Cons:** KSK/ZSK rollovers; DS mismatch or clock skew → `SERVFAIL` for all clients.
- **Maintenance:** ZSK ~90 days, KSK ~ yearly; `DS` at parent; monitor `dig +dnssec` + `delv`. See `docs/dnssec-caa-guide.md`.
- **Increase / lost:** without → DNS spoof could point `grader` to attacker; with correctly operated → authenticity, but mis-op → outage (so disabled default).
- **How to enable:** see `docs/dnssec-caa-guide.md`. In short:
  ```bash
  echo 'DNSSEC_ENABLED=1' >> .env.local
  echo 'CAA_ENABLED=1' >> .env.local
  echo 'CAA_ISSUER=letsencrypt.org' >> .env.local
  # then publish CAA:  grader.mwit.ac.th. IN CAA 0 issue "letsencrypt.org"
  # and DS from `dnssec-dsfromkey` at parent
  dig CAA grader.mwit.ac.th +short  # verify
  dig +dnssec grader.mwit.ac.th @1.1.1.1  # verify AD flag
  ```
  No compose change. `__domain.sh status` logs `DNSSEC=… CAA=…`.

## 4. mTLS — mutual TLS for worker RPC (beyond Tailscale)

- **Why:** authenticate workers with client certs, not just `TAILSCALE_IP` allowlist; defense-in-depth at RPC boundary (ports `29000`, `28000`, … `26000`).
- **Price:** `$0` self-signed CA via `openssl`; alternatives free (CF Zero Trust).
- **Pros:** worker identity `CN=worker-0` via cert, revocation via CRL, rotated independently of tailnet.
- **Cons:** cert distribution to every worker node, rotation + CRL/OCSP plumbing.
- **Maintenance:** CA at `config/mtls/ca.pem` (generate `openssl req -x509 -newkey rsa:4096`); worker certs at `config/mtls/worker-*.pem`; rotate ~ yearly; share CRL at `config/mtls/crl.pem`. All `*.pem.local` gitignored.
- **Increase / lost:** without mTLS, any tailnet peer (or `0.0.0.0` if mis-set) can reach RPC; with mTLS, stolen tailnet key alone is insufficient — but lost CA key can issue rogue workers (guard CA).
- **Interaction with `TAILSCALE_IP`:**
  - `MTLS_WORKERS_ENABLED=0` (default): firewall / `cms.toml` stays `TAILSCALE_IP` allow ALL — existing behavior.
  - `MTLS_WORKERS_ENABLED=1`: firewall SHOULD restrict RPC to mTLS only (e.g. `iptables -A INPUT -p tcp --dport 26000 -m conntrack …` or nginx `ssl_verify_client on`). See runbook below.
- **How to enable:**
  ```bash
  # Generate self-CA + worker cert (local, gitignored via *.pem.local)
  mkdir -p config/mtls
  openssl req -x509 -newkey rsa:4096 -days 365 -nodes -keyout config/mtls/ca-key.pem.local -out config/mtls/ca.pem.local -subj /CN=CMS-mTLS-CA
  openssl req -newkey rsa:2048 -nodes -keyout config/mtls/worker-key.pem.local -out /tmp/worker.csr -subj /CN=worker-0
  openssl x509 -req -in /tmp/worker.csr -CA config/mtls/ca.pem.local -CAkey config/mtls/ca-key.pem.local -CAcreateserial -out config/mtls/worker.pem.local -days 365

  echo 'MTLS_WORKERS_ENABLED=1' >> .env.local
  echo 'MTLS_CA_CERT=config/mtls/ca.pem.local' >> .env.local
  echo 'MTLS_WORKER_CERT=config/mtls/worker.pem.local' >> .env.local
  echo 'MTLS_WORKER_KEY=config/mtls/worker-key.pem.local' >> .env.local

  # compose mounts are commented but documented in worker service — uncomment to enforce:
  # - ${MTLS_CA_CERT}:/etc/cms/mtls/ca.pem:ro
  # Then restart with that mount + enforce ssl_verify_client at proxy
  ```
  When disabled: logs `mTLS workers disabled (set MTLS_WORKERS_ENABLED=1 … TAILSCALE_IP allow ALL remains)`.

---

## TUI / Script Behavior (never forced)

- `scripts/__domain.sh setup` prompts for each of the four if not already set, only on TTY, skipped with `--yes` / `-y` or non-TTY (CI).
- `scripts/__domain.sh {status,preflight}` always logs a one-liner per feature (`… disabled (set …=1 to enable)` or `… enabled …`) without failing when off.
- `scripts/__secrets-rotate.sh` header notes Vault as alternative; `.env.local` and `.env.*.local` are gitignored for local secrets.

## Validate (no breaking change when off)

```bash
bash -n scripts/__domain.sh && bash -n scripts/__secrets-rotate.sh
docker compose config > /dev/null
docker compose -f docker-compose.domain.yml config > /dev/null
docker compose -f docker-compose.vault.yml --profile vault config | grep -q vault
grep -q 'HSM_ENABLED=0' .env.infra.example && grep -q 'VAULT_ENABLED=0' .env.infra.example
grep -q 'DNSSEC_ENABLED=0' .env.infra.example && grep -q 'MTLS_WORKERS_ENABLED=0' .env.infra.example
git check-ignore -q .env.local config/hsm/tokens/foo.db config/mtls/ca.pem.local && echo "gitignore ok"
```
