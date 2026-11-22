# Agent protocol — normative

**Scope.** Every coding agent, every session, every checkout of this repository. This file is the
single home of three rules that must never be restated in different words anywhere else: **who
decides what**, **how a choice is made**, and **how context is carried**. `AGENTS.md` carries §1
below as a verbatim copy; `scripts/__check_agent_protocol.sh` fails the build when the copy and §1
disagree.

**What this file does not own** — so nothing here is duplicated:

| Question | Where it lives | What it says, in one line |
|---|---|---|
| how work is cut, staffed, proved, landed | `TEAM-WORKFLOW.md` | three axes, the cell rule (an unproven green is a lie), the council, anti-drift locks |
| which files an agent may edit right now | `coordination/PROTOCOL.md` in the panel checkout | claim on the board before editing; overlaps go to a chat thread |
| what this migration must achieve and in what order | `dev/migration/PLAN.md` | nine decisions, slices S-0…S-9, seven gates |

---

## Binding rules — every agent, every session

<!-- BEGIN agent-protocol §1 — verbatim copy of dev/agent-protocol.md §1. Do not edit here; edit there and re-copy. -->
**Tier A — decide, do not ask.** Naming, file layout, test shape, step order inside a slice, commit
split, which existing component to extend, re-running a gate. Record the reason once in the epic
file only when another person's work depends on it.

**Tier B — decide, record in the same breath.** A method choice with one surviving candidate; a new
guard plus its negative control; merging a gated lane; deleting the unit a slice replaced. One line
in the epic file: what was chosen, why, what was rejected.

**Tier C — stop and ask, always, no exceptions.** Production deploy or restart; a running contest
touched; history rewrite or force-push; deleting or overwriting another writer's work; a new
dependency, service or port; schema or migration shape; credentials or secrets; data deletion,
backfill or restore; a new public surface; a trunk or landing-branch change; weakening, skipping or
re-pointing a gate; anything one `git revert` cannot undo.

**Selection — any technical choice.** Generate at least three candidates from primary sources
(docs, crates.io, docs.rs, the repository at that SHA) and never a straw man. Drop every candidate
that fails a hard requirement and record one line on why it failed. Then: **one survivor** → build
it, no table; **two or more survivors** → a compare table on security · efficiency + single source +
customizability · final-state code/UI · future-proofing · reversibility, with effort and downtime
kept out of the ranking as scheduling facts, and the question names the axis that ties; **fewer
than three passable candidates** → never lower the bar, record that the field holds no third and the
search that showed it.

**One question, one topic.** A decision form asks about exactly one topic. Two decisions in one form
is not a shorter conversation, it is an unanswerable one: the answer to A changes which candidates
for B survive, and the operator is left confirming a bundle he cannot judge. Ask, record, then ask
the next — even when both are ready. Choosing a topic means naming the whole field of candidates that
matter for that topic and comparing them; three hand-picked options out of a large space is a straw
man wearing a table.

**Context.** Every claim carries its evidence inline (`path:line`, command, output, version). Never
name an ID, file, key or skill without restating what it says in the same breath. Thai for meaning
and reasoning; English for identifiers, code, commands and anything that lands in the repository.
The message must be actionable by someone who reads only it — a pointer is for verification, never
for understanding.

**Evidence.** Command, exit code, counts, and one line of what it proves. "Tests pass" is not
evidence. A gate counts only once it has been seen to fail on a dead input.

**Ephemeral work.** Anything that is not the result itself — a probe script, an ad-hoc query, a
generated report, a downloaded fixture, a one-off migration helper — lives in the session scratch
directory, never in the repository, and is deleted in the turn that stops needing it; what survives
is the finding, written into the epic or the doc. A script that a gate or CI runs is permanent by
definition: it lives in `scripts/`, carries a test and a negative control, and is reviewed like code.

**Research.** A claim earns a place in a document only when at least three *independent* sources
support it — different authors, different method, ideally different field — and the disagreements
between them are recorded with the adjudication. One source that happens to agree is a coincidence,
not a finding, and the first source that matches is the failure mode this rule exists to stop.

**Reading a comment.** A remark is evidence of a sighting, never a specification. Before changing
anything, name what the artefact must achieve, say in one sentence what the remark is evidence of,
then do what follows from that — which is often not the literal wording. If two readings lead to
different work, ask one question that names both. Never implement the literal wording when the job
behind it is stated, and never obey a remark that contradicts a rule the evidence supports without
saying so.

