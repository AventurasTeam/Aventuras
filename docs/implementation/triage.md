# Implementation triage

Inbox for cross-cutting deferrals surfaced during implementation that
have **no single downstream slice to own them** — the items that would
otherwise be dropped straight into [`followups.md`](../followups.md) or
[`parked.md`](../parked.md) and lost.

Drop them here first. This file is a **queue, not a ledger**: an item
living here means "not yet triaged," not "deferred forever." Triage
happens as a separate pass — each item is read, then routed to its real
home (a specific slice's Open questions, the active
[`followups.md`](../followups.md) ledger, [`parked.md`](../parked.md), a
canonical spec change) or deleted if it dissolves on inspection. Keep
the queue short; a growing inbox is the signal to triage.

A deferral that a **specific downstream slice** will own does not belong
here — it goes straight into that slice's Open questions, where the
slice-planning gate forces its resolution before that slice is planned.

## Inbox

- **Story isolation leaks across files under
  `--fileParallelism=false`.** Serializing puts every story file in one
  page, and some app-level DOM state survives the file that set it.
  Latent rather than active — nothing runs the suite serially — but it
  means "run the browser project sequentially" is not available as a
  debugging move, which is exactly the move a browser-project
  regression calls for. See
  [failed Storybook files with zero failed tests](lessons-learned/storybook-load-flake-zero-failed-tests.md)
  for the parallel-run flake this sits next to; the two may share a
  cause. **Anchor item — accumulating evidence, not yet actionable.**
  Append observations rather than rewriting.

  Evidence so far:
  - 2026-08-24, raised at `384823d6`: the `Diagnostics On` story in
    `app-actions-menu-pure.stories.tsx` failed 2/2, body carrying a
    `data-density` attribute. Attributed to that story; both the
    attribution and the mechanism are unconfirmed.
  - 2026-08-25 at `edce17b8`, three full serial runs (96 files, 803
    tests): green, then a failure in `Trigger Opens Overlay`
    (`preset-browser.stories.tsx`), then green. `Diagnostics On` passed
    all three; `components/compounds` alone is green 26/26. So it is
    intermittent (~1 in 3), the failing story varies across
    directories, and it is not one story's dependency. Root cause
    unidentified — an overlay that fails to open suggests residual
    pointer-events or portal state rather than `data-density`, which
    every file sets for itself through the global decorator in
    `.storybook/preview.tsx`.
  - 2026-10-07, 4.5a: `Trigger Opens Overlay`
    (`preset-browser.stories.tsx:49`) failed once in a 27-file parallel
    run, on `findByText`'s 1 s default, and passed 3 of 3 alone.

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **Name-collision detection misses partial-name duplicates.** Layer B
  reconciliation (`lib/classifier/reconcile.ts`) gates on an exact
  `normalizeTerm` name match against existing characters, so "Kael" and
  "Kael Stormborn" never reach the embedding comparison: the classifier
  creates a second row with no flag, and no surface offers a merge.
  Keywords and aliases are not consulted either. Only characters are
  reconciled at all, though canon gives the flag to all four kinds.
  Scene presence is unused too: the classifier's window carries each
  turn's prose but not the `sceneEntities` saved in its metadata, and
  Layer B compares names and descriptions only, so a "new" character in
  a turn whose scene already names the existing row (strong evidence of
  a classifier miss) still lands as a flagged duplicate. Revisit
  together, developer-requested: feed each window turn its saved
  metadata state, resolve or promote such a character to the existing
  row, and consider correcting past entries' scene presence once a
  duplicate is resolved — a merge rewrites only the tail scene, so
  earlier entries keep naming the deleted loser and render it as
  "Entity no longer exists". Found during 4.2c planning (2026-10-06);
  the classifier is M3.3's substrate, outside 4.2c's scope.
- **The classifier drops why it flagged a row.** `reconcileNewCharacter`
  returns a `FlagReason` (`distinct`, `ambiguous`, `no-signal`), the
  similarity and the best-matching namesake, and its type comment says
  the reason is "carried explicitly for the collision-review surface",
  but `lib/classifier/plan.ts` persists only the 0/1 flag. The resolve
  dialog could say "descriptions differ" or "couldn't compare", and a
  stored partner id would let World pair the flagged row with the
  namesake the classifier actually compared rather than guessing by
  name. Both need a schema column. Found during 4.2c planning
  (2026-10-06).
