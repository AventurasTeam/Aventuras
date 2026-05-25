# Memory probe

**Wireframe:** [`memory-probe.html`](./memory-probe.html) — interactive

Power-user diagnostic surface for inspecting per-turn retrieval state
and re-tuning ranker parameters against captured state. Embedding-
mode only; gated behind a two-level toggle (App Settings · Diagnostics
master gate + Story Settings · Memory · Probe). Off by default.

The capture model and simulator math contract live in
[`docs/memory/probe.md`](../../../memory/probe.md). This doc owns the
screen UX.

Cross-cutting patterns this screen consumes:

- [`patterns/chips.md`](../../patterns/chips.md) — filter chips
  in the capture-list filter row.
- [`patterns/forms.md → Select primitive`](../../patterns/forms.md#select-primitive)
  — sort dropdown + branch dropdown.
- [`patterns/lists.md`](../../patterns/lists.md) — large capture
  table virtualization + empty / no-results states.
- [`patterns/alert-dialog.md`](../../patterns/alert-dialog.md) —
  `Clear all captures` destructive confirm.

Cross-refs:

- [`memory/probe.md`](../../../memory/probe.md) — capture model,
  simulator contract, schema delta.
- [`memory/retrieval.md → The ranker`](../../../memory/retrieval.md#the-ranker)
  — terminology (`sim_blend`, `recency_factor`, `kw_boost`,
  `pin_signal`, `chapter_boost`, MMR, budget-fill) the probe
  surfaces.
- [`memory/edge-cases.md → v1 limitations`](../../../memory/edge-cases.md#v1-limitations)
  — probe was previously parked; this design lands it.
- [Edit restrictions during in-flight generation](../../principles.md#edit-restrictions-during-in-flight-generation)
  — applies to "Apply to story settings" from the simulator.
- [`reader-composer.md`](../reader-composer/reader-composer.md) —
  per-turn probe entry point lives there.
- [`app-settings.md`](../app-settings/app-settings.md) — diagnostics
  master gate under the Diagnostics tab governs probe writes.
- [`story-settings.md`](../story-settings/story-settings.md) — per-
  story Probe activation + capture-list entry point in Memory tab.

## Surfaces

The screen has three modes, navigated within one route:

- **Capture list** — default landing view. Browse and filter
  captures for the current story / branch.
- **Inspect** — a single capture opened for read-only viewing.
- **Simulate** — same capture, side-by-side with a re-run under
  edited parameters.

Inspect and simulate share the capture-detail layout; simulate
augments it with a param panel and diff highlighting.

## Capture list

```
┌──────────────────────────────────────────────────────────────┐
│ <story> / Memory probe          [status][actions][⛭][←]      │ ← top bar
├──────────────────────────────────────────────────────────────┤
│ Probe mode: ON · 47 / 100 captures · 12.4 MB                 │ ← status strip
│ Branch: [main ▾]   Sort: [recency ▾]   [⟳]   [clear all]     │ ← filter row
├──────────────────────────────────────────────────────────────┤
│ Captures                                                      │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ ch.4 · turn 87 · 2026-05-09 14:22 · light · 42 KB    │    │
│  │ 12 entities · 5 lore · 8 happenings · 2 threads · 1 cs│    │
│  │ 1840 / 1800 budget · 3 over-budget skipped            │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ ch.4 · turn 86 · ...                                  │    │
│  │ ...                                                   │    │
│  └──────────────────────────────────────────────────────┘    │
│  ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

### Status strip

Shows current state of the probe-mode toggles plus storage usage.
Click → opens Story Settings · Memory · Probe.

States:

- `Probe mode: ON · N / 100 captures · X MB` — both toggles on,
  captures accumulating.
- `Probe mode: OFF (story) · N existing captures · X MB` — app-
  level on, story-level off. Captures stop; existing inspectable.
- `Probe mode: OFF (app) · N existing captures · X MB` — app-level
  off. Same behavior; click → opens App Settings · Diagnostics.
- `Probe mode never on · no captures` — never enabled. Empty state
  with link to enable.

### Filter row

- **Branch dropdown** — defaults to current branch. Select a
  different branch to see captures from that branch (read-only;
  simulate stays disabled until the user switches branches).
- **Sort** — recency (default), tokens used, drop count, capture
  size, capture age.
- **Refresh** — re-reads the captures list. Useful if a turn just
  landed and the list hasn't auto-updated.
- **Clear all** — destructive. Confirm dialog: "Delete all N
  captures for this story? Cannot be undone." On confirm, deletes
  all captures across all branches of this story.

### Capture cards

One card per capture. Compact summary so users can scan for
"the turn where retrieval went weird":

- Pointer line: `ch.<n> · turn <m> · <timestamp> · <mode> · <size>`
- Selection summary: per-type counts in fixed order (entities,
  lore, happenings, threads, chapter summaries).
- Budget line: total tokens used / total budget across all per-type
  pools, plus a tail noting drop counts ("3 over-budget skipped").

Card states:

- **Default** — clickable, hover lifts.
- **Failed capture** — red left-edge accent, replaces the budget
  line with `Failed: <reason>`.
- **Deep capture** — small `deep` badge after the mode marker.
- **From other branch** — gray dim, branch pill `(branch: <name>)`
  in pointer line; clicking opens read-only inspect with a "switch
  to branch X to simulate" CTA.

Click → opens inspect for that capture.

### Empty states

- **Probe mode just enabled, no captures yet:**
  "Probe mode is on but no captures yet. Generate the next turn to
  capture." Link to reader.
- **Probe mode off, no historical captures:**
  "Probe mode is off. Captured turns will appear here when enabled."
  - Activate button (toggles story-level on; app-level on if needed,
    with a confirm explaining both gates).
- **Filtered out by branch:** "No captures for branch X", with a
  link to the current-branch view.

## Capture detail (inspect mode)

```
┌───────────────────────────────────────────────────────────────┐
│ <story> / Memory probe / ch.4 · turn 87  [status][⛭][←]      │ ← top bar
├───────────────────────────────────────────────────────────────┤
│ ch.4 · turn 87 · 2026-05-09 14:22 · light                     │ ← header strip
│ branch: main · entry: e_2876 [→ open in reader]               │
│ ⚠ params differ from current story · 3 changes [▾]            │ ← drift badge
│ [Simulate] [Re-capture] [Export] [Delete capture]             │ ← actions
├───────────────────────────────────────────────────────────────┤
│ Tabs: Queries | Entities | Lore | Happenings | Threads | CS | Selected │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│  (selected tab content, scrolls)                              │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

### Header strip

- Pointer line: chapter / turn / timestamp / capture mode.
- Branch and entry id; entry id is a deep link that opens the
  reader scrolled to that entry.
- **Drift badge** — only shown when captured params differ from
  current story params. Expandable: shows the diff (param name,
  captured value, current value). Inspect mode treats captured
  params as the live state being inspected.
- Action buttons:
  - **Simulate** — switch to simulate mode (see below).
  - **Re-capture** — re-runs the retrieval pass against the current
    story state under current params, writes a new capture
    pointing at the same `target_entry_id`. Useful for "is this
    still missing X under current params?" Costs a fresh embed of
    the three queries (~20-100 ms local; ~50-300 ms provider). Does
    NOT regenerate the prose turn.
  - **Export** — downloads the capture as a JSON blob (gzipped
    payload + metadata). Includes prose snippets — user is
    responsible for redaction before sharing.
  - **Delete capture** — removes this capture only; confirm dialog.

### Tabs

Seven tabs. Default to **Selected** when arriving fresh — that's
the "what actually got injected" view, the most common entry
question. Switching to a per-type tab drills into the ranker
mechanics.

#### Queries tab

```
Q1 — User action                       embedded · 18 tokens
┌─────────────────────────────────────────────────────┐
│ "Aria reaches for the locked drawer, hesitates,..." │
└─────────────────────────────────────────────────────┘
[copy]  cosine histogram (deep mode only) ▁▂▅▇▆▃▁

Q2 — Structural digest                 embedded · 32 tokens
┌─────────────────────────────────────────────────────┐
│ "Aria, Kael, the study. Active threads: the locked  │
│  letter, betrayal arc. Era: Reform. The diary..."   │
└─────────────────────────────────────────────────────┘
sources: scene=2 entities · location=the_study ·
         threads=2 active · summary=piggyback
[copy]  histogram ▁▂▄▆▇▆▄▂

Q3 — Heuristic prose extract           embedded · 48 tokens
┌─────────────────────────────────────────────────────┐
│ "She drew the iron key from her pocket."            │
│ "Kael whispered, 'They mustn't know.'"              │
│ "The diary lay open to page seven."                 │
└─────────────────────────────────────────────────────┘
selection scores: 1.4 · 1.1 · 0.9 (top-3 of 12)
breakdown: entity hits, lore keyword hits, action verbs,
           dialogue, brevity bonus per sentence
[copy]
```

Three blocks, one per query. Each shows full text, token count,
copy button, and (in deep mode) a tiny cosine-similarity histogram
across the candidate pool — useful for spotting "this query had no
high-sim hits anywhere."

The Q2 source breakdown lists which structural fields fed the
template (sceneEntities count, location, active thread count) and
whether a piggyback summary line was included.

The Q3 breakdown shows top-K selected sentences with their per-
sentence scores and the signal contributions
(named-entity / lore-keyword / action-verb / dialogue / brevity).

#### Per-type tabs (Entities / Lore / Happenings / Threads / Chapter summaries)

Each tab follows the same shape, with type-specific score columns.

**Layout note — wide-table containment.** Score tables have 12-14
columns and easily exceed available width at narrower viewports
(phone tier, desktop simulate mode with the param panel taking
280 px). The table MUST live inside a per-table wrapper element
with `overflow-x: auto`; horizontal scroll stays scoped to the
table while the chrome (diff banner, funnel summary, filter chips,
tabs strip, top-bar) stays anchored. A bare `<table>` without the
wrapper lets the surrounding surface widen — the user scrolls
horizontally and the entire view slides off, banner included.

```
Funnel: pool 1248 → pre-filter 200 → MMR 18 → selected 12
Tokens: 1840 / 1800 budget · 3 over-budget skipped
Stale excluded from pool: 7

Filter: [all] [selected] [dropped] [bypassed] [stale]

┌──────────────────────────────────────────────────────────────┐
│ Name      Sts sim Q1 Q2 Q3 blend rec pin kw bypass score MMR result │
├──────────────────────────────────────────────────────────────┤
│ Aria      ▣  .82 .91 .77  .83  1.0 .90 .10  -    .85    1  ✓ │
│ Kael      ▣  .79 .85 .73  .79  1.0 .80 .10  -    .81    2  ✓ │
│ the_study ⌂  .58 .76 .42  .59  1.0  -  .00  -    .59    3  ✓ │
│ Vael      ◌  .61 .54 .38  .51  .67  -  .10  -    .44    7  - │ ← pre-filtered
│ Maelis    ◌  .42 .38 .31  .37  .55  -  .00  -    .20    -  ↓ │ ← below threshold
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

Funnel summary — same numbers as the capture card, broken out per
type. Stale-row count below: rows that exist in metadata but didn't
make it into the vec0 pool.

Filter chips — narrow the table to a subset:

- **all** (default) — everything.
- **selected** — only rows that made it into injection.
- **dropped** — only rows that didn't make it, with the drop reason.
- **bypassed** — rows whose `bypass_triggered=1` (high-similarity
  revival).
- **stale** — rows with `embedding_stale=1` at capture (uncommon —
  most stale rows aren't even pool candidates, but the edge case
  where a row goes stale during a retrieval pass shows here).

Table columns vary by type:

- **Entities**: name, status, sim Q1/Q2/Q3, sim blend, recency,
  pin (status-derived), kw boost, bypass, score, MMR rank, result.
- **Lore**: title, priority, sim Q1/Q2/Q3, blend, kw boost, score,
  MMR rank, result.
- **Happenings**: title, chapter, sim Q1/Q2/Q3, blend, recency,
  pin (`decay_resistance`), kw boost, chapter boost, bypass, score,
  MMR rank, result.
- **Threads**: title, status, sim Q1/Q2/Q3, blend, recency, kw
  boost, score, MMR rank, result.
- **Chapter summaries**: chapter, title, sim Q1/Q2/Q3, blend, kw
  boost, score, MMR rank, result.

Result cell glyphs:

- `✓` selected (green)
- `-` pre-filtered (gray; tooltip: rank/pool size, "below pre-
  filter cut at 200")
- `⊘` MMR-deduped (gray; tooltip: "redundant with `<other row>`")
- `↓` below score threshold (gray; tooltip: "score 0.11 < 0.15")
- `⤴` over-budget (yellow; tooltip: "needs 380 tokens; 200
  remaining when scanned")
- `⤴⤴` candidate too large for type (red; tooltip: "needs 800
  tokens; type budget 500")
- `⚠` failed-capture marker (when failure occurred mid-type)

Click a row → opens a detail drawer with:

- Full row text (the candidate's display content, untruncated).
- Full score formula applied step-by-step (raw sims → blend →
  recency × pin → kw → chapter boost → bypass check → MMR drop /
  budget result).
- Deep-link button: "Open in World" / "Open in Plot" — jumps to
  the row's location in the relevant panel.

#### Selected tab

```
Total injected: 1840 + structural 2400 = 4240 tokens

Structural floor (fixed):
  ▸ Recent buffer (12 entries) ········ 1820 tokens
  ▸ Active+in-scene entities (Aria, Kael) · 320 tokens
  ▸ Current location (the_study) ······· 110 tokens
  ▸ Active threads (2) ················ 150 tokens

Retrieved (per type, in injection order):
  Entities (1200 / 1200 budget):
    ▸ Vael — staged, retrieved off scene match ····· 280 tokens
    ▸ Maelis — staged, retrieved off scene match ··· 240 tokens
    ▸ ...
  Lore (1800 / 1800 budget):
    ▸ The locked-letter custom ····················· 320 tokens
    ▸ ...
  Happenings (1500 / 1500 budget):
    ▸ Kael's confession at chapter 2 ·············· 180 tokens
    ▸ ...
  Threads (400 / 400 budget):
    ▸ The betrayal arc ····························· 220 tokens
    ▸ ...
  Chapter summaries (300 / 300 budget):
    ▸ Chapter 2 — "The first letter" ·············· 210 tokens
```

The unified output view. Shows what actually went into the prompt
context, in injection order, with per-row token cost. Each row is
a clickable deep link to its source panel (World / Plot / chapter).

This tab is the most common entry-point question's answer ("what
did the model see for this turn?"); putting it first in the tab
order would compete with the per-type tabs for "first read"
attention. Default-tab to **Selected**, but type tabs sit
immediately to the right of Queries so the diagnostic flow
(query → which candidates → why they ranked → what got injected)
reads left-to-right.

## Simulate mode

Toggling the **Simulate** action in the header switches the layout
to a single full-width score table with inline diff annotations,
plus a sticky parameter panel:

```
┌───────────────────────────────────────────────────────────────┐
│ <story> / Memory probe / ch.4 · turn 87 · SIMULATING          │
│ branch: main · entry: e_2876                                  │
│ +1 selected · -1 selected · 4 score deltas · 1 bypass change  │ ← diff banner
│ [Apply to story settings] [Save snapshot] [Cancel]            │
├──────────────────────────────────────────────────────────────┤
│ Tabs: Selected | Queries | Entities | Lore | ...              │
├──────────────────────────────────────────────┬────────────────┤
│ Filter: [changes only] [all] [selected] ...  │ Param panel    │
│                                              │ Query weights  │
│ Name      Sts Q1 Q2 Q3 BL rec pin kw byp ... │ w_action  ▢   │
│ ─────────────────────────────────────────    │ w_digest  ▢   │
│ Vael       ◌ .61 ...        ▲.45 was .44  ✓  │ w_prose   ▢   │
│ Linde      ◌ .91 ...    ↗  ▲.07 was .05  ✓  │ Decay          │
│ Cap. Roen  ◌ .40 ...        ▲.39 was .38  ✓ NEW │ λ_happen ▢ │
│ Sera       ◌ .29 ...        ▼.14 was .15  ↓ DROP│ ...        │
│ ...                                          │ Bypass         │
│                                              │ τ_revive  ▢   │
│                                              │ ...            │
└──────────────────────────────────────────────┴────────────────┘
```

### Why single-table-with-diffs and not side-by-side

Two parallel tables (captured | simulated) was the obvious framing
but doesn't fit. The score table has 13 columns
(name + status + Q1 / Q2 / Q3 + blend + recency + pin + kw + chapter
boost + bypass + final score + MMR rank + result). Two of those
side-by-side plus the 280-pixel parameter panel exceeds desktop
container width before any column gets readable padding. Phone tier
collapses to one or the other anyway.

A single table with inline annotations carries the same comparison
signal more compactly:

- **Score cell**: simulated value with `▲` or `▼` delta arrow plus
  a faint `was X.XX` tail for changed scores.
- **Result cell**: glyph for the new result, plus a `NEW` or `DROP`
  badge when the selection state itself flipped.
- **Row tinting**: green for newly-selected (`diff-add`), red for
  newly-dropped (`diff-rem`), yellow for score-only changes
  (`diff-mod`), blue for bypass-state changes (`diff-bypass`).

The "see them next to each other" intuition is preserved through
the per-row "was X.XX" annotation; the loss is the ability to scan
two unchanged values side-by-side, which isn't actually what tuners
do.

### Diff banner

Always visible above the type tabs. Counts changed cells across the
whole capture (added selections, removed selections, score moves,
bypass state changes). Each type tab repeats this banner scoped to
its own pool.

### Default filter — "changes only"

Filter chips in simulate mode default to `changes only`, hiding
unchanged rows. The remaining chips (`all`, `selected`, `dropped`,
`bypassed`, `stale`) work the same as inspect mode. The default
keeps the diff scannable — for a typical pool of hundreds of
candidates, only ~5-15 rows actually move under a single param
edit.

### Action buttons

- **Apply to story settings** — opens a confirm dialog showing the
  param diff vs current story settings ("These 4 params will change
  on this story"). On confirm, writes the simulated params to
  `stories.settings` and exits simulate mode (returning to inspect
  on the same capture, with the drift badge updated). **Disabled
  during in-flight generation** per
  [Edit restrictions during in-flight generation](../../principles.md#edit-restrictions-during-in-flight-generation)
  — the write would compete with the active pipeline for the
  single-writer gate; tooltip explains and routes to "wait for
  generation to finish."
- **Save snapshot** — persists the current simulator state
  alongside the parent capture (counts toward the FIFO cap as a
  separate row pointing at the parent). Useful for "I want to
  compare three different param sets against this capture later."
  Snapshots are inspect-only; they can't be re-simulated (would be
  simulating against a simulated state, a meaning-loss).
- **Cancel** — discards the simulator state, returns to inspect
  mode with no changes.

### Param panel

Sticky right-side column on desktop and tablet, slide-up sheet on
phone. Param groups in fixed order:

- **Query weights** — `w_action`, `w_digest`, `w_prose`. Sum-to-one
  re-normalization on edit (edit one, others rebalance).
- **Decay** — per-type `λ` (happenings, entities off-scene,
  threads). Lore and chapter-summary `λ` are 0 by design and not
  shown.
- **Boosts** — `kw_boost` magnitude, `chapter_boost` magnitude.
- **Bypass** — `τ_revive`.
- **Threshold** — `min_score_threshold`.
- **Budgets** — per-type token budgets (5 inputs).
- **MMR** — `λ_div`. **Disabled in light captures** with the
  explanation: "Light captures don't store candidate vectors.
  Recapture this turn with deep mode to tune MMR diversity."

Each param input shows:

- Current simulated value.
- A reset arrow ↶ that snaps the input back to the captured
  value. A header-level "Reset all to current story" button covers
  the bulk-revert case.
- Diff highlight: yellow background when the input differs from
  the captured value.

### Single-capture-only — explicit limitation

A simulator pass operates on one capture at a time. The intuition
"if this param helps on this turn, ship it" is the failure mode —
a single turn isn't representative. The recommended tuning workflow
(documented in the surface as a one-line hint above the param
panel):

> Simulate against multiple captures before applying. One turn's
> diff isn't enough signal.

If real signal shows users tune off a single capture and regret,
add a "saved snapshot per applied param-set" cross-capture
aggregate view. Parked until then — see
[`memory/probe.md → Cross-capture aggregation`](../../../memory/probe.md#cross-capture-aggregation--out-of-scope-for-v1).

## Mobile expression

Probe is desktop-primary. Phone-tier reflows:

- **Capture list** — card list (already cards on desktop; mobile
  uses the same shape with tighter padding). Filter row collapses
  to a two-row stack: branch / sort first, refresh / clear actions
  second.
- **Capture detail** — tabs become a horizontally-scrollable strip;
  per-type score tables overflow horizontally inside their column
  rather than reflowing into stacked cards (the dense numerical
  grid doesn't reduce well to phone width — accept the horizontal
  scroll).
- **Selected tab** — natural fit on phone; structural floor and
  per-type sections stack vertically.
- **Simulate mode** — same single-table layout as desktop. Diff
  banner stays above the table; the param panel collapses to a
  slide-up sheet (Sheet pattern, ~65 % height). An `Edit params ↑`
  button above the table opens the sheet; a close button inside
  the sheet header dismisses it.
- **Drift badge / failure banner** — wrap onto two lines on phone.

The mobile shape lets a user **inspect** comfortably (review
captures, see what fell off, read scores) and run a basic
simulation cycle (edit params in the sheet, see deltas in the
table). Power-users doing serious empirical tuning are expected on
desktop; the phone shape exists so the user isn't locked out, not
because it's the intended primary surface.

## Entry points

### From reader-composer

Per-entry "Probe this turn" affordance, only visible when Probe
mode is on at app + story level. Sits with the per-entry options
(rollback, regenerate). Click → opens this surface scoped to that
entry's capture (or the failure capture, or "no capture" state).

When Probe mode is off, the affordance is hidden — not greyed-out.
The reader is the daily-use surface; gating the probe behind dev
mode keeps it out of the way for users who don't tune.

If the entry has no capture (probe mode was off when it
generated), clicking "Probe this turn" lands on a stub state:
"No probe data — this turn was generated with probe mode off."
A `Re-run retrieval to capture now` button beneath it captures the
turn fresh under current params and lands the user on inspect.

Per-turn deep capture toggle: a small "deep" checkbox next to the
generation button when probe mode is on, off by default. Captures
the next turn in deep mode. Resets to off after one use — deep is
opt-in per-turn, not a sticky preference.

### From Story Settings · Memory · Probe

Sub-section under the existing Memory tab (alongside per-type
budgets, classifier cadence, etc.):

- Probe mode toggle (per-story).
- Capture stats: count, size, oldest / newest.
- "Open probe" button → capture list.
- "Clear all captures" button (destructive, confirm).

When the app-level flag is off, the per-story toggle is disabled
with a hint linking to App Settings · Diagnostics.

### From App Settings · Diagnostics

The master diagnostics gate (`app_settings.diagnostics.enabled`)
governs probe writes alongside the rest of the diagnostics layer
(log sinks, http capture sinks, Actions-menu Hub entry). When the
gate is on, memory-probe captures accumulate; when it flips off,
in-memory ring buffers clear immediately, but persisted
`probe_captures` rows stay until explicitly cleared.

The Diagnostics panel surfaces:

- What the gate covers (probe captures plus the diagnostics layer).
- That capture adds per-turn cost (small).
- That existing probe captures persist when the gate is toggled off.
- Link to memory-probe screen (top-level, opens story-list and a
  probe-scope picker if no current story).

## Edge cases

### Branch fork while probe mode is on

The fork starts with no captures. Existing captures stay on their
branch. Switching back to the parent branch surfaces them as
before; switching to the fork shows an empty list (with the same
"no captures yet" empty state).

A capture from branch A can be **inspected** while on branch B
(read-only mode). Simulating is disabled. The drift badge upgrades
to a branch-mismatch warning: "This capture is from branch A.
Switch to branch A to simulate, or use this view for read-only
inspection." The "Open in reader" deep-link in the header switches
branches with a confirm.

### Embedding model swap mid-tuning

If the story's `embedding_model_id` changes after captures exist,
existing captures are still valid for inspection — captured `sim_*`
values are post-cosine numbers, not vector-space-dependent.
Simulation continues to work for everything except deep-mode
λ_div (the captured vectors are now in a stale space).

The drift badge surfaces the model mismatch alongside param drift:
"Captured under model X · current model is Y." Clicking opens
[Story Settings · Memory · Embedding model](../story-settings/story-settings.md).

### Probe mode disabled mid-session

App-level flag flips off:

- Capture writes stop immediately on the next turn.
- Existing captures stay inspectable.
- The reader's per-turn probe affordance hides on subsequent
  turns; existing captured turns retain their affordance.

Story-level flag flips off: same behavior, scoped to one story.

### Failed retrieval capture

A capture with a non-null `failure_reason` renders with a banner at
the top of inspect:

```
⚠ Retrieval failed at capture time
Reason: embedder unavailable (init returned null)
Captured state: queries embedded · pool retrieval skipped
```

Tabs render whatever partial data exists (Queries usually populated
even on failure; per-type tabs may be empty). The Simulate button
is disabled.

### Capture write failure

If the in-transaction capture write fails while the turn proceeds,
the next inspect of that turn lands on the "no capture" stub. A
banner in Story Settings surfaces persistent failures: "Last 5
captures failed to write. Check disk space."

### Storage warnings

- At 80 / 100 captures: inline banner in capture list — "Approaching
  capture cap. Oldest captures will be evicted on the next turn."
- After eviction: brief toast on the capture list view next time
  it's opened — "Evicted N old capture(s) to make room."

### Re-capture vs original capture

Re-capture creates a new capture pointing at the same
`target_entry_id`. The capture list shows both; pointer line
distinguishes via timestamp + a small `recap` badge on the newer
one. Inspect on the original still shows captured-time params; the
re-capture shows current-time params. Simulate mode on the
re-capture works against current state.

### Export format

Exported capture is a JSON file:

```
{
  "version": 1,
  "branch_id": "...",
  "id": "...",
  "target_entry_id": "...",
  "captured_at": 1746792120000,
  "capture_mode": "light",
  "embedding_model_id": "...",
  "failure_reason": null,
  "payload": { /* the gzipped payload, decompressed */ }
}
```

Includes prose snippets (display fields, query texts, sentence
extracts). The user is responsible for redaction before sharing.
A note in the export confirm dialog: "Exports include prose from
the turn. Review before sharing externally."

Import is not in v1 — the export shape is for sharing /
support / archiving, not for re-running on a different machine.
