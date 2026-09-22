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

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **Four copies of the accent hex regex.**
  `/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i` lives in
  `lib/themes/core/accent-palette.ts`, `components/ui/color-picker.tsx`,
  `components/story-settings/suggestion-categories-draft.ts`, and
  `lib/db/stories/story-info-ops.ts` (`STORY_ACCENT_HEX`). One shared
  home would stop them drifting; left apart in Slice 4.4 because the
  copies sit on both sides of the `lib/db` ↔ `lib/themes` / components
  boundary. Surfaced 2026-09-14.

- **Component inventory has no Story Settings or embedder rows.**
  `docs/ui/component-inventory.md` lists single-domain compounds by
  folder, but has no rows for `components/story-settings/` or
  `components/embedder/` — shipped M3 pieces
  (`StorySettingsSaveBar` / `StorySettingsDialogs`,
  `UnsavedChangesDialog`, `AuthoringAidsPanel`, `MemoryPanel`,
  `SwapDialog`, `SwapResumeDialog`) and Slice 4.4's
  (`DefinitionalChangeDialog`, `AboutPanel`, `ModelsPanel`,
  `MemoryKnobsPanel`, `EmbeddingUpgradeDialog`). Backfill as one pass
  rather than piecemeal. Surfaced 2026-09-14.

- **Nothing runs React Compiler, so its bail-outs are invisible.** The
  compiler is on (`app.json` → `expo.experiments.reactCompiler`) but no
  lint rule or CI step reports what it skipped:
  `eslint-plugin-react-hooks` 5.2.0 ships no compiler rule, and
  `.storybook/main.ts` adds only the worklets plugin, so plays exercise
  uncompiled components. **The ask is a gate** — a lint rule, or the
  sweep in CI — before anyone chases individual files. Evidence: running
  `babel-plugin-react-compiler` with `panicThreshold: 'all_errors'` over
  `components/`, `app/` and `hooks/` (stories and tests excluded) on
  2026-09-16 found 25 of 269 files bailing — ref access during render,
  several `Todo` shapes (`components/story-settings/memory-panel.tsx`'s
  three `try … finally` handlers among them), manual-memo deps that
  cannot be preserved, a value-mutation error and one incompatible
  library. Five of the 25 bail for a cause a gate would catch first,
  because lint can already see it: an
  `eslint-disable-next-line react-hooks/exhaustive-deps` in
  `components/reader/reader-document.tsx`,
  `components/compounds/import-dialog.tsx`,
  `components/compounds/model-card-document.tsx`,
  `components/compounds/embedder-download-dialog.tsx` (two) and
  `components/wizard/step-calendar.tsx`. The mechanism and the
  panic-threshold technique are in
  [the compiler-suppression lesson](lessons-learned/exhaustive-deps-suppression-disables-the-compiler.md).
  Surfaced 2026-09-14.

- **The phone save-bar lift lives in the Story Settings shell, not in
  `MasterDetailLayout`.** The shell calls `useTier()` a second time to
  guess when the layout has collapsed, which can drift from
  `MasterDetailLayout`'s own collapse rule. App Settings' save session
  needs the same lift (`app-settings.md` calls its mobile save bar
  identical to Story Settings'). A `footer` slot on
  `MasterDetailLayout` — in the detail pane on tablet and desktop,
  below both panes on phone — would hold it once. Surfaced 2026-09-14.

- **`useSurfaceNavigate` drops the query when it pops.**
  `app/world/[branchId].tsx` navigates to
  `/story-settings/<id>?tab=memory`; when Story Settings is already
  below World, the hook matches it, strips the query and
  `router.dismiss(n)`s with no params, so the Memory tab never opens.
  Fix inside the hook: on a match with a query, dispatch
  `CommonActions.setParams(query)` with `source` set to the matched
  route's key before dismissing (unverified whether `setParams`
  replaces or pushes web history in this fork). Surfaced 2026-09-14.

