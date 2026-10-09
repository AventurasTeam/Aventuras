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
  Android first. Found during 4.2c planning (2026-10-06). Once the
  History tab reused its link-end scan (#581), this is most of what is
  left: on a 30k-delta branch whose tab row has only old deltas, a
  first chunk or search keystroke still takes about 9 ms while the
  next chunk takes under 1 ms (`pnpm bench:history`).
- **The entity update arm accepts a present-but-`undefined` column.**
  `updateHandler` (`lib/actions/entities/register.ts`) treats a key as
  written whenever `col in patch`, so `{ name: undefined, priority: 7 }`
  returns `ok`: the DB keeps the old name, the store row's `name` becomes
  `undefined`, and the undo payload records `name`, so History shows
  "Modified Name" for a change that never landed and user precedence
  treats `name` as user-written. 4.2c closed the hole for
  `nameCollisionFlag` only (its own refusal). A general rule — refuse or
  skip any updatable key whose value is `undefined` — would cover every
  column. Found in 4.2c's Task 1 review (2026-10-06).
- **The entity operational seam's flag arm can bypass the delta log.**
  `lib/actions/entities/operational.ts` still calls itself the non-delta
  seam for the compute-lifecycle columns, flag included, but 4.2c made
  the flag clear a delta-logged user write. Its flag arm is unused; a
  future classifier path calling it would write a column the user path
  delta-logs, and a rollback couldn't revert it. Either drop the arm or
  narrow the header. Found in 4.2c's Task 1 review (2026-10-06).
- **Plot's awareness upsert type duplicates the arm's payload.**
  `lib/plot/happening-draft.ts` declares a local `AwarenessUpsert` type
  instead of deriving it from the `upsertHappeningAwareness` payload in
  `PipelineActionMap`. It is compatible today and can drift silently
  (4.2c added `retrievalCount` to the arm). Found in 4.2c's Task 3
  review (2026-10-06).
- **Undo and redo of a story entry's metadata skip its metadata lock.**
  `withEntryMetadataLock` has four callers (scene fields, world time,
  entity delete, 4.2c's merge); the undo and redo paths for an
  `updateStoryEntryMetadata` delta (`lib/actions/story-entries/undo.ts`,
  `lib/actions/delta/redo.ts`) take no lock. A CTRL-Z landing while a
  scene edit, delete or merge sits between its tail read and its commit
  could have its restore overwritten. Unverified: it needs two user
  actions at once. Found in 4.2c's Task 8 review (2026-10-06). The fix
  can't take the metadata lock inside the branch lock's exclusive hold:
  the merge holds the tail's metadata lock while it waits for the shared
  branch lock, so that order deadlocks. Take the metadata lock first, as
  the four callers do (4.2c's slice review, 2026-10-07).
- **The entity update arm's missing-row refusal carries no code.**
  `updateHandler` (`lib/actions/entities/register.ts`) refuses "update
  target … not found" without `TARGET_NOT_FOUND`, which the delete arm
  sets. Callers that map refusal codes (`resolveCollision`,
  `commitRowSave`) therefore report a vanished row as `failed` instead
  of `not-found`. Found in 4.2c's PR 1 final review (2026-10-06).
- **The group runner commits an update and a delete of one row.**
  `groupConflict` (`lib/actions/delta/apply-delta-action.ts`) refuses a
  write to a row a delete in the same group cascades, but not an update
  of the deleted row itself. Such a group commits, and its undo then
  throws `ReversalIntegrityError` (`held-in-redo`), so the action can't
  be reversed. No shipped planner emits it (4.2c's merge leaves the
  loser out of its scene effects for this reason); any future planner
  that does would commit an irreversible action. Found while fixing
  4.2c's merge scene effects (2026-10-06).
- **The group conflict check can't see refs inside entity `state`.**
  `rowRefs` (`lib/actions/delta/live-refs.ts`) covers link-row columns
  but not the ref fields inside an entity's `state` (`current_location_id`
  and the rest), so `groupConflict` can't refuse a state write that names
  a row the same group deletes. Planners avoid it by discipline (4.2c's
  merge rewrites every ref to the loser before deleting it); nothing
  checks it. Found in 4.2c's PR 1 review (2026-10-06).
- **A tail scene edit re-anchors characters who left at the tail.** The
  scene editor (`lib/actions/story-entries/scene-fields.ts`) runs
  `sceneTrackingActions` over the previous, original and edited scenes
  on every tail edit, so a character the tail's scene dropped is moved
  back to the previous entry's location, overwriting a manual location
  edit made since. Plausibly intended (the edit re-states the scene) but
  undocumented as a consequence. Its live filter on the previous scene's
  ids has no effect, since tracking iterates live entities only. Found
  in 4.2c's PR 1 review (2026-10-06).
- **Location tracking accepts an item target.**
  `updateEntityLocationTracking`
  (`lib/actions/entities/state-patch-actions.ts`) has no kind check, so
  it writes `current_location_id` into an item's state, which the item
  state schema doesn't refuse; `updateItemPosition` checks its kind.
  4.2c's merge guards its own call; the arm doesn't. Found in 4.2c's
  PR 1 review (2026-10-06).
- **Segment Select clips a label that wraps past two lines.**
  `SegmentBranch` (`components/ui/select.tsx`) gives each option a fixed
  `h-control-md` height with `overflow-hidden` and no line limit, so a
  segment whose labels carry user data clips once a label wraps. 4.2c's
  collision dialog moved its phone picker to radio rows to avoid it; the
  component itself still needs a line limit or a growing row. Found in
  4.2c's PR 2 review (2026-10-06). The desktop canonical picker is still
  a segment, and its options now carry the side word as well ("Kael,
  Older, 3 days ago"), so a long name reaches the clip sooner (4.2c's
  slice review, 2026-10-07). The dialog's mode picker clips too, on web
  in a window narrower than 330 px: "Keep as distinct", then "Merge into
  one", wrap to three lines (text 192–252 px in a 201–243 px row at 320
  px). It fit while the dialog lacked the primitive's side margin, which
  4.2c's developer review restored. Native keeps no such margin and is
  unaffected (2026-10-07).
- **Select's radio groups don't follow the keyboard on web.**
  `components/ui/select.tsx` builds its segment and radio-row branches on
  `@rn-primitives/radio-group`, whose web side relies on Radix's roving
  focus. RN-Web drops the `data-radix-collection-item` attribute Radix
  finds its items by. Probed on the collision dialog's mode picker (a
  segment): the group is a stray tab stop and an arrow key moves focus
  without checking anything. The radio-row branch uses the same
  primitive and wasn't probed. 4.2c's collision dialog handles Space,
  the arrows and the single tab stop itself for its stacked radios.
  Found in 4.2c's slice review (2026-10-07).
