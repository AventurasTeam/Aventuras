# Slice 4.5a — Reader Browse rail

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** [Slice 4.1](./01-world-shell.md) and
  [Slice 4.3](./03-plot-panel.md) (the C2 list modules for all seven
  categories; the C1 selectors; the C6 routes a row click lands on)
- **Blocks:** [Slice 4.5b](./05b-peek-drawer.md) (the rail hosts the
  peek and owns the Sheet morph seam, C10)

## Goal

The reader's placeholder column becomes the Browse rail: a
seven-category dropdown grouped World / Plot, the same rows and
queries the panels use, filter chips, search, the collapsed strip
dashboard with per-kind classifier tint, the manual-plus-viewport
collapse state model with hysteresis, the ~150 ms slide, and on phone
the `[☰ Browse]` chip filling the shell's shipped chip-strip slot,
opening the rail's content as a bottom Sheet built to morph into the
peek (C10). Added at promotion: Slice 2.5 deferred the rail to
"M4-era" and no roadmap slice owned it.

## Background

The rail is level one of entity surfacing — list only, fast glance,
row click. It renders exactly what the World and Plot list panes
render, at ~300 px, which is why it consumes C2 rather than building a
third row set: any divergence is a prop. Collapsed, it is not a
silhouette but a compact dashboard — scene counts for characters and
items, quick-access cells for location and factions, each tinted by
the strongest recently-classified signal of its kind — with three hit
zones. Display is the product of two decoupled inputs: a manual
preference persisted app-globally and an event-driven viewport
collapse with ~80 px hysteresis that never overwrites the preference.
Phone has no in-place rail; `ScreenShell` already ships the phone chip
strip and a right-anchored `mobileChipAction` slot waiting for this
chip, whose tint is the aggregate classifier signal.

## Required reading

