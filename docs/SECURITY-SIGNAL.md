# Security signal — one digest on the panel, one message that must not wait

**Register item:** D1 in `TODO-DEV.md` (*"no security signal reaches a human"*). Its recommendation was
**"panel first, external channel next"**; this is both halves, shipped together because a card nobody opens
and a channel nobody trusts are the same failure.

Companion to `docs/SECURITY-FEED.md`, which owns the producer contract. **Nothing here changes that
contract**: a backup age is still not a finding, no source or severity is added, and the ingest endpoint is
untouched.

## 1. What pushes, and what only appears on the page

A notification is worth its noise only when ignoring it has a cost that grows by the hour.

**Pushed** (`buildSecurityDigest` → `triggers`):

| fact | why it starts a message |
|---|---|
| **a waiver past its `review_by`** | the decision lapsed: the CI waiver gate fails from that moment, so every deploy is blocked, and the finding it covered is unowned again. Cheapest thing on this list to fix. |
| **an unresolved CRITICAL with no live waiver** | the class where "the next Renovate PR will bump it" is not a plan. Any waiver state other than `active` suppresses nothing, so a lapsed waiver counts here too — but it is pushed *as the lapsed decision*, never twice. |
| **`cms_backup_stale` or `cms_offsite_stale` = 1** | the one fact that cannot be repaired after the fact. |
| **a copy whose staleness cannot be evaluated** | fail closed: a monitoring stack that is down, a series that is missing, a publisher that stopped writing — each is reported as *cannot evaluate*, never as healthy. |

**Page only** (`riders` — named in a message that something else started, never a reason to send one):

| fact | why it stays on the page |
|---|---|
| a waiver **expiring** within `SIGNAL_RULES.waiverWarningDays` (7) | an advance warning is planning. It becomes a push the moment it actually lapses. |
| an unwaived **HIGH** | the ordinary state of an unpatched image between two daily bumps. Paging it makes the channel unreadable in a week. |
| a finding **older than** `SIGNAL_RULES.findingAgeDays` (14) | age is a prioritisation signal, not an event; "still 40 days old" repeats what the page already says. |
| a **stale image** (Diun) | drift is routine and Renovate owns the action; the same six images would page every cycle. |
| MEDIUM / LOW / UNKNOWN, per-waiver history | no decision changes by being told at 3 a.m. |

The rule of thumb: **push what a human must act on and cannot discover by opening one page; leave the
rest on the page that exists for it.**

## 2. The panel digest

One card — `components/security/SecuritySignalCard.tsx` — at the top of `security/overview`, built from the
shared `Card`/`Badge` primitives and the dictionary:

- the counts that matter (`unwaived critical`, `unwaived high`, expired waivers, waivers due within 7 days,
  findings older than 14 days), with zeroes hidden so a clean card is one sentence instead of four noughts;
- **the worst finding named** (severity · waiver state) and **the oldest unowned item named** with its age;
- one line per copy: `Backup: current 4h ago` / `stale` / `cannot evaluate — <reason>`;
- a link to `/…/security/patching` for the detail.

It is a **server component with no query of its own**: `readPatchingSnapshot()` (in
`lib/security/patching-read.ts`) returns `PatchingSnapshot = PatchingState & { signal: SecurityDigest }`, so
the card, the four existing patching cards, the page and the channel all read one computation of one set of
rows. The digest reads the four existing tables' state; the backup readings come from the series the backup
scripts publish (below), not from a second definition of "unresolved".

The card does not claim health when it cannot see: an unevaluable copy renders `cannot evaluate` plus the
sentence *"A backup reading could not be taken, so this card does not claim the backups are healthy."*

## 3. The external channel

`logToDiscord` (`lib/discord-notifier.ts`) — the same webhook, role and colour the backup and lockout alerts
already use. No second notifier, no second channel implementation.

**Deduplicated.** Each push-worthy fact carries a key that is stable while the fact is: `waiver:<id>:expired`,
`finding:source:key`, `stale:<channel>`, `cannot-evaluate:<channel>`. A tick diffs the current keys against the
keys of **the last message that actually left**, and sends only when there is at least one key the last
message did not carry. So an expired waiver pages once, not once a minute, and a *new* expired waiver in the
same set still pages immediately. The message always carries the **full** current trigger set (plus the riders
as one counted line), so the operator is not left guessing whether the older item was fixed.

**Rate-limited.** One message per `SIGNAL_RULES.minIntervalMs` (10 min), however many facts are new — the
floor exists for flapping producers (a partial push resolves a row and the next complete push brings it back,
which makes the same fact "new" again seconds later). A suppressed fact is never marked as said, so it goes
out on the first tick after the floor. A message is capped at `maxLines` (12) detail lines and counts the rest.
The role is mentioned only when the message carries a critical finding or a staleness fact — a lone lapsed
waiver does not ping the whole role.

**Quiet when nothing changed.** No triggers → nothing is sent (not even an empty digest). Same triggers as the
last message → no send.

**Where the dedupe state lives: `audit_log`.**

