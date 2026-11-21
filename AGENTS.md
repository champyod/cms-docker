# AGENTS.md — CMS Docker

> Project rules for AI agents working in this checkout. Coordination first: read
> `coordination/PROTOCOL.md` (board + chat rules) — present in the panel checkout — and claim your
> files before editing anything. The **binding decision, selection and context rules are §1 of
> `docs/agent-protocol.md`**, copied verbatim at the end of this file and checked by
> `scripts/__check_agent_protocol.sh`.

## Cross-agent coordination

This checkout is written by multiple agent CLIs. Every agent must:

1. Read `coordination/PROTOCOL.md` (board + chat rules) at session start.
2. Claim the files it will touch on `coordination/BOARD.md` **before** editing them.
3. Never edit a file another agent's row declares. Overlaps go to `coordination/chat/`.
4. Commit policy: quick `WIP:` commits while building, one logical full commit per epic
   (no WIP left), per the operator's decision of 2026-10-31 recorded in `coordination/PROTOCOL.md`.

## Authority

- `CLAUDE.md` is the architecture and pattern law of this codebase.
- `admin-panel/DESIGN.md` is the design law of the panel: the delete test, the ban list, density,
  colour, type and the instruments that check them. Any UI change is judged by it before it is
  judged by taste.
- `docs/agent-protocol.md` §1 is the binding rule set for decisions, selection and context — it is
  copied verbatim at the end of this file, and the copy is checked.
- `TODO-DEV.md` and `epics/` (hub root) are the durable backlog and decision record.
- The landing branch is the line you are on: `feat/backend-rust` on the Rust trunk,
  `major/admin-panel` on the panel line. Nothing lands on either unverified.

---

<!-- BEGIN agent-protocol §1 — verbatim copy of docs/agent-protocol.md §1. Do not edit here; edit there and re-copy. -->
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

