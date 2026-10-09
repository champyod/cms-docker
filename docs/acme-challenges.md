# ACME challenge selection

How this stack obtains and renews the certificate the domain proxy serves, which
challenge it answers, which CA signs it, and what happens when a certificate did not
come from a CA at all.

All keys live in `config.toml` under `[admin]`. Run `./cms config sync` after editing so
`.env` is regenerated. Every example below uses `example.org` and `192.0.2.0/24`
(TEST-NET); real hostnames, addresses and tokens belong only in the gitignored
`config.toml` and `.env*` files.

## The three challenges

| `ACME_CHALLENGE` | Proves control by | Needs | Client |
| --- | --- | --- | --- |
| `http-01` (default) | the CA fetching `http://<name>/.well-known/acme-challenge/<token>` | a reachable port 80 that nginx can answer | `certbot` |
| `dns-01` | a TXT record at the name's DNS provider | `ACME_DNS_PROVIDER` and its credentials | `certbot` |
| `tls-alpn-01` | the ALPN protocol `acme-tls/1` on **TCP 443** | the proxy to release :443 for the run | `lego` |

`tls-alpn-01` is the one to reach for when a network drops inbound port-80 requests
carrying `/.well-known`. RFC 8555 fixes that path and the CA has no fallback port, so
no amount of configuration makes HTTP-01 work there — but TLS-ALPN-01 is validated on
443 with the path hidden inside TLS, which such a filter does not see.

`certbot` **cannot** answer `tls-alpn-01`: it never shipped the challenge and removed
the last of the supporting code in 5.0.0. Asking for the combination is refused by name
rather than attempted.

```toml
ACME_CHALLENGE = "tls-alpn-01"
ACME_CLIENT    = "lego"
```

## Keys

| Key | Default | Meaning |
| --- | --- | --- |
| `ACME_CHALLENGE` | `http-01` | which challenge answers |
| `ACME_CLIENT` | `certbot` | which client runs it; `tls-alpn-01` requires `lego` |
| `ACME_CA` | `letsencrypt` | `letsencrypt`, `letsencrypt-staging`, `zerossl`, `buypass`, `custom` |
| `ACME_DIRECTORY_URL` | `""` | explicit ACME directory, wins over `ACME_CA` |
| `ACME_DNS_PROVIDER` | `""` | DNS-01 plugin name (e.g. `cloudflare`), required by `dns-01` |
| `ACME_DNS_CREDENTIALS_FILE` | `""` | plugin credentials; empty derives one from `CLOUDFLARE_API_TOKEN` |
| `ACME_CERTBOT_IMAGE` | `certbot/certbot` | certbot image; `certbot/dns-cloudflare` for DNS-01 |
| `ACME_TLS_ALPN_ADDRESS` | `:443` | address lego binds while the proxy is stopped |
| `ACME_LEGO_IMAGE` | `goacme/lego:v5.5.2` | pinned lego image |
| `ACME_HANDOVER_TIMEOUT` | `60` | seconds to wait for :443 to free and to return |
| `ACME_RENEW_AT_UTC` | `03:00` | HH:MM UTC an unattended `tls-alpn-01` renewal may take :443; `""` disables it |
| `ACME_RENEW_BEFORE_DAYS` | `7` | days of validity left before a `tls-alpn-01` certificate counts as due |
| `ACME_HTTP01_ON_443` | `0` | answer HTTP-01 on :443 and have :80 redirect everything there |
| `DOMAIN_CERT_METHOD` | `letsencrypt` | `letsencrypt`, `provided`, `selfsigned` — how the certificate is obtained |

`DNS_PROVIDER`, `DNS_CREDENTIALS_FILE` and `CERTBOT_IMAGE` were renamed into this
namespace. `./cms config sync` moves their values onto the new keys and deletes the old
lines; a host whose `.env` predates that sync still reads them and warns once.

## Certificate authority

```toml
ACME_CA = "zerossl"                    # or letsencrypt, letsencrypt-staging, buypass
ACME_DIRECTORY_URL = ""                # set instead for a CA the list does not name
```

`LE_STAGING = 1` is an alias for `ACME_CA = "letsencrypt-staging"`. The directory is
passed to `certbot` as `--server` on issuance; `certbot renew` deliberately carries no
`--server`, so a change of CA never moves an existing lineage behind your back.

## The :443 handover

A TLS-ALPN-01 client has to own port 443 to answer, and `grader-nginx-proxy` owns it.
Issuance therefore runs as a handover:

1. record whether the proxy is running and stop it,
2. wait up to `ACME_HANDOVER_TIMEOUT` for :443 to go quiet,
3. run lego under `goacme/lego` with `--network host`,
4. start the proxy again, install into `live/<lineage>/`, reload,
5. on **any** exit path — including a failure or a Ctrl-C — step 4 still happens.

The public site is down for the length of the challenge: typically seconds, tens of
seconds on a slow CA. An empty `ACME_PROXY_TO_RESTORE` makes the restore idempotent, so
the exit trap and the normal path cannot both try to start a container.

`--auto-retry` is deliberately ignored for this challenge. Each failed validation spends
one of the five attempts Let's Encrypt allows per hour per name, and re-running a failing
handover is what drives a consecutive-failure run into a multi-month issuance pause.

### When the unattended renewal fires

`renew --due` takes :443 only when **both** hold:

- `days_left <= ACME_RENEW_BEFORE_DAYS`, and
- the current UTC time has reached `ACME_RENEW_AT_UTC`.

So the first day the margin is reached is the day it fires, at the hour you configured,
and never outside it. `ACME_RENEW_AT_UTC = ""` disables the unattended handover entirely
and leaves renewal to you.