**Never.** Edit another writer's lane, branch, stash or uncommitted file; `git add .` or `git add
-A` on a dirty tree; weaken a gate to reach green; present a result you did not obtain; repair a
pre-existing failure you did not cause — report it with the failing line.
<!-- END agent-protocol §1 -->

---

## §2 Tier C detail — what "irreversible" means here

The list in §1 is exhaustive, not illustrative. Each entry, and why it is not a judgement call:

| Entry | What makes it irreversible in this system |
|---|---|
| production deploy or restart | both hosts are contest-live; a restart mid-contest costs submissions, and a rollback does not restore the lost interval |
| a running contest touched | the same, at submission granularity |
| history rewrite, force-push | a rewound shared branch destroys other writers' commits, which exist nowhere else |
| deleting or overwriting another writer's work | a lane, branch, stash or uncommitted file is unrecoverable once discarded |
| a new dependency, service or port | it changes the image, the attack surface and the deploy; it cannot be reverted by editing code |
| schema or migration shape | a migration that has run cannot be un-run; the data it wrote stays |
| credentials, secrets | a leaked or rotated secret cannot be un-leaked |
| data deletion, backfill, restore | the rows are gone; a restore has already overwritten what it replaced |
| a new public surface | it is reachable by strangers before anyone reviews it |
| trunk or landing-branch change | every lane's cut point moves, and other writers' assumptions stop being true |
| weakening, skipping, re-pointing a gate | it removes the only evidence that the work is safe |
| anything one `git revert` cannot undo | the operational definition of the whole table |

A Tier C item is asked once, in one form, with the compare table when the method is open, and with
the choice written down. It is never asked twice, and never re-asked after it has been recorded.

## §3 Selection detail — worked example

Choosing the template engine, 2026-11-21:

1. **Candidates from primary sources:** `minijinja` 3.1.0 (Jinja2-compatible, `UndefinedBehavior`),
   `askama` 0.16.1 (compile-time checked), `tera` (Jinja-inspired, divergent syntax), `tinytemplate`
   (minimal). Four, not two — two would have been a choice between what was already known.
2. **Hard requirement that decides:** the operator's requirement is *"render the frontend files as
   they are"*. `askama` and `tera` both require rewriting the 77 existing templates, which puts two
   copies of every template in flight until the last slice — a hard failure, not a cost.
3. **Survivors:** `minijinja` alone. So no table, and the record is one line: *minijinja with
   `UndefinedBehavior::Strict`, because Python already runs `StrictUndefined`
   (`src/cms/server/jinja2_toolbox.py:28,294`), so strict rendering is parity rather than change;
   askama rejected for the rewrite, tera for syntax divergence, tinytemplate for neither Jinja
   compatibility nor compile-time checking.*
4. **Contrast — when a table is required:** if `askama` had also rendered the existing files it
   would have survived on compile-time checking, the two would tie on future-proofing, and the
   question would be exactly that axis.

**The failure this prevents:** a table of three candidates where two were never passable. That is a
menu, not a choice, and it wastes the one decision the operator has to make.

## §4 Context detail — the two ways a message fails the rule

| Failure | Written | Why it fails |
|---|---|---|
| pointer instead of fact | "blocked by OQ-04" | the reader must open another file to learn that OQ-04 is the RPC shared secret with no per-caller identity (`src/cms/io/rpc.py:443-445`) |
| unnamed referent | "use the existing helper" | there are three helpers; the reader cannot tell which, and will pick wrong or ask |

| Repair | Written |
|---|---|
| fact inline | "blocked by OQ-04 — the RPC transport authenticates with one shared secret and carries no caller identity (`src/cms/io/rpc.py:443-445`), so a per-role authorization cannot be enforced at the transport" |
| referent named | "extend `render_admin_page` in `cms-svc` rather than adding a second renderer" |

Identifiers stay in their own form: a path, a symbol, a crate name, a command and a slice id are
never translated, because translating them makes them unsearchable.

## §5 Evidence detail

| Written | Verdict |
|---|---|
| "tests pass" | not evidence — no command, no count, no scope |
| "`cd backend && cargo test --quiet` → exit 0, 41 passed, 0 failed" | evidence |
| "the gate works" | not evidence — it has never been seen to fail |
| "gate G-5, dead input: renamed a row's `path` without marking it `retired` → exit 1, `FEATURES.tsv:118`; live input → exit 0" | evidence, and it proves the gate can fail |

## §7 Ephemeral work — where a throwaway file may live

| Kind | Lives in | Lifetime | What survives |
|---|---|---|---|
| probe script, ad-hoc query, generated report, downloaded fixture, one-off migration helper | `$HERMES_SCRATCH/<task>/` — default `~/.hermes/cache/scratch`, one directory per task | deleted in the turn that stops needing it | the finding: the number, the decision or the diff, written into the epic or doc |
| an experiment that needs a build | a `spike/<topic>` branch, or a lane worktree deleted afterwards | branch deleted once the answer is written down | the answer, plus one row in the epic naming the spike |
| a script a gate or CI runs | `scripts/` in the repository | permanent until the gate retires | itself: it carries a test, a negative control, and review |
| a fixture a test needs | the test's own directory | permanent | itself |

Six rules make it mechanical rather than a matter of taste:

1. **Nothing temporary is committed** — not "just this once", not "it may be useful later". A
   committed script is permanent by definition and must be gated.
2. **The scratch directory is outside every checkout**, so `git status` can never show it. A
   temporary file appearing in `git status` means the rule was already broken two steps earlier.
3. **`/tmp` is not scratch** — it is shared between processes and cleaned without a policy. Use the
   session scratch directory, which is one per task and pruned after 24 hours idle.
4. **No credential, token, key or production dump goes to scratch either.** A probe reads a secret
   from where the product reads it and prints nothing derived from it.
5. **Cleanup happens in the turn, not later.** The directory exists because a question was open;
   when the answer is written down, the directory goes.
6. **A helper needed twice is promoted properly** — a gate in `scripts/` with a test, or a
   documented tool — in its own commit. It is never renamed from scratch into the repository.

**Why:** the cost of a temporary file in the repository is not the file. It is that the next reader
cannot tell it apart from a result, so it is kept for years, and the tree fills with scripts nobody
dares delete.

## §8 Amendment

A change to §1 is **one commit** that edits §1 and every verbatim copy in the same commit:
`AGENTS.md` (both the hub root and the repository copy), and any document that restates a rule.
`scripts/__check_agent_protocol.sh` compares the marked block in `AGENTS.md` against §1 and fails on
any difference, so a copy cannot drift and a rule cannot exist twice in different words.

A rule is never added to a doc other than this one. If a doc needs to describe its own consequence
of a rule, it points here and says what the consequence is — the rule text stays here.
