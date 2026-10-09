# Security module — operator guide

The admin panel Security group gives a permissioned view of the deployment security surfaces
and the safe subset of actions an operator may take from the panel. Nothing here replaces the
host CLI: every mutation either writes a tracked config file or queues a request for the host
agent.

## What the panel may do

| Field | Reads | Writes |
|---|---|---|
| Overview | WAF state, banned addresses, open lockouts, certificate expiries, agent health | — |
| WAF | engine mode, paranoia, thresholds, container state, parsed audit alerts | config.toml [infra] WAF_* and config/modsecurity/crs-setup.conf; sync + recreate, or restart, grader-waf |
| Blocks | fail2ban bans reported by the agent, open login lockouts from the ledger | queue an unban; lift a lockout |
| TLS | lineages under config/letsencrypt/live, proxy and certbot state | queue a certificate renewal |

Every write requires a reason and records an audit_log row. Security verbs are pushed to the
notification bell and to Discord when the webhook is configured.

## Permissions

Two seeded groups carry the surface:

- **Security Admin** — security:read, waf:read, waf:config, waf:control, ban:read, ban:unban,
  lockout:read, lockout:unlock, tls:read, tls:renew.
- **Superadmin** — the same ten keys, plus the backup family except backup:schedule.

container:control alone does not reach the WAF controls. waf:control is no longer a reserved
key: the container guard no longer refuses grader-waf, and the recreate is scoped to that one
service by lib/security/waf-compose.ts. domain:control stays reserved: the TLS proxy and
certbot are still refused, and renewal is queued to the host agent under tls:renew.

## Applying a WAF change

| Setting | Written to | Applied by |
|---|---|---|
| WAF_ENABLED, WAF_RULE_ENGINE, WAF_RESP_BODY_ACCESS | config.toml [infra] | Sync and recreate WAF: runs scripts/__config_sync.sh, then recreates grader-waf alone with docker-compose.yml + docker-compose.domain.yml + docker-compose.waf.yml --profile core --profile waf |
| paranoia level, inbound/outbound anomaly thresholds | config/modsecurity/crs-setup.conf (authoritative under MANUAL_MODE=1), with a .bak of the previous file | Restart WAF: the file is a read-only bind mount, re-read on start |

The panel mounts the cms-waf-logs volume read-only at /var/log/waf and parses the ModSecurity
audit log (JSON, one object per line) for rule id, anomaly score, URI and whether the request
was interrupted. A native-format log yields no rows, and the page reports the unparsed line
count rather than guessing.

## The host agent

The panel never runs fail2ban-client or certbot. It validates a request, writes it under
.security-agent/queue/ in the repo, and the agent applies it on the host:

    sudo make security-agent      # install + start the systemd timer (30 s tick)
    make security-state           # print the fail2ban state the panel reads
    make security-unban JAIL=nginx-limit-req IP=203.0.113.7
    bash scripts/__security-agent.sh --check

- Queue, results and state live under .security-agent/, which is gitignored and root-owned on
  a host install.
- Requests are validated twice: the panel rejects an unknown jail, a malformed address or an
  empty reason, and the agent re-validates before executing.
- No field from a request is ever interpolated into a shell string; the agent passes validated
  arguments to fail2ban-client, and certificate renewal runs scripts/__domain.sh renew.
- If fail2ban-client is unavailable the agent writes no state file, and the Blocks field says
  the agent is not reporting rather than showing an empty list as "no bans".

## Data

security_blocks records one row per block event — a fail2ban ban, a login lockout or a WAF
block — never per failed attempt. The login counter stays in memory and the row is written when
the threshold is crossed, so a brute-force run cannot amplify into database writes. The table is
excluded from the selective-backup catalog for the same reason audit_log is: its rows are only
meaningful as the record of events that actually happened.