- **Three gaps in `components/ui/select.tsx`, one of them shared with
  `Chip`.** (1) **No `disabledReason`.** SwitchRow, Stepper, Button and
  IconAction take one (SwitchRow also sets `accessibilityHint` for
  screen readers; TagInput only sets a web `title`); `Select` has
  neither, so a segment disabled by a generation run explains nothing
  (seen on Story Settings → Authoring aids → wrap POV). `Chip` has the
  same gap — Story Settings → Memory's threshold preset chips go inert
  with no reason — so add it to both primitives rather than wrapping
  call sites: a `ReasonTooltip` around a chip row breaks its
  `flex-wrap` on web. (2) **The dropdown branch can't hold a controlled
  empty value.** With no matching option, `DropdownBranch` passes
  `value={undefined}` to the rn-primitives `Root`, which then runs
  uncontrolled: it keeps its own pick (on web the trigger shows the raw
  option value, since `onStrValueChange` sets the label to the value),
  and Radix logs "changing from uncontrolled to controlled" on the
  first pick of any dropdown that starts empty, production builds
  included. Story Settings → Models works around it with a `key`
  remount on its Add override dropdown, which also drops keyboard focus
  to the page body after each add. Fix in the primitive: always pass
  `Root` a controlled value, using `{ value: '', label: '' }` for the
  empty case (Radix treats an empty string as the placeholder), and
  render `value?.label || placeholder`; then remove the remount.
  (3) **The popover is pinned to the trigger's width, not floored by
  it.** The popper Viewport gets
  `w-[var(--radix-select-trigger-width)]`; upstream shadcn uses
  `w-full min-w-[var(--radix-select-trigger-width)]`, so its popover
  grows to fit content while ours cannot. **Latent — no current
  victim.** Slice 4.4's Add override Select hit it and was fixed at the
  call site by dropping a `self-start` hug that deviated from
  [`forms.md → Input width within form rows`](../ui/patterns/forms.md#input-width-within-form-rows)
  anyway; the only other narrow-trigger dropdown, the reader composer's
  mode picker, measures 115 px under a 123 px trigger and the developer
  judged it fine there — its rows are short. So this bites only a
  future dropdown whose rows are wider than its trigger, and the fix
  rewidens every Select in the app, which is why the primitive was left
  alone. Note that `resolveMode` routes description-bearing options to
  `radio` by default, so any `mode="dropdown"` caller with descriptions
  has opted out of that and lands on the pinned path.
  Surfaced 2026-09-14, (3) 2026-09-19.

- **Story Settings panel section titles aren't headings.** Every Story
  Settings panel renders its section titles as plain `Text` — inline in
  About, Authoring aids, Models and Memory, and through a local
  `SectionTitle` helper in
  `components/story-settings/memory-knob-sections.tsx` — so screen
  readers get no `role="heading"` structure to navigate by;
  `components/ui/heading.tsx` exists to supply it. Convert in one pass
  across the panels. Surfaced 2026-09-14.

- **Classifier cadence says turns but counts entries.** Story Settings
  → Memory labels `classifierCadence` "Turns between periodic
  classifier runs" and shows "N turns of coverage overlap", but the
  counter counts every non-`system` entry — actions and replies alike
  (`unprocessedTurnCount` in `lib/actions/classifier/deps.ts`; the
  comparison against the cadence is `shouldCadenceFire` in
  `lib/classifier/status.ts`, which counts nothing itself) — so a
  cadence of 8 fires after about four exchanges, and the partial buffer
  beside it is labelled in entries. A user reading "turn" as an
  exchange mis-tunes it by about 2×. Canon uses the same wording
  (`data-model.md` → `classifierCadence`: "turns … entry-counted"), so
  this is a canon and copy decision. Surfaced 2026-09-14.

- **Story Settings → Memory shows embedding status inside the Embedder
  block.** Canon (`story-settings.md` → Memory tab) lists Embedding
  status as its own conditional section after Keyword retrieval,
  rendered only while the active branch has stale rows. The shipped
  `MemoryPanel` (`components/story-settings/memory-panel.tsx`) renders
  the stale count unconditionally — zero included — beside the current
  model, with `Reindex now` under it, and Slice 4.4 seats that panel
  where canon's Embedder sits. Either split the panel or amend canon to
  keep status with the model it describes. Surfaced 2026-09-15.

- **Three copies of the save-session story harness cell.**
  `components/story-settings/about-panel.stories.tsx`,
  `models-panel.stories.tsx` and `memory-knobs-panel.stories.tsx` each
  carry their own `useSyncExternalStore` cell plus harness so
  `onCommit` refreshes the section's data synchronously (the timing
  reason lives in a repeated comment, and in
  [save-session harness refresh](lessons-learned/save-session-harness-sync-refresh.md)).
  One generic `externalCell<T>()` in a shared story helper would hold
  it once. Surfaced 2026-09-15.