- **`Dialog` doesn't register as a blocking overlay.**
  `components/ui/dialog.tsx` never calls `useRegisteredOverlay`, while
  `alert-dialog.tsx`, `sheet.tsx` and `select.tsx` do, and
  `lib/stores/ui/blocking-overlays.ts` says modal dialogs should. So
  every `Dialog`-based modal (collision resolve, import, embedder) leaves
  the actions menu and its shortcuts armed underneath it. Found in 4.2c's
  PR 2 review (2026-10-06). Since 4.5b the reader's undo / redo and End
  keys stand down only for registered overlays, so the entry card's
  world-time and scene Dialogs (`components/compounds/entry-card.tsx`),
  which focus their content on open, leave Ctrl+Z live: edit an entry's
  world time, reopen its Dialog, press Ctrl+Z, and the edit reverts
  behind it as the Dialog closes. Registering `DialogContent` like
  `AlertDialogContent` also makes master-detail back stand down under any
  Dialog. Added in 4.5b, 2026-10-09.
- **The collision dialog's tag partition compares raw strings.**
  `components/compounds/collision-resolve-diff.ts` partitions tags
  exactly, while the merge planner cleans them (trim, drop blanks, drop
  duplicates). So `'hero'` and `'hero '` render as two chips, a blank tag
  renders as an empty chip, and a side's internal duplicates give
  duplicate chip keys and a duplicated tag in the submitted list; the
  merge writes the cleaned list. The plan kept tags exact for case only.
  Found in 4.2c's PR 2 review (2026-10-06).
