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
| S11 | Convert pages to their layout | **done** | 76 declared, 0 undeclared of 76 pages; 53 of 53 inventoried. Seven content layouts (dashboard, list, detail, form, settings, board, modes) plus redirect |
| S12 | Status colour removed from ordinary text | **open** | 370 uses across 123 files; the gate holds it (may fall, never rise) |
| S13 | Light, dark, high contrast and both densities measured per rebuilt page | **done at the token level, open at the pixel level** | 72 colour pairs measured across light, dark, high contrast and dark high contrast; every declared page paints only tokens; both densities come from one row-height constant. A per-page rendered measurement needs a browser harness, which is a new dependency and therefore an operator decision |
| S14 | A board layout for pages carrying several record kinds | done | `BoardPage` with a section contract; two lanes refused those pages before it existed, and the refusal was correct |
| S15 | A contract that does not push a page to invent content | done | `activity` is optional on dashboard after a lane refused a count-only digest; `tests/page-slots.test.ts` pins every slot's requirement level, so loosening one is a decision and not a quiet edit |

## Rules this epic is held to

- A step lands only with its gate green and its negative control shown to fail.
- Debt is counted: raw controls (238), undeclared pages (75), status-colour misuse (164). Each may
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

## Queued: BoardSection's empty contract

`BoardPage` renders `section.empty ?? section.rows`, so a page says "this section is empty" by
passing `empty` and says "it is not" by passing `empty: undefined`. That trick makes the page
compute emptiness twice - once to choose `empty`, once to build `rows` - and a section that passes
both loses its rows without a word.

The shape it should become:

    type BoardSectionBody =
      | { readonly isEmpty?: false; readonly rows: ReactNode; readonly empty?: never }
      | { readonly isEmpty: true; readonly empty: ReactNode; readonly rows?: never };

Blast radius: 17 sections across /search, /security/blocks, /people/users/:id/history and the two
infrastructure boards. It is a contract change plus a page-by-page edit, so it gets its own sessions
rather than riding along with the component review that found it.