- **The swap-resume prompt and the crash-recovery modal can portal
  together.** `components/embedder/swap-resume-host.tsx` opens whenever
  the open story carries a swap marker and never checks
  `recoveryReportStore`, while
  `components/story/crash-recovery-modal-host.tsx` opens whenever a
  report is pending — so a crash that also left a swap marker stacks
  two alert dialogs. Slice 4.4's upgrade prompt is exclusive with both
  (its gate refuses while a swap marker or a recovery report exists);
  this pair predates it. Order them — recovery first, as the slice
  doc's host order says — with one guard in the resume host. Surfaced
  2026-09-15.

- **Android hardware back can skip an app-level alert dialog.** The
  story-open upgrade prompt (and `SwapResumeHost`) register their
  `hardwareBackPress` handler when their content mounts, which on the
  `Edit info` path happens before Story Settings focuses and registers
  `useMasterDetailBack` (`app/story-settings/[storyId].tsx`,
  `hooks/use-master-detail-back.ts`); `BackHandler` runs the latest
  registration first, so back collapses the tab or pops Story Settings
  behind the still-open dialog. The library-card → reader path is
  unaffected (the reader registers none). Read from code, not seen on a
  device. Surfaced 2026-09-15.

- **`ScreenShell`'s chrome is addressed through screen-specific locator
  namespaces.** The back arrow and the Actions menu belong to
  `ScreenShell` (`components/shells/screen-shell.tsx`), not to any one
  screen, but `e2e/locators/story-settings.ts` owns `back` and
  `actionsTrigger` and specs reach for them while a different screen is
  focused — `story-settings-edit-info.spec.ts` calls
  `storySettings.back` with the reader focused five times. It reads as
  a scoping error at every call site and invites a duplicate per
  screen. One shared `chrome` locator object, re-exported or imported
  directly, would name what these actually are. Surfaced 2026-09-16.

- **E2E turn helpers are copied per spec, and one invariant is
  justified two different ways.** `waitForTurnTerminal` is duplicated
  in `e2e/tests/story-settings-models.spec.ts` and
  `story-settings-edit-info.spec.ts`, while `takeTurn` and
  `captureForTurn` are local to `story-settings-keyword-inject.spec.ts`;
  `waitForTurnTerminal` and `takeTurn` hang the same "Send visible is
  the turn's terminal" invariant on different evidence (isGenerating
  excludes suggestion-refresh, versus refreshSuggestions having one
  call site), so the copies will drift. Lifting both into
  `e2e/harness/` would also fix `retrieval-q4.spec.ts` and
  `retrieval-q4-fallback.spec.ts`, which poll a capture on a content
  predicate (five query slots) and so cannot tell "no capture written
  yet" from "written but wrong" — their own comments admit the
  coupling. Surfaced 2026-09-16.

- **Nothing makes `keyboardShouldPersistTaps` the default, so most
  scrollers eat the first tap.** With RN's `"never"` default, a tap
  landing while a field holds focus is consumed dismissing the
  keyboard and never reaches the control — every knob reads as dead
  until tapped twice. Five files set `"handled"`
  (`components/wizard/wizard-shell.tsx`,
  `components/compounds/provider-model-picker.tsx`,
  `components/ui/searchable-overlay-list.tsx` and two dev screens);
  **twenty-plus do not**, including `components/ui/dialog.tsx`,
  `ui/alert-dialog.tsx`, `ui/select.tsx`, `ui/multi-select.tsx`,
  `shells/detail-pane.tsx`, `story/story-list.tsx`,
  `compounds/scene-edit-form.tsx` and
  `compounds/collision-resolve-dialog.tsx` — the form-bearing ones
  bite hardest. Measured on a 420 dpi emulator before the fix: with a
  field focused, tap 1 on a switch only closed the keyboard, tap 2
  toggled it. Slice 4.4 set the prop on the two Story Settings
  scrollers; the rest are untouched, and nothing stops the next new
  scroller starting wrong. **The ask is a default** — a shared
  scroller that sets it, or a lint rule — rather than a one-off
  sweep. Surfaced 2026-09-19.

