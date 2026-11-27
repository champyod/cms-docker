# Perspective registry — append-only

Every perspective this migration must keep in view. **Entries are added, never deleted, never
merged away.** Retiring a perspective is a recorded decision (`## Retired`, with the reason and the
slice that made it obsolete), never an edit that removes the row.

A slice's coverage table enumerates the rows whose domain it touches, each as
`proved — <command> → <output>` or `n/a — <one clause>`. An absent row is `unowned` and blocks the
merge. The cell-state rule resolves to `dev/agent-protocol.md` §1 (Evidence: a gate counts only
once it has been seen to fail on a dead input); claim and overlap rules resolve to
`coordination/PROTOCOL.md`. This file carries the list; no workflow document is duplicated here.

## A. Equivalence (did it move without changing?)

| ID | Perspective | Domain | Proof |
|---|---|---|---|
| P-01 | route table identity: every route exists, same method, same path | D02 | generated list diff; `FEATURES.tsv` is an unimplemented S-1 follow-up contract, not a current gate (`dev/migration/PLAN.md` §4.1) |
| P-02 | status codes and redirect targets, including the error page | D02 | differential replay |
| P-03 | HTML byte identity for the same template and data | D03 | byte compare, whitespace-normalised only where recorded |
| P-04 | template variable completeness: no undefined variable renders | D03 | Strict; a fixture with a missing key must fail |
| P-05 | i18n: TH and EN dictionaries produce the same keys and the same fallbacks | D03/D11 | dictionary key diff |
| P-06 | RPC method identity: name, argument names, reply shape | D01 | RPC replay per method |
| P-07 | wire framing, one message per CRLF line, 1 MiB cap both directions | D01 | oversized-message test |
| P-08 | ordering and pagination of every list surface | D02 | fixture with ties at the page boundary |
| P-09 | clock and timezone: intervals, deadlines, contest start/end, `parseInterval` semantics | D04 | fixtures around DST and midnight |
| P-10 | numeric semantics: score arithmetic, rounding, ties, `float` vs decimal | D08 | scoring-oracle comparison |
| P-11 | idempotency: the same submission replayed twice | D09 | duplicate delivery test |
| P-12 | bulk and batch operations produce the same rows as the single-row path | D02 | matrix over n=1 and n=many |
| P-13 | empty states: zero rows, zero contests, a contest with no tasks, a task with no active dataset | D02/D08 | the 2026-10-15 case as a fixture |
| P-14 | unicode, RTL and long strings in every rendered field | D03 | fixture corpus |

## B. Security (what must not open)

| ID | Perspective | Domain | Proof |
|---|---|---|---|
| P-15 | authz on every route: allowed/denied matrix per permission key | D06 | matrix test, deny-by-default |
| P-16 | `all:all` expands identically everywhere; one expansion rule | D06 | parity test against the Python predicate |
| P-17 | field-level permission rules exist once, not three times | D06 | single definition + test |
| P-18 | session: cookie flags, expiry, rotation, fixation, CSRF on every mutating route | D05 | attack test per property |
| P-19 | password formats: `bcrypt:` and `plaintext:` prefixes, timing-safe compare, no silent truncation | D05 | fixture per format |
| P-20 | lockout, rate limit and CAPTCHA parity, including the exemptions | D05 | threshold test per path |
| P-21 | SQL injection: no interpolated value reaches the database | D04 | grep gate + deliberate-injection test |
| P-22 | template injection: no user-controlled template source | D03 | review + test with `{{...}}` in data |
| P-23 | XSS: autoescape on for every rendered template, including fragments and macros | D03 | payload corpus |
| P-24 | path traversal on `/file/:digest/:name`, statements, attachments, testcase download | D10 | `../` corpus |
| P-25 | SSRF: any server-side fetch of a user-supplied URL | D02 | internal-address corpus |
| P-26 | archive extraction (dump import, backup restore): zip/tar slip, symlink escape, size bomb | D10/D12 | malicious archive fixtures |
| P-27 | Docker socket: nothing outside one audited boundary can reach it; never root-equivalent from the panel | D12 | capability test + review |
| P-28 | secrets: never in logs, never in the browser, never in an error body | D01/D12 | log and bundle grep |
| P-29 | RPC authentication fails closed when the secret is unset, and the secret never appears in a message | D01 | unset-secret test |
| P-30 | submission flood: per-participant and per-contest limits applied before enqueue | D09 | load test with a bounded queue |
| P-31 | sandbox: untrusted code runs only in the isolating sandbox; no configuration can select the other | D08 | selection test |
| P-32 | audit: append-only, written before the change commits, no unaudited mutation path | D07 | policy test + code path inventory |
| P-33 | RLS: enabled and forced on every table, the app role is demoted, the actor is set per transaction | D04 | coverage gate + role attributes |
| P-34 | resource limits: request body caps, upload caps, output caps, timeouts on every outbound call | D02/D12 | boundary test per limit |
| P-35 | dependency supply chain: licences, advisories, pinned versions, reproducible lockfile | D12 | `deny.toml` + CI |