- **The collision dialog's merge error can scroll out of view.** The
  inline error line sits at the end of the merge body's scroll content,
  so with many tags a refusal can land below the fold. Found in 4.2c's
  PR 2 review (2026-10-06).
- **An E2E failure with a dirty pane hangs teardown.** When a test fails
  while a pane is dirty, the main process's armed close guard blocks
  `app.close()` (`e2e/harness/launch.ts`), so each spec's `afterAll`
  waits out the 90 s hook timeout per attempt and leaks its temporary
  `userData` directory. The harness needs a fallback that exits the app
  from main or kills it after a timeout. Found in 4.2c's PR 2 review
  (2026-10-06).
- **Link update arms log unchanged values.** The involvement update arm
  (`lib/actions/happenings/register-involvements.ts`) and the awareness
  upsert (`register-awareness.ts`) write a delta even when the value
  doesn't change, where the relationship arm refuses it as a `noop`. A
  caller sending the same role writes a "Modified Role" History row
  with no change. The Plot draft compares before writing, so no shipped
  path does this today. Found in 4.2c's PR 3 review (2026-10-07).
- **The History tab reads its own row without a branch check.**
  `components/history/use-history-target.ts` looks the tab's row up in
  the stores by id alone; ids repeat across branches (composite primary
  key), and 4.2c added branch guards to the other-end name lookups and
  the link version beside it. Unreachable while panes render only
  branch-filtered rows. Found in 4.2c's PR 3 review (2026-10-07).
- **The authorship contract table doesn't list the collision flag.**
  `docs/data-model.md → Authorship contract` has no row for
  `name_collision_flag`, though the World screen's authorship section
  (3+ collisions) cites the contract for who sets and clears it: the
  classifier at create, user paths only clearing it since 4.2c. Found
  in 4.2c's PR 2 review (2026-10-06).
- **Row-save and row-delete map refusal codes from a plain string.**
  `rejectionCode` in `lib/actions/row-save/commit-row-save.ts` and
  `lib/actions/row-delete/delete-row.ts` switches over the runner's
  untyped `code: string`, defaulting to `failed`, so a new arm refusal
  code compiles and is silently reported as `failed`. 4.2c made its own
  collision mapping exhaustive; these two predate it. Found in 4.2c's
  slice review (2026-10-07).
- **The tail-lock sequence is written twice.** The collision merge
  (`lib/actions/world/resolve-collision.ts`) copies the entity delete's
  steps (`lib/actions/row-delete/delete-entity.ts`): read the head's
  tail, take its metadata lock, re-read the head, refuse if the tail
  moved, then build the tail value. `components/world/delete-impact.ts`
  builds the same tail value a third time. A shared helper in
  `lib/actions/story-entries` would keep the lock order in one place.
  Found in 4.2c's slice review (2026-10-07).
- **No shared branch filter for store rows.** About twenty call sites
  in `lib`, `components` and `app` filter a store's rows by
  `branchId` inline; 4.2c added two more (`branchRows` in
  `resolve-collision.ts`, `inBranch` in
  `components/world/use-collision-resolve.ts`). A store-level accessor
  would replace them. Found in 4.2c's slice review (2026-10-07).
- **A `DialogContent` width override silently loses to
  `sm:max-w-lg`.** The primitive (`components/ui/dialog.tsx`) sets
  `max-w-[calc(100%-2rem)] sm:max-w-lg`, and tailwind-merge only
  replaces a class with the same variant. An unprefixed `max-w-2xl`
  therefore leaves the dialog at 32rem (512 px on web) from `sm` up,
  and below `sm` it drops the side margin on web. The collision dialog shipped like this until
  4.2c's visual review. A width prop, or a documented `sm:` override,
  would stop the next dialog from repeating it. Found in 4.2c's
  developer review (2026-10-07).
