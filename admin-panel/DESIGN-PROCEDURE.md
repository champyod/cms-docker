# Design procedure — the order in which a page is reasoned about

`DESIGN.md` is the law (what is banned, what is required). `DESIGN-RESEARCH.md` is the evidence.
**This file is the procedure** — the sequence of questions that produces a page, and the reason each
step cannot be skipped or reordered.

Why a procedure and not a checklist: a checklist is applied *after* the page exists, so it can only
find violations. The two published procedures below are generative — they decide the encoding before
a single pixel is drawn, which is the only way to avoid the failures this repo kept hitting
(a status bar for categorical counts, a gradient with no scale, a threshold with no provenance).

- **Mackinlay, APT (1986):** generate candidate encodings → test **expressiveness** (the graphic
  must encode the facts in the data and *only* those facts) → rank by **effectiveness** (perceptual
  accuracy of the channel) → apply the **importance-ordering principle**: encode the more important
  fact with the more accurate channel.
- **Munzner, nested model (2009):** four nested levels — characterise the domain problem, abstract
  into data types and operations, design the encoding and interaction, then the algorithm. A mistake
  at an outer level cannot be fixed at an inner one; each level has its own validation method.
- **Cleveland & McGill (1984):** accuracy ranking of channels — position on a common scale > position
  on non-aligned scales > length > angle/slope > area > volume > colour saturation. In one line: length
  and position answer "how much"; colour answers "which".

## Step 0 — the job, before any fact

| Question | Artifact |
|---|---|
| Who reads this, and what do they decide while reading it? | one sentence, with the decision named |
| Which questions must the screen answer? (3–5, in priority order) | numbered list, each answerable by a glance |
| What is the first thing that must be seen? | the element that gets the largest area and the highest contrast |

A screen with no answer to these is a layout, not a design.

## Step 1 — the facts, typed (Munzner level 2)

Every fact on the page, one row each, before layout:

| # | Fact | Type | Unit | Source | Freshness | Importance (1 = highest) | Reference? |
|---|---|---|---|---|---|---|---|

`Type` ∈ nominal (categories: service names, contests) · ordinal (severity) · quantitative (counts,
durations, rates) · temporal (hour, day). `Source` and `Freshness` are mandatory: a number with no
provenance is not a fact, it is a rumour. `Reference` = target, baseline, previous period, or "none".

## Step 2 — encoding by the effectiveness ranking (Mackinlay + Cleveland & McGill)

For each fact, in importance order:

1. **Quantitative + must be compared** → **position on a common scale**, or **length** (bars).
   Never area, never colour, never a gradient.
2. **Quantitative + single value against a target** → a bar with a target tick (bullet), not a dial,
   not a status strip.
3. **Nominal sets** → position (rows) or grouped bars; colour only to *separate*, never to *rank*.
4. **Ordinal (severity)** → an ordered channel: position in a sorted list + one colour channel + the
   word. Shape for a second dimension, not hue.
5. **Temporal trend** → position on a time axis; the line or bar shows the change, the reference
   line shows the target.

**Expressiveness test, applied to the candidate:** does the graphic assert something the data does
not? Examples that fail: an area scaled to a 1-D count; a colour applied to an unordered set; a
gradient implying a continuous scale where only three states exist; a pie for comparing more than
three values.

**Common-sense conversions** (each is a Step-2 failure seen in this repo):

| Wrong form | Why it fails | Right form |
|---|---|---|
| a status strip for counts per contest | colour/position-for-state applied to a quantitative comparison | sorted bars |
| a templated colour gradient for meaning | implies a continuous, monotone scale nobody defined | a scale anchored at the reference, or no colour |
| "lower is better" as text only | the meaning lives outside the mark | bar drawn from the target outward, so the bad side is visible |
| a big number for something nobody acts on | size promises importance | a row |

## Step 3 — the reference, and where it comes from

Every comparison needs three things beside the value: **what** it is compared to, **where that
number came from**, and **when it was true**.

| Provenance class | Example | How it must be labelled |
|---|---|---|
| static policy | `target 75%` set by the operator | the value plus `policy`, and the date it was set |
| computed from history | `typical 20–60`, `last contest 606` | the window it was computed over |
| live comparison | `+182 on yesterday` | the period, and the freshness of both sides |

A threshold that is hardcoded in a template is a defect even when the number happens to be right: it
cannot be re-derived, it never ages, and nobody can tell whether it was computed or guessed.

## Step 4 — state and colour, as one channel plus the word

- One colour channel per region (§17 of the law), and the word always present (WCAG 1.4.1).
- A semantic scale is **anchored at the reference** (diverging around the target), not decorative:
  the same hue at two lightness steps for "fine / needs attention", and form (outline, weight) for
  the rest. Traffic-light triplets are the last resort, not the default.
- Direction is carried by the mark, not by a sentence: `+40/min` next to a queue that is growing is
  already text; the *bar* shows the growth against the reference.

## Step 5 — the colour budget, measured

`60-30-10` is a trade convention from interior design, not a validated UI law: NN/g recommends it as
a guideline, while measured product UIs come out near **85–90 % neutral / 8–12 % support / ≤3 %
accent**, because the dominant area in an interface is a neutral surface, not a brand hue. The
durable rule is the one underneath: **one neutral dominates, one accent is scarce, and saturation is
spent only where meaning lives**.

Measured on this repo's own dashboard comp (12-colour reduction of the render):
`61 % white · 23 % light neutral · 3 % borders · 3 % alert tint · 7 % accent violet · ~3 % text`.
That is the shape real product UIs have. The check is arithmetic, not taste:

```
neutral   ≥ 85 %   accent ≤ 10 %   semantic ≤ 5 %
greyscale test: the element you are meant to see first is still first
counting test:  no more than 1 in 10 coloured elements wears the accent
```

## Step 6 — surface quality, last

Contrast (4.5:1 body, 3:1 large and non-text), targets ≥ 24×24 px, focus visible at 3:1, keyboard
reachable, 390 px designed rather than squeezed, no re-entry, undo for destructive acts.

## Step 7 — verify with instruments

`scrollWidth − clientWidth = 0` · contrast pairs measured · colour areas measured · the same page
read in greyscale · the seven states driven · keyboard walk · the comparison's provenance read off
the page. A scan is not an audit: hand-check three hits before a number reaches a report.

## Step 8 — record the omissions

What was left off the page, and why. A dashboard is defined as much by what it refuses to show; the
omission list is what stops the next session from "just adding" the thing that was deliberately cut.
