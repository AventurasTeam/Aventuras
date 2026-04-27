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
  [location entities](./data-model.md#world-state-storage) (per-location
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

[`worldTime`](./data-model.md#in-world-time-tracking) — a single
integer in **base time units** — is the spine. The conversion
`worldTime ↔ tier-tuple` is one bidirectional walk. The data model
already pre-supposes this: the integer is calendar-agnostic; the
calendar is a renderer + arithmetic engine over the integer.

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
The story holds **era flip events** (the `at`-worldTime + name
pairs). Flips are user-triggered — explicit "Flip era" affordance
— and delta-logged like any narrative-state mutation (the deltas
table is documented in [data-model.md → World-state storage](./data-model.md#world-state-storage)).

A calendar with predictable eras (rare — fixed-length 1000-year
ages with no narrative branch) is unsupported by design. Users
wanting that author it as `{{ year | divide: 1000 | floor }}` in
the display template, with no era field at all.

## Data shape

### Calendar definition

```ts
type CalendarSystem = {
  id: string // stable across saves; e.g. 'earth-gregorian'
  name: string // human-readable
  baseUnit: string // bottom tier's name in vocabulary terms
  //   — 'second', 'day', 'cycle', 'tick'
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
}

type EraDeclaration = {
  resetsOnFlip: string[] // tier names to reset to startValue on era flip
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

Two pieces of state, separated by mutability:

```ts
// Stable definitional reference (settings — copy semantics see below)
stories.settings.calendarSystemId: string   // e.g. 'earth-gregorian'

// Mutable narrative state (new column on stories table)
stories.calendar_state: {
  eraFlips: Array<{
    at: number       // worldTime of the flip
    eraName: string  // new era's display name
  }>
}
```

[`stories.settings.worldTimeOrigin`](./data-model.md#story-settings-shape)
holds the per-story anchor — the tier-tuple corresponding to
`worldTime = 0`. Different stories using the same calendar can have
different origins (one Earth story starts in 2024, another in 1942).

This **amends** data-model.md's current `worldTimeOrigin: string`
shape. v1 (Earth-only) keeps the string form because all consumers
agree on ISO 8601. When fictional calendars implement, the field
becomes `TierTuple` (a structured object keyed by tier name) and
the wizard's input becomes a calendar-specific date-picker rather
than a free-form string. The string form falls out of the
calendar's `displayFormat` template applied to the tuple, available
anywhere a string is needed.

### Where calendar definitions live

App-global, like
[providers and model profiles](./data-model.md#app-settings-storage):

```ts
app_settings.calendars: CalendarSystem[]
app_settings.default_calendar_id: string   // seed for new stories
```

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
a direct edit; the clone gets a new id and lands in the user's
calendars list with the original preset name + " (custom)" suffix.

## Rendering pipeline

Hooks into the existing [generation context](./architecture.md#the-single-context-principle):

1. App init: load active story's `calendarSystemId` → resolve the
   calendar definition from `app_settings.calendars` → register its
   `displayFormat` Liquid template.
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
     [follow-up](./followups.md#manual-worldtime-correction--cascade-vs-jump--downstream-blast-radius)) —
     date picker, not free-form text.
     No generic free-form date parser is needed for v1.

Caching: per-year cumulative-day lengths memoize lazily. A
10,000-year story span = 10,000 small entries; bounded; fine.

## Classifier integration

The classifier (described under
[architecture.md → Agent orchestration](./architecture.md#agent-orchestration))
reads narrative and emits worldTime deltas. It needs the calendar's
vocabulary to convert prose like "two days later" or "next Tuesday"
into elapsed-base-unit integers.

Inject a `calendar` block into the classifier prompt context:

- `calendar.baseUnit` — name of the base unit.
- `calendar.tiers` — ordered tier names with rollover descriptions
  ("year ≈ 365 days", "month ≈ 28-31 days", "day = 24 hours").
- `calendar.weekday` — sub-division labels, so the classifier
  recognizes "Tuesday".
- `calendar.eraNames` — current era + preset list if defined.

The classifier still emits a single integer delta in base units —
**no contract change**. The pack's classifier prompt template
renders the calendar block as part of its prompt. For non-uniform
tiers (Earth's months), the classifier's "27 days" → integer base
units math is stable because base units are uniform; display
handles the variable-length rendering separately.

## Authoring (UI)

Three levels of user power, gated by complexity:

| Level  | Scope                                                                             | v1?      |
| ------ | --------------------------------------------------------------------------------- | -------- |
| **L1** | Pick a preset from the catalog.                                                   | Yes      |
| **L2** | Tweak labels of a chosen calendar (rename months, weekdays, eras).                | Yes      |
| **L3** | Author a calendar from scratch — add/remove/reorder tiers, define rollover rules. | Deferred |

**L1 surface** lives in the Story Creation wizard — calendar
selection step, default = global app default.

**L2 surface** lives in the calendar editor at App Settings →
Calendars (sibling to Profiles, Providers). Stories don't own
calendar shape; they reference by id. Edits to a calendar
propagate to every story using it (per
[Where calendar definitions live](#where-calendar-definitions-live)).

**L3 surface** is a dedicated Calendar Editor screen — own design
pass when v1 ships and a real fictional calendar surfaces. Likely
form-driven (tier list + rollover rule cards) with a raw-JSON view
for power users (consistent with the
[JSON viewer pattern](./ui/principles.md)).

Story Settings exposes the active calendar picker and a read-only
summary of the selected calendar's shape. The full editor is at
the app level.

## Presets to ship

**v1:** Earth (Gregorian).

**Followup presets** to add as concrete fictional examples emerge
(per [followups.md](./followups.md#fictional-calendar-systems)):

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
- **Calendar swap on existing story** — every entry's worldTime
  reinterprets under the new tier shape. Display changes, integer
  arithmetic doesn't. Document as intentional; warn in the swap
  affordance.
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
[`Fictional calendar systems`](./followups.md#fictional-calendar-systems)
are answered above:

- **Where declared:** `stories.settings.calendarSystemId` references
  an entry in `app_settings.calendars`; `stories.calendar_state`
  holds runtime era-flip log.
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