- [`reader-composer.md → Layout`](../../../../ui/screens/reader-composer/reader-composer.md#layout),
  [`Browse rail — collapse / expand`](../../../../ui/screens/reader-composer/reader-composer.md#browse-rail--collapse--expand)
  through [`Animation`](../../../../ui/screens/reader-composer/reader-composer.md#animation),
  [`Browse rail — search scope`](../../../../ui/screens/reader-composer/reader-composer.md#browse-rail--search-scope)
  and [`Mobile expression`](../../../../ui/screens/reader-composer/reader-composer.md#mobile-expression)
  — the whole rail contract, including the strip anatomy, hit zones,
  state model and the phone rail-as-Sheet.
- [`principles.md → World / Plot split`](../../../../ui/principles.md#world--plot-split--unified-panels-by-purpose)
  — the grouped seven-category dropdown (with `Places` as the
  location label).
- [`patterns/entity.md → Entity surfacing`](../../../../ui/patterns/entity.md#entity-surfacing--three-levels-same-data),
  [`Browse filter chips`](../../../../ui/patterns/entity.md#browse-filter-chips),
  [`Accordion grouping on "All" view`](../../../../ui/patterns/entity.md#accordion-grouping-on-all-view)
  and [`Recently-classified row accent`](../../../../ui/patterns/entity.md#recently-classified-row-accent)
  (the strip's aggregation reads the same window).
- [`collapse.md → Reader / composer`](../../../../ui/foundations/mobile/collapse.md#reader--composer-narrative--rail--narrative--rail-strip)
  and [`State preservation on reflow`](../../../../ui/foundations/mobile/collapse.md#state-preservation-on-reflow).
- [`navigation.md → Reader chip strip (phone-only)`](../../../../ui/foundations/mobile/navigation.md#reader-chip-strip-phone-only)
  and [`touch.md → Chip-strip safe zone`](../../../../ui/foundations/mobile/touch.md#chip-strip-safe-zone),
  [`Tap-to-tooltip on inert chrome text`](../../../../ui/foundations/mobile/touch.md#tap-to-tooltip-on-inert-chrome-text).
- [`layout.md → Sheet`](../../../../ui/foundations/mobile/layout.md#sheet)
  and [`Stacking`](../../../../ui/foundations/mobile/layout.md#stacking)
  — the single-Sheet content-swap rule C10 encodes.
- [`patterns/lists.md → Empty list / table state`](../../../../ui/patterns/lists.md#empty-list--table-state)
  and [`No-results state`](../../../../ui/patterns/lists.md#no-results-state-search--filter-narrowed-to-zero).
- [`data-model.md → Entry metadata shape`](../../../../data-model.md#entry-metadata-shape)
  — the scene triple the strip counts from; factions not scene-tagged.
- [`data-model.md → App settings storage`](../../../../data-model.md#app-settings-storage)
  — where the manual preference most plausibly lives.
- [Milestone contracts C1, C2, C6, C10](../milestone.md#slice-contracts).

## Scope: in

- **Expanded rail** (tablet / desktop): header with the `›` collapse
  chevron; the grouped category `Select` (World: Characters, Places,
  Items, Factions, Lore; Plot: Threads, Happenings — the label passed
  into C2 per surface); per-category filter chips (entity chips; none
  for lore; Plot's own); search with the rotating placeholder and
  standard tooltip / ⓘ from C2's copy; the C2 renderers at the rail's
  density, grouped on the All view by C2's grouping key (the 4.5a PR
  adds the rail to `entity.md`'s per-surface key list); per-category
  empty and no-results states from C2's copy; `+ Import from Vault`
  footer (disabled, "Vault lands in M8"). Until 4.5b lands, a row
  click routes straight to the owning panel with the row pre-selected
  (C6).
- **Collapsed strip:** the affordance chevron, Group A counted cells
  (characters, items — counts from C1's in-scene selector, `0` muted,
  `9+`), separator, Group B glyph cells (location, factions), empty
  region; per-cell tint from C1's per-kind aggregate; three hit zones
  with their tooltips; hover per zone; tablet long-press tooltip.
- **State model:** manual preference (chevron, strip, `Cmd/Ctrl+\`)
  persisted app-globally; viewport-forced collapse on a downward
  cross of ~900 px and restore on an upward cross of ~980 px,
  event-driven, preference untouched; first-launch default open;
  ~150 ms symmetric slide with the narrative edge in lockstep;
  collapsing closes an open peek (the hook 4.5b binds to).
- **Phone Browse chip:** fills `ScreenShell`'s shipped
  `mobileChipAction` slot with the right-anchored `[☰ Browse]` chip,
  tinted by C1's aggregate across every rail-surfaceable category; tap
  opens the rail content as a Sheet (bottom, medium initial).
- **C10 morph seam:** the Sheet host holding `{ content, size }`,
  rendering the rail vocabulary for `list`, an empty slot for `peek`,
  and changing the Sheet's detent on a content swap; a criterion below
  exercises the size change so 4.5b inherits a working morph.
- **Placeholder removal:** the `railPlaceholder` string and column go.
- **Storybook:** rail per category, collapsed strip tint states,
  phone chip and Sheet, the morph seam at both sizes.

## Scope: out

- The peek drawer and the Sheet's peek content — [Slice 4.5b](./05b-peek-drawer.md).
- Row renderers, queries and copy — consumed, not built (C2).
- The rail's `scope chip if active` row from the Layout sketch — the
  awareness-scoped browse it implies has no v1 spec beyond the parked
  character-side Awareness tab; the row is omitted until that work
  exists.
- The other three phone chips — M5 (chapter), M6 (branch), M7.2
  (time-chip era affordances).
- Vault import — M8.3.

## Acceptance criteria

- A vitest imports the rail's renderer map and the C2 modules and
  asserts referential identity for all seven categories (the rail
  mounts 4.1's and 4.3's renderers, never copies); search scope copy
  rotates with the category (component test).
- The strip's character cell shows the count of characters in the
  tail entry's `sceneEntities`, renders `9+` above nine and muted at
  zero; a cell whose kind has a fresh classifier write tints full,
  fading tints half, otherwise none (vitest on the aggregation plus
  Storybook).
- Clicking a cell expands the rail **and** switches its category;
  the chevron and empty region expand without switching (component
  test).
- Resizing below ~900 px collapses the display without changing the
  stored preference; resizing back above ~980 px restores it; a
  manual expand inside the small window sticks until the next
  downward cross (vitest on the state reducer with fake resize
  events).
- The manual preference persists: after toggling, the stored value is
  readable from the settings row (E2E asserting the DB through the
  fixture helper; a relaunch assertion only if the harness gains a
  second `launchApp` against the same user-data directory).
- On phone the Browse chip renders in the shell's slot; tapping opens
  the Sheet with the full rail vocabulary; a test-only content swap to
  `peek` grows the Sheet to the tall detent and back; drag-down and
  backdrop dismiss it (component test on the Sheet host; manual on
  Android).
- `Cmd/Ctrl+\` toggles regardless of focus (E2E on desktop).
- `reader:railPlaceholder` no longer exists in `locales/` and no
  component references it (grep in review; the i18n key test if one
  exists).
- Every chrome string routes through `t()`; new compounds have stories.

## Tests

- Vitest: state reducer (manual / viewport / hysteresis), strip
  aggregation, renderer identity, preference persistence.
- Component tests: rail per category, hit zones, chip, Sheet host and
  morph.
- Storybook: the matrix above including narrow-window and phone.
- E2E (desktop): open reader → rail rows → collapse / expand →
  preference in DB.

## Open questions

- **Preference storage.** Default assumption: an additive
  `app_settings.appearance.readerRailCollapsed` boolean with a Zod
  default (the `showJumpToBottom` precedent). Alternative: device
  storage outside the DB. Canon calls this an implementation detail.
- **Chapterless phone strip.** Canon hides the whole strip — Browse
  chip included — until the story has a chapter, which makes the rail
  unreachable on phone for every story before M5. Default: show the
  strip with the Browse chip whenever the branch has any browsable
  row, and amend `navigation.md`'s empty-state rule in this PR.
- **Rail width.** Canon says ~300 px; the placeholder is 260 px. Pick
  at planning against the reader's narrow-window behavior.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
