# 2026-05-20 — Search scope on `entities.state` fields

Resolves the [`Search scope on state fields`](../followups.md)
followup. With the [`entities.state` shape](../data-model.md#world-state-storage)
settled and carrying real user-facing text content (classifier-mutable
short prose, chip-array identity bits, dynamic state deltas), entity
search expands from the universal `name` / `description` / `tags`
triple to a per-kind scope that covers the searchable state slots.

## Outcome

Entity search remains **category-aware** and **per-active-kind**.
Both consumer surfaces (Reader Browse rail, World list pane) keep
their existing kind-selector UX; the change is purely in _which
fields the active kind contributes_ to the search.

The canonical per-kind scope lives in a new
[`patterns/entity.md → Search scope`](../ui/patterns/entity.md#search-scope)
section. Per-screen docs and the [`patterns/lists.md → Search bar
scope`](../ui/patterns/lists.md#search-bar-scope) cross-cutting summary
both collapse to pointers — single source of truth, no duplicated
field lists.

Tooltip stays terse ("Searches name, description, tags,
retired-reason, and per-kind state fields"); the ⓘ help popover
expands to a kind-aware two-tier list (Identity / State).

## Per-kind scope

**Row-level (every entity kind).** Universal across `entities`
regardless of `kind`:

| Field            | Status                       |
| ---------------- | ---------------------------- |
| `name`           | unchanged — already in scope |
| `description`    | unchanged — already in scope |
| `tags`           | unchanged — already in scope |
| `retired_reason` | newly in scope               |

`retired_reason` matches the same user-authored short-text profile as
`description`; it's populated only when `status=retired` (NULL
otherwise), so `NULL LIKE '%query%'` evaluates falsy and active
entities cost nothing.

**State fields (kind-discriminated).** Names below trace into
the `state` JSON column via `json_extract` / `json_each`:

| Kind      | State fields in scope                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Character | `traits[]`, `drives[]`, `voice`, `visual.physique`, `visual.face`, `visual.hair`, `visual.eyes`, `visual.attire`, `visual.distinguishing[]` |
| Location  | `condition`                                                                                                                                 |
| Item      | `condition`                                                                                                                                 |
| Faction   | `standing`, `agenda[]`                                                                                                                      |

**Explicitly out of scope** (called out so the omissions read as
intentional):

- **FK references on state** — `current_location_id`,
  `equipped_items`, `inventory`, `faction_id` on CharacterState;
  `parent_location_id` on LocationState; `at_location_id` on
  ItemState. Text-matching FK id strings is meaningless; users
  searching `Iron Tavern` find the location directly by name.
  FK-target-name resolution into searched text is structured-relation
  querying — deferred (see [Followups in/out](#followups-inout)).
- **`stackables`** on CharacterState — `Record<string, number>`.
  Both text-key search ("characters with gold") and numeric filters
  ("gold > 0") are structured-filter shapes; pinning a hybrid now
  invites half-built numeric semantics. Deferred.
- **`lastSeenAt`** cache on CharacterState — denormalized recency
  cache, not user-authored prose; surfacing it in search would
  conflate identity with recency.

**Visual sub-fields are all in** — explicit decision against the
followup's lean. Accepted trade-off: broad terms like `dark` or
`red` will flood across many characters. Mitigation lives at the
user level (narrow query, use filter chips); no implementation
guardrail in v1. A per-sub-field toggle is the additive next step
if real use surfaces flooding signal — parked under
[Followups in/out](#followups-inout).

## Document placement decision

Three placements were considered:

- **A. `patterns/entity.md` owns the canonical per-kind scope.**
  New `## Search scope` section. Per-screen docs and
  `patterns/lists.md` summary point in.
- **B. `patterns/lists.md → Search bar scope` owns the per-kind
  scope.** Expand the cross-cutting summary table to a per-kind
  sub-table.
- **C. Per-screen docs each spell out the full scope inline.**
  Matches today's "per-screen docs carry single-surface detail"
  convention.

**A chosen.** The per-kind state-field scope is entity-domain
knowledge (what a Character or Faction _has_ on its state) — same
shape of knowledge as the rest of `entity.md`. B would put
"Character has `traits[]` and `visual.hair`" under a list-rendering
pattern, which is a category error. C would create non-trivial
duplicated prose across two per-screen docs, drift-prone, and
would trigger boilerplate-detection by design.

`patterns/entity.md → Used by` already covers Reader Browse rail +
World panel + Plot panel — no Used-by addition; the new section's
canonical-URL role for these surfaces is consistent with the
existing pattern-adoption story.

## Tooltip / ⓘ popover copy

Per the existing [`patterns/lists.md → Search bar
scope`](../ui/patterns/lists.md#search-bar-scope) contract:

**Placeholder** — preserved per-surface. Reader rotates per active
category (`Search characters…`, `Search locations…`, etc.); World
keeps its static `Search…`. Unchanged.

**Tooltip on focus / hover** — single line, every entity kind:

> Searches name, description, tags, retired-reason, and per-kind
> state fields.

**ⓘ popover** — kind-aware two-tier rendering. Examples:

For Characters:

> **Identity:** name, description, tags, retired-reason
>
> **State:** traits, drives, voice, visual (physique, face, hair,
> eyes, attire, distinguishing)

For Locations / Items:

> **Identity:** name, description, tags, retired-reason
>
> **State:** condition

For Factions:

> **Identity:** name, description, tags, retired-reason
>
> **State:** standing, agenda

Lore / threads / happenings categories keep their pre-existing
single-tier popover content (their kinds have no `state` JSON
column).

The popover content variant is keyed by the active category — the
same signal both surfaces already track for placeholder rotation
and filter behavior. No new primitive contract, host-rendered.

## SQLite mechanics

No schema work earned by this design — consumption-side decision
over an already-settled shape.

- Top-level columns (`name`, `description`, `tags`,
  `retired_reason`) — `LIKE` (existing).
- Single-string state fields (`voice`, `condition`, `standing`,
  `visual.physique`, etc.) — `json_extract(state, '$.<path>')
LIKE '%query%'`. NULL-safe (`NULL LIKE x` is NULL → falsy).
- **Array state fields (`traits`, `drives`, `agenda`,
  `visual.distinguishing`) must use `json_each`** with `LIKE` on
  the `value` column — same shape `tags` already uses.
  Partial-`LIKE` on raw `json_extract` of an array would match
  against the JSON syntax (commas, brackets, quotes) and is
  brittle. Implementation footgun called out explicitly here.
- Composition — query is `WHERE kind = ? AND (row LIKEs OR state
json_extracts / json_eaches)`. Per-kind clause is composed by
  the active category; Locations never get Character-state extracts
  in their WHERE.

FTS5 upgrade path is unchanged — `patterns/lists.md` already names
it, and [`parked.md → FTS5 upgrade for
search`](../parked.md#fts5-upgrade-for-search) carries the deferred
work. v1 stays on LIKE + JSON1.

**Translation rows are not searched.** Search runs over source-
language text only; the [`translations`](../data-model.md#translation)
table is display-only per locale. A user reading a translation
searching a translated term won't find entities whose source state
carries the same concept. Future
[translation-aware search](../parked.md#translation-aware-search) is
its own parked item, not part of this design.

## Edge cases + adversarial findings

- **Optional / unset state fields.** `voice?`, `condition?`,
  `standing?`, `agenda?[]`, `visual.distinguishing?[]`, and every
  `visual.*` sub-field are nullable. `json_extract` returns NULL for
  missing keys; `NULL LIKE x` is NULL (falsy). Matches existing
  optional-tag behavior — no special-casing.
- **Sparse `state` on staged entities.** A `status=staged` entity
  may not yet have populated state. Same null-handling as above.
- **`retired_reason` × status filter.** When the user filters out
  `retired` via the status chips, retired-reason matches are
  excluded by the status filter, not by search-scope omission. The
  no-results state in [`patterns/lists.md → No-results
state`](../ui/patterns/lists.md#no-results-state-search--filter-narrowed-to-zero)
  applies cleanly.
- **Multi-word query across chip-array elements.** A query
  `former soldier` matches a chip `"former soldier"` but does NOT
  match a character with chips `["former", "soldier"]`. Same
  semantics as `tags` today. Mitigation is classifier-prompt
  discipline (multi-concept chips tend to be written as single
  strings); not a design break.
- **Cross-kind search.** Both consumer surfaces use mutually
  exclusive kind selectors (verified against
  [`entity.md → Browse filter chips`](../ui/patterns/entity.md#browse-filter-chips)
  — the `All` chip is a status filter, not a kind filter; accordion
  grouping under "All" groups by status within the active kind, not
  across kinds). The per-kind scope is therefore always well-defined
  at query time.
- **`visual.*` flooding.** Accepted by explicit decision. Mitigation
  via filter chips + query narrowing at the user level; per-sub-
  field toggle is parked for signal.
- **Read-site sweep.** Walked every search-bearing surface — Story
  List (story-level fields, unrelated), Plot panel
  (threads / happenings, different kinds, scope unchanged), Diagnostics
  Hub (delta-log search, structurally different), Wizard cast list
  (no search input — verified), Branch navigator (sort-only, not
  search). The two surfaces in scope are the only consumers.

## Integration plan

**Canonical files touched:**

- [`docs/ui/patterns/entity.md`](../ui/patterns/entity.md) — new
  `## Search scope` H2 between `## Browse filter chips` and
  `## Entity detail-pane composition`. Section contents: per-kind
  scope table (row-level + state fields), out-of-scope call-outs,
  SQLite-mechanics paragraph (including `json_each` guidance for
  arrays + translation-source-only acknowledgment), tooltip + ⓘ
  popover copy per kind.
- [`docs/ui/patterns/lists.md`](../ui/patterns/lists.md) →
  `## Search bar scope` summary table. Reader Browse rail + World
  panel entity-row entries compress from inline field lists to
  pointers at `patterns/entity.md → Search scope`. Lore / thread /
  happening parts unchanged.
- [`docs/ui/screens/reader-composer/reader-composer.md`](../ui/screens/reader-composer/reader-composer.md) →
  `## Browse rail — search scope` body collapses: per-kind entity
  scope via pointer; lore / thread / happening scope spelled out
  (unchanged); placeholder-rotation reader-specific deviation
  preserved.
- [`docs/ui/screens/world/world.md`](../ui/screens/world/world.md) →
  `## List pane — search scope` body collapses: per-kind entity
  scope via pointer; lore scope spelled out (unchanged).
- [`docs/followups.md`](../followups.md) — remove
  `### Search scope on state fields`.
- [`docs/parked.md`](../parked.md) — add
  `#### Structured filters on entity rows` under
  `## Parked until signal → ### UX (parked)`.

**Renames:** none. The two existing `## Browse rail — search
scope` and `## List pane — search scope` headings keep their
slugs; their content compresses, the anchor doesn't change.

**Pattern adoption:** no new pattern citation — the per-screen docs
already cite `patterns/lists.md → search-bar-scope`, and
`patterns/entity.md → Used by` already lists Reader Browse rail +
World panel as primary consumers.

**Wireframes:** no edits required. Visual affordance is unchanged;
the ⓘ popover content varies per active kind, but the popover
shell + placement are pre-existing.

**Intentional repeated prose:** none. The point of approach A is
to avoid the duplication; only single-source canonical text per
field-list lives anywhere in the tree.

## Followups in/out

**Resolved by this integration:**

- `docs/followups.md` → Search scope on state fields — entry
  removed in the integration commit; this design IS the answered
  pass.

\*\*New parked entry (under `parked.md → ## Parked until signal →

### UX (parked)`):\*\*

- `Structured filters on entity rows` — consolidates four
  trigger-distinct deferrals:
  - **FK target name resolution** in text search (searching
    `Iron Tavern` matching characters whose `current_location_id`
    resolves to a location named that). Structured-relation
    querying; not text scope.
  - **`stackables` filtering** — text-key (`gold`) and numeric
    (`gold > 0`) forms. Structured-filter shape; lands at the
    first design pass that touches inventory-management UX.
  - **Per-`visual.*` sub-field toggle** if flooding signal emerges
    in real use. UX guardrail; not pre-built.
  - **Cross-field multi-word query language** (`hair:red AND
attire:cloak`-style). Significant scope; only earns its way
    in if simple substring stops covering use cases.

All four share enough query-layer machinery that one consolidated
design pass is the right shape — splitting into four entries
would create ledger noise.
