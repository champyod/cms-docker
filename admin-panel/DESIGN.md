# DESIGN.md — the design law of this panel

**Status:** law for every UI change in `admin-panel/`. Read before touching a page. A change that
breaks a rule here is rejected even when it compiles, looks tidy and tests pass — because the rules
below are the difference between an operational console and a generated dashboard.

The register is **operational software**: quiet, dense, utilitarian. No hero, no decorative card
grid, no marketing composition. Information a person scans a hundred times a day, predictable
navigation, repeated action. A correct page in the wrong register still reads as wrong.

## 1. The delete test — the only rule that matters

Every element must answer a question this page exists to answer. If it cannot be named, it goes.

Before delivering any surface, list every element that could be removed with **zero information
loss**, that would look at home on a generic template, or that carries a claim nobody can prove.
Remove them. Report what went. **If nothing could be removed, the surface is not finished.**

## 2. Banned — each one is a recognised "generated interface" tell

| Banned | Why | Instead |
|---|---|---|
| tracked-out ALL-CAPS eyebrow above every card | decoration carrying no information | a plain 13–14px muted label, or nothing |
| a subtitle that restates its own title ("Submissions" / "recent submissions") | the title already said it | nothing |
| a delta pill **and** a sentence restating it | one fact, two visual languages | the pill plus one context line (timeframe or baseline) |
| prose where a threshold belongs ("target < 50 · on track") | reads as commentary, not data | one short context line pinned to the card edge |
| a colour bar, dot or pill that encodes nothing | colour is a system, not decoration (§4) | delete, or give it a named role |
| an emoji in UI copy | reads as filler, ages badly, breaks screen readers | a word, or nothing |
| an icon that decorates a label it repeats | two encodings of one fact | the label alone |
| text explaining the app to itself ("use this page to manage…") | the interface teaches by working | delete |
| developer reasoning in the UI (why a value is null, what the code does) | it is not the user's question | a tooltip on the *value*, one clause |
| a bordered box around every region | hierarchy by boxing is the default, not a choice | 1px α0.10 border only where structure needs it; hierarchy from size and weight |
| the same count in the header, a row and a strip | busy without being informative | state each fact once, where the decision about it is made |
| a nav group label repeating its own first item | reads as a rendering bug | labels name the category, never an item inside it |

## 3. Density — charts carry the body, text carries what a mark cannot say

- A page stops being glanceable at roughly **40 content lines**. A card costs ~180px (~9 lines), a
  row ~28px. Ten cards is a wall; the same facts as rows fit a third of a screen.
- **If a number has a shape, draw the shape.** A chart, sparkline or heatmap beats a paragraph for
  magnitude, trend and distribution. Prose is for what a mark cannot say: a title, axis ticks, one
  number, the labels a legend cannot imply.
- **Detail belongs in the tooltip on the mark**, not in the body: hovering a bar or an hour gives the
  breakdown (queued · oldest · idle). That tooltip is the most detailed text on the page.
- **Merge by decision, not by domain.** Every actionable item becomes one place to look, not one card
  per domain. Rates go in one thin strip; exploration (trends, history, per-object detail) is a link,
  not a block.
- Numbers are **right-aligned, monospace, `tabular-nums`** — otherwise columns stop comparing at a
  glance.
- One fact, one place. A countdown stated twice is not emphasis, it is noise.

## 4. Colour is a system, never a decision made at the point of use

- **Zero colour literals outside the token block.** No `#rrggbb`, no `bg-blue-500`. Every colour
  property references a token (`--primary`, `--destructive`, `--success`, `--warning`, `--muted`).
- A colour that varies between two elements of the same kind is a bug, not variety.
- **Severity is luminance plus form, not hue**: healthy = quietest surface step, degraded = data hue
  at half strength, down = brightest ink plus a hairline outline. The loudest thing on the page is
  then the broken thing, and the encoding survives greyscale and red-green colour blindness.
- **A chart's colour must never restate its geometry.** Bar length already encodes the value; colouring
  bars by the same threshold is redundant twice over.
- Status is dot + one word (`Operational`), never colour alone.

## 5. Type and space

- Base 13–14px for a console, not 16px. Named steps only — `text-xs/sm/base/lg/xl/2xl` — never an
  arbitrary `text-[13px]`. Ladder: values 24 · page title 20 · panel title 16 · body 14 · metadata 12.
- Page hierarchy is **size and position**, not consistency: six panels at one title size is a grid,
  not a hierarchy. One page, one priority — if the top number is risk, the big chart answers risk too.
- Table cell padding 8px, row separators only, no vertical rules.
- Type never shrinks on smaller screens; the layout reflows instead.

## 6. Copy

User-facing text answers a question the user has. It never describes the implementation, never
apologises, never explains a null because the code allowed it. Three words beat three lines; a
tooltip beats a paragraph; `n/a` with a reason beats a blank cell — but the reason is one clause.

## 7. States — every surface has seven

empty · loading · error · denied (403 with the missing grants named) · stale · dense (full data) ·
narrow (390px, designed separately: no sidebar, one row per item, no axes, no grid lines, the alarm
count is the only filled element, touch targets ≥ 44px).

A denied capability is 403-with-a-reason; 404 is only for object existence across a privacy boundary.
Never an empty page where the truth is "you may not see this".

## 8. How this law is checked — instruments, not adjectives

| Check | Instrument | Fails when |
|---|---|---|
| delete test | the removal list, written down | nothing could be removed |
| colour | `grep -rn '#[0-9a-fA-F]\{6\}' src --include=*.tsx` outside the token block | one literal |
| colour meaning | the same element type sampled across pages | the same kind varies in colour |
| density | content height ÷ viewport, lines counted | a page over ~40 content lines with no chart |
| numbers | computed style `font-variant-numeric` and text-align | any metric column left-aligned |
| layout fit | `main.scrollWidth - main.clientWidth === 0`, zero elements with `scrollWidth > clientWidth` | any overflow at desktop width |
| states | each of the seven driven | a state missing or rendered as another |
| contrast | WCAG 2.2 AA spot-check | any pair below 4.5:1 body / 3:1 large |
| 390px | rendered at 390 with `innerWidth === 390` asserted | desktop column narrowed instead |
| screenshots | desktop + 390 stored with the change | none attached |

A scan is not an audit: hand-check three hits before any number reaches a report.

## 9. Amendment

A rule is added here, never in a pull request comment. Removing a rule needs the reason it was wrong
written in its place.