The timer's `ExecStart` is `scripts/__domain.sh renew --due --apply`, run out of the
checkout the unit was installed from. It calls the script directly rather than `./cms`
because it is not an operator command: there is nobody there to answer a prompt, and
`--due` is the only authority the scheduled run needs.

```sh
./cms domain setup --install-timer  # install + enable the hourly renewal timer, then stop
./cms domain status                 # shows the window, the expiry and the mechanism
./cms domain renew --apply          # reissue now, ignoring the window
./cms domain renew --due --apply    # what the timer's ExecStart runs
```

`--install-timer` short-circuits: it installs and stops, so `setup` does not also run.
`./cms domain renew --install-timer` installs the same units.

`grader-cert-renew.timer` ticks hourly, because a twelve-hour tick would pass
`ACME_RENEW_AT_UTC` and miss it by twelve.

### Where the timer is installed

The units are written to `~/.config/systemd/user` and enabled with `systemctl --user`, so
no root and no system-wide service is involved. A user manager only exists while that
account has a session, which on a headless host means the timer never fires at all. The
install therefore runs `loginctl enable-linger "$(id -un)"`, which keeps the user manager
alive with no one logged in. That needs authorization the installer may not have, so it
warns and prints the command rather than failing an install whose units are already in
place; a timer on a host without lingering stays dormant until an operator runs it.

## Importing an externally issued certificate

When the certificate was produced somewhere else — another ACME client, an internal CA,
a campus PKI — import it as `provided`:

```sh
./cms domain setup --cert provided \
  --cert-path /path/to/fullchain.pem --key-path /path/to/privkey.pem --apply
```

Before it is copied anywhere, the import checks that the chain verifies, that the key
belongs to the certificate, and that it covers every configured name. A key that does
not match stops the run — a mismatched pair copies happily and is only refused by nginx
at the next reload, by which point the old certificate is already gone.

It is installed into `live/<lineage>/{fullchain,privkey}.pem`, which is the single
layout the proxy reads. A flat `live/fullchain.pem` left by an older release is moved
into that layout on the next setup, so the two layouts cannot drift apart again.

## Renewal visibility

`certbot` discovers what to renew from `renewal/<lineage>.conf`. A certificate that was
imported, or issued by lego, has no such file — `certbot renew` reports "No renewals
were attempted" for ever while the certificate approaches expiry, and the renewal line
keeps reading healthy.

`./cms domain status` now names the owner of the certificate on disk before it names any
timer:

| State | Meaning |
| --- | --- |
| `grader-cert-renew.timer` / `certbot.timer` / `certbot-container` | certbot owns it and a schedule runs |
| `lego` | lego owns it; renewal happens inside `ACME_RENEW_AT_UTC` |
| `external` | nothing will renew it — status prints the expiry and the exact procedure |
| `none` | no schedule detected |

`--json` carries the same verdict as `renewal` plus `renewal_managed`, so a monitor can
tell a certificate that will be renewed from one standing still.

An explicit `./cms domain renew` on an externally managed certificate **fails** instead
of reporting a renewal that did not happen.

## HTTP-01 served on :443

Some hosts redirect every port-80 request, which would otherwise bounce the challenge
into itself. Let's Encrypt follows redirects (up to 10, to `http:`/`https:` on ports
80/443), so the challenge can live on :443 and :80 can redirect everything there:

```toml
ACME_HTTP01_ON_443 = 1
```

The location leaves the :80 vhost and appears in **every** :443 vhost — Let's Encrypt
reaches each name with that name's SNI, and a vhost without the location answers 404.

This does not help a network that drops the request before nginx sees it; it is for a
host that only ever answers port 80 with a redirect.

## Command line

Every key has an explicit override. Config is the default source, the command line wins,
and a flag that changes a configured value says so:

```sh
./cms domain cert --challenge tls-alpn-01 --acme-client lego --apply
./cms domain cert --ca zerossl --apply
./cms domain cert --acme-server https://acme.example/directory --apply
./cms domain cert --dns cloudflare --apply
```

| Flag | Overrides |
| --- | --- |
| `--cert <letsencrypt\|provided\|selfsigned>` | `DOMAIN_CERT_METHOD` |
| `--challenge <http-01\|dns-01\|tls-alpn-01>` | `ACME_CHALLENGE` |
| `--acme-client <certbot\|lego>` | `ACME_CLIENT` |
| `--ca <name>` | `ACME_CA` |
| `--acme-server <url>` | `ACME_DIRECTORY_URL` |
| `--dns <provider>` | `ACME_DNS_PROVIDER` |
| `--dns-credentials <file>` | `ACME_DNS_CREDENTIALS_FILE` |
| `--tls-address <addr>` | `ACME_TLS_ALPN_ADDRESS` |
| `--staging` | `LE_STAGING` |

## Where the code lives

| File | Owns |
| --- | --- |
| `scripts/__acme.sh` | challenge, client and CA resolution; the renewal window; status verdicts |
| `scripts/__acme_tls_alpn.sh` | lego issuance and the :443 handover |
| `scripts/__cert_import.sh` | validating a `provided` certificate; retiring the flat layout |
| `scripts/__domain.sh` | the verbs, flags and dispatch that call into them |
| `docker-compose.domain.yml` | the certbot container's own bootstrap and renew loop |

Tests: `tests/test_acme_challenge_selection.sh`, `tests/test_tls_alpn_handover.sh`,
`tests/test_certbot_entrypoint_challenge.sh`, `tests/test_renewal_visibility.sh`,
`tests/test_provided_cert_validation.sh`, `tests/test_http01_on_443.sh`.