| requirement | how the audit log satisfies it |
|---|---|
| survives a restart | it is Postgres. `readLastPage()` reads the newest `security.signal.notified` row by its entity index; a container restart, a deploy or a `down -v` of anything else cannot lose it |
| cannot be rewritten | the table is append-only **by absence of any UPDATE/DELETE policy**, so a later run cannot edit what an earlier one said |
| one truth, not a second | "a page was sent to a human" *is* an action, and the audit trail is the panel's one record of actions. A dedicated table would be a second truth about the same event and needed its own migration and policy |
| auditable | `after_values` carries `{keys, fresh, tone, counts}` and `reason` says "N push-worthy item(s), M new" — so "when was anyone told?" is answerable on the audit page |
| only counts a *delivered* message | `logToDiscord` returns whether the receiver accepted the POST; the row is written **after** that. A refused or failed POST leaves no record, so the fact stays fresh and is retried |

Only the newest row is read, and the message always carries the whole trigger set, so retention pruning old
rows (D3) cannot weaken the diff.

**When the state cannot be read at all** (database down, actor missing), no diff is possible: the tick logs
and pages at most once per 15 minutes, and not at all inside the first 60 s after boot — a restart is not an
outage.

## 4. What runs on a schedule

`security-signal` in **`docker-compose.security.yml`** (the security overlay that already exists), under its
**own profile**:

```
docker compose --env-file .env --env-file .env.security \
  -f docker-compose.yml -f docker-compose.security.yml --profile security-signal up -d security-signal
```

- **No new image and no host process.** It is the second entry point of the poller image
  (`docker/scheduler/Dockerfile`): `node bootstrap.mjs security-signal` runs the same compiled tree as the
  backup scheduler, because the decision must use the panel's `readPatchingSnapshot` and `logToDiscord`.
  `bootstrap.mjs` keeps `main.js` as the default entry, so the scheduler's own start is unchanged, and the
  entry name is taken from a closed allowlist rather than from a path.
- **The actor is set once, for the process lifetime.** `withActor({kind:'system', name: SYSTEM_IDENTITIES.SCHEDULER}, …)`
  wraps everything before the first tick. Every table is `FORCE ROW LEVEL SECURITY` on `cms.actor`, so a query
  outside that scope reads nothing and throws — which is why no identity is added: `system:scheduler` is
  already in the generated allowlist, and adding a new `system:` name would mean editing the policies.
- Read-only rootfs, every capability dropped, no host mount, no docker socket; the only inputs are Postgres,
  Prometheus over `cms-network` and one webhook.
- `security-signal` is a separate profile from `security`: turning the feed on does not turn the notifier on.

## 5. Backup and offsite staleness

**Read, not recomputed.** One request to `PROMETHEUS_URL` (`/api/v1/query`, 1.5 s timeout) asks for
`cms_backup_stale`, `cms_offsite_stale`, `cms_backup_last_success_age_seconds`,
`cms_offsite_last_ship_age_seconds` and `cms_backup_metrics_written_timestamp_seconds` — the series the
backup and offsite scripts already write through node-exporter's textfile collector
(`publish_backup_metrics` in `scripts/__lib/common.sh`).

The **scripts' verdict is the verdict**: `stale = 1` is stale, and this module never re-derives the window.
The only extra judgement is about the *publisher*, and it reuses the scripts' own number
(`BACKUP_STALE_HOURS`, default 26, the same knob): `cms_backup_stale = 0` is trusted only while the write
stamp is inside that window, because the verdict describes the moment the file was written. A file older than
the window means no backup and no offsite sync ran inside it, which is exactly the condition that window
describes — so the reading becomes `cannot evaluate` rather than a stale-forever "healthy".

`unknown` is a first-class state: unreachable scrape target, non-2xx, unparsable body, or a missing series
each produce `unknown` with the reason, and `unknown` pushes.

## 6. Tests

`admin-panel/tests/security-signal-*.test.ts(x)`:

| file | what it pins |
|---|---|
| `security-signal-digest.test.ts` | the counts, the worst/oldest named item, triggers vs riders, one line per item when a critical's waiver lapsed, HIGH never triggering alone, a lapsed-soon waiver staying on the page, and the unevaluable reading being a trigger |
| `security-signal-notify.test.ts` | dedupe (the same fact is quiet forever), a new fact re-sending with the whole state, the rate-limit floor, `nothing-to-say`, the mention rules, the line cap |
| `security-signal-run.test.ts` | the tick: deliver-then-record, retry when delivery is refused (nothing recorded), unreadable → no send, the 15-minute read-failure floor |
| `security-signal-staleness.test.ts` | the parser (current / stale / missing channel / dead publisher / malformed), the HTTP paths (unreachable, 503, one request for the five series), and the `BACKUP_STALE_HOURS` knob |
| `security-signal-card.test.tsx` | the card's counts, the named items, the detail link, the all-clear sentence, and the "does not claim healthy" note |

The run proof (scratch Postgres with the real RLS policies, a stub scrape target, a stub webhook, the compiled
entry point started the way the container starts it) is in the lane report: one delivered digest, a second
process quiet because the record survived, and the fail-closed message when the scrape target disappeared.