## C. Operations (what happens at 03:00 during a contest)

| ID | Perspective | Domain | Proof |
|---|---|---|---|
| P-36 | zero-downtime cutover: the new process starts beside the old, the proxy switches, no restart of a running stack | D12 | rehearsal on the dev stack |
| P-37 | rollback: switching the proxy back is sufficient, and the data written by the new process is readable by the old | D12 | rollback drill, recorded |
| P-38 | observability: logs, metrics and traces exist for every new process and name the same things | D12 | endpoint read after deploy |
| P-39 | config compatibility: every TOML section and key keeps its meaning and default | D11 | config fixture + a rendered config diff |
| P-40 | backup/restore and large-object layout stay readable by both stacks during the transition | D10/D12 | restore drill |
| P-41 | CLI surface: same command names, arguments, exit codes and messages | D12 | command table test |
| P-42 | queue and cache semantics: Redis keys, TTLs, and what happens when Redis is down | D09 | failure injection |

### S-6d4 — the evaluation daemon (2026-11-27)

| Perspective | Status | Evidence |
|---|---|---|
| P-36 cutover | **partly proved** — the compose service now runs `cms-evaluation` on the same port with the same published bind, but no rehearsal on the dev stack has been run, so the zero-downtime claim is not yet earned | `docker-compose.yml` service block; `cms-evaluation --help` path unexercised |
| P-37 rollback | proved at source level — reverting `8cf56448` restores `cmsEvaluationService` and the Python unit is one commit back (`35083c54`), so the switch is one revert each way; no data shape changed | `git revert` of the two, no migration involved |
| P-38 observability | partly proved — the daemon logs a named line per failed sweep and per failed operation, and `queue_status` reports depth; no metrics endpoint exists | `cms-evaluation/src/run.rs:66-68`, `service.rs` `queue_status` |
| P-41 CLI surface | proved — `cms-evaluation` reads the same `EVALUATION_SERVICE_PORT`/`SHARD` names, binds the configured port (`0.0.0.0:25000`), refuses a missing or empty `DATABASE_URL` with a named message and exit 1, and the healthcheck names the binary it starts | `env -u DATABASE_URL` and `DATABASE_URL=""` both → `real_exit=1` plus the refusal line; with a scratch URL it prints `listening on 0.0.0.0:25000`; `docker compose config` parses the block |
| P-43 no duplicate implementation | proved — `EvaluationService.py` (1,178), `workerpool.py` (497) and the entrypoint (53) are deleted in the same epic, and the retry limits are re-pointed at their existing home rather than copied | `35083c54` |
| P-44 one concept, one definition | proved — the reply deadline exists once in `cms-svc` `READ_TIMEOUT` and the worker pool's separate supervision was not reproduced beside it | `2d35d56f` |
| P-45 complexity budget | proved — longest function 38 lines, largest touched file under 250 code lines, four `#[allow(dead_code)]` documented as the shared-fixture case | measured over `git diff --name-only` |
| P-48 record | proved — this section, `dev/migration/PLAN.md` S-6d4, and the epic T6/T7 rows carry the SHAs and the measured numbers | this file, `PLAN.md`, `epics/017` |

Two behaviours deliberately still owned by Python, and the reason each is not a duplicate: the
`ServiceCoord` dial from `PrometheusExporter`/`contest`/`admin`/`AddSubmission` is a *client* of the
service, which the Rust binary now answers on 25000 — not an implementation of it; and
`src/cms/service/esoperations.py` still owns the planner, which decides what work exists rather than
performing it. The daemon consumes that contract instead of restating it.

## D. Quality and process

| ID | Perspective | Domain | Proof |
|---|---|---|---|
| P-43 | no duplicate implementation: the Python unit is deleted in the slice that replaces it | all | delete-auditor seat |
| P-44 | one concept, one definition: a second copy of a rule, route or type is refused at plan time | all | concept registry |
| P-45 | complexity budget: no function over ~40 lines, no file over ~250 lines, no layer violation | all | lint + review |
| P-46 | performance: a measured number and the command that produced it, per surface that can regress | D02/D04 | benchmark, recorded |
| P-47 | accessibility and keyboard paths on every rendered surface that a human uses | D03 | browser seat |
| P-48 | record: decision, rejected alternative, evidence line, written when it happened | all | epic file row |

## Retired

(none)
