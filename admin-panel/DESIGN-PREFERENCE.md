# Design preference — what survives repetition

**Status:** provisional, distilled after 3 build→measure→audit rounds of one page (2026-11-21). This
file is not a law. It is the place where a published principle becomes *this project's* preference —
by surviving repeated application, not by being cited once.

**How a row earns permanence**

1. New candidate → appended here with the source it came from and the round it appeared in.
2. A candidate that survives **three different pages** (not three edits of one page) is promoted to
   `DESIGN.md` as a rule.
3. A candidate that a later build contradicts is moved to **Dropped**, with the counter-case written
   down. Nothing is deleted: the counter-case is what makes the next session trust the rules that
   remain.
4. Every promotion must name an instrument. A preference that cannot be checked stays here.

## Promoted candidates (survived 3/3 rounds of the dashboard)

| # | Preference | Replaces | Source | How it was tested |
|---|---|---|---|---|
| P1 | Build from the **fact table** before any layout: type · unit · source · freshness · importance · reference | starting from a layout and fitting data into it | Mackinlay APT; Munzner nested model | 3 rounds; both rounds' defects were visible in the table before the render |
| P2 | **One freshness stamp**, in the page header; fields do not repeat it | "probe 14:00" on two fields next to a header stamp | §14 one fact once | round 2 caught 4 copies of `14:00`; round 3 kept 2 (header + chart's "now") |
| P3 | No invented denominators: every scale is either the data or a **declared reference** with provenance | a bar "to 500" nobody declared | Step 3 of the procedure | dropped in round 2 as a defect |
| P4 | Each comparison names **what** it is compared to **and where that came from** (`policy · since 2026-11`, `typical 30d`) | bare "target 75%" | Grafana thresholds (static vs query-computed) | applied in round 1, unchanged since |
| P5 | **Derived insight text is not page content**: the mark shows it, the tooltip states it exactly | "peak 88 at 13:00 · band = typical 20–60" | Tufte (show the data); metric-provenance writing | removed in round 1 and never missed |
| P6 | **One colour channel + the word** per region; surfaces may tint, marks may not carry the same state twice | red word *and* red bars *and* pink band for one outage | WCAG 1.4.1; Carbon status indicators | round 2 removed the destructive-coloured word and the value-coloured sparkline |
| P7 | A duplicated fact is resolved by deleting the weaker instance, not by rewording either | an "Ungraded 12" bullet beside the "12 ungraded" row | §14 | round 2 deleted the bullet |
| P8 | **Units live in titles and labels** ("Submissions per hour", "Median grading time"), never implicit | "Submissions" | §15, NN/g scanning | round 3 |
| P9 | An **unlabelled mark is decoration**: a sparkline without a label goes, or gets one | grey sparkline with no caption | §2 delete test | round 2 removed the caption, round 3 put a label back |
| P10 | The alert band reads **facts → cause → action**, left to right | actions between facts and cause | F-pattern; Mackinlay importance ordering | round 1 layout, unchanged |
| P11 | Colour budget is measured, not assumed: neutrals ≈ 90 %, accent ≤ 10 %, semantic marks ≤ 5 %, a tinted surface may be ~20 % | "it looks balanced" | measured on this render (`61 % white · 21 % tint · 6 % track · 5 % accent`) | measured each round with a 10-colour histogram |

## Candidates not yet earned

| Candidate | Why it is still open |
|---|---|
| "Direction is encoded by the mark, not by text" (bar drawn outward from target) | never built; needs a build where the direction is ambiguous |
| 60-30-10 as a check | the measured shape is already 90/5/5; whether to enforce a ratio or just an accent ceiling is unresolved |
| A bar for a single count against zero | the "waiting 214" bar was invented and removed; the honest form is a number plus its reference |

## Design language: Material 3 — topic log

The operator chose Material 3 on 2026-11-21 and asked for the preference to be decided **one topic at a
time**, never as a bundle: the answer to one topic changes which candidates survive in the next.

| # | Topic | Status | Decision |
|---|---|---|---|
| 1 | Colour architecture (where roles come from) | **decided** | **V2 — M3 baseline palette.** Roles come from the official M3 baseline; the brand colour lives in the logo and is not a role. Chosen over V1 (dynamic from a brand seed), V3 (hand-assigned brand ramp) and V4 (own semantic tokens) after a rendered four-way comparison: V1–V3 all collapse success/info/warning into brand/hue variations, because M3 defines exactly one semantic status (`error`) — so every architecture needs a status palette bolted on anyway, and V2 buys the same structure without depending on a palette generator that trails the spec. |
| 2 | Type scale | **decided** | **G — base 12 × 1.2, six steps: 12 · 14.4 · 17.28 · 20.74 · 24.88 · 29.86.** Jobs mapped: label/table-header 12 · body and table cell 14.4 · card title 17.28 · section heading 20.74 · page title 24.88 · display 29.86. Chosen over base 11 (forces the label to a sub-pixel 11), base 13 (no step below body, so a table header has nowhere to go) and 1.125 (steps of 1.5px at the bottom, indistinguishable without weight). The chain is computed, not rounded per step: an earlier table of mine claimed "each step ×1.2" while showing 13→16, which is ×1.23 and was wrong — 13 × 1.2 = 15.6. Two design systems hand-pick their ladder instead of generating it (M3's 15 styles, Carbon's productive set with "fixed headings"), so the ratio here is chosen for a dense admin, not because a ratio is the field's default. |
| 3 | Shape / radius | **decided** | **Carbon product radius: 0 for containers and controls, 2px and 4px are the only small steps, `full` for tags and status pills.** Chosen over M3's full shape scale (0·4·8·12·16·28 — read as a consumer app on the same fragment, and a rounded card gives an action nearly the same weight as the surface), Fluent 2 (2–24, safe but says nothing) and flat-0 everywhere (a secondary button and a tag became indistinguishable: same fill, same shape, no radius to separate action from label). The rule that comes with it: a nested surface's radius is the parent's minus the inset, and a control never shares both fill and shape with a label. |
| 4 | Elevation | **decided** | **Carbon layers: each layer is a neutral tone with a 1px border; a shadow appears only on an overflow menu or a tooltip.** Chosen over M3 tonal elevation (a page of tinted surfaces turns the whole panel lavender-grey within one shift, and a card inside a table separates from its row only by tone), Fluent shadows (thirty cards means thirty shadows — noise in a dense table) and borders-only (no hierarchy at all once a dialog opens over a card over a table). |
| 5 | Density | **decided** | **32px row as the default, with a 40px comfortable mode the operator can switch to.** 32px fits 19 rows in a 620px table area against 15 at 40px and 12 at Material's 48 (+27% data per screen at the default, with the comfortable mode as the escape hatch). 28px was rejected: it adds only three rows over 32 while every icon control then has to carry a 24px hit area (WCAG 2.5.8) inside a row where it nearly fills the height. The switch is a display setting, so the gate has to measure both modes. |
| 6 | State layer and focus | **decided** | **Carbon's state set: hover and pressed change the real surface colour, focus is a 2px ring outside the shape, selected adds a 3px leading bar.** M3's state layers were rejected on evidence: focus is a 12% tint with no ring, and WCAG 2.4.13 (Focus Appearance, AA in 2.2) asks for an indicator of at least 2px at 3:1 — a 12% tint on a light surface measures about 1.1–1.3:1, so M3 would need a ring bolted on anyway; and its hover (8%) and pressed (12%) differ by 4%, which a dense table cannot show. |
| 7 | Component map | **decided** | **We write our own primitives; the existing eleven and the M3/Carbon catalogues are a checklist, never source code.** Measured: 11 primitives in 833 lines, 12 files importing them, against 68 raw `<button>`, 155 raw `<input>`, 44 raw `<select>`, 41 raw checkboxes and 18 native `confirm()` calls in 14 files — the primitives are not the path of least resistance, and swapping the library would move those raw controls rather than fix them. `admin-panel/PRIMITIVES.md` holds the manifest: per control, its states, its accessibility contract and where the code stands today; it is checked in both directions — every raw control must have a home, and every catalogue component must be mapped or refused with a reason. |
| 8 | Accent and status palette | open | — |
| 9 | Data-viz palette | open | — |
| 10 | Motion | open | — |
| 11 | Dark mode | open | — |
| 12 | What we do not take from M3 | open | — |

Topic 1 fixes only *where the roles come from*. The accent colour, the status palette and dark mode are
topics of their own (8, 11); deciding topic 1 did not decide them and must not be read as doing so.

## Decided 2026-11-21 (Tier B — decided by the agent, recorded for overrule)

| # | Decision | Reasoning |
|---|---|---|
| P12 | **One primary action per surface**; every further level is the same family at lower weight (secondary → tertiary), never a raw `<a>`. The lowest level is still a button: hit area ≥ 24px and a real focus ring. | Carbon ("primary only once per screen; secondary only alongside a primary"), Material 3 ("primary actions carry higher emphasis through size, colour or shape"), Atlassian ("three levels; never two primaries; subtle is still a button; links are navigation"). All three converge, so no tie to ask about. |
| P13 | **The main message of an incident is the state, not the count.** The title says what stopped ("Scoring is down"), the consequence line carries the quantity and the blast radius ("214 waiting · contest 9 has no scores"), the action sits with them. The number is not the largest element when it is a symptom rather than a metric someone decides on. | Carbon's notification title guidance (title = what stopped or cannot be done) + the BAN rule (a big number earns its size only when it is a number someone acts on) + F-pattern evidence (top-left gets the first fixation, so the main sentence must be there). |
| P14 | **Re-think triggers, three levels.** The page's job changes → restart at procedure step 0 and rebuild the layout. A fact or a channel is added/changed → restart at steps 1–2 and re-measure the colour budget. An element is added → delete test plus placement check. | Design-debt literature: choose refactor / restructure / redesign by impact × change frequency and by reversibility, not by convenience. |
| P15 | Every severity level carries its own colour; a lower level is a **quieter** colour, never an absent one. | Operator's correction + Carbon status indicators (at least three of four channels) + PatternFly (text + colour + icon). |


## Dropped

| Candidate | Counter-case |
|---|---|
| "Put the bullet strips' good direction in words" (`lower is better`) | it survived 2 rounds but reads as an instruction to the reader; the open candidate above may replace it |
| "Add the peak annotation to save the reader a look" | the annotation was unverifiable against the axis and stale by design (P5) |

## What the rounds themselves taught (process, not taste)

- **An edit is not a change until it is rendered.** Round 3's label landed as a flex sibling and read
  as a second column; only the render caught it. Every candidate above is recorded from a render plus
  an audit, never from the diff.
- **Two of three rounds fixed something the previous round introduced.** That is the cost of editing
  by rule without a full re-read; the audit is what closes it.
- **The fact table paid for itself twice**: the duplicated ungraded count and the invented 500 scale
  were both visible in the table, before either existed on the page.
