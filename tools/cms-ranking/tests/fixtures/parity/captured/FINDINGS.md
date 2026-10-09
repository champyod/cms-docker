# What the capture says about the port

Each row compares the captured bytes with what `tools/cms-ranking` emits today.

| Route | Captured | The port | Verdict |
| :--- | :--- | :--- | :--- |
| `/` | the vendored page | the same file from `RANKING_STATIC_DIR` | matches |
| `/scores` | `{}` | an object keyed by user, empty with no submissions | matches |
| `/history` | `[]` | an array, empty with no submissions | matches |
| `/config` | exactly two keys | thirteen fields, nulls included | **diverges** |
| `/credits` | `project` and `license` are objects | both are strings | **diverges** |
| `/users/` | 200 with the users, `f_name`/`l_name`/`team` | 503, not routed | **missing** |
| `/users/u0` | 404, HTML body | not routed | **diverges** |
| `/events` | a `:` heartbeat, no data event in five seconds | a `reinit` event on connect | **diverges** |
| `/logo` | `image/jpeg`, `Last-Modified` | the file, type by extension probe | matches |

## Why each divergence matters

**`/users/` is the serious one.** The page needs names and teams; it is not a push route as
assumed when the CRUD endpoints were left out. Without it the Rust scoreboard shows scores
with no names against them. It must read the `ranking_users` projection.

**`/credits` is a contract, not cosmetics.** The captured body nests `license.spdx_id` and
`project.name`; the port flattening them to strings breaks anything reading those paths, and
the licence is the one thing this project refuses to render wrong.

**`/config` extra keys are additive** and the page reads by name, so it will not break — but
byte comparison is impossible while thirteen keys are serialised where two were sent, and
`access_mode` leaks the protected-mode setting to anonymous readers.

**`Timestamp`.** The capture shows `Timestamp` on `/scores` but not on `/history`; the page's
data store uses it to discard out-of-order responses. The port must send it where the
baseline does and nowhere else.

**`/events` connect behaviour** differs, so an EventSource client sees a different first
message than it did in production.

