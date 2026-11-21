# S-2c — `cmscommon.datetime`, the gap on S-3's critical path

`../PLAN.md` §3 lists S-2 as `cmscommon` + `cms.io` + `conf`/`log`/`util`/`locale`. This file covers
the module that turned out to be the actual blocker: `cms/db` (S-3, the critical path under every
later slice) imports **only four** things from `cmscommon` — `digest`, `datetime`, `crypto`,
`constants` — and `datetime` has **no Rust port at all**. Measured on this lane's base `e418a316`:

```
grep -rn 'from cmscommon\.' src/cms/db/*.py   →   digest 1, datetime 1, crypto 1, constants 1
grep -c  get_timezone|make_datetime|make_timestamp|get_system_timezone  backend/**/*.rs  →  0 for all four
```

So this is 110 lines standing between the whole migration and its first real slice. That is why it
comes before S-2b (`archive`, `conf_parser`, `mimetypes`, `terminal`), whose Python files cannot be
deleted yet anyway: each still has live Python consumers (`conf_parser` ← `cms/conf.py`, `terminal` ←
`cms/log.py` + `cmstaskenv`, `mimetypes` ← 5 files, `archive` ← 3 files), so a "delete the Python file"
criterion there could only be met by deleting something still in use.

## What to port

`src/cmscommon/datetime.py`, 110 lines, 6 public names:

| Name | Behaviour to preserve |
|---|---|
| `make_datetime(timestamp=None)` | `None` → now; else `datetime.utcfromtimestamp(t)`. **Always UTC, never local.** |
| `make_timestamp(dt=None)` | `None` → `time.time()`; else `(dt - datetime(1970,1,1)).total_seconds()` — note this is the *UTC-naive* difference, not `dt.timestamp()`. |
| `EPOCH` | `datetime(1970, 1, 1)`, naive |
| `get_timezone(user, contest)` | the user's timezone, else the contest's, else `local_tz`; a `LookupError` from babel falls through to the next candidate rather than raising |
| `get_system_timezone()` | the system's best timezone description, `"Europe/Rome"`-like |
| `utc`, `local_tz` | the two module constants |

## The trap, and it is the whole test

`make_timestamp` is **not** `dt.timestamp()`. It subtracts a **naive** epoch, so a timezone-aware
datetime produces the same number as its naive local spelling — and the rest of the system depends on
that convention (the DB stores naive UTC instants). `chrono`'s `.timestamp()` on a `DateTime<Utc>` gives
the true POSIX value, which agrees only for UTC. So:

- port `make_timestamp` as the naive-epoch subtraction, and
- prove it with a **non-UTC** input: a `+05:00` datetime whose `make_timestamp` differs from
  `dt.timestamp()` by exactly 18000 s. A test that only uses UTC cannot tell the two implementations
  apart, and will pass either way.

## Where

A module in an existing crate — check `cms-db` first, it is the caller. Do not create a sixth workspace
member. `chrono` is already a workspace dependency (`backend/Cargo.toml`), so no new crate is needed
for the datetime maths; `babel`-equivalent timezone lookup is the only part that may need one, and if
it does, **propose it in the handback, do not add it** — a new dependency is the operator's decision.

## Acceptance criteria

1. `make_datetime`, `make_timestamp`, `EPOCH`, `utc`, `local_tz` ported. `get_timezone` and
   `get_system_timezone` may be deferred **only** with a named reason (which caller needs them and
   which slice will supply them) — say so rather than porting a stub that returns a default.
2. **Cross-language proof against the Python implementation** for `make_timestamp`: for a naive
   datetime, a `+05:00` datetime, a `-08:00` datetime and a mid-DST instant, the Rust value equals
   `src/cmscommon/datetime.py`'s. Run the Python side; do not reason about it. Report each pair.
3. A test that **fails** if `make_timestamp` is implemented as `dt.timestamp()` instead of the naive
   subtraction: invert it, show the failure, restore, show the pass.
4. `make_datetime(None)` is UTC now, not local now — prove it by asserting the offset is zero even
   while `TZ` is set to something else in the test process.
5. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` exit 0 in
   `backend/`. Name the crate.

## Out of scope

- Do not edit `admin-panel/**`, `docs/DESIGN*.md`, `src/**` (read it, do not change it), other lanes.
- Do not add a dependency; propose it instead.
- Do not port `babel`'s whole timezone database — the fallback chain (`user → contest → local`) is what
  matters, and a named "deferred" is an acceptable answer for the lookup itself.

## Report

Evidence table, one row per criterion (command | exit code | count), then what landed (SHA), what is
blocked (named), what is next.
