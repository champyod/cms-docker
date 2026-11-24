# Epic — the admin panel's frontend as a system

Base branch: `feat/rust-trunk-reconcile` (this lane), cut from `origin/feat/backend-rust` and merged
with `origin/major/admin-panel` at `27768790`.

## Goal

Three layers, one source of truth each: **tokens** (colour, type, radius, density, motion),
**layouts** (shell plus five page layouts: dashboard · list · detail · form · settings), **pages**
(every page names a layout and supplies facts, never layout of its own).

## Steps

| # | Step | Status | Evidence |
|---|---|---|---|
| S1 | Tokens carry the decided values, measured by a gate | done | `design:tokens` — 36 pairs at 4.5:1/3:1, six type steps against the 12×1.2 chain, radius scale; five mutations each exit 1 |
| S2 | Theme is three states, the choice is recorded and survives a reload | done | 22 tests; the control shows `system` distinctly from an explicit light choice |
| S3 | The mark is two colours, centred on its ink mass, every asset derived from `brand/` | done | centroid 62.8 against a 63.5 centre; `icons:check` 18 assets |
| S4 | The three missing field primitives, and a ratchet on raw controls | done | 245 → 238 raw controls, per-file baseline, four negative controls |
| S5 | Type scale and focus ring enforced by a gate, not only declared | done | `design:usage` across 1,032 files; caught its own leftovers twice |
| S6 | Five page layouts, a registry, and a discrepancy gate | done | four negative controls: new undeclared page, declared page not rendering its layout, stale declaration |
| S7 | Dashboard and the contests list rebuilt on the system | done | six contract tests, falsified twice; contests list holds 0 raw controls |
| S8 | Row height is the density preference, default dense | done | `h-10 density:h-8` from one constant; default `compact` |
| S9 | `DetailPage`, `FormPage`, `SettingsPage` layouts | done | four contract tests: the fact strip is a `<dl>`, the error summary sits above the fields, a clean form shows no alert, and every settings group states its scope |
| S10 | Slot contract and per-page inventory | done | `patterns/slots.ts` names the facts each layout requires; `PAGE-INVENTORY.md` lists all 59 surface pages, 5 documented; the gate refuses a declared layout whose facts are empty |
| S11 | Convert pages to their layout | **done** | 76 declared, 0 undeclared of 76 pages; 53 of 53 inventoried. Six content layouts (dashboard, list, detail, settings, board, modes) plus redirect |
| S12 | Status colour removed from ordinary text | **open** | 242 uses across 107 files; AdminList, the deploy panel, ContainerRow, the testcase pairs, the dataset actions, the task contest chip, the participant chips, the roster state, the task avatar, the ranking queue, the worker log toggle and the score view switcher use the primitives, the task token labels and selections are neutral, and the docs callouts are neutral; the gate holds it (may fall, never rise) |
| S13 | Light, dark, high contrast and both densities measured per rebuilt page | **done at the token level, open at the pixel level** | 72 colour pairs measured across light, dark, high contrast and dark high contrast; every declared page paints only tokens; both densities come from one row-height constant. A per-page rendered measurement needs a browser harness, which is a new dependency and therefore an operator decision |
| S14 | A board layout for pages carrying several record kinds | done | `BoardPage` with a section contract; two lanes refused those pages before it existed, and the refusal was correct |
| S15 | A contract that does not push a page to invent content | done | `activity` is optional on dashboard after a lane refused a count-only digest; `tests/page-slots.test.ts` pins every slot's requirement level, so loosening one is a decision and not a quiet edit |

## Rules this epic is held to

- A step lands only with its gate green and its negative control shown to fail.
- Debt is counted: raw controls (228), undeclared pages (75), status-colour misuse (242). Each may
  fall, never rise.
- One writer per worktree index. A step handed to a subagent gets its own lane.
- Every gate takes its inputs from environment variables, so a negative control can run it against a
  throwaway fixture. A gate whose rules cannot be reached by a fixture cannot be falsified, and an
  unfalsified gate is a claim, not a check. This was learned three times in this epic.
- Product code carries no reference to how the work is organised: no document names, no step
  numbers, no gate talk.

## What is not done, and why

- **Per-page rendered measurement.** Everything the gates can prove without a browser is proven:
  the palette is measured in four modes, the primitives name only measured tokens, and every
  declared page paints only tokens. What no gate can prove is what a page looks like once rendered
  with real data at 1280px. That needs a headless browser harness and a fixture server, i.e. a new
  dev dependency and a login path - an operator decision, not an agent one.
- **The inventory is a document, not a check.** The gate requires a row for every declared page and
  that the row's layout matches the registry. Whether the row's list of facts matches what the page
  actually renders is reviewed by a person, not by a script.
- **`/ranking/users` refusal follow-up.** Three record kinds on one page were converted to a board,
  which is right, but the lane's original note stands: the shown-contests and board-hides surfaces
  would be better as routes of their own. That is a navigation change (new public surfaces), so it
  is recorded here rather than done.

## Landed: BoardSection's empty contract