- **`Chip` and `Stepper` don't carry canon's 44 px phone floor.**
  [`touch.md → The contract`](../ui/foundations/mobile/touch.md) pins a
  44 px hard `min-height` on phone-tier interactive rows, applied at
  the row wrapper independent of density; neither
  `components/ui/chip.tsx` nor `components/ui/stepper.tsx` sets a
  `min-height` or a `hitSlop`, so nothing enforces it. Measured on a
  420 dpi emulator (2.625 px/dp) on Story Settings → Memory: the
  chapter-threshold preset chips are **35.8 dp** and the classifier
  context stepper's `−` / `+` buttons are **24 dp**, about half the
  floor. `NumberInput` passes at 44.6 dp via `--control-h-md`, which is
  the mechanism canon names, so the gap is the two primitives rather
  than the rule. Both predate Slice 4.4 — it is the consumer that put
  them on a phone settings surface. `ScreenShell`'s own Back and
  Actions buttons measure 32 dp and are the same gap in `IconAction`.
  Surfaced 2026-09-19.

- **Entry-ref excerpts render raw markdown / rich-HTML markup.**
  `EntryRefPicker` and its shared `EntryRefText`
  (`components/compounds/entry-ref-picker.tsx`) print an entry's
  excerpt as plain text, but an entry body can carry markdown or
  sanitized rich HTML; `lib/markdown` has no plain-text-strip helper
  to derive a display excerpt from either. Until one exists, a picker
  row can show literal `**bold**` markers or stray tags instead of
  prose. Surfaced 2026-09-22.

- **`ListRow`'s `aria-label` drops its status pill, when-marker, and
  ⊙ state from screen readers.** `components/compounds/list-row.tsx`
  sets `aria-label={label}` on the row's Pressable, which replaces
  the accessible content of every child instead of composing with
  it — a screen reader announces only the title, never the status
  pill, when-marker, or common-knowledge glyph a sighted user sees
  (World's rows carry the same gap). Compose the row's accessible
  name from its rendered slots instead of overriding with the bare
  label. Surfaced 2026-09-22.

- **Bottom-anchored `Sheet` exposes no container role on web.**
  `components/ui/sheet.tsx`'s `BottomSheetContent` (gorhom's
  `BottomSheetModal`) renders with no `role="dialog"`, unlike
  `RightSheetContent`'s `DialogPrimitive.Content`, which sets one — a
  screen reader gets no landmark for the phone-tier sheet surface.
  Surfaced 2026-09-22.

- **A presented bottom Sheet may not leave the DOM after close in the
  vitest-browser runner.** Closing a phone bottom Sheet didn't
  reliably remove it from the DOM under `vitest-browser` during this
  slice's story work, so a play should assert dismissal through the
  trigger's `aria-expanded` rather than the sheet's absence. Likely a
  runner artifact rather than real behavior; unverified on a narrow
  Electron window or Android. Surfaced 2026-09-22.

- **Four hand-copied menu-item rows have drifted from each other.**
  `ImporterMenuItem` (`components/compounds/importer-menu.tsx`),
  `OverflowMenu`'s `MenuItem` (`components/compounds/overflow-menu.tsx`),
  `StoryCard`'s `OverflowItem` (`components/story/story-card.tsx`), and
  the cast-list inline row (`components/wizard/step-cast.tsx`) each
  reimplement the same pressable-row shape. They've already drifted on
  disabled accessible naming: `OverflowMenu` composes `label, reason`;
  `ImporterMenuItem` replaces the label with the reason outright.
  Extract one shared `MenuItem` and align `ImporterMenu` to the
  `label, reason` pattern. Surfaced 2026-09-22.

