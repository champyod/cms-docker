# Address / Bind Model

How a service decides which host address its published ports bind to, and how to
publish on more than one address.

## Variables

| Variable | Scope | Meaning |
| --- | --- | --- |
| `BIND_MODE` | system | `local` / `public` / `ts-http` / `domain`. Empty keeps each service's own default. |
| `EXTRA_IPS` | system | Comma-separated extra addresses (e.g. the tailnet IP). Alias for the legacy `TAILSCALE_IP` when unset. |
| `PUBLIC_IPS` | system | Comma-separated public addresses. Falls back to the legacy `PUBLIC_IP`. |
| `<SVC>_BIND_IP` | service | Explicit bind for one service; wins outright. Comma list allowed. |
| `<SVC>_EXTRA_IP` | service | Extra address for one service, overriding the system-wide extra for it. |

## Resolution (highest priority first)

1. `<SVC>_BIND_IP`
2. `<SVC>_EXTRA_IP`
3. `BIND_MODE`: `local`/`domain` → `127.0.0.1`; `public` → `PUBLIC_IPS`; `ts-http` → `EXTRA_IPS`
4. nothing set → the service keeps its compose default (nothing is emitted for it)

## Publishing on several addresses

docker compose pins one `host_ip` per port entry, so N addresses need N entries, and
a single `${VAR}` cannot expand into several lines. `scripts/__render_expose.sh`
resolves the model and writes `docker-compose.expose.yml`, which the `Makefile`
includes automatically when present (`COMPOSE_FILES`).

```
bash scripts/__render_expose.sh
make core        # or ./cms deploy all
```

The override uses Compose's `!override` tag to replace a service's `ports` list, so
it needs Compose >= 2.24. The generated file is gitignored.

## Examples

Public host, single address:

```
BIND_MODE = "public"
PUBLIC_IPS = "203.0.113.10"
```

Public plus tailnet, worker reachable on the tailnet only:

```
BIND_MODE = "public"
PUBLIC_IPS = "203.0.113.10"
EXTRA_IPS = "100.64.0.1"
WORKER_EXTRA_IP = "100.64.0.1"
```

Loopback only (local testing):

```
BIND_MODE = "local"
```
