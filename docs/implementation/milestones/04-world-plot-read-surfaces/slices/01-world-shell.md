# Slice 4.1 — World panel shell + list pane

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** none (day-one; the M1.5 entity and lore layers, the
  shipped `ScreenShell` / `MasterDetailLayout` / `EntityListPane` /
  `DetailPane` shells, and the M3.3 classifier that writes
  `name_collision_flag` are merged prerequisites; row data comes from
  `pnpm db:seed` until real stories exist). Doc-as-contract pair with
  [Slice 4.3](./03-plot-panel.md) over C6 (the deep-link param shape).
- **Blocks:** [Slice 4.2a](./02a-entity-detail.md) (detail pane host,
  `[+] Blank`) and through it [Slice 4.2b](./02b-lore-history-delete.md)
  (lore create mode); [Slice 4.2c](./02c-collision-review.md) (the
  `Resolve →` hand-off — partial); [Slice 4.3](./03-plot-panel.md)
  (C1 signals and the C6 World deep link — partial);
  [Slice 4.5a](./05a-browse-rail.md) (row renderers and list queries —
  C2); [Slice 4.6](./06-import-export.md) (import host — partial)

## Goal

The World route exists and lists the branch's entities and lore the
way canon draws it: kind dropdown, per-kind filter chips, accordion
grouping on the All view, the four-layer entity sort and two-layer
lore sort, category-aware search over row columns and `state` JSON,
four-channel rows, collision surfacing chrome, the Actions menu's
`GO TO` group, phone collapse. The detail pane is hosted but empty — a
placeholder until 4.2a. Two substrate modules land here because every
later surface reads them: the derived row-signal selectors (C1) and
the per-kind list modules (C2).

## Background

World is the deep-edit workshop level of the three-level entity
surfacing (rail → peek → panel). Its shell decomposition is already
shipped and story-covered — this slice wires, it does not build
chrome. What it builds is the **data side** of the list pane: the
search SQL that reaches into `entities.state` per kind with
`json_extract` / `json_each`, the rule-driven sort with the lead
pinned, the accordion keyed on status tier, and the per-row derived
signals (in-scene from the tail entry's `metadata`, recently-classified
from the delta log, collision from the flag). Collision **resolution**
is 4.2c; this slice only makes the flag visible everywhere canon says
it should be.

## Required reading

