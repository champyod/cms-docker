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

## 3b. A number without a comparison is not information

Every headline number carries what makes it decidable: a target, a baseline, or a previous period.
`214 waiting` says nothing; `0 → 214 in 18 min` says whether to move. `71% accepted` is a value;
`71% against a 75% target` is a decision.

The shape of a headline number (Big Aggregate Number), and nothing more:

```
label        what is measured, 11px muted, above
number       the indicator, by far the largest element
comparison   target · baseline · previous period
change cue   the ONE coloured element on the surface
```

**Cap the count.** 3–7 headline numbers per screen; a wall of big numbers is no big number at all.
Beyond that they stop being headline and become a table — so make it a table.

**Direction, not decoration.** A bullet strip is readable only when the reader can tell which end is
good without reading the number. So: the target tick is labelled once per strip, the "good" side is
named in the label (`lower is better` / `higher is better`), and a strip that has no target is not
in that group — a today-vs-yesterday comparison is a different object and belongs elsewhere.
Every surface carries a **freshness timestamp**; a dashboard that cannot say when it was last read is
not trustworthy during an incident.

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

## 7b. Notification anatomy

An alert is not a paragraph. Fixed shape:

| Part | Rule | Source |
|---|---|---|
| label | what is affected, 11px muted, above the number | BAN anatomy |
| number | the quantity that makes it urgent, largest element | BAN anatomy |
| comparison | `0 → 214 in 18 min` — not an adjective, not a story | Plotly 2026: a summary must keep the part that changes the decision |
| actions | **one** primary button + at most one inline link | Carbon: an actionable notification allows one action; label 1–2 words |
| length | title short, no full stop; body ≤ 2 lines; the body never restates the title | Carbon, Atlassian |
| severity | word + surface tint, never colour alone | Atlassian, Material: colour must never be the only channel |
| overflow | a link to the detail, never a longer sentence | Carbon: "View more" |

**Never:** a coloured stripe down the left edge (it encodes nothing the tint does not), a second
primary button, an icon in a tinted square beside the text, or a sentence that describes the system
instead of the state.

## 11. Quality of life — friction is measured, not felt

QoL is not "small tweaks": it is friction removed, and the unit is time, keystrokes, clicks or errors.

| Rule | Why (evidence in `DESIGN-RESEARCH.md` §3) |
|---|---|
| A bulk action is three parts, never one: **persistent visible selection** (count + selection that survives scroll and reload), **a preview of what will change**, **undo that still works after you navigate** | Linear and Gmail's cases; 100 items at 10s each is 17 minutes |
| The same shortcut acts on the selection as on one row — one action vocabulary | Linear's model; branching verbs confuse |
| Show every shortcut beside its action; never require it | shortcuts beat menus by ~50% only after practice (APA) |
| Never ask twice for the same fact | WCAG 3.3.7 Redundant Entry |
| Every drag has a click alternative | WCAG 2.5.7 Dragging Movements |
| Destructive action → **undo**, not a confirmation dialog | undo is the cheaper safety net; confirmations are skipped by reflex |
| Filters, sort and selection survive a reload | state that dies on refresh is not a feature |
| Measure it: time-to-task, keystrokes, clicks, errors — before and after, with the command that measured it | otherwise QoL is an opinion |

## 13. Space is allocated by importance, not left over

- The content column has a **maximum width** (1180px here). A full-bleed row on a 1440 screen
  produces a hole between its groups, and a hole reads as an unfinished page.
- The **largest area holds the decision**, not the prettiest picture: eye-tracking on dashboard
  layouts shows the first fixations land top-left and follow the block order, so the block with the
  action comes first and the block with context second (TVCG 2025; MDPI *Sensors* 2024).
- A row with three groups (facts · cause · actions) distributes with **equal gaps**; two groups with
  a `1fr` track leaves the slack as dead space in the middle.
- Vertical rhythm: the gap **above** a section is larger than the gap **inside** it — proximity is
  what makes the grouping legible (NN/g, Gestalt proximity).

## 14. Every fact appears once

Write the page's facts down before building it, then check each one's occurrence count. A second
mention is a **link**, not a repetition: the same queue number stated in a KPI strip and again in a
row asserts two facts where there is one. If a value has to appear twice, the second appearance is a
navigational reference with a label, not a number.

## 15. A label sits with what it names

