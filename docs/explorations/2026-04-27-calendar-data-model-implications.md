# Calendar — data-model implications (2026-04-27)

## Why this exists

Calendar systems were designed in
[`calendar-systems/spec.md`](../calendar-systems/spec.md) with five
proposed data-model deltas. Those deltas live in spec.md but were
never integrated into [`data-model.md`](../data-model.md). Two of
them turned out to have spec gaps: one structural (era flips placed
on `stories` rather than branches), one semantic (the integer base
unit was implicitly per-calendar, contradicting the "calendar swap
preserves the integer" promise).

This exploration resolves both gaps and the smaller open items
around them, then ships the integration as edits to `data-model.md`,
`spec.md`, `architecture.md`, and `followups.md`.

## Decisions

### Universal seconds

`worldTime` is in **physical seconds**, not per-calendar base units.
The calendar declares `secondsPerBaseUnit: number` mapping its
bottom-tier unit to seconds (Earth = 1, Shire = 86400, Mayan kin =
86400, Stardate = 86400 in TNG convention). Tier rollovers above the
bottom stay as today — "how many of THIS tier per parent."

This makes:

- **Calendar swap meaningful.** The integer is preserved; only
  display and the `secondsPerBaseUnit`-mediated arithmetic
  reinterprets.
- **Classifier contract permanent.** The classifier always emits
  second-deltas. The active calendar's vocabulary feeds the prompt as
  display labels (and via `secondsPerBaseUnit` as a conversion
  factor), not as semantics. The LLM understands seconds natively
  across all stories.
- **All worldTime arithmetic uniform** across calendars (character
  ageing, freshness decay, scheduled-happening fire times, era
  flips).

Precision floor is one second; int64 holds ~290 billion years.
Surveyed published-fiction calendars (Earth-shaped fantasy, sci-fi
planetary, mythological including Vedic kalpas, Warhammer's symbolic
notation, Stardate) all decompose to second-grain or coarser. The
escape hatch — bumping physical base to milliseconds, still
int64-safe for ~290M years — exists if a future case demands it.

### Structured origin (TierTuple from v1)

`stories.settings.worldTimeOrigin` is `TierTuple` (`Record<tierName,
number>`) from v1, not a string-now-tuple-later migration. Earth's
origin is `{ year, month, day, hour, minute, second }`; Shire's is
`{ year, month, day }`; Stardate's is `{ count }`.

The string form is recoverable any time by rendering the tuple
through the calendar's `displayFormat`. The wizard's date-picker
produces a tuple directly. No migration ever runs.

### Branch-scoped era flips

Era flips live in a dedicated `branch_era_flips` table — composite
`(branch_id, id)` PK, snapshot-on-fork, per-row delta machinery.
spec.md originally placed them on `stories.calendar_state` JSON,
which would have broken branch isolation: era flips fork with
branches like every other narrative state, but a `stories`-scoped row
crosses the branch boundary.

Why not JSON on `branches`? Forces adding `branches` to
`deltas.target_table` (currently never delta-logged), turns per-flip
mutations into whole-row JSON updates with awkward delta payloads,
and breaks the "branches is config-shaped, narrative state in
dedicated tables" pattern. The dedicated table inherits the existing
infrastructure — composite PK, fork copy, delta ops — without
special cases.

Why not piggy-back on `happenings`? Era flips are calendar
configuration events, not narrative events. They don't have
involvements or awareness; conflating them would muddy both domains.

Constraints on `branch_era_flips`:

- `at_worldtime ≥ 0` — no pre-story flips. Pre-story history belongs
  in `happenings.temporal`. Time is increment-only.
- Unique `(branch_id, at_worldtime)` — no two flips at the same
  moment on the same branch. UI-level invariant; the user has no
  normal flow to construct conflicting writes.
- Flip at `at_worldtime = 0` overrides
  `EraDeclaration.defaultStartName`. The wizard's initial-era
  picker creates a flip at 0 if the user picks something other
  than the default, otherwise the default applies until the first
  user-triggered flip.

### App-global calendar registry

Calendars live in two homes:

- **Built-ins in code** (or repo JSON loaded at boot) —
  `'earth-gregorian'` is the v1 ship-with set.
- **User-authored** in `app_settings.calendars: CalendarSystem[]` —
  clones of built-ins (with new UUIDs) plus any from-scratch entries
  (L3 power-user authoring, deferred).

App init merges the two into one in-memory `Map<id, CalendarSystem>`.
Stories reference by id; resolver does direct lookup. Built-in ids
are stable strings; clone ids are UUIDs — disjoint by construction,
no precedence rule needed.

`app_settings.default_calendar_id: string` seeds new stories'
`calendarSystemId`. Sibling pattern to `default_provider_id`
(top-level on `app_settings`, not nested under
`default_story_settings`) — both are single-id pointers into a
registry, not full state copies.

Cloning a built-in copies its definition to a new entry with a new
UUID + the original name + " (custom)" suffix. The clone is fully
independent from creation onward — no shadow / fallback path.
Calendar deletion is blocked when any story references the calendar
id.

### Calendar swap semantics

Allowed but warned:

- The integer `worldTime` is preserved (universal seconds is
  calendar-agnostic).
- Display reinterprets through the new calendar's tiers +
  `secondsPerBaseUnit`.
- `worldTimeOrigin` may need re-confirmation if the new calendar's
  tier shape differs (strict zod parse on load; UI surfaces a
  re-confirm affordance).
- Era flips on the current branch are kept as orphaned data if the
  new calendar has `eras: null` (re-surface if eras are re-enabled
  later).
- **Mid-generation swap is prohibited.** Broader UX pattern:
  story-settings edits during in-flight generation are blocked. New
  followup added; the cross-cutting pattern needs its own pass.

## Schema deltas

### data-model.md

- **`stories.settings.calendarSystemId: string`** added.
  Copy-at-creation; seeded from `app_settings.default_calendar_id`.
- **`stories.settings.worldTimeOrigin`** retyped: `string` →
  `TierTuple` (`Record<tierName, number>`).
- **New `branch_era_flips` table** — composite `(branch_id, id)` PK,
  columns `at_worldtime: number`, `era_name: string`, `created_at`.
- **`branches ||--o{ branch_era_flips`** relationship in the ER
  diagram.
- **`deltas.target_table` enum** appended with `branch_era_flips`.
- **Branch-fork procedure** updated to include `branch_era_flips` in
  the snapshot-on-fork enumeration.
- **`app_settings.calendars: CalendarSystem[]`** added (user-authored
  only).
- **`app_settings.default_calendar_id: string`** added.
- **New `### Era flips` decision sub-section** explaining the
  branch-scoped storage rationale + the constraints above.
- **`### In-world time tracking`** rewritten — universal seconds,
  structured origin, classifier-emits-seconds clarification.
- **`### Story settings shape`** — new fields in the World-time
  block; one-line scope-policy note acknowledging top-level seed
  sources.
- **`### App settings storage`** — new "Calendars — user-authored
  only" paragraph.

### spec.md

- **Opening of `The primitive: tiered counters`** rewritten for
  universal-seconds framing.
- **New `Universal seconds, calendar-declared base unit`
  sub-section** added.
- **`CalendarSystem` type** — `baseUnit` renamed to `baseUnitName`
  (display label only); `secondsPerBaseUnit: number` added (positive
  integer, validated at JSON save).
- **`Eras: hoisted out, manually triggered`** third paragraph
  rewritten — points at `branch_era_flips`, drops the
  `stories.calendar_state` framing.
- **`Per-story state`** code block + paragraph rewritten — TierTuple
  from v1, `branch_era_flips` reference, no migration paragraph.
- **`Classifier integration`** rewritten — explicit-seconds contract,
  `secondsPerBaseUnit` exposed in prompt context.
- **`Adversarial check` calendar-swap bullet** sharpened —
  universal-seconds preservation, era-flip orphan behavior on
  `eras: null`.
- **`Resolves in followups.md` first bullet** corrected —
  `branch_era_flips` instead of `stories.calendar_state`.

### architecture.md

- **Classifier contract line for `worldTime`** updated — "base-unit
  delta (seconds for Earth calendar)" → "seconds delta (universal
  across calendars)".

## Out of scope / deferred

- **Era-name translation.** Out of scope. Users wanting localized era
  names use a calendar in their preferred language (a Japanese-
  localized Imperial Japan clone, etc.). `branch_era_flips.era_name`
  is intentionally not joined to `translations.target_kind`.
- **Sub-second narrative resolution.** Not pre-built.
  Universal-milliseconds escape hatch exists if a future case
  demands it.
- **Mid-generation edit restrictions** as a cross-cutting pattern.
  Calendar-swap-during-generation is one instance; story-settings-
  edits-during-generation is another. The broader pattern needs its
  own pass — new followup.
- **App Settings → Calendars wireframe.** L2 surface specified in
  spec.md but not wireframed. New followup.
- **Story Settings calendar-picker wireframe.** Spec'd in spec.md but
  no wireframe element. New followup.
- **Backup / story export with user-authored calendars.** Export
  needs to embed user-authored calendar definitions as a sidecar
  (or import substitution UX). New followup.
- **L3 Calendar Editor screen.** Already deferred in spec.md — own
  UI design pass when v1 ships and a real fictional calendar
  surfaces.

## Followups created / changed

**Added** (UX section unless noted):

- Provider / profile / model-profile deletion semantics — sets
  precedent for calendar deletion (block when references exist),
  worth a dedicated pass for providers and profiles too.
- App Settings → Calendars surface — wireframe + L2 editor design.
- Story Settings calendar-picker surface — wireframe element + read-
  only summary of selected calendar's shape.
- Backup / story export with user-authored calendar definitions —
  sidecar embedding or import substitution UX.
- Edit restrictions during in-flight generation — cross-cutting UX
  pattern. Calendar swap is one instance; settings edits another.
  Settle on a pattern.

**Unchanged:**

- `Fictional calendar systems` (Data-model) — design folded in via
  spec.md, but the followup stays since implementation is still
  deferred until 2–3 concrete fictional calendars surface.
- `Manual worldTime correction` (Data-model) — unaffected by this
  design; the cascade-vs-jump question is orthogonal.
- `Top-K-by-salience retrieval` (Data-model) — unaffected.

**Resolved (removed):** none.
