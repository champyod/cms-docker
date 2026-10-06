# Address / Bind Model

How a service decides which host address its published ports bind to, and how to
publish on more than one address.

## Variables

| Variable | Scope | Meaning |
| --- | --- | --- |
| `BIND_MODE` | system | `local` / `public` / `ts-http` / `domain`. Empty keeps each service's own default. |
| `EXTRA_IPS` | system | Comma-separated extra addresses (e.g. the tailnet IP). Alias for `INNER_IP` when unset. |
| `INNER_IP` | system | Comma-separated peer/private address. Any VPN address, or `0.0.0.0` to accept from anywhere. Empty resolves to `127.0.0.1`. |
| `PUBLIC_IPS` | system | Comma-separated public addresses. Falls back to the legacy `PUBLIC_IP`. |
| `<SVC>_BIND_IP` | service | Explicit bind for one service; wins outright. Comma list allowed. |
| `<SVC>_EXTRA_IP` | service | Extra address for one service, overriding the system-wide extra for it. |

## Resolution (highest priority first)

1. `<SVC>_BIND_IP`
2. `<SVC>_EXTRA_IP`
3. `BIND_MODE`: `local`/`domain` → `127.0.0.1`; `public` → `PUBLIC_IPS`; `ts-http` → `EXTRA_IPS`
4. nothing set → the service keeps its compose default (nothing is emitted for it)

## `INNER_IP` direction

`INNER_IP` is read by both machines, and the same key names opposite things on each. It
is one key rather than two on purpose: two keys would let the main server and its workers
drift apart silently, and the drift would only surface as an unreachable worker fleet.

| Machine | Meaning | Reader |
| --- | --- | --- |
| Main server | The address to bind worker-RPC ports to; `/metrics` allow-list entry | `__domain.sh`, `__render_expose.sh`, compose port bindings |
| Worker | The main server's address to dial | `__worker_tui.sh`, read from the worker's own `config.toml` |

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