- **The desktop window has no minimum width.** `createWindow` in
  `electron/main.ts` sets `width` and `height` but no `minWidth`, so the
  window can shrink to widths no desktop user works at, and layouts get
  exercised there that only phones should reach. Example: below 330 px
  the collision dialog's mode segment clips (see the segment-clip entry
  above). Developer-requested: set `minWidth` around 360 px, which still
  lets the window narrow into the phone tier to check phone layouts.
  Found in 4.2c's developer review (2026-10-07).
- **Rename fields don't say when a name is taken.** The collision
  dialog's Rename (`renameIssue`, `lib/world/collision-resolve.ts`)
  checks the two names only against each other, and 4.2a's detail-pane
  rename checks the name against no other row, so either can land on
  another row's name without a word and leave two namesakes nothing
  flagged (the dialog clears the pair's flags as it saves; #578's
  observations). Developer-requested: under each rename
  field, run the namesake rule collision detection uses (`namesakeKey`:
  same kind, `normalizeTerm` name, staged and retired rows included)
  against the branch's other rows and, on a match, show only that
  another row already has that name. It's a hint, not a block: the
  user may keep the name, as with Keep as distinct. Canon to touch:
  `world.md → Rename` and the detail pane's name field. Found in
  4.2c's developer review (2026-10-07).
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
  box.** `e2e/locators/world.ts:60` and `e2e/locators/plot.ts:28` match the
  rail's identical placeholder whenever the rail shows the same category
  (World's default `Characters`), a latent strict-mode trap. Scope them like
  `categoryTrigger` and `tierHeader` if they ever fail. Raised in 4.5a review,
  2026-10-07.
- **`useRailData` runs in the uncompiled reader route.** The route
  re-renders on lore, thread, happening and chapter writes. Unmeasured.
  Options: each connected rail component calls `useRailData` itself,
  memoized, or a `useReaderRail(branchId)` hook. Raised in 4.5a review,
  2026-10-07.
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
  `components/reader/rail/rail-list.tsx:88-95` repeats
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
  final review, 2026-10-07. A `tall` Sheet pinned to `interactive` (the rail
  Sheet's peek level, since 4.5b) goes further with a keyboard showing:
  gorhom places it at `max(0, highestDetent − keyboard)`
  (`BottomSheet.tsx` around lines 845-857), under the status bar with no
  `topInset`. Harmless today, as the peek holds no field. Added in 4.5b,
  2026-10-09.
- **The Sheet canon describes a keyboard API the shipped Sheet doesn't
  have.**
  [`overlays.md → Sheet — API surface`](../ui/patterns/overlays.md#sheet--api-surface)
  and
  [`Sheet — Keyboard handling`](../ui/patterns/overlays.md#sheet--keyboard-handling)
  specify `dismissable` and `avoidKeyboard` props and a
  `react-native-keyboard-controller` wrap. The gorhom-based
  `components/ui/sheet.tsx` has none of them: it takes
  `enablePanDownToClose`, and gorhom handles the keyboard through
  `keyboardBehavior`.
  [`layout.md → Sheet behavior`](../ui/foundations/mobile/layout.md#sheet-behavior--additional-rules)
  points at the same `avoidKeyboard` prop. The two-line consumer rule in
  `Sheet — Keyboard handling` also lists a "Peek drawer hosting
  save-session edits" as a field-bearing
  Sheet body, which contradicts the read-only peek in
  [`reader-composer.md → State-field composition — lore peek`](../ui/screens/reader-composer/reader-composer.md#state-field-composition--lore-peek).
  Rewrite the keyboard canon from the shipped Sheet. Raised in 4.5b's
  review, 2026-10-09.
- **`SheetContent`'s props don't say which anchor takes which.**
  (2026-10-09) `SheetContentProps` in `components/ui/sheet.tsx` is one
  flat type: `size`, `enablePanDownToClose` and, since 4.5b,
  `keyboardBehavior` only reach the bottom anchor, and `portalHost` only
  the right one; the other path drops them unread. A union keyed on
  `anchor` would reject them at the call site
  ([`code-conventions.md → Type design`](../code-conventions.md#type-design)).
  Raised in 4.5b's slice review, 2026-10-09.
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
- **`ImporterMenu` is a Popover on phone.** (2026-09-11)
  [`world.md → Mobile expression`](../ui/screens/world/world.md#mobile-expression)
  wants a short Sheet on phone but it's a Popover at every size. The
  surface binding it cites has no `ImporterMenu` row, so that sentence
  is the only canon. This slice re-plumbs the menu to host
  `ImportDialog`; a Sheet there makes it the third caller of the phone
  wrap, which is the extraction trigger in
  [the parked tier-wrap entry](../parked.md#duplicated-desktop-popover--phone-sheet-tier-wrap).
  The controlled-open seam drives the trigger ref, so a Sheet needs it
  re-plumbed.
  Moved from Slice 4.6's Open questions (2026-10-07): 4.6 does not
  touch `components/compounds/importer-menu.tsx` — the import dialog
  mounts in the World and Plot routes beside the menu — so "this
  slice" above no longer makes 4.6 the cheaper home.
- **Four hand-copied menu-item rows.** (2026-09-22)
  `ImporterMenuItem` (`components/compounds/importer-menu.tsx`),
  `OverflowMenu`'s `MenuItem` (`components/compounds/overflow-menu.tsx`),
  `StoryCard`'s `OverflowItem` (`components/story/story-card.tsx`), and
  the cast-list inline row (`components/wizard/cast-list.tsx`) each
  reimplement the same pressable-row shape. Their disabled naming was
  aligned to `label, reason` on 2026-09-23, but the shapes still
  differ: only the first two have a disabled state, and `StoryCard`'s
  row is `py-row-y-sm` with no phone `min-h`. This slice re-plumbs
  `ImporterMenu` anyway, which makes it the cheapest place to extract
  one shared `MenuItem`. The rows' role stays with
  [Nested dialog roles in Popover](../parked.md#nested-dialog-roles-in-popover).
  Moved from Slice 4.6's Open questions (2026-10-07): 4.6 does not
  touch `components/compounds/importer-menu.tsx` — the import dialog
  mounts in the World and Plot routes beside the menu — so "this
  slice" above no longer makes 4.6 the cheaper home.
- **A legacy entity row exports a file its own import refuses.**
  (2026-10-08) `lib/piggyback/apply.ts:199-200` says rows holding `Gold`
  beside `gold` in `stackables` exist until a transfer folds them. Such a
  row's `.avts` export fails the import's `duplicateStackable` check. A
  lore row with a null body is the same shape: `lore.body` is nullable
  (`lib/db/lore/lore-schema.ts`), `loreExport` writes it as `''`, and the
  import refuses a lore file without a body. No writer stores a null body
  today (the lore pane, the wizard and the seed all require one), so a new
  lore writer is what would surface it. Fix idea: fold stackables on
  export the way `normalizedStackables` in `lib/world/entity-actions.ts`
  does. Found in Slice 4.6 review.
- **Entity register writes the raw state, not the parsed one.**
  (2026-10-08) `lib/actions/entities/register.ts:137-152` and `:213-220`
  `safeParse` the state but write the raw `row` / `patch.state`, so unknown
  state keys persist, and per-row export carries them out. Found in Slice
  4.6 review.
- **No lint rule catches a dropped `await`.** (2026-10-08)
  `eslint.config.js` has no type-aware promise rules (`no-floating-promises`,
  `return-await`), so a missing `await` passes lint repo-wide. Task 9's
  review proved it on the export path, and a story now pins that one. Found
  in Slice 4.6 review.
- **The JSON viewer is a portaled overlay not gated on screen focus.**
  (2026-10-08) It now lives in `components/compounds/row-detail-frame.tsx`,
  so it stays open when the screen loses focus
  ([lesson](lessons-learned/portaled-overlay-outlives-screen-focus.md)).
  Pre-existing in all four detail heads; low risk because it is modal.
  Found in Slice 4.6 review.
- **`import-dialog.stories.tsx` now imports the World and Plot import
  configs.** (2026-10-08) When M8.3 / M9.4 add more host stories, consider
  domain-owned `world-import.stories.tsx` / `plot-import.stories.tsx` next
  to the configs' tests instead of growing a compound's stories. Found in
  Slice 4.6 review.
- **The wrong-kind banner prints the file's `format` uncapped.**
  (2026-10-08) `parseEnvelope` in
  `components/compounds/import-dialog-pipeline.ts` puts the envelope's
  `format` into the wrong-kind banner ("got …, expected …") at any length,
  so a hand-made file with a 1 MB `format` gives a million-character
  banner. The issue list caps paths at 40 characters
  ([`import-dialog.md → Issue flattening`](../ui/patterns/import-dialog.md#issue-flattening));
  meta copy has no such rule. Predates 4.6. Raised in 4.6's slice review,
  2026-10-08.
- **The Vault and story-list `ImportDialog` sketches have no failure
  path.** (2026-10-08)
  [`import-dialog.md → Vault calendars`](../ui/patterns/import-dialog.md#vault-calendars)
  and [`→ Story list`](../ui/patterns/import-dialog.md#story-list) chain
  the import action's promise into navigation with no rejection handling,
  though the dialog has closed by then, so a host copied from them fails
  silently. The World sketch shows the shape (failure toast and log).
  Owners: M8.3 (vault calendars) and M9.4 (story import). Predates 4.6.
  Raised in 4.6's slice review, 2026-10-08.
- **Slice 4.6's Implementation notes overstate two rules.** (2026-10-08)
  In [Slice 4.6](milestones/04-world-plot-read-surfaces/slices/06-import-export.md#implementation-notes),
  "import drops those keys rather than rejecting them" skips the happening
  anchor, which is still read for the time-anchor exclusivity
  ([`data-model.md → Aventuras file format`](../data-model.md#aventuras-file-format-avts)
  now says so). "The host flow M8.3 and M9.4 copy … refused and closed
  while generation is in flight" contradicts
  [`import-dialog.md → Host gating during in-flight generation`](../ui/patterns/import-dialog.md#host-gating-during-in-flight-generation),
  where vault calendars and story-list import are unaffected; and
  `useRowImport` commits a row save (`ImportRowResult`), which neither of
  those imports is. Reword both notes when the slice doc is next edited;
  the closing review had it read-only. Raised in 4.6's slice review,
  2026-10-08.
- **`PlotSaveResult` admits codes Plot can't produce.** (2026-10-08)
  `PlotSaveResult = RowSaveResult` (`lib/actions/plot/commit-plot-save.ts`)
  carries `parent-cycle` and `parent-chain-broken`, but threads and
  happenings have no parent chain; `components/plot/plot-copy.ts` maps them
  to the generic failure. Narrow it the way 4.6 narrowed `ImportRowResult`;
  older code, so a deferral per
  [`code-conventions.md → Type design`](../code-conventions.md#type-design).
  Raised in 4.6's slice review, 2026-10-08.
- **`entityStateSchemaForKind` isn't generic over the kind.** (2026-10-08)
  `lib/db/entities/entity-state-schema.ts` returns the union of the four
  state schemas, so `lib/avts/entity.ts` casts each kind's schema
  (`StateSchemaWith<…>`) to reach a key only that kind has. A generic
  `entityStateSchemaForKind<K>(kind: K)` would drop the casts. Older API,
  so a deferral per
  [`code-conventions.md → Type design`](../code-conventions.md#type-design).
  Raised in 4.6's slice review, 2026-10-08.
- **The World route's collision-dialog blur comment gives the wrong
  reason.** (2026-10-08) In `app/world/[branchId].tsx`, "The dialog is
  portaled: left open, it would paint over the screen pushed on top" sits
  above the effect that closes the collision dialog on focus loss, but
  `open={focused}` already hides it; what the effect does is keep the
  dialog from reopening when focus returns. 4.6 moved its import dialogs'
  copy of the rule into `useRowImport`. Predates 4.6. Raised in 4.6's
  slice review, 2026-10-08.
- **Slice 4.6 left four duplicates waiting for a shared home.**
  (2026-10-08) The closing review's simplifier skipped each because the
  shared copy needs a module that doesn't exist yet, or a file outside the
  slice:
  - `openWorld` in `e2e/tests/import-export.spec.ts` repeats
    `openWorldFromHome` in `e2e/tests/world.spec.ts`; `e2e/flows/navigation.ts`
    is the natural home.
  - The `ExportHandsTheCommittedRow` stories (entity, lore, thread,
    happening) and the frame's `ExportStaysLiveWhileBlocked` each set up
    the same download spy; there is no shared story-helper module.
  - `components/world/world-import.test.ts` and
    `components/plot/plot-import.test.ts` each define `parse`,
    `withVersion` and `EnvelopeConfig`.
  - `components/world/world-add-options.ts` and
    `components/plot/plot-add-options.ts` are near copies; merging them
    touches World's Vault entry.

  Raised in 4.6's slice review, 2026-10-08.

- **A disabled control under focus drops focus to `<body>` on web.**
  (2026-10-09) RN-Web renders a `role="button"` Pressable as a native
  `<button>` and turns `disabled` into the native attribute, so Chromium
  blurs it when it disables under focus (`Button`'s `loading`,
  `components/ui/button.tsx:97-107`; any reason-bearing control that
  disables while focused). The remount note in
  `components/ui/reason-tooltip.tsx` (lines 16-18) implies an
  unconditional wrapper keeps focus across a flip to disabled, which
  doesn't hold on web. The peek keeps focus by refocusing its dialog from
  the drawer instead
  ([`color.md → Disabled`](../ui/foundations/color.md#disabled): disabled controls
  aren't focusable). The reason not reaching assistive tech on web is
  [roadmap M9.2](./roadmap.md#m9--storybook--per-surface-visual-polish--ship-gate)'s
  `disabledReason` item. Candidate lessons-learned entry. Raised in
  4.5b's review, 2026-10-09.
- **Focus-ring canon drift.** (2026-10-09)
  [`color.md → Focus`](../ui/foundations/color.md#focus) (lines 163-164) asks for a 2px
  ring with a 2px offset; none of the `focus-visible:ring-2` usages under
  `components/` has an offset (no `ring-offset` anywhere). `Region`,
  `EntityLink` and `StatusRow` in
  `components/world/overview/overview-parts.tsx` have no focus ring at
  all. Raised in 4.5b's review, 2026-10-09.
- **Trigger-less overlay focus return isn't where canon says.**
  (2026-10-09)
  [`overlays.md → Sheet — ARIA contract`](../ui/patterns/overlays.md#sheet--aria-contract)
  (lines 349-353) says a Sheet opened without a trigger returns focus to
  the element focused before the open, "per rn-primitives / Radix
  convention", but Radix's modal Dialog only returns focus to a
  registered trigger (`@radix-ui/react-dialog` `dist/index.mjs:146-149`),
  so every right-anchored Sheet opened through `open` drops focus to
  `<body>` on close. 4.5b's `PeekDrawer` implements the return locally
  (`onOpenAutoFocus` remembers, `onCloseAutoFocus` restores unless it
  routed away); it belongs in `RightSheetContent`
  (`components/ui/sheet.tsx:413`). Related: `demoteRadixDialog`
  (`sheet.tsx:403`) leaves Radix's FocusScope fallback on the
  role-stripped, unnamed wrapper; the bottom Sheet's focus on web is its
  own entry above, "Bottom Sheets on web move no focus in and return
  none on close"; and 4.5a's list and categories swaps drop focus, as
  does the phone row-to-peek swap on web (Chromium blurs the row when its
  layer turns `visibility: hidden`) and the way back, since `←`
  unmounts with the peek level it sits in.
  Known residual in the peek: after a successful `Set as lead` the lead
  row re-parents into `ModuleList`'s pinned slot, so the remembered node
  is disconnected and the next close drops focus to `<body>`; canon
  carves this out ("unless the row has moved"). Fix by
  re-finding the row by id (`ModuleList`'s `focusRef`), or at primitive
  level as above. Raised in 4.5b's review, 2026-10-09.
- **A toast fired under a modal Sheet may be hidden from assistive
  tech.** (2026-10-09) Radix's `hideOthers` marks everything outside a
  modal Sheet `aria-hidden`, and the `Toaster` renders in-tree
  (`app/_layout.tsx:107`, `components/ui/toast.tsx:194`), so a toast
  fired while the peek drawer or another modal Sheet is open may sit
  under the scrim and go unannounced; the peek's `Set as lead` refusal
  toast is a new instance. Raised in 4.5b's review, 2026-10-09.
- **A failed story-id read leaves the reader's actions silently
  inert.** (2026-10-09) The reader reads its branch's `storyId` on mount
  (`app/reader-composer/[branchId].tsx`, the `branches` select routed
  through `runAction`); if that read rejects it only logs
  `reader.story_id_load_failed`, and `storyId` stays null for the
  visit. Send and Regenerate then return early with nothing shown
  (`runSubmit` / `runRegenerate`: `if (!storyId || …) return`). The
  peek's `Set as lead` toasts the generic lead failure in that state
  since 4.5b's review; the reader has no error state of its own for it.
  Raised in 4.5b's slice review, 2026-10-09.
- **Plot row semantics are hidden from assistive tech.** (2026-10-09)
  Plot's `⊙` common-knowledge marker (`components/plot/happening-row.tsx:46`)
  is a bare icon with no accessible name, and `ListRow` sets `aria-label`
  to the title (`components/compounds/list-row.tsx:84`), so the
  when-marker, `⊙` and category never reach AT on Plot rows.
  (`plot:commonKnowledgeMarker` had no user before the 4.5b peek.) Raised
  in 4.5b's review, 2026-10-09.
- **Phone deep-link reveal can't scroll the hidden list.** (2026-10-09)
  World's and Plot's mount-arrival `revealRow` opens the row's tier, but
  on phone the list sits under the detail with `hidden`
  (`components/shells/master-detail-layout.tsx:83`), so the scroll and
  focus are a no-op and the first `←` shows the tier open with the list
  at the top. Fix shape: reveal the selected row in `handleBack` in the
  same guarded update as `select(null)`, as `onPillPress` does
  (`app/world/[branchId].tsx:379`); applies to World and Plot, and
  `openEntity` on phone has the same gap. Raised in 4.5b's review,
  2026-10-09.
- **The 44 px touch class is written out three times.** (2026-10-09)
  `'min-h-[44px] justify-center'` appears as `PHONE_TOUCH_FLOOR`, private
  in `overview-parts.tsx:35`, in `components/compounds/breadcrumb.tsx:29`
  and in `peek-foot.tsx:26` (new in 4.5b). Raised in 4.5b's review,
  2026-10-09.
- **The injection help copy is keyed in four places.** (2026-10-09)
  `InjectionModeChip`'s `INJECTION_HELP` map
  (`components/world/overview/overview-parts.tsx`) and the three
  Settings selects it mirrors (`components/world/tabs/settings-tab.tsx:61`,
  `components/world/detail/lore-detail-pane.tsx:226`,
  `components/plot/thread-detail-pane.tsx:276`) each spell out their
  `injection.<mode>Help` key.
  [`world.md → Overview`](../ui/screens/world/world.md#overview--glance-summary-read-mostly)
  makes the chip's tooltip the select's own explanation, so one shared
  lookup would keep them from drifting. Raised in 4.5b's slice review,
  2026-10-09.
- **`QuietSheetBackground` passes the deprecated `pointerEvents` prop.**
  (2026-10-09) `components/ui/sheet.tsx:79` hands gorhom's
  `pointerEvents` to a `View` as a prop; RN-Web warns that the prop is
  deprecated in favour of `style.pointerEvents` on every rail-sheet play.
  Raised in 4.5b's review, 2026-10-09.