- [`world.md → Layout`](../../../../ui/screens/world/world.md#layout),
  [`Top-bar`](../../../../ui/screens/world/world.md#top-bar),
  [`List pane — search scope`](../../../../ui/screens/world/world.md#list-pane--search-scope),
  [`Per-row import`](../../../../ui/screens/world/world.md#per-row-import),
  [`List sort — lore`](../../../../ui/screens/world/world.md#list-sort--lore-static-two-layer),
  [`List filter — lore`](../../../../ui/screens/world/world.md#list-filter--lore),
  [`Surfacing`](../../../../ui/screens/world/world.md#surfacing) and
  [`Mobile expression`](../../../../ui/screens/world/world.md#mobile-expression)
  — the screen contract this slice fulfills.
- [`patterns/entity.md → Entity row indicators`](../../../../ui/patterns/entity.md#entity-row-indicators--four-orthogonal-channels),
  [`Entity list sort order`](../../../../ui/patterns/entity.md#entity-list-sort-order--static-four-layer),
  [`Browse filter chips`](../../../../ui/patterns/entity.md#browse-filter-chips),
  [`Accordion grouping on "All" view`](../../../../ui/patterns/entity.md#accordion-grouping-on-all-view),
  [`Search scope`](../../../../ui/patterns/entity.md#search-scope)
  (including SQLite mechanics and the ⓘ popover copy) and
  [`Recently-classified row accent`](../../../../ui/patterns/entity.md#recently-classified-row-accent)
  — the row-level rules, and the definition of "touched" C1 encodes.
- [`patterns/lists.md → Search bar scope`](../../../../ui/patterns/lists.md#search-bar-scope),
  [`Empty list / table state`](../../../../ui/patterns/lists.md#empty-list--table-state)
  and [`No-results state`](../../../../ui/patterns/lists.md#no-results-state-search--filter-narrowed-to-zero).
- [`patterns/data.md → Import counterparts`](../../../../ui/patterns/data.md#import-counterparts--file-based--vault)
  — the three-option `[+]` menu this slice mounts.
- [`patterns/collision-resolve.md → CollisionListRow`](../../../../ui/patterns/collision-resolve.md#collisionlistrow)
  and [`Out of scope`](../../../../ui/patterns/collision-resolve.md#out-of-scope)
  — the strip compound this slice mounts, and the pill and badge chrome
  the pattern leaves to the screen.
- [`patterns/generation-status-pill.md → Open items`](../../../../ui/patterns/generation-status-pill.md#open-items)
  — the World `⚠ N need review` pill and the top-bar consumer wiring.
- [`patterns/actions-menu.md → Curated core`](../../../../ui/patterns/actions-menu.md#curated-core)
  and [`Contextual zone`](../../../../ui/patterns/actions-menu.md#contextual-zone)
  — the `GO TO` group with its self-omit rule, and World's entries.
- [`principles.md → World / Plot split`](../../../../ui/principles.md#world--plot-split--unified-panels-by-purpose),
  [`Universal in-story chrome`](../../../../ui/principles.md#universal-in-story-chrome),
  [`Master-detail sub-header`](../../../../ui/principles.md#master-detail-sub-header),
  [`Breadcrumb tappability`](../../../../ui/principles.md#breadcrumb-tappability)
  and [`Scene presence is runtime-derived`](../../../../ui/principles.md#scene-presence-is-runtime-derived-not-status).
- [`collapse.md → Two-pane navigation surfaces`](../../../../ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings),
  [`navigation.md → Cross-surface navigation model`](../../../../ui/foundations/mobile/navigation.md#cross-surface-navigation-model)
  and [`Stack-aware Return on mobile`](../../../../ui/foundations/mobile/navigation.md#stack-aware-return-on-mobile).
- [`data-model.md → World-state storage`](../../../../data-model.md#world-state-storage)
  and [`Entry metadata shape`](../../../../data-model.md#entry-metadata-shape)
  — the `state` paths search traverses and the scene triple in-scene
  derives from.
- [`memory/edge-cases.md → Name collision`](../../../../memory/edge-cases.md#name-collision-and-disambiguation)
  — where the flag comes from.
- [Milestone contracts C1, C2, C6](../milestone.md#slice-contracts).

## Scope: in

- **Route and chrome:** the World route reachable from the reader's
  in-story chrome and the Actions menu; `ScreenShell` in-story variant
  with the `<title> / World` breadcrumb, status pill slot, chapter
  progress strip; the master-detail sub-header
  (`Characters / Kael`) with tappable parent segments; the
  deep-link selection params `{ kind, id, tab? }` (C6, World half).
- **Actions menu:** the shared `GO TO` group (`Open Reader` /
  `Open World` / `Open Plot` / `Open Chapter Timeline` /
  `Open Story Settings`) in `AppActionsMenu`, gated on an open story
  and omitting the current surface — no navigation zone exists in the
  shipped compound; 4.3 adds nothing, since its entry is in the group
  already — plus World's contextual entries `Add entity…` /
  `Add lore…` routing to the `[+]` menu.
- **List pane:** `EntityListPane` with the five-category `Select`
  dropdown (Characters / Locations / Items / Factions / Lore),
  per-kind filter chips (`All` / `In scene` / `Active` / `Staged` /
  `Retired`; none for lore), accordion grouping on All by status tier
  (Active expanded, Staged and Retired collapsed, session-scoped),
  search with the category-aware placeholder, tooltip and ⓘ popover
  copy, per-kind empty states and the no-results line.
- **Shell change:** `EntityListPane`'s `addAction` becomes a trigger
  slot so the `[+]` can host an `ImporterMenu` (today it renders a bare
  `IconAction`); 4.3 consumes the same slot.
- **C2 modules — entities and lore:** the `ListModule` interface and
  its two World instances — list query (an in-memory predicate over
  the hydrated working set: `name` / `description` / `tags` /
  `retired_reason` plus the per-kind `state` fields canon scopes,
  composed per active kind; lore over `title` / `body` / `category` /
  `tags` — the branch's lore is hydrated at story open from this
  slice on), the four-layer sort with the lead pinned and the lore
  two-layer sort, grouping keys, chip vocabularies, search-scope copy,
  empty and no-results copy, and the `EntityRow` / `LoreRow` renderers
  over `ListRow` taking derived signals and a density prop, with the
  category label passed in by the surface.
- **C1 module:** the recently-classified window selector with its
  per-kind aggregate, and the in-scene selector over the tail entry's
  scene triple through the reader's inherited-metadata helper; the
  World rows and the detail-head badge slot consume both. The 4.1 PR
  amends `plot.md`'s decay open question to record the two-turn
  default.
- **Collision surfacing:** `CollisionListRow` on flagged rows with
  `Collides with <other>` (in-surface jump to the other row) and
  `Resolve →` (disabled with the "lands in Slice 4.2c" reason until
  that slice, and gated while generation is in flight); the top-bar
  `⚠ N need review` pill (`Tag tone="warning"`, click scrolls to the
  first flagged row and expands its group; glyph and count on phone);
  the collapsed-accordion `⚠ N` badge.
- **Seed:** `pnpm db:seed` gains one flagged same-name character pair
  so the surfacing chrome — and 4.2c's drivers later — are exercisable
  without a real classifier run.
- **`[+]` affordance:** the `ImporterMenu` with per-kind tooltip
  (`New character` … `New lore`) and the three options — `Blank`
  (disabled until 4.2a / 4.2b), `From JSON file…` (disabled until
  4.6), `From Vault…` (disabled, "Vault lands in M8") — each disabled
  entry exposing its reason.
- **Detail pane host:** `DetailPane` mounted with a "select a row"
  empty state and, on selection, a read-only placeholder body naming
  the row (kind icon, name, recently-classified badge) — the tab strip,
  editors and `⋯` menu are 4.2a.
- **Phone collapse:** list-first via `MasterDetailLayout`, row tap →
  detail state, `useMasterDetailBack` for `←` and hardware back, the
  sub-header at route level.
- **i18n:** new `world` namespace.
- **Storybook:** list-pane states (each kind, each filter, accordion
  collapsed with badge, flagged row, empty, no-results) and the
  detail placeholder.

## Scope: out

- Every detail-pane editor, the `⋯` menu, save session — 4.2a / 4.2b.
- The resolve dialog driver — [Slice 4.2c](./02c-collision-review.md).
- `From JSON file…` wiring and export — [Slice 4.6](./06-import-export.md).
- The Browse rail, which reuses these modules — [Slice 4.5a](./05a-browse-rail.md).
- Bulk operations (parked), character-side Awareness tab (parked).
- FTS5 search — parked; v1 stays on `LIKE` and JSON1.
- Plot's thread and happening modules — [Slice 4.3](./03-plot-panel.md).

## Acceptance criteria

- The World route opens from the reader and from the Actions menu's
  `GO TO` group on desktop and Android and lists the seeded branch's
  rows for every category; switching the dropdown swaps filters,
  search scope copy and rows; the `GO TO` group omits `Open World`
  while on World (manual smoke plus E2E happy path; component test on
  the self-omit rule).
- Search on Characters for a term that appears only in
  `state.visual.hair` matches; the same term on Locations does not;
  an array field (`traits`) matches element-wise, and a term that
  only appears in JSON syntax or an FK reference never matches
  (vitest on the search predicate over fixture rows).
- The entity list order is lead → Active in-scene → Active
  off-scene → Staged → Retired, alphabetical within each; filtering
  to `Staged` keeps alphabetical order; lore sorts by `priority` DESC
  then `title` (vitest on the sort).
- A character in the tail entry's `sceneEntities` renders the in-scene
  stripe and one absent from it does not; the `currentLocationId`
  location renders it and sibling locations do not; a tail
  `user_action` inherits the triple from the entry above (vitest on
  the C1 in-scene selector plus Storybook).
- A row the classifier wrote this turn renders `fresh`; the same row
  one turn later renders `fading`; two turns later untinted; a
  character whose only change is leaving the scene tints; a
  `user_edit` delta never tints (vitest on the C1 module over fixture
  deltas and entries).
- With the seeded flagged pair, the pill reads `⚠ 1 needs review` on
  desktop and `⚠ 1` on phone, the flagged row carries the strip,
  collapsing its group shows the badge, and clicking the pill expands
  the group and scrolls to the row (component test plus manual).
- `Blank`, `From JSON file…`, `From Vault…` and `Resolve →` render
  present, disabled, and each exposes its deferral reason (component
  test).
- Mounting the route with `{ kind, id }` selects that row, with `tab`
  preselecting a tab once 4.2a's strip exists, and on phone lands in
  the detail state; the first `←` returns to the list (component test
  on the param parser and pre-selection; the UI-driven E2E lives in
  4.5b, whose `Open in panel →` is the first real producer).
- Every chrome string routes through `t()`; new compounds have stories.

## Tests

- Vitest: C2 search predicate and sort (per-kind field scope,
  JSON-syntax and FK non-match, null safety), sort layers, C1
  recently-classified matrix
  (fresh / fading / expired, scene-transition touch, source
  exclusions, per-kind aggregate), C1 in-scene selector (characters,
  items, singleton location, inherited tail).
- Component tests: list pane rendering per kind, accordion and badge,
  collision strip, disabled entries, empty and no-results states,
  deep-link parser, `GO TO` self-omit.
- Storybook: the matrix above plus phone list-first and detail
  placeholder.
- E2E (desktop): open World from the reader and from `GO TO`, switch
  category, search, select a row.

## Implementation notes

- **D1.** C2's query runs in memory over the hydrated working set
  (lore is hydrated at story open from this slice on); the
  [SQLite mechanics](../../../../ui/patterns/entity.md#sqlite-mechanics)
  `entity.md` describes stay the contract for a future SQL path, not
  a description of the v1 read path.
- **D2** (resolves the Turn-boundary open question) — C1's boundary is
  the log-position window of the last two `ai_reply` create deltas
  (fresh, fading); scene-presence transitions tier the same way,
  kind-aware like in-scene. Full rule:
  [`entity.md → Recently-classified row accent`](../../../../ui/patterns/entity.md#recently-classified-row-accent).
- **D6** (developer, 2026-09-11) — C1 attributes link-table writes
  (`happening_awareness`, `happening_involvements`,
  `character_relationships`) to the rows they connect; per-turn
  retrieval-count bumps are excluded.
- C1 excludes deltas of reversed runs (`pipeline_runs.outcome`
  aborted, failed, or recovered) — reversal keeps the log.
- C1 refetch is keyed on a monotonic `generationStore.settleCount`
  (bumped when a run leaves `txState` or a reversal settles), shared
  by every mounted consumer.
- Known C1 limitations: a manual scene edit on the last two replies
  reads as a transition and tints (canon says manual edits don't —
  see [`entity.md → Recently-classified row accent`](../../../../ui/patterns/entity.md#recently-classified-row-accent)
  and [triage](../../../triage.md)); a classifier happening delete
  removes its links inside its own delta, so linked characters don't
  tint.
- **D3** the route is `/world/[branchId]?kind&id&tab`; **D4** the
  contextual `Add entity…` / `Add lore…` entries open the `[+]`
  `ImporterMenu` via a controlled `open` seam (the rn-primitives
  popover root is uncontrolled, so the seam drives the trigger ref).
- **D5** (developer, 2026-09-11; revised 2026-09-12) — on the All
  view the lead is pinned above the tier accordion whatever its tier,
  and excluded from its group, so collapsing Active never hides it.
- **Resolves the "Lore Recently classified before M5" open
  question.** C1 treats every row category generically; lore gets no
  non-`user_edit` deltas until M5's chapter close, so the badge stays
  honestly inert this milestone, as assumed.
- C2's contract is fixed here for 4.3 / 4.5a:
  `ListModule<Row, Filter, Signals, GroupKey>` — `filters`, `query`, a
  nullable `grouping`, `copy`, and a `Row` renderer with `density` (a
  no-op on entity rows, which carry no description line). C2's
  "tooltip" is `Toolbar.Search`'s ⓘ popover.
- In-story navigation (`GO TO`, World's breadcrumb story segment and
  gear, the reader's gear) pops to an exact match already in the
  stack, else pushes (`hooks/use-surface-navigate.ts`) — never
  `dismissTo`, which replaces the current screen when the target is
  absent.
- The Actions menu (`SearchableOverlayList`'s desktop popover) no
  longer reclaims focus another surface already took on close —
  needed for Actions → `[+]`.
- List reveal (review pill, badge, strip link) expands the target's
  tier, resets the chip or search only if it hides the target, and
  scrolls once the accordion's animation settles (mid-animation
  scrolls clamp short on web); a category switch resets scroll to top
  unless a reveal lands with it.
- The collapsed-tier `⚠ N` badge sits right of the chevron, outside
  the accordion trigger
  ([`world.md → Surfacing`](../../../../ui/screens/world/world.md#surfacing)
  says "right of the group count"; inside the trigger it would nest a
  button in a button and toggle the tier).
- `EntityListPane` hides its chip row when `filterChips` is null
  (lore has no chips, per
  [`world.md → List filter — lore`](../../../../ui/screens/world/world.md#list-filter--lore)).
- The list pane's Phone story has no play: the category `Select`
  opens a Sheet only on native, so the pane has no phone-only web
  behavior to assert.
- `ModuleList` and `useRevealScroll` (`components/world/`) are
  reusable as they are for Plot's threads and happenings; only the
  reveal planning inside World's `revealRow` is entity/World-typed and
  would need lifting if [Slice 4.3](./03-plot-panel.md) needs
  deep-link reveal — see its Open questions.
- Route pre-selection evidence is the param-parser unit test plus an
  E2E cold-mount deep link (desktop) and the Android smoke (phone
  lands-in-detail, first `←`) — there's no route-level component
  harness, so the acceptance criterion's component test is met by the
  E2E instead.
- Breadcrumb: every segment shares one vertical box (`py-2` tablet and
  desktop, 44px minimum on phone), so the sub-header holds its height
  across select and deselect; the root grows to fill its row, so the
  current segment's 70% cap measures the bar, not itself.
- The sub-header renders taller than the top bar because
  `MasterDetailLayout`'s wrapper pads too — see
  [Slice 4.3](./03-plot-panel.md)'s Open questions.
- The review pill's target and the pane's list signals are built
  separately under a comment-only switch-and-reveal contract — see
  [Slice 4.2c](./02c-collision-review.md)'s Open questions for a
  possible `revealFirstFlagged()` handle.
- The route shows the reader's loading and failed copy until the
  story is open (an empty list would otherwise read "No characters on
  this branch yet."), and hides `Add entity…` / `Add lore…` until
  then.
- Seed gained a flagged `Brannoc` namesake pair plus a
  periodic-classifier create delta; run `pnpm db:seed` to see it
  locally.