- **`lastSeenAt.locationId` can name a removed location.** Characters
  and items carry `lastSeenAt { entryId, locationId, worldTime }`
  (`lib/db/entities/entity-state-schema.ts`), but `locationId` isn't
  one of the six ref fields the entity delete arm clears
  (`lib/world/entity-delete.ts`), nor one the 4.2c merge rewrites. So
  after a location is deleted (true since 4.2b) or merged away, a
  "last seen" can name a row that no longer exists. Canon is silent:
  `data-model.md → Authorship contract` makes `lastSeenAt` a
  classifier-only snapshot, and `world.md → Delete` lists the six
  fields. Decide whether the snapshot is history (leave it, render the
  dangling id as "Entity no longer exists") or a ref (clear or rewrite
  it like the others). Found during 4.2c planning (2026-10-06).
- **SQLite never gathers table statistics.** Nothing runs `ANALYZE` or
  `PRAGMA optimize` (`lib/db`, `electron/`), so the planner picks
  indexes without statistics. Measured while planning 4.2c's History
  link-row union: on a 30k-delta branch (node:sqlite, desktop) a
  History chunk takes about 9 ms because the union's OR keeps SQLite off
  `deltas_chain_idx`, and about 2 ms after `ANALYZE`. That's accepted
  for 4.2c. Running `PRAGMA optimize` at boot or on close is
  cross-cutting (desktop main process and the mobile expo-sqlite
  connection), so it's routed here rather than into the slice. Revisit
  if History or another log-shaped query feels slow on a long story,
  Android first. Found during 4.2c planning (2026-10-06).
