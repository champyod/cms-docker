# Address / Bind Model

How a service decides which host address its published ports bind to, and how to
publish on more than one address.

## Variables

Every published port is named by exactly one key, and that key alone decides the
address it answers on. There is no system-wide switch.

| Variable | Scope | Meaning |
| --- | --- | --- |
| `<SVC>_BIND_IP` | front-door service | The address one service's published ports answer on. A comma list publishes on several at once. |
| `INNER_IP` | peer-facing services | The address `database`, the six RPC services and `worker` publish on, and the address a worker dials to reach the main server. Empty leaves each on its compose default (`127.0.0.1`). |
| `PUBLIC_IP` | not a bind key | Your box's public IP. Used for `CORE_SERVICES_HOST` and apt-mirror selection, **not** for binding a port. Keep it separate from `INNER_IP` — they answer different questions and merging them silently repoints one of the two. |

The front-door keys are `CONTEST_BIND_IP`, `NGINX_BIND_IP`, `ADMIN_BIND_IP`,
`ADMIN_NEXT_BIND_IP` and `RANKING_BIND_IP`. `database` uses `DB_BIND_IP` and
`worker` uses `WORKER_BIND_ADDR`.

## Resolution

1. `<SVC>_BIND_IP` — the service's own key. A comma-separated list is several
   addresses, one published entry each.
2. Nothing set → the service is not emitted and keeps its compose default. For
   `database` and the six RPC services that default is `${INNER_IP:-127.0.0.1}`,
   so an unset key means loopback, not every interface.

A port answers on an address only when the key owning that port names that
address. There is no fallback that puts the peer ports — postgres, the RPC
services, the worker's 26000 — on an address set for the web tier, so widening
the front door never widens the evaluation surface.

## `INNER_IP` direction

`INNER_IP` is read by both machines, and the same key names opposite things on each. It
is one key rather than two on purpose: two keys would let the main server and its workers
drift apart silently, and the drift would only surface as an unreachable worker fleet.

| Machine | Meaning | Reader |
| --- | --- | --- |
| Main server | The address to bind worker-RPC ports to; `/metrics` allow-list entry | `__domain.sh`, `__render_expose.sh`, compose port bindings |
| Worker | The main server's address to dial | `__worker_tui.sh`, read from the worker's own `config.toml` |

## Publishing on several addresses

`ADMIN_BIND_IP = "203.0.113.10,100.64.0.1"` publishes that service's ports on the
public address and the tailnet address together. Comma-separated is how several
addresses are published — there is no second key and no mode to set.

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
ADMIN_BIND_IP = "203.0.113.10"
```

Public plus tailnet on the same service:

```
ADMIN_BIND_IP = "203.0.113.10,100.64.0.1"
```

Loopback only (local testing) — unset the key and the compose default keeps it there:

```
ADMIN_BIND_IP = ""
```

Workers reachable on the tailnet only:

```
INNER_IP = "100.64.0.1"
WORKER_BIND_ADDR = "100.64.0.1"
```