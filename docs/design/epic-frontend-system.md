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
| S11 | Convert pages to their layout | **in progress** | 24 of 76 declared (17 redirects need no surface); batches 1-2 merged, batch 3 running. 52 content pages still undeclared, 9 of 59 inventoried |
| S12 | Status colour removed from ordinary text | **open** | 370 uses across 123 files; the gate holds it (may fall, never rise) |
| S13 | Light, dark, high contrast and both densities measured per rebuilt page | **partly** | `design:modes-per-page` fails any declared page that paints a raw colour, which is what makes four-mode measurement possible at all; it found and fixed two `text-amber-300` statuses in the TLS panel |
| S14 | A board layout for pages carrying several record kinds | done | `BoardPage` with a section contract; two lanes refused those pages before it existed, and the refusal was correct |

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
