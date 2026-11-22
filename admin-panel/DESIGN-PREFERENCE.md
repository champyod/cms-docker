# Design preference — the charter

**Goal.** Give the admin panel a design system that is Material 3 in structure and *ours* in
detail: every visual decision recorded in this file, decided one topic at a time, and applied to
the code only through gated steps.

**How a decision is made here.** A rendered comparison of the real candidates (no hand-picked
three out of a large field), one question with one topic in it, and a number behind the answer —
contrast, ΔE, pixels, milliseconds. A principle from a checklist is never a decision; it becomes
one only after it survives being rendered and measured against this panel.

**What this file is.** The state of the work. No topic is decided until its row says so and carries
the measurement that settled it. A row marked *queued* is a commitment to a later step, not a
result.

**Non-negotiables that the system must guarantee, not hope for.** One source of truth per fact and
per component; no duplicated token, primitive or rule; a new state always has a colour, a new
control always has a primitive, a new chart always has an encoding — so adding a feature cannot
break a page silently. Every colour pair is measured in both modes; every control has a focus ring
that passes 2.4.13; meaning is never carried by hue alone.

**Out of scope of this file.** The Rust backend migration (system and backend only, handed to its
own session). Code is changed only inside a gated step: applying tokens and the logo is step **8e**,
with its own gate, not a side effect of deciding.