- **Close-on-disable is copied into three components instead of
  living in the substrate.** `OverflowMenu`
  (`components/compounds/overflow-menu.tsx`), `EntityPicker`, and
  `EntryRefPicker` (`components/compounds/`) each carry their own
  effect closing the overlay when `disabled` flips true.
  `SearchableOverlayList` already threads a `disabled` prop through
  its as-trigger mode
  ([Shape 2](../ui/patterns/searchable-overlay-list.md#shape-2--dialog-wrapping-a-combobox-and-listbox)),
  which is the one consumer of that mode — moving close-on-disable
  there would drop all three copies. Surfaced 2026-09-22.

- **`ProviderModelPicker`'s broken-state scroll promises aren't
  implemented.** The
  [Trigger](../ui/patterns/provider-model-picker.md#trigger) section
  promises the picker opens scrolled to the first existing provider's
  section when the value's provider is missing, and scoped to that
  provider's section when the model isn't in the catalog.
  `components/compounds/provider-model-picker.tsx` always passes
  `initialScrollRowId={value ? rowId('provider', value) : undefined}`
  — a row id for the broken value itself, which exists in neither
  broken state, so neither promise fires and the picker opens
  unscrolled. Surfaced 2026-09-22.

- **Duplicated clone/compare helpers across the save-session hooks.**
  `hooks/use-row-save-session.ts`'s `cloneValue` and
  `components/story-settings/save-session-state.ts`'s `cloneDraft` do
  the same job under different names, and each keeps its own
  `deepEqual`-shaped comparison; two more standalone `deepEqual`
  implementations live in `lib/actions/delta/delta-encoding.ts` and
  `components/compounds/collision-resolve-diff.ts`. One shared
  clone/compare helper would stop the four from drifting further.
  Surfaced 2026-09-22.

- **`searchable-overlay-list.tsx` is ~1650 lines, and its
  [Implementation notes](../ui/patterns/searchable-overlay-list.md#implementation-notes)
  overstate native virtualization.** The doc says virtualization is
  always on, via `SectionList` on native, but the inline
  (popover-hosted) native branch, `InlineNativeList`, renders through
  a plain gesture-handler `ScrollView` with no virtualization — only
  `SheetNativeList` (the phone-Sheet branch) uses `SectionList`.
  Moving `InlineNativeList` / `SheetNativeList` into a sibling module
  would also shrink the file. Surfaced 2026-09-22.

- **Native initial-scroll-to-value has three residual gaps.**
  `SearchableOverlayList`'s scroll-to-selection anchor releases only
  on `onScrollBeginDrag` (`components/ui/searchable-overlay-list.tsx`),
  so a non-drag scroll — TalkBack, or wheel / trackpad on DeX /
  ChromeOS — never lets go of it; a quick close-then-reopen that
  interrupts gorhom's dismiss animation can carry a stale anchor into
  the next open (the list isn't keyed per open to force a reset); and
  sticky section headers land the target row about one header-height
  below center instead of centered. Surfaced 2026-09-22.

- **A dirty links array on Save overwrites concurrent link changes to
  the same row.** `useRowSaveSession`'s same-row refresh
  (`hooks/use-row-save-session.ts`) merges a store patch per
  top-level field, so a dirty `involvements` / `awareness` array
  keeps the user's whole array rather than grafting the patch in; the
  natural-key builder in `lib/plot/happening-draft.ts` then reads
  that stale array as the truth and deletes or reverts the rows a
  concurrent write added. Unreachable in M4 — turns hard-gate the
  pane, and the classifier only links happenings it creates — but
  live once chapter-close writes links onto existing happenings
  through a path with no such gate. Surfaced 2026-09-22.

- **Classifier free text is stored verbatim, including empty
  strings.** `awareness.source` (`lib/classifier/schema.ts`, a
  required `z.string()`) and involvement `role` (an optional
  `z.string()`) pass straight from the model's structured output into
  `createHappeningInvolvement` / `upsertHappeningAwareness`
  (`lib/classifier/plan.ts`) with no normalization —
  `role: involvement.role ?? null` only catches `undefined`, not
  `''`. Normalize both to `NULL` at write time. Surfaced 2026-09-22.