- **Editor overlays skip canon's in-edit dismissal guard.**
  [`layout.md → Sheet`](../ui/foundations/mobile/layout.md#sheet) wants an
  in-edit dismissal to raise the save-session navigate-away guard (Save /
  Discard / Cancel) and Esc to dismiss on desktop. On phone, the world-time
  and scene editors are bottom Sheets: gorhom reports a dismissal only after
  it happens, so 4.5a blocks drag-down and tap-outside while they hold
  unsaved input, but Android back still closes them through the primitive's
  `BackHandler` and discards it, and bottom Sheets bind no Esc on web. On
  desktop and tablet the same edits run in `EntryCard`'s Radix Dialogs, which
  drop the input on an outside click. Raised in 4.5a planning, 2026-10-07.
  The canonical Sheet API
  ([`overlays.md → Sheet — API surface`](../ui/patterns/overlays.md#sheet--api-surface))
  names the switch `dismissable` and has it gate drag-down, tap-outside and
  system back / Esc together; the primitive's prop is `enablePanDownToClose`,
  which since 4.5a gates drag-down and the scrim tap but not Android back. The
  fix lands the canon name and the back / Esc gating together; until then
  `component-inventory.md`'s "every shipped primitive matches its spec" is
  untrue for `Sheet`. Added in 4.5a's slice review, 2026-10-07.
- **Narrative reflow on Browse rail toggle jumps the reading position.**
  Measured by hand on desktop at a 1050 px window, hero story scrolled to
  about 45% (`scrollTop` 3548, unchanged by the toggle): the narrative
  scroller's width goes 739 px to 1007 px as the rail collapses, and the
  paragraph at the top of the viewport moves +72 px on expand and -72 px on
  collapse, so the reader loses a few lines of place. The Android tablet
  expand shows the same. Canon's anchor rule
  ([`reader-composer.md → Anchor preservation under shifts`](../ui/screens/reader-composer/reader-composer.md#anchor-preservation-under-shifts))
  names no rail-toggle scenario. Raised in 4.5a, 2026-10-07.
- **A `Sheet` dismiss sent right after `present()` is dropped.** In
  `components/ui/sheet.tsx`, a dismiss that lands while gorhom's modal status
  is still INITIAL (within about 60 ms of `present()`) is silently ignored, so
  the Sheet stays open while the host holds `open=false`. Fix idea: hold the
  dismiss until gorhom reports the opening animation (`onAnimate` or
  `onChange`). Raised in 4.5a review, 2026-10-07.
- **Bottom Sheets on web move no focus in and return none on close.**
  [`layout.md → Sheet`](../ui/foundations/mobile/layout.md#sheet) says sheets
  trap Tab focus; the primitive neither focuses into the Sheet nor restores
  focus to the trigger. Raised in 4.5a review, 2026-10-07.
- **Overlay scrims are off canon (0.4 light, 0.6 dark).**
  `components/ui/dialog.tsx:31` and `alert-dialog.tsx:37` use `bg-black/50`,
  and the right-anchored Sheet (`sheet.tsx` near line 444) uses `bg-black/40`
  in both modes; `SCRIM_OPACITY` could be the single source. Raised in 4.5a
  review, 2026-10-07.
- **`aria-selected` on `role="button"` is invalid ARIA on web.**
  `components/compounds/list-row.tsx:85` and
  `components/reader/rail/rail-sheet-categories.tsx` set it; native maps it to
  `accessibilityState.selected` correctly. Raised in 4.5a review, 2026-10-07.
- **`MultiSelect` nests a checkbox role inside a checkbox role.**
  `components/ui/multi-select.tsx:388-401`: the outer one shows no checked
  state on web. Raised in 4.5a review, 2026-10-07.
- **A fresh-tinted row probably loses its tint on web hover.**
  `components/compounds/list-row.tsx:89-91` sets the fresh tint and
  `hover:bg-tint-hover` as backgrounds on the same element, so hover likely
  replaces the tint. Reasoned from the classes, not rendered. Raised in 4.5a
  review, 2026-10-07.
- **`.storybook/*.ts` is never typechecked.** `tsc`'s `**/*.ts` include skips
  dot-directories. Raised in 4.5a review, 2026-10-07.
- **Three explicit gorhom scroll views should use `ScrollComponentContext`.**
  `SceneEditForm`'s inside-sheet `Body`, `AiAssist`'s `Scroller` and
  `MultiSelect`'s phone list pick their scroll host by hand; moving them onto
  the context leaves one way to choose a Sheet's scroll component. Raised in
  4.5a review, 2026-10-07.
- **The rail's happening list and the Plot pane duplicate the entry-index
  status block.** A shared `EntryIndexStatus` (title, body, retry) would
  replace the rail's copy and `app/plot/[branchId].tsx:405-418`. Raised in
  4.5a review, 2026-10-07.
- **Collapse defaults belong to the C2 modules.**
  [`entity.md → Accordion grouping`](../ui/patterns/entity.md#accordion-grouping-on-all-view)
  makes the grouping a module concern, yet the rail keeps its own
  `railCollapseDefaults` and imports two pane modules to build it. A
  `defaultCollapsed` on `ListModule` would remove both. Raised in 4.5a review,
  2026-10-07.
- **`useRowSignals` returns new `rowTints` and `inScene` identities on
  unrelated writes.** `hooks/use-row-signals.ts:107-131` changes them on lore,
  thread and entry writes, so rail lists re-render through a classifier
  burst; keep the old value when the contents are equal. Raised in 4.5a
  review, 2026-10-07.
- **`readerRailStore.enterBranch` is keyed on `branchId` only.** Once M6 adds
  branch switching, key it on focus too: a pushed reader for another branch,
  popped back, would otherwise keep the other branch's view. Raised in 4.5a
  review, 2026-10-07.
- **The World and Plot `search` locators match the hidden reader rail's search
  box.** `e2e/locators/world.ts:41` and `e2e/locators/plot.ts:28` match the
  rail's identical placeholder whenever the rail shows the same category
  (World's default `Characters`), a latent strict-mode trap. Scope them like
  `categoryTrigger` and `tierHeader` if they ever fail. Raised in 4.5a review,
  2026-10-07.
- **`useRailData` runs in the uncompiled reader route.** The route
  re-renders on lore, thread, happening and chapter writes, and
  `useEntryIndex`'s `tailId` selector loops all entries on every render, each
  stream chunk. Unmeasured. Options: each connected rail component calls
  `useRailData` itself, memoized, or a `useReaderRail(branchId)` hook. Raised
  in 4.5a review, 2026-10-07.
- **`ROW_CATEGORIES` duplicates a list `lib/list-modules` already has.**
  `lib/row-signals/types.ts:3-11` spells out what
  `[...WORLD_CATEGORIES, ...PLOT_KINDS]` gives. Raised in 4.5a review,
  2026-10-07.
- **`chrome.back` matches its name as a substring.** `e2e/locators/chrome.ts:8`
  has no `exact: true`, so the phone rail Sheet's "Back to categories"
  (`reader:rail.backToCategories`) would collide if that button ever rendered
  in a desktop E2E DOM. Latent: the Sheet is phone-only and E2E is
  desktop-only. Raised in 4.5a's final review, 2026-10-07.
- **The rail likely flashes expanded, then slides closed, on a narrow reader
  mount.** When the reader route mounts in the same commit as
  `RailViewportWatcher` under 900 px (a web or dev reload of the reader route),
  `ReaderRailColumn` first renders before the first window width reaches the
  store, so `RailColumn` starts at 300 px and the watcher's first resize then
  forces a collapse. Reasoned, not observed; normal launches reach the reader
  after home, so the store already holds a width. Fix idea: set the width
  without `withTiming` for a `collapsed` change before first layout, or have
  `ReaderRailColumn` wait for the first width. Raised in 4.5a's final review,
  2026-10-07.
- **The happening filter-reset layout effect is duplicated.**
  `components/reader/rail/rail-list.tsx:75-82` repeats
  `components/plot/plot-list-pane.tsx:98-103`, same comment and same reset. A
  small shared hook (e.g. `useOfferedFilterReset`) would remove the copy; it
  fits the same pass as the filed `EntryIndexStatus` and collapse-defaults
  extractions. Raised in 4.5a's final review, 2026-10-07.
- **A medium Sheet can be lifted under the status bar by a tall keyboard.**
  `components/ui/sheet.tsx` gives bottom Sheets smaller than `tall`
  `keyboardBehavior='interactive'` with no `topInset`, so on a small phone a
  medium (60 %) Sheet can rise until its head sits under the status bar.
  Inferred from the code, not observed; the rail Sheet (medium, a search field
  right under its head) is the likeliest place to see it. Raised in 4.5a's
  final review, 2026-10-07.
- **The rail's `+ Import from Vault` footer has no owner.** 4.5a ships it
  disabled with the reason "Vault lands in M8"
  (`reader:rail.importFromVaultReason`), and the 4.5a slice doc routes vault
  import to M8.3, but
  [roadmap M8.3](./roadmap.md#m8--translation--vault-parent-shell) scopes
  only the vault shell, vault-level import / export is parked, and the vault
  holds no entity content type
  ([`parked.md → Vault parent shell`](../parked.md#vault-parent-shell)).
  Decide who builds importing from the vault into a story, or drop the footer
  and its copy. Raised in 4.5a's slice review, 2026-10-07.
- **The phone scene editor's sections have no gaps.**
  `components/compounds/scene-edit-form.tsx` sets
  `contentContainerClassName="gap-3 pb-3"` on gorhom's
  `BottomSheetScrollView`, which NativeWind never registered, so inside the
  bottom Sheet both classes drop (measured in a story: `rowGap: normal` and
  `paddingBottom: 0px`, against `rowGap: 12px` outside a Sheet). Put the
  classes on an inner `View`, as `components/wizard/ai-assist.tsx` does.
  Predates 4.5a, and the `ScrollComponentContext` move filed above wouldn't
  fix it. Raised in 4.5a's slice review, 2026-10-07.
- **A Dialog opened as a bottom Sheet closes may sit under its scrim.** On
  native, gorhom's sheets render above the app's `PortalHost`, and since 4.5a
  a closing Sheet's scrim keeps catching touches until its animation ends
  (gorhom's backdrop turns `pointerEvents` off only at index -1). A host that
  closes a Sheet and opens a Dialog in one press, like the phone
  `OverflowMenu`, would show the Dialog under the fading scrim for about
  250 ms and lose a tap in that window. Inferred from the code, not observed
  on a device. Raised in 4.5a's slice review, 2026-10-07.
