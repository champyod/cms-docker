# Design research — the evidence behind DESIGN.md

**Status:** evidence note, 2026-11-21. `admin-panel/DESIGN.md` is the law; this file is what the law
rests on. A rule in DESIGN.md cites a section here; a claim here cites its source and the number or
example it came from. Nothing here is a preference stated as a fact.

**Method (and why this file exists):** a rule earns its place only when **three independent sources**
support it — different authors, different method, different field — and the disagreements are written
down with their adjudication. The first version of DESIGN.md was built from single sources, and two of
its rules failed on contact with a second reading. That is the failure this note prevents.

---

## 1. Dashboard

| Source | The example or number that matters | Rule it supports |
|---|---|---|
| Tufte, *The Visual Display of Quantitative Information* (1983) | data-ink ratio = the share of ink that changes with the data; "erase non-data ink, *within reason*" | DESIGN.md §1, §2 — content-free decoration competes for attention |
| Few, *Information Dashboard Design* (2006/2009); "Sometimes We Must Raise Our Voices" (perceptualedge) | data pixels vs non-data pixels; **non-data ink that aids reading stays but is de-emphasised**; one screen; text organised in a perceptual pattern works | §3 density; §4 colour |
| NN/g, *Dashboards: Making Charts and Graphs Easier to Understand* | a dashboard serves one task; the eye reads position, length and colour **before** the numbers | §5 hierarchy |
| Plotly, "Dashboard Design Mistakes That Mislead Decision Makers" (2026-10-16) | `Revenue: $4.2M ▲ 12%` — 12% against what? a KPI without a named comparison misleads; define the decision, then primary / supporting / diagnostic zones | §3b comparison rule |
| NCDPI Data Visualization Style Guide, "KPIs & big numbers" (Vautier's BAN framework) | BAN = label · number · comparison · **one** coloured change cue · micro-chart; "a wall of big numbers is no big number" | §3b anatomy and cap |
| datawirefra.me, "How Many KPIs on a Dashboard?" | 3–5 executive, 5–7 management, **10+ is a monitoring wall**; a KPI row holds 3–6 | §3b cap |
| IBM Carbon, Data Visualization / dashboards | most important data = highest contrast + largest area; F-pattern; whitespace raises comprehension ~20% | §5 hierarchy |
| Tableau, *Visual Best Practices* | three type levels (top / mid / low); lighten titles so the numbers pop | §5 type |

**Conflict 1 — Tufte vs Few.** Tufte:"erase redundant data-ink". Few:"some redundancy in a value's
graphical display is useful for comparison; stripping it forces the eye to work harder".
**Adjudication:** the ban is on *decoration* (an element no data sits behind), not on a second encoding
that speeds a comparison. Encoded in §2 and §4.

**Conflict 2 — big number as a pattern vs as a wall.** The BAN literature endorses a large number with
a comparison; the de-slop literature lists "big-number stats strip" as a tell. **Adjudication:** a big
number earns its size only when it is a number *someone decides on*, and at most 3–7 per screen; eight
equal KPI cards are the tell, not the pattern. Encoded in §3b.

## 2. UI and UX

| Source | The example or number | Rule |
|---|---|---|
| NN/g, *10 Usability Heuristics* (1994, still the industry baseline) | heuristic 6: recognition over recall | §7 (labels, visible options) |
| NN/g, *Memory Recognition and Recall* (2024) | recalling from scratch is harder than recognising the right option in a list | §7; command palette must show commands, not require typing them from memory |
| Microsoft HAX / CHI 2019, *Guidelines for Human-AI Interaction* (18 guidelines, validated with 49 practitioners on 20 products, 2,455 citations) | a system must make its capabilities and limits legible, and **convey why it did what it did** | §7b alert anatomy; status text says the reason |
| W3C WCAG 2.2 (Recommendation; 9 new criteria vs 2.1; 4.1.1 Parsing removed) | **2.5.8** pointer target ≥ **24×24 CSS px** (AAA 44×44) · **2.4.13** focus indicator ≥ 2 CSS px perimeter with **3:1** contrast · **2.5.7** every drag action needs a single-pointer alternative · **3.3.7** no re-entering information already given | §8 instruments — numeric, not arguable |
| IBM Carbon, Atlassian Banner, Material Banner / MUI Alert | title short and descriptive with no full stop; body ≤ 2 lines that never restates the title; **one** action, labels 1–2 words; severity never by colour alone; a banner truncates silently, so keep it short | §7b |
| *make-interfaces-feel-better* (design-engineering principles) | concentric radius (outer = inner + padding); `tabular-nums`; hit area ≥ 40–44 px; borders for structure, shadows for elevation | §5, §8 |

**Conflict 3 — "ask the user" vs "act".** HAX and the requirement literature want the system to ask
or state its interpretation; the operator's own rule is to continue past a clear threshold.
**Adjudication:** state the interpretation and proceed when the action is reversible; ask when two
readings lead to different work, or when the step is irreversible. Asking is the escape hatch, not the
default — and never a substitute for stating what was assumed.

## 3. Quality of life (friction)

| Source | The example or number | Rule |
|---|---|---|
| demandmaven, "The quality of life improvement trap" (2023) | QoL = "slight tweaks and adjustments to features that already exist" — a **roadmap framing**, not a design measure | not adopted as a rule; recorded because it is how the term is used in product work |
| uxuiprinciples, *Expert Pathway* (grounded in Chi, Glaser & Farr 1988 on chunking) | 100 items at 10 s each = **17 minutes**; one bulk operation = seconds. Bulk needs three parts: selection, preview, undo | §11 bulk actions |
| APA, *J. Exp. Psychol.: Applied* — "With practice, keyboard shortcuts become faster than menu selection" | two-key shortcuts 3–20% faster for drawing, **~50% faster than menus** for text editing, but only **after practice** (a crossover interaction) | §11 shortcuts: show the key, do not require it |
| brainy.ink, *Bulk operations*; Linear and Gmail as the worked cases | Linear 2020: shift-click 23 issues → `B` → change status for all in one request, undo toast answering `Cmd+Z`; Gmail: `X` selects, `E` archives. Non-negotiables: **persistent visible selection**, **keyboard reachability**, **undo that never fails** | §11 |
| W3C WCAG 2.2 — 2.5.7 Dragging Movements, 3.3.7 Redundant Entry | every drag needs a click alternative; never ask for information already provided | §11 — QoL is partly an accessibility floor, not an extra |
| GQueues, "Save time with keyboard shortcuts and the command palette" | vendor claim of "up to eight workdays per year" saved by shortcuts | treated as a vendor claim, not evidence; the APA study is the evidence |

**Conflict 4 — "QoL is small" vs "QoL is measurable".** The product framing calls QoL small tweaks; the
accessibility standards make some of them mandatory, and the keyboard study makes others measurable.
**Adjudication:** QoL = friction removed, measured in time, keystrokes, clicks or errors — not "small".
Encoded in §11.

## 4. De-slop

| Source | The example or number | Rule |
|---|---|---|
| *unslop-ui* — a catalogue mined from ~3.2M posts across 47 AI/SaaS subreddits (2020–2026) | the top complaint is sameness (6.1% of on-topic comments, negative 91% of the time), then "screams AI / slop" (6.4%); "a tell is just a default that nobody overrode" | §2 slop = an undecided default |
| mowgli.ai, "Why Every AI-Built App Looks the Same: 15 Tells" | big-number stats strip; icon in a tinted square on every card; ALL-CAPS eyebrow over every heading; identical rounded cards with the same shadow; emoji as icons; "Supercharge your workflow" copy | §2 ban list |
| dev.to, "The Purple Gradient Problem" (2026) | distributional convergence; Tailwind's author publicly apologised for `bg-indigo-500` becoming every AI button; "the root cause of slop is *no decision*" | §4 — a colour needs a role, not a ban list |
| arXiv 2607.13156 (2026), *Design-System-Aware Development with AI* | tools that know the design system improve delivery speed, design fidelity and operational consistency | §4, §8 — the countermeasure is token awareness, evidenced |
| Nature (2024), model collapse | models trained on their own output lose the tails and converge on reduced variance | explains why slop gets more polished, not less |

**Conflict 5 — tell lists vs product tokens.** The tell catalogue implies "no violet"; the product's
primary token *is* violet (oklch 0.511 0.262 277). **Adjudication:** the catalogue detects defaults
nobody chose, in marketing surfaces. A deliberate token used with one role is not a tell. The rule is
"no colour without a role", and the check is a grep for literals, not a ban on a hue.

---

## What this note changed in the law

| Change | Why |
|---|---|
| §3b numbers carry a comparison; cap 3–7 | Plotly, BAN, datawirefra |
| §3b direction named on a bullet strip; no mixed comparison groups | the first bullet-strip comp failed exactly here on a second reading |
| §7b notification anatomy (7 parts) | Carbon + Atlassian + Material converge |
| §11 quality of life: bulk (selection/preview/undo), shortcuts shown, no redundant entry, drag alternatives | APA, WCAG, Linear/Gmail cases, expert-pathway |
| §8 numeric checks (24 px targets, 3:1 focus, overflow, contrast, freshness) | WCAG 2.2 |

## What is still open

- **Density has no measured ceiling.** Tufte and Few both stop at "within reason"; the 40-content-line
  figure in §3 is a practitioner heuristic, not a study. Treat it as a target to test, not a law.
- **QoL savings are vendor numbers.** Only the APA crossover study is peer-reviewed; the "8 workdays"
  figure is marketing and is recorded as such.
- **The de-slop catalogue is qualitative mining, not a controlled study.** It is the best available
  evidence for what people *call* slop, and it is used only to detect defaults — never as a style ban.
