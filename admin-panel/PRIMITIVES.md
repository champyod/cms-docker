# Primitives — the coverage manifest

The panel already ships eleven primitives in `src/components/ui/` (833 lines: badge, button, card,
command, dialog, input, sheet, skeleton, sonner, table, tooltip) built on Radix and Tailwind. They are
not the path of least resistance: **twelve files import them**, while the source contains **68 raw
`<button>`, 155 raw `<input>`, 44 raw `<select>` and 41 raw checkboxes across 82, 32 and 29 files**
(scan of 502 `.tsx` files, 2026-11-21). A library swap would not fix that; the raw controls would move
house and stay raw.

So the panel writes its own primitives, and the existing eleven — together with the M3 and Carbon
component catalogues — are used as a **checklist**, never as source code: a catalogue is how we prove
that nothing used today has been left without a home.

## What the scan found (evidence, not opinion)

| Control | Raw uses | Files | What that means |
|---|---|---|---|
| `input` | 155 | 82 | the single most common control; it has a primitive and is still written raw |
| `button` | 68 | 47 | only 11 of them carry an `aria-label` — an icon button without an accessible name fails WCAG 4.1.2 |
| `select` | 44 | 32 | no primitive exists at all |
| `checkbox` | 41 | 29 | no primitive exists |
| `textarea` | 14 | 14 | no primitive exists |
| native `confirm()` | 18 | 14 | a browser dialog: unstylable, blocking, untranslatable, unaudited |
| `role="dialog"` | 1 | 1 | the real dialog surface is the Radix one; 14 files still use `confirm()` |
| `<table>` | 2 | 2 | tables are div-based (`ResponsiveTable`) — good for mobile cards, but the semantics have to be rebuilt |
| tooltip references | 83 | 9 | the most-used overlay after the dialog |

## The manifest

Every row is a control we own. `states` is what the primitive must render; `a11y` is the contract the
gate enforces; `today` is where the code stands.

| Primitive | States | a11y contract | Today |
|---|---|---|---|
| `Button` | rest · hover · pressed · focus-visible · disabled · loading | native `<button>`, 32px height, never a `<div role=button>` | primitive exists, 68 raw buttons bypass it |
| `IconButton` | same + `selected` | 24×24 hit area minimum (WCAG 2.5.8), **`aria-label` required** | 11 labelled buttons; unlabelled ones unknown |
| `Input` | rest · focus · error · disabled · read-only | `<label for>` always; the error text lives next to the field, not in a toast | primitive exists, 155 raw inputs |
| `Select` | closed · open · hover · selected · disabled | keyboard: arrows, Home/End, type-ahead, Esc; `aria-expanded` | **missing** — 44 native selects |
| `Checkbox` | unchecked · checked · indeterminate · disabled | 24px target, label click toggles | **missing** — 41 raw |
| `Textarea` | rest · focus · error · resizable | auto-grow bounded, never a scroll trap | **missing** — 14 raw |
| `Table` | row rest · hover · selected · sorted · empty · loading | row = `<tr>`, header = `<th scope>`; a div grid needs the roles added by hand | div-based, 2 raw tables |
| `Dialog` | open · closing · error inside | focus trap, Esc closes, focus returns to the trigger, `aria-modal` | primitive exists; **14 files use `confirm()`** |
| `Banner` | one per severity, with its own colour (P15) | `role="status"` for info, `role="alert"` for danger; the text says the cause | several ad-hoc copies |
| `Badge` / `StatusPill` | one per severity | colour is never the only channel — the word is always present (WCAG 1.4.1) | exists |
| `Tooltip` | open on hover and on focus | 1.5s delay, dismissible with Esc, never holds the only copy of a fact | 83 references, 9 files |
| `Card` | flat layer with a 1px border | heading level follows the page, not the component | exists |
| `Tabs` · `Menu` · `Toast` · `Breadcrumb` · `Pagination` | per catalogue | arrow-key navigation, `aria-controls`, `aria-current` | spread across page folders |

## The two directions the manifest is checked

A coverage claim is only worth something if it can fail, so the check runs both ways:

1. **From our code to the manifest.** Every raw control the scan finds must map to a primitive in the
   table. A raw control with a home is a defect, and the ratchet counts raw occurrences downward per
   file — never upward.
2. **From the catalogues to our code.** Every component in the M3 and Carbon catalogues is either
   mapped to one of ours or **refused with a reason** (M3 `FAB`, bottom app bar and ripple are already
   refused: no surface in this panel needs them; a floating action button in a table is a second
   primary, which P12 forbids).

Nothing is "covered" because a library has it. It is covered when the table says which primitive owns
it, which states it renders, and which accessibility contract the gate can measure.
