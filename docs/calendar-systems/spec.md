# Calendar systems

Design for the date-time abstraction that powers in-world time
display, classifier vocabulary, and (eventually) user-authored
fictional calendars.

## Status

Design complete; implementation deferred. v1 ships **Earth
(Gregorian) only**, with the schema and pipeline pre-fitted to the
design here so that fictional calendar support drops in as data + a
template, not a refactor.

## Goal

Let users define and use their own date-time systems for stories,
including non-Earth fictional ones (high fantasy, sci-fi). Earth is
the baseline; everything else is a configuration of the same
primitive.

## Non-goals

Things this design does not attempt to support:

- **Auto-generation** of calendars from natural language ("invent a
  calendar for me").
- **Multiple parallel calendars** rendered simultaneously. One active
  calendar per story; if a story wants both lunar and solar shown,
  the user authors that into the active calendar's display template.
- **Time zones.** Flagged as a potential future extension: if ever
  supported, timezone offsets would most naturally bind to
  [location entities](../data-model.md#world-state-storage) (per-location
  offset on top of the active calendar's clock), not to the calendar
  itself. Out of scope for the calendar primitive.
- First-class **moon phases / seasons / weather / holidays**. Those
  belong in lore data, or in the active calendar's display template
  if a story wants them rendered alongside dates.
- **Mid-series metric shifts within a single calendar** (e.g.,
  real-life Star Trek's TNG → DS9 stardate refactor). Use a separate
  calendar swapped mid-story instead.
- **Roman-style annotated dating** ("ides of March") and other
  non-arithmetic decorations.

These are decisions, not omissions — surfacing them keeps the
schema's surface small enough to ship.

## The primitive: tiered counters

A calendar system is **an ordered stack of integer counters
(tiers)**, plus optional non-counter decorations (sub-divisions,
eras). Each tier has a current value and a rollover rule — when
does this tier reset and tick its parent.

Top-down, the chain runs from largest scope to smallest. The base
unit is the bottom tier.

| Calendar                | Tier stack                                                |
| ----------------------- | --------------------------------------------------------- |
| Earth (Gregorian)       | `year → month → day → hour → minute → second`             |
| Tolkien Shire Reckoning | `year → month → day`                                      |
| Warhammer 40K Imperial  | `millennium → fractional-year` (two-tier, decimal-shaped) |
| Stardate (sequential)   | `count` (one tier, no rollover)                           |

[`worldTime`](../data-model.md#in-world-time-tracking) — a single
integer in **physical seconds since story start** — is the spine.
Universal across calendars: the integer's unit is identical
regardless of which calendar a story uses. The conversion
`worldTime ↔ tier-tuple` is one bidirectional walk: divide by the
calendar's `secondsPerBaseUnit` to get the bottom-tier count, then
walk the rollover stack. The data model already pre-supposes this:
the integer is genuinely calendar-agnostic; the calendar is a
renderer + arithmetic engine over a universal-seconds integer.

### Universal seconds, calendar-declared base unit

The integer `worldTime` is **always physical seconds**, regardless
of calendar. Calendars declare a `secondsPerBaseUnit: number` saying
how many seconds equal one of the bottom tier's units — Earth = 1,
Shire = 86400, Mayan kin = 86400, Stardate = 86400 (one stardate ≈
one day in TNG convention).

This means:

- **Calendar swap on an existing story preserves the integer.**
  Display reinterprets through the new calendar's tiers +
  `secondsPerBaseUnit`; arithmetic doesn't change. Era-flip moments,
  manual worldTime corrections, scheduled-happening fire times —
  all keep their meaning.
- **The classifier always emits second-deltas.** The active
  calendar's vocabulary (tier names, weekday labels, era names)
  ships into prompt context so the classifier can convert prose like
  "two days later" — but its arithmetic output is always seconds.
  See [Classifier integration](#classifier-integration).
- **`baseUnit` on the calendar is a display label**, not semantics
  — renamed below to `baseUnitName` to make this explicit.

Precision floor is one second (int64 holds ~290 billion years). No
realistic narrative-time fiction needs sub-second resolution; if one
ever does, the escape hatch is bumping physical base to milliseconds
— still int64-safe for ~290M years.

### Sequential is the same shape with one tier

A "stardate"-style calendar is the degenerate case: one tier with
no rollover. The render template handles formatting
(`stardate {{ count | divide: 1000 | round: 1 }}`). No mode
discriminator; sequential is just `tiers.length === 1`.

This is where the integer-native worldTime pays off relative to
date-triplet calendar libraries (most prior art assumes
`{ year, month, day }` as the identity). For us, sequential is the
floor of the abstraction, not a special case.

### Sub-divisions: cycling labels that don't tick the chain

A tier may declare **sub-divisions** — labels that cycle on the
same counter but don't participate in rollover. The canonical
example is **weekday**: it labels each day as
`(daysSinceEpoch + offset) % 7`, never ticks anything, and the day
counter is independent of weekday.

Sub-divisions distinguish "weeks-as-labels" (Earth — Tuesday) from
"weeks-as-counters" (a calendar where week-number is part of the
canonical address, "Week 47, 2026"). The latter is a normal tier
in the chain. We default to sub-division for typical fiction.

Sub-divisions never affect arithmetic. They are render-only.

**Days outside the cycle — `skipWhen`.** Some calendars deliberately
hold certain days _outside_ the weekday cycle so the cycle aligns to
a clean year boundary. The Shire calendar's Mid-year's Day is the
canonical example — Tolkien designed it so that 365 − 1 = 364 = 52 ×
7, making every Shire date fall on the same weekday every year.
Bahá'í (Ayyám-i-Há), Discworld (Hogswatchnight), and many fantasy
systems share this trick.

A sub-division can declare `skipWhen: Array<Record<string, number>>`
— a list of partial tier-tuples. When the current day matches any
entry, that day renders with no weekday and does not advance the
cycle counter. Example for Shire: `[{ "month": 7, "day": 2 }]` skips
Mid-year's Day.

**Conditional skipping is deferred.** A skip whose presence depends
on _other_ tier state — e.g. Shire's Overlithe, present only in leap
years and only at month 7 / day 3 — cannot be expressed by a flat
partial-tuple match. Modeling it would need a predicate against leap
state or full-tuple inspection. Deferred in v1; consequence is that
conditional non-cycling days drift the weekday cycle by one day per
occurrence. For Shire this means a 1-day weekday drift in leap years
— acceptable fidelity gap, surfaced explicitly for users authoring
such calendars.

### Eras: hoisted out, manually triggered

Eras are **not** a tier in the chain. They live in a separate
top-level field because real and fictional eras are almost always
narrative-triggered, not arithmetic — AD/BC, Japanese imperial
reigns, Tolkien's Ages, Warhammer 40K Imperial founding, Forgotten
Realms cataclysms. All driven by story events, not clock math.

Modeling eras as a top tier in the chain forces the calendar's
structural rewrite at flip time, which is the bug surface where
prior-art calendar libraries accumulate edge cases. Hoisting eras
out keeps the tier chain purely arithmetic.

The calendar declares **era support** (enabled? which lower tiers
reset on flip? default first-era name? optional preset name list?).
**Era flip events live in [`branch_era_flips`](../data-model.md#era-flips)**
— a branch-scoped table; flips fork with branches like every other
narrative state. Each row carries `at_worldtime` (in physical
seconds) + `era_name`. Flips are user-triggered (explicit "Flip era"
affordance) and delta-logged via the standard per-row delta
machinery.

A calendar with predictable eras (rare — fixed-length 1000-year
ages with no narrative branch) is unsupported by design. Users
wanting that author it as `{{ year | divide: 1000 | floor }}` in
the display template, with no era field at all.

### Era flip semantics — `flipMode`

`resetsOnFlip` says _which tiers_ are affected by an era flip; it
doesn't say _what the affect is_. Three semantics are observable
in real and fictional calendars, and the calendar must pick one
explicitly via `flipMode`:

- **`'display-label'` (default).** Pure annotation. The era name is
  rendered alongside the absolute tier-tuple; `eraYear` (computed as
  `current_cal_year - era_start_cal_year + 1`) is exposed in the
  template scope so the calendar can re-anchor the year value in
  display. The underlying tiers continue counting unaffected.
  Models nengō (Japanese imperial), Chinese reign-name, Roman
  regnal — eras are a _naming_ layer over a steady calendar. The
  first era year is often partial (Reiwa 1 ran May–Dec 2019 only).

- **`'elapsed-from-flip'`.** Full structural reset. Tiers in
  `resetsOnFlip` are recomputed as if the era flip _was_ the
  calendar's origin. Year 1 Day 1 of the new era literally starts at
  the flip moment; the previous calendar's year/month/day no longer
  participate in display. Models French Revolutionary, Warhammer 40K
  millennium-flip, fictional cataclysm-style resets.

- **`'calendar-aligned'`.** Hybrid: tiers reset to `startValue` at
  flip, but increment at the underlying calendar's natural
  boundaries (e.g., the next Jan 1) rather than from the flip
  moment. For a single-tier reset, display-equivalent to
  `'display-label'`; diverges only when multiple tiers are in
  `resetsOnFlip` and the user wants "start a fresh year/month/day
  count at flip but keep aligning to the underlying solar year."
  Listed for completeness; v1 implementations may defer it.

The three are visibly different when applied to the same calendar
moment. For an era flip on May 1, 2019 and a current date of
November 15, 2020:

| `flipMode`            | display                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `'display-label'`     | `Reiwa 2年 11月15日` (calendar-year-relative; Nov/15 from underlying Gregorian)  |
| `'elapsed-from-flip'` | `Reiwa 2年 6月15日` (recomputed; ~563 days since flip = Year 2, Month 6, Day 15) |
| `'calendar-aligned'`  | same as `'display-label'` for single-tier reset                                  |

`resetsOnFlip` semantics depend on `flipMode`:

- Under `'display-label'`, the list is a hint about which tiers'
  values are exposed via re-anchored template variables (e.g.,
  `eraYear`). Tier counters themselves don't change.
- Under `'elapsed-from-flip'`, the list specifies which tiers are
  recomputed from `worldTime - era.at` (with origin = all
  `startValue`s). Tiers not in the list stay absolute.
- Under `'calendar-aligned'`, the list specifies which tiers reset
  at flip but re-increment at the underlying calendar's normal
  boundaries.

Default: `'display-label'`. Picked because it has the safest
behavior — no structural rewrite, just annotation.

## Data shape

### Calendar definition

```ts
type CalendarSystem = {
  id: string // stable across saves; e.g. 'earth-gregorian'
  name: string // human-readable
  baseUnitName: string // renamed from `baseUnit`. Display label only —
  //   bottom tier's name in vocabulary terms ('second',
  //   'day', 'cycle', 'tick'). Feeds the classifier prompt
  //   and UI labels; NOT semantic.
  secondsPerBaseUnit: number // physical seconds per one bottom-tier unit.
  //   Positive integer (validated at JSON save).
  //   Earth = 1; Shire = 86400; Stardate = 86400; Mayan kin = 86400.
  tiers: Tier[] // ordered top-down; bottom tier is the base unit
  displayFormat: string // Liquid template; full state in scope
  eras: EraDeclaration | null // null = this calendar doesn't support eras
}
// Note: the worldTime=0 anchor is per-story, not per-calendar. See
// `stories.settings.worldTimeOrigin` below.

type Tier = {
  name: string // 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'
  startValue: number // typical: 0 or 1
  rollover: TierRollover // when this tier resets and ticks its parent
  labels?: string[] // labels by tier value; e.g. month names indexed by month value
  subdivisions?: Subdivision[] // cycling overlays (weekday-style)
}

type TierRollover =
  | { kind: 'constant'; value: number } // hours-in-day = 24
  | { kind: 'table'; values: number[] } // month-length table indexed by parent value
  | { kind: 'rule'; base: number; conditions: LeapCondition[] } // Gregorian-shaped

type LeapCondition = {
  every: number // applies when (parent-value % every) === 0
  offset?: number // shift the cycle (default 0)
  exclude?: boolean // negate the previous match
  // Gregorian Feb: { every:4 } → +1, { every:100, exclude } → cancel,
  //                { every:400 } → +1 again
}

type Subdivision = {
  name: string // 'weekday'
  length: number // 7
  offset: number // value at calendar's epoch
  labels: string[] // ['Sunday', 'Monday', …]; length === Subdivision.length
  skipWhen?: Array<Record<string, number>>
  // ^ optional: partial tier-tuples for days that DON'T cycle (e.g.
  //   Shire's Mid-year's Day). Conditional skipping (predicate against
  //   leap state) deferred — see "Days outside the cycle" above.
}

type EraDeclaration = {
  flipMode: 'display-label' | 'elapsed-from-flip' | 'calendar-aligned'
  // ^ how an era flip affects display; see "Era flip semantics" above.
  //   default: 'display-label'.
  resetsOnFlip: string[] // tier names affected by the flip; semantics depend on flipMode
  defaultStartName: string // era name at worldTime=0
  presetNames?: string[] // optional canonical sequence (e.g., ['First Age', 'Second Age', …])
}

type TierTuple = Record<string, number> // keyed by tier name
```

`rollover.kind: 'rule'` evaluates against the **full tier-tuple
state**, not just the immediate parent. Gregorian's leap rule
depends on the year value, which is two tiers up from `day` (where
the leap day is inserted). The schema allows this because rule
conditions are evaluated against the tier-tuple at conversion time.

### Per-story state

Two pieces of state, separated by mutability and scope:

```ts
// Story-level — copy-at-creation, references the calendar registry
stories.settings.calendarSystemId: string   // e.g. 'earth-gregorian'

// Branch-level — narrative state, forks with the branch
branch_era_flips                            // see data-model.md → Era flips
//   composite (branch_id, id) PK
//   at_worldtime: number       (physical seconds since story start; ≥ 0)
//   era_name: string
```

[`stories.settings.worldTimeOrigin`](../data-model.md#story-settings-shape)
holds the per-story anchor — a `TierTuple` (`Record<tierName, number>`)
corresponding to `worldTime = 0`. Different stories using the same
calendar can have different origins (one Earth story starts in 2024,
another in 1942).

Earth's origin tuple is `{ year, month, day, hour, minute, second }`;
Shire's is `{ year, month, day }`; Stardate's is `{ count }`.
Calendar-uniform from v1 — no string-to-tuple migration. The
wizard's input is a calendar-specific date-picker that produces a
tuple directly. Anywhere a string-formatted creation date is needed,
render the tuple through the calendar's `displayFormat` template.

### Where calendar definitions live

App-global. Storage splits across two homes (per
[data-model.md → Vault content storage](../data-model.md#vault-content-storage)):

```ts
// Built-ins — code (or repo JSON loaded at boot). Read-only.
//   v1 ships: 'earth-gregorian'.
// User-authored — vault_calendars rows. Mutable.
//   Clones of built-ins + future from-scratch entries.

app_settings.default_calendar_id: string   // pointer; seeds new stories
```

App init merges built-ins + `vault_calendars` rows into one
in-memory `Map<id, CalendarSystem>`. Stories reference calendars by
id; resolver does direct lookup against the merged registry.

A calendar is a **preset-shaped artifact**, not story-customized
state — modifying one is conceptually creating a different calendar.
Two tiers of mutability follow from that:

- **Built-in presets are read-only.** Any "edit" on a built-in
  triggers a clone — a new user-authored calendar with a new id,
  seeded from the preset's shape. The original built-in is never
  mutated.
- **User-authored calendars are mutable**, with the explicit
  consequence that edits propagate to every story referencing them
  by id. The integer `worldTime` is preserved across edits; only
  display reinterprets. The user owns this calendar and is
  responsible for what they break in stories using it.

This is **not** the copy-at-creation pattern that operational
`stories.settings` fields use. The reasoning: a calendar is a
stable definition the way a font or a unit system is. Per-story
customization would force every story to carry a full calendar
copy, which is the wrong shape — if you want a different calendar,
clone the preset and use the clone.

Calendar swap on a story (changing `calendarSystemId`) is allowed
but warned: the integer worldTime is preserved, but every existing
entry's display reinterprets under the new calendar's tier shape.
No data is lost.

**The "edit a built-in" affordance always clones first.** UI shows
the active built-in preset with a "Clone & edit" button rather than
a direct edit; the clone gets a new UUID and lands as a
`vault_calendars` row with the original preset name + " (custom)"
suffix.

## Rendering pipeline

Hooks into the existing [generation context](../architecture.md#the-single-context-principle):

1. App init: load active story's `calendarSystemId` → resolve the
   calendar definition from the merged registry (built-ins +
   `vault_calendars`) → register its `displayFormat` Liquid template.
2. Anywhere a worldTime needs a display string:
   1. Compute `tierTuple = worldTimeToTuple(worldTime, calendar)`.
      Variable-length tiers (rule, table) require accumulated
      lookups; cache per-year cumulative lengths lazily.
   2. Compute sub-division values (weekday) from `daysSinceEpoch`
      and the sub-division's modulus.
   3. Compute current era — find the era whose `at` is the largest
      value `≤ worldTime`. Convert `era.at` to its own tier-tuple;
      `eraYear = currentTuple.year - eraAtTuple.year + 1`. (Era
      arithmetic uses the year tier specifically because era flips
      conventionally count years; if a calendar has no `year` tier,
      eras are pointless and should be disabled at the calendar
      level.)
   4. Render `displayFormat` against the assembled state:
      `{ ...tierTuple, weekday, era, eraYear, monthName,
weekdayName, ... }`.
3. Inverse (parse a user-typed date) is needed only at:
   - The wizard's `worldTimeOrigin` input — calendar-specific date
     picker, not free-form text.
   - Manual worldTime correction UI (per the
     [follow-up](../followups.md#manual-worldtime-correction--cascade-vs-jump--downstream-blast-radius)) —
     date picker, not free-form text.
     No generic free-form date parser is needed for v1.

Caching: per-year cumulative-day lengths memoize lazily. A
10,000-year story span = 10,000 small entries; bounded; fine.

## Classifier integration

The classifier (described under
[architecture.md → Agent orchestration](../architecture.md#agent-orchestration))
reads narrative and emits worldTime deltas. It needs the calendar's
vocabulary to convert prose like "two days later" or "next Tuesday"
into **elapsed-second integers**.

Inject a `calendar` block into the classifier prompt context:

- `calendar.baseUnitName` — display label for the bottom tier
  ('second', 'day', 'cycle'). Tells the classifier "the user thinks
  in 'days' here" — vocabulary, not contract.
- `calendar.secondsPerBaseUnit` — conversion factor. The classifier
  multiplies natural-language durations by this to get seconds (e.g.,
  "two days later" under Shire → `2 × 86400 = 172800`).
- `calendar.tiers` — ordered tier names with rollover descriptions
  ("year ≈ 365 days", "month ≈ 28-31 days", "day = 24 hours").
- `calendar.weekday` — sub-division labels, so the classifier
  recognizes "Tuesday".
- `calendar.eraNames` — current era + preset list if defined.

**The classifier always emits a single integer delta in physical
seconds — universal contract across all calendars.** The LLM
understands seconds natively; the calendar block above is purely
vocabulary support. For variable-length tiers (Earth's months),
"27 days" → `27 × 86400 = 2,332,800` seconds is direct; display
handles variable-length rendering separately.

## Authoring (UI)

Three levels of user power, gated by complexity:

| Level  | Scope                                                                             | v1?      |
| ------ | --------------------------------------------------------------------------------- | -------- |
| **L1** | Pick a preset from the catalog.                                                   | Yes      |
| **L2** | Tweak labels of a chosen calendar (rename months, weekdays, eras).                | Yes      |
| **L3** | Author a calendar from scratch — add/remove/reorder tiers, define rollover rules. | Deferred |

**L1 surface** is the calendar picker — surfaces in App Settings
(default-calendar select, seeds new stories), Story Settings
(per-story calendar select), and the Story Creation wizard
(calendar selection step). Same picker primitive across all three;
its design lands as a separate pass.

**L2 surface** lives in the
[Vault calendar editor](../ui/screens/vault/calendars/calendars.md).
[Vault](../ui/README.md) is the home for non-story user content
(packs, scenarios, character templates, calendars); deferred from
v1 as a unified surface, but the calendar sub-wireframe lands as
the first concrete piece. Stories don't own calendar shape; they
reference by id. Edits to a calendar propagate to every story
using it (per
[Where calendar definitions live](#where-calendar-definitions-live)).

**L3 surface** is a dedicated from-scratch authoring view inside
the Vault calendar editor — own design pass when v1 ships and a
real fictional calendar surfaces. Likely form-driven (tier list +
rollover rule cards) with a raw-JSON view for power users
(consistent with the
[JSON viewer pattern](../ui/patterns/data.md#raw-json-viewer--shared-modal-pattern)).

Story Settings exposes the active calendar picker and a read-only
summary of the selected calendar's shape. The full editor is in
Vault; Story Settings is selection + summary only.

## Presets to ship

**v1:** Earth (Gregorian).

**Followup presets** to add as concrete fictional examples emerge
(per [followups.md](../followups.md#fictional-calendar-systems)):

- Generic fantasy 12×30 — same structure, renamed months, no leap.
- Tolkien Shire Reckoning — 12×30 + intercalary days.
- Stardate-ish — sequential single-tier.
- Warhammer 40K Imperial — two-tier `M{millennium}.{fractional-year}`.

Presets live in code; the schema is stable enough that adding a
preset is a data commit, not a code change.

## Adversarial check

Things that could go wrong, flagged for implementation:

- **Variable-length tier conversion is O(year-span).** Bounded by
  per-year cumulative cache; small entries; fine for any realistic
  story. Don't call uncached on every keystroke in interactive UI.
- **Calendar swap on existing story** — the integer `worldTime` (in
  physical seconds) is preserved; display reinterprets under the new
  tier shape + `secondsPerBaseUnit`. Era flips on the current branch
  are kept as orphaned data if the new calendar has `eras: null`
  (re-surface if eras are re-enabled). Warn in the swap affordance.
  Mid-generation swap is prohibited per the broader "no settings
  edits during in-flight generation" pattern.
- **`secondsPerBaseUnit` validation** — must be a positive integer.
  Zero divides; non-integer values produce fractional bottom-tier
  values that don't round-trip. Strict zod parse on JSON save.
- **Era flip is reversible** (delta-logged). Implementation must
  cover: flip era → undo → state matches pre-flip.
- **Origin validation** — `worldTimeOrigin` (a `TierTuple`) must
  reference every tier the active calendar declares, with values in
  range. A user editing the calendar (adding/removing a tier) leaves
  every using-story's origin partially-shaped. Strict zod parse on
  load; on schema mismatch, surface a "this story's origin needs
  re-confirmation" affordance rather than failing the render.
- **Display template breakage** — a user-edited Liquid template
  with a typo breaks every render. Preview-on-save in the editor.
  Render-time error fallback: render integer worldTime as raw
  fallback string with a warning chip.
- **Sub-division offset stale after edits** — if a user changes a
  sub-division's `length` or `labels`, the existing `offset` may
  still be valid numerically but semantically wrong. Editor warns;
  on confirmation, user re-picks the value at worldTime=0.
- **Rollover-rule combinatorics** — a stack of leap conditions can
  encode unintended states ("every 4, exclude every 5, include
  every 100" produces a complicated mask). Test coverage on the
  Gregorian shape; a "show me when this rule fires" debugging view
  in the L3 editor would help. Defer to L3.

## Open questions

Items resolved by this design but with implementation-level
follow-ups:

- **L3 Calendar Editor screen** — own UI design pass when v1 ships
  and the first fictional calendar surfaces.
- **Cross-calendar translation** — rendering a worldTime in a
  calendar OTHER than the story's active one (e.g., a flashback
  scene labeled in a historical calendar). Probably not v1; defer
  until needed.
- **Wizard `worldTimeOrigin` input UX per calendar** — each
  calendar's parser shapes a different input form (date picker for
  Earth; tier-by-tier inputs for Tolkien; bare integer for
  stardate). Component design lands with the wizard work.
- **Classifier vocabulary breadth** — does the prompt also need
  era _history_ (not just current era) for prose like "before the
  Sundering"? Probably yes for any story with multiple eras;
  classifier prompt design lands with implementation.

## Resolves in followups.md

The four sub-questions in
[`Fictional calendar systems`](../followups.md#fictional-calendar-systems)
are answered above:

- **Where declared:** `stories.settings.calendarSystemId` references
  an entry in the calendar registry (built-ins in code +
  `app_settings.calendars`); `branch_era_flips` table holds runtime
  era-flip log.
- **How authored:** declarative tiered schema + Liquid display
  template. v1 ships preset catalog + label-tweak (L1/L2);
  full from-scratch authoring (L3) deferred.
- **Renderer contract:** `worldTime` integer → tier-tuple via the
  calendar's tier walk → Liquid template render. Inverse only at
  date-picker entry points; no free-form parser.
- **Classifier awareness:** gets a `calendar` context block with
  vocabulary; still emits integer base-unit deltas.

The followup is reduced to a pointer at this doc, with
implementation deferred until 2-3 concrete fictional calendars
surface to validate the design against.