`BoardPage` renders `section.empty ?? section.rows`, so a page says "this section is empty" by
passing `empty` and says "it is not" by passing `empty: undefined`. That trick made the page
compute emptiness twice - once to choose `empty`, once to build `rows` - and a section that passed
both lost its rows without a word.

The shape it became:

    type BoardSectionBody =
      | { readonly isEmpty?: false; readonly rows: ReactNode; readonly empty?: never }
      | { readonly isEmpty: true; readonly empty: ReactNode; readonly rows?: never };

`boardSection(isEmpty, empty, rows)` picks the branch, and the compiler refuses a section that
carries both. The security board's activity section shows its empty word only when the read
succeeded and returned no rows; before the change it showed the empty word whenever the read
succeeded. The board test asserts one body per section and the type refuses both.

## Why there is no form layout

`FormPage` existed in the taxonomy, the registry, the slot contract and the gate, and no page ever
rendered it. Every create and edit in this panel is a dialog that keeps the list visible behind it,
so a page-level form has no consumer here. It was removed rather than kept for a future that may not
arrive: a layout nothing renders is a template whose rules - error summary above the fields, one
assertive alert, exactly one primary - were never exercised against real data.

If a page-level form ever appears, the shape is in git history (`FormPage.tsx` before this commit)
and the contract is the five slots the old `PAGE_SLOTS.form` named. Add it back with a page that
renders it, not before.

**Confirmed by the operator** when the deletion was put to him as a decision rather than a report:
keep it removed, because a template nothing renders is a rule nobody tested against real data.

## Working rule — the ask flow (binding on every session of this epic)

This epic produced its own failure worth writing down. After the nine layout reviews, the queue held
counted debts - dead props, off-scale type, counts written into strings - and each looked small
enough to fix without asking. Eight pages went by that way. The discussion tables had turned into
reports of decisions already taken, which is a decision taken alone with a summary attached.

The rules that replace it:

1. **One item per turn.** One page, or one component. A turn that touches two pages is two turns'
   work and is refused, however small the second one looks.
2. **Never bulk.** No batch of N pages in one commit, no multi-lane fan-out for design work, no
   "while I am here". A class of identical defects is still N items, not one sweep - unless the
   operator says otherwise for that class.
3. **Never skip.** Every item in the queue gets its own discussion, its own decision and its own
   verification. "Mechanical" is not a reason to skip the discussion; it is a reason the discussion
   is short.
4. **Ask before the code, not after.** Anything a reader can see or feel - a type size, a number, a
   footer's sentence, a heading's name, the taxonomy itself - is presented as the real candidate set
   with a reason for each and the recommended one first. The operator picks. The table comes before
   the edit, never as a report of one.
5. **Code nobody can see may be fixed without a question, but never without a report.** A dead prop
   removed is not a design decision; it is still one item, still its own commit, and the message
   says what it was and why nothing changes on screen.
6. **A decision already taken is reversible by the operator.** When he revisits one, the earlier
   commit is re-opened as a discussion, not defended.

## Working rule — when a preview is required

Decided by the operator, and it governs how every later item in this epic is put to him.

| Preview | Required when | Example from this epic |
|---|---|---|
| **UI** — rendered at the real width, light and dark | the reader sees a different thing: page structure, type size, colour allocation, how a number is grouped, copy inside a control, an element added or removed | the list footer, a count inside a heading, `text-sm` becoming a token |
| **File structure** — the tree and the shape, not the code | files are added, moved or deleted, or a contract changes shape: a prop, a slot, a layout kind, a dictionary section | removing `FormPage`, adding `count` to `BoardSection`, detail's seven slots becoming four |
| **Implementation** — the diff | logic with no visible effect, or a small visible effect with a wide blast radius | `formatCount` inside `StatCard`, `LinkButton` |
| **None** | dead code, a comment, a rename that changes no behaviour | removing a `title` the shell owns |

Size decides how many of the three apply: one file or one item needs none of them; a shared primitive
or anything touching more than one page needs UI and file structure; a taxonomy or contract change
needs all three.

### Amendment: when the six rules do not apply

Recorded after the operator asked why a question had gone out at all: "dont should we have more
question call? or it just pass the confidence threshold on my preference to be able to auto-continue?"

The ask flow governs a genuine fork. It does not govern a decision his own criteria already settle:
security, then efficiency with a single source and the most customizability, then the final code and
UI. When those leave one surviving candidate, it is built and the render is shown in the report, not
offered as a question first. The four sizes above the top of the ladder were that case: a status
heading is text and belongs on the ladder, a gauge value is a card's headline and belongs one step
below it, and a 20% opacity numeral is decoration the law refuses. One candidate each, so three
questions were three too many.

### How the dev server starts in this checkout

`bun run dev` exits with code 1 the first time: Next 16.4.3 prints a security-upgrade reminder and
stops, writing a receipt under `.next/cache/next-agentic-upgrade-retries/`. Running the same command
again inside five minutes continues normally ("This command is continuing after the upgrade
reminder"), and the server is up in about 250ms. `CI=1` does not bypass it; `canPromptForUpgrade`
needs a TTY, and the block is the receipt, not the prompt.

The reminder itself is real and unaddressed: the installed Next is affected by a published advisory,
and upgrading it is a dependency change, so it is the operator's decision and it stays open.