**Done when** every topic is decided, 8e is applied with the gate measuring both modes, and the
dashboard plus one table page are rebuilt on the system with zero raw controls that have a primitive.

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
| 8 | Accent and status palette | **decided** | **M3-derived status tones: solid = tone 40, tint = tone 90, text = tone 10, one set per severity (success · warning · danger · info · unknown).** Measured across four published palettes: Carbon's text on tint reaches 7.00:1 but its yellow solid measures **1.68:1** on white, below the 3:1 WCAG 1.4.11 asks of a graphical object; Atlassian's is 1.53:1; the panel's current red and green separate by only **0.111** under protanopia. The M3-derived set measures 8.67:1 text, **6.15:1 solid** and 0.335 under protanopia — it passes text, non-text and colour-vision separation, and it continues the tonal method chosen in topic 1. M3 defines only `error`, so these ramps are ours to own, which is the same conclusion topic 7 reached. `unknown` is a first-class severity, not an absent one. |
| 8b | Accent (the colour of primary action, links, focus) | **decided** | **Maroon 40/80 — light `#7a2439`, dark `#f8acb7`, exactly as chosen.** Light on the tonal light surface `#fbfaf7` measures 9.41:1 (ΔE 37.9 from light danger); dark on `#171613` measures 9.97:1. The operator picked this pair from a rendered light/dark comparison, so the pair is the decision — an earlier recording substituted a different dark value (`#bc6398`) on a ΔE worry of my own, which is now reverted: **a measured risk never outranks a selected artefact.** The colliding value is moved instead, and it was never decided before: the dark danger moves from `#ffb4ab` (ΔE 10.6 from the accent — a pale pink next to a pale pink) to **`#f2705f`** (ΔE 37.2 from the accent, 53.9 from warning, 6.25:1 on dark). Chosen after sweeping all 24 hues at the panel's chroma: the best separations (blue-violet 255–345, ΔE 62–85) are excluded by the operator, and every remaining saturated hue collides with a status (olive ΔE 6.4 to warning, teal 25 to success). Blue and purple are out of the palette entirely — which puts the `info` hue chosen in topic 8 back on the table. |
| 8c | Logo | **decided** | **Two colours, maroon and white, with the glyph's ink mass centred — and two variants that swap the pair.** Light: `#7a2439` badge with a `#ffffff` glyph (9.82:1). Dark: `#f8acb7` badge with a `#7a2439` glyph (9.97:1 on the dark surface; the maroon badge itself measures only **1.84:1** against `#171613`, below the 3:1 a graphic needs, which is what forces the swap). The `S` filament takes the glyph's colour: drawn in maroon on a maroon badge it disappears entirely (verified), in the glyph colour it survives to 24px. Centring is optical, not geometric: at the shipped offset the glyph's bounding box looked centred but its **ink centroid sat 10.6 units above the hexagon's centre**, so it read as floating; the glyph now translates to y=68, leaving the centroid 0.6 units high, which measures as centred in mass. |
| 8d | Status hue allocation + `info` | **decided** | **S3 — error is ink, `info` is rose, the accent stays maroon.** Chosen by the operator over S1 (conventional red error + blue info, ΔE 18/14), S2 (rose info, unmitigated accent collision, 8/5) and S4 (rose info + ink accent, the best measured at 31/23). Recorded as chosen, and the values inside those roles were then optimised rather than left at their defaults: the best attainable minimum within S3 is **ΔE 12.2** with dark `info` `#c293bd` and dark accent `#bc7b9a` (every value keeps ≥4.5:1 on `#171613`). Two tight pairs are structural in S3 and cannot be fixed by colour: error-as-ink against the pale grey `unknown` (12.2), and rose `info` against maroon accent (12.5) — so meaning is carried by the second channel the evidence requires: `unknown` is an outline with no fill, `error` is a filled ink surface, `info` appears only as a chip and the accent only as a filled control or underlined link. Theory behind the choice: ISO 3864 fixes red for prohibition in *physical* safety signage; colour-in-context theory (Elliot & Maier 2012) holds that colour meaning is learned within a system's context; WCAG 1.4.1 forbids hue as the only channel and MDN's own guidance is to avoid pure red/green. All three permit a non-red error as long as the word and the shape carry it — which is what this row commits to. |
| 8e | Applying tokens, theme and logo to the code | **done** | Tokens in `globals.css` carry the decided values; `scripts/__check_design_tokens.mjs` measures 36 colour pairs at 4.5:1/3:1, the six type steps against the 12×1.2 chain and every `--radius*` against Carbon's scale — real file exit 0, and five independent mutations (light foreground `#cfcfcf` 1.49:1, dark foreground `#3a3833` 1.55:1, `text-body` 16px, `radius-md` 6px, a removed `--ring`) each exit 1. Theme is three states with the choice recorded in `data-theme-preference` (22 tests, was 20). The mark is two colours and re-centred on its ink mass (measured 0.7 units high against the hexagon's centre), with all 18 derived assets regenerated from `brand/` and `icons:check` green. Gates: tsc 0, eslint 0 errors, `design:check` 0. |
| 8f | Rebuild the dashboard and one table page on the system | open | The system exists and is measured; no page has been rebuilt on it yet, and the ratchet that fails a raw control which has a primitive is not written. This is the step that turns the token set into a product surface. |
| 9 | Data-viz palette | **decided** | **C — a single ordinal lightness ramp; no categorical hue at all.** Six hue positions are already spent on meaning (error ink, warning, success, info rose, accent maroon, unknown grey), so reusing hue to separate *data series* would make one colour mean two things on one page. Measured: of the free hues only blue (ΔE 30.6 from the nearest reserved colour) and teal (25.0) survive, and olive collides with warning at ΔE 14.8 — a palette with two or three usable slots is not a categorical system. Consequence that must be honoured downstream: a ramp encodes **order**, so a series set that has no order is not coloured — it becomes small multiples (one chart per series) or is ordered by a quantity the page already shows. |
| 10a | Transition motion | **decided** | **Carbon durations — 70 / 150 / 240 ms, easing `cubic-bezier(.2,0,.38,.9)`; total 460 ms for the three transitions the panel uses most (row highlight, banner rise, dialog open).** Measured in a running comparison: Carbon 460 ms, Fluent 400 ms, M3 1000 ms, none 0 ms. M3 is too long for a table an operator clicks through — one second is a wait, and three clicks in a row feel sticky; no-motion leaves no signal that the state changed, which invites a double click. Two rules that come with it: reduced motion is a **switch the person owns**, never something the page decides (the first version of the comparison quietly disabled itself when the host reported `prefers-reduced-motion`, which made every option look identical — that was a broken demonstration, not a finding); and no motion is ever used to draw attention (a blinking error bar is excluded for seizure and attention disorders). |
| 10b | Loading and progress motion | **decided** | **Skeleton of the real content as the default, a spinner only for short work, and never a percentage that was not measured.** A skeleton that does not match the shape of what arrives is a lie, a fast bright shimmer distracts, and an indeterminate sweep read as a progress bar makes people wait for a bar that is not measuring anything. Where progress is genuinely countable (files processed, rows imported), the number is shown as a count rather than turned into a bar. |
| 11 | Dark mode | **decided** | **Three states — Follow system (default), Light, Dark — with the person's choice stored.** Verified rather than assumed: the light render's surface measures `(251,250,247)` = `#fbfaf7` and the dark render's `(23,22,19)` = `#171613`, every role passes 4.5:1 in both modes (body 16.41/14.24, muted 6.11/10.62, accent 9.41/9.97, info 7.53/7.07, warning 8.09/12.11, success 5.89/10.37), and the same three-state control drives it. Two facts that must be honoured downstream: layer separation is almost invisible in light (1.04–1.05) and real in dark (1.09–1.23), so in light the 1px border is what separates surfaces — as topic 4 decided — while in dark a layer must never exceed 1.25 or the page becomes boxes inside boxes. And `unknown` (dashed, no fill) reads as *disabled* if it is the only element without a fill, so the word always sits inside the chip and no interactive control is ever drawn with a dashed border. |
| 12 | Feedback after an action | **decided** | **Snackbar with undo as the default, inline banner for errors and for results that need a decision.** Four patterns were built and run: inline-only leaves the table looking unchanged and adds permanent clutter; a success toast is gone in four seconds and takes the only record of the action with it; in-place change works only while the row stays visible, so it fails the moment a filter or a page hides it. The snackbar wins because the row changes immediately and a recovery path sits within reach. Two constraints come with it: the snackbar must never cover the row's own controls (it overlaps the last rows in a dense table — measured on the render), and it never takes focus. |
| 13 | What we do not take from M3 | **decided** | **Refused:** state layers (topic 6), tonal elevation (4), the full shape scale (3), the 15-style type scale (2), FAB and bottom app bar (a second primary, P12), ripple (no evidence it helps selection in a dense table), and dynamic colour from a seed (1). **Kept open:** navigation rail — only for narrow viewports, not decided yet. |

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
