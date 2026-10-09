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
- **`MultiSelect` nests a checkbox role inside a checkbox role.**
  `components/ui/multi-select.tsx:388-401`: the outer one shows no checked
  state on web. Raised in 4.5a review, 2026-10-07.
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
- **The World and Plot `search` locators match the hidden reader rail's search
  box.** `e2e/locators/world.ts:60` and `e2e/locators/plot.ts:28` match the
  rail's identical placeholder whenever the rail shows the same category
  (World's default `Characters`), a latent strict-mode trap. Scope them like
  `categoryTrigger` and `tierHeader` if they ever fail. Raised in 4.5a review,
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
- **The wrong-kind banner prints the file's `format` uncapped.**
  (2026-10-08) `parseEnvelope` in
  `components/compounds/import-dialog-pipeline.ts` puts the envelope's
  `format` into the wrong-kind banner ("got …, expected …") at any length,
  so a hand-made file with a 1 MB `format` gives a million-character
  banner. The issue list caps paths at 40 characters
  ([`import-dialog.md → Issue flattening`](../ui/patterns/import-dialog.md#issue-flattening));
  meta copy has no such rule. Predates 4.6. Raised in 4.6's slice review,
  2026-10-08.
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