- Label **above** its value, unit in the label, one noun per label ("Median grading time", not "Median
  grade time"; "Backlog growth", not "Growth").
- The distance from a label to its own value must be **smaller than to any other value** — proximity
  beats colour and shape as a grouping cue (NN/g).
- **One word may not carry two meanings on a page**: a column called `Waiting` for age and a field
  called `Waiting` for queue depth are two different facts wearing one label.
- A time belongs to the event it times: `since 13:42` goes with the thing that has been down, not
  with the number beside it.

## 16. No sentence where a pair will do

Information is **label + value**. A sentence is allowed only for a cause that a pair cannot express,
one clause long, and never underneath a number: `normal 0 · since 13:42` is two pairs pretending to
be a sentence; `Scoring is down` + `contest 9 · since 13:42` is a pair and a fact.

## 17. One colour channel per region

Severity is carried by **one** colour channel plus the word: a row tint **or** a dot, never both.
A dot is legitimate where it is the only colour channel (a status strip with no tint), and the word
still has to be there — colour alone is never the carrier (WCAG 1.4.1). Carbon's status indicators
change shape *and* colour for the same reason.

## 18. How this law is checked — instruments, not adjectives

| Check | Instrument | Fails when |
|---|---|---|
| delete test | the removal list, written down | nothing could be removed |
| headline number comparison | every big number read against its target/baseline | a number with no target, baseline or previous period |
| headline number count | counted on the page | more than 7 |
| alert anatomy | counted: actions, lines, title repetition | two primary buttons, or a body that restates the title |
| decorative structure | the diff adds a stripe, tinted icon square or border with no data behind it | one instance |
| pointer targets | measured bounding boxes | any interactive target under 24×24 CSS px (WCAG 2.5.8) |
| focus visibility | keyboard walk, computed styles | focus indicator under 2px perimeter or under 3:1 contrast (WCAG 2.4.13) |
| re-entry | the flow walked twice | any value asked for twice (WCAG 3.3.7) |
| undo | the destructive action performed | no undo path, or undo lost after navigation |
| freshness | the surface read | no timestamp of when the data was read |
| fact count | the fact list written before the build, then counted on the page | any fact appearing twice |
| label meaning | every label read aloud without its value | a label that cannot be named, or one word used for two facts |
| prose under a number | the block read | a sentence where a label/value pair would say it |
| colour channels per state | counted per region | a tint and a dot carrying the same state |
| content width | measured `getBoundingClientRect` of the content column | full-bleed groups with a gap wider than 15% of the row |
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

## 10. Sources — what each one settles

Read 2026-11-21. **The full evidence note, with the example or number behind each rule and the five
conflicts and their adjudications, is `admin-panel/DESIGN-RESEARCH.md`.** The **order in which a page
is reasoned about — facts typed, encoding chosen by the effectiveness ranking, reference and
provenance specified, colour budget measured — is `admin-panel/DESIGN-PROCEDURE.md`.** This table is
the index; that file is the evidence, and a rule may only cite a source that appears there.

| Source | What it settles here |
|---|---|
| Tufte, *The Visual Display of Quantitative Information* (1983) — data-ink ratio, "chartjunk", "erase redundant data-ink" | §1, §2: content-free decoration competes for attention and buys nothing |
| Stephen Few, *Information Dashboard Design* (2006/2009) and "Sometimes We Must Raise Our Voices" (perceptualedge.com) | §3: data pixels vs non-data pixels; non-data ink that supports reading stays but is de-emphasised; *some* redundancy aids comparison — so the ban is on decoration, not on a second encoding that speeds reading |
| NN/g, "Dashboards: Making Charts and Graphs Easier to Understand" (nngroup.com/articles/dashboards-preattentive) | a dashboard is one task — communicating critical information; pre-attentive attributes (position, length, colour) are what the eye reads first |
| Plotly, "Dashboard Design Mistakes That Mislead Decision Makers" (2026-10-16) | §3b, §5: define the decision first; primary / supporting / diagnostic zones; a metric without a named comparison is misleading; one job per colour |
| NCDPI Data Visualization Style Guide, "KPIs & big numbers" (Vautier's BAN framework) | §3b: label · number · comparison · one coloured change cue · micro-chart; cap the count — "a wall of big numbers is no big number" |
| datawirefra.me, "How Many KPIs on a Dashboard?" | §3b cap: 3–5 executive, 5–7 management, 10+ is a monitoring wall, not a decision page; KPI row holds 3–6 |
| IBM Carbon — Notification guidelines and Data Visualization/dashboards | §7b: short title with no full stop, body ≤ 2 lines that never restates the title, **one** action, 1–2 word labels, colour+icon+word, overflow via a link; §5: F-pattern hierarchy, most important = highest contrast and largest area |
| Atlassian Design — Banner usage | §7b: banners are sparse, concise, severity never by colour alone, truncation is a failure |
| Material Design — Banners; MUI Alert | §7b: one banner at a time, a single message with specific actions, colour alone is not a channel, essential alerts never auto-dismiss |
| "unslopped UI" tell catalogue (3.2M posts, 47 subreddits) and mowgli.ai's 15 tells | §2: the AI tells — big-number stats strip, icon in a tinted square on every card, ALL-CAPS eyebrow, identical rounded cards, emoji as icons; "a tell is just a default that nobody overrode" |
| dev.to, "The Purple Gradient Problem" (2026), incl. Adam Wathan's `bg-indigo-500` apology | §4: distributional convergence; the root cause of slop is *no decision*; fix by committing to one direction and holding a banned list |

