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
| S9 | `DetailPage`, `FormPage`, `SettingsPage` layouts | **open** | only two of five exist |
| S10 | Per-page information inventory: what each page must show, in what order | **open** | the layer that made the dashboard wrong before tokens could help |
| S11 | Convert pages to their layout, tightening the archetype baseline from 75 | **open** | 1 of 76 declared |
| S12 | 164 uses of a status colour on ordinary text removed | **open** | 83 files; colour must mean state |

## Rules this epic is held to

- A step lands only with its gate green and its negative control shown to fail.
- Debt is counted: raw controls (238), undeclared pages (75), status-colour misuse (164). Each may
  fall, never rise.
- One writer per worktree index. A step handed to a subagent gets its own lane.
- Product code carries no reference to how the work is organised: no document names, no step
  numbers, no gate talk.
