# What the capture says about the port

Recorded from the running Python service on 2026-10-09 with the fixture set seeded through
its own authenticated PUT path (`seed_sha256=19734aff...`). Every row is observed bytes.

## Routes the page fetches, and what the port must serve

| Route | Observed | Notes |
| :--- | :--- | :--- |
| `/` | the vendored page | already served |
| `/scores` | `{"u0": {"t0": 100.0}, ...}` | nested user -> task -> best score, `Timestamp` |
| `/history` | `[["u0", "t0", 1700001000, 50.0], ...]` | arrays, no `Timestamp` |
| `/config` | two keys | already served, but 13 are serialised |
| `/credits` | `license`/`project` are objects | the port flattens them to strings |
| `/logo` | `image/jpeg` | already served |
| `/contests/`, `/contests/<k>` | object keyed by key | **missing in the port** |
| `/tasks/`, `/tasks/<k>` | object keyed by key | **missing** |
| `/teams/`, `/teams/<k>` | object keyed by key | **missing** |
| `/users/`, `/users/<k>` | object keyed by key | **missing** |
| `/sublist/<user>` | `[]` for a user with no submissions | **missing**; no `Timestamp` |
| `/faces/<user>` | 200 `image/png`, the bundled dummy face | **missing**; not 404 |
| `/flags/<team>` | 200 `image/png`, the bundled dummy flag | **missing**; not 404 |

## The three findings that matter

**Faces and flags are never 404 for a known key.** The service answers with its bundled
dummy assets when the entity has none, so the earlier 404s were for keys that do not exist.
The port must serve a fallback image, and the images ship with the vendored static files.

**`Timestamp` is not universal.** It is on `/scores` and on every entity list and single
route, and absent from `/history`, `/sublist`, `/config`, `/credits`, `/logo` and every 404.

**The event stream, verbatim.** The greeting is `:`; each block is `id:<hex microseconds>`,
`event:<name>`, `data:<payload>` and a blank line; `reinit` appears only after a stale
`Last-Event-ID` and carries neither `id` nor `data`. Names and payloads observed:
`contest|task|team|user` with `create <key>` / `update <key>`, and `score` with
`<user> <task> <score>`. Re-seeding the same keys emitted `update` instead of `create` and
no `score` events, because the scores did not change.

The port's current feed opens with `reinit` unconditionally, uses compact JSON, and sends no
`Timestamp`.

