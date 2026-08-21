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

- **All four `patchedDependencies` keys are version-less, so a dropped patch
  only warns.** `pnpm-workspace.yaml:14-18` uses bare keys (`js-tiktoken:`, not
  `js-tiktoken@x.y.z:`). pnpm 10.33.1 maps a bare key to `strict: false`, and
  `allowFailure = ignorePatchFailures ?? !strict` then routes a failed patch to
  `globalWarn` instead of throwing `PATCH_FAILED` — `pnpm install` exits 0 with
  the package unpatched. Slice 3.12b's exposure note ("pnpm fails loudly when
  the patch stops applying") is therefore wrong, and it was the stated rationale
  for closing the upstream-filing item. One line fixes all four:
  `ignorePatchFailures: false`. Cost: install hard-fails on a bump instead of
  warning. Surfaced 2026-08-21 (Slice 3.12b, Task 1 review).
- **`onnxruntime-react-native`'s added-file hunk has no guard.**
  [`pnpm-patch-drops-added-files.md`](./lessons-learned/pnpm-patch-drops-added-files.md)
  records `react-native.config.js` being dropped twice. Its failure mode is
  Android-only and CI-invisible: autolinking never registers
  `OnnxruntimePackage`, so the native module is `null` at runtime. A four-line
  existence assertion mirrors the `js-tiktoken` dist-shape guard
  (`lib/retrieval/js-tiktoken-patch.test.ts`). Surfaced 2026-08-21.
- **`@gorhom/bottom-sheet` keeps the RN-Web `pointerEvents` deprecation alive.**
  It passes the prop form from its own bundle —
  `BottomSheetHostingContainer.js:95` and `BottomSheetBackgroundContainer.js:19`
  — under a `BottomSheetModalProvider` mounted globally in both
  `app/_layout.tsx:93` and `.storybook/preview.tsx:120`. RN-Web keys `warnOnce`
  on the bare string `'pointerEvents'`, so one vendor caller warns for
  everyone: Slice 3.12b converted all fourteen first-party sites and the console
  is unchanged. A patch for this package already exists. Surfaced 2026-08-21.
- **`fast-glob` is a phantom dependency.** Three test files import it
  (`lib/prompts/constants-enforcement.test.ts`, `lib/probe/fork.test.ts`,
  `lib/retrieval/js-tiktoken-patch.test.ts`) while it appears nowhere in
  `package.json`; it resolves only because `pnpm-workspace.yaml` sets
  `nodeLinker: hoisted`. Flipping that setting breaks all three at import.
  Declare it a devDependency. Surfaced 2026-08-21.
- **Four spellings of the same pointer-events style constant, across 15 files.**
  `POINTER_EVENTS_NONE` / `POINTER_EVENTS_BOX_NONE` (10 files, 8 of them added
  by Slice 3.12b), `OVERLAY_*` / `LINT_HIT_STYLE` (`spellcheck-textarea.tsx`),
  a `pointerEventsNone` key inside a styles object (`save-bar.tsx:15`,
  `searchable-overlay-list.tsx:140`, `color-picker.tsx:98` — each written
  differently), and `dragHandleDisabledStyle`
  (`suggestion-categories-editor.tsx:867`). Three further sites dodge
  `react-native/no-inline-styles` with `({ pointerEvents: 'none' } as never)`
  (`tabs.tsx:48`, `accordion.tsx:82`, `calendar-picker.tsx:195`) — the
  `TSAsExpression` wrapper breaks the rule's AST match, and the cast also
  silences the type checker. A shared `constants/styles.ts` retires all of them;
  `constants/` already exists under the `@/` alias and eslint's
  `boundaries/elements` classifies it as app-code, so no config change is
  needed. Slice 3.12b scaled the majority spelling from 2 files to 10 without
  surveying the other three — deliberately, to keep an API migration separate
  from a cross-cutting refactor. Surfaced 2026-08-21.
- **Storybook's Vite build never reads `babel.config.js`, so Reanimated hooks
  need explicit deps.** `@storybook/react-native-web-vite` passes
  `babel: { babelrc: false, configFile: false }`, so
  `react-native-worklets/plugin` never injects `updater.__closure`. A deps-less
  `useAnimatedStyle` then throws under `__DEV__` (dev server) and silently
  builds `dependencies = [undefined]` under `mode: test`, where the animation
  renders but never runs — CI only ever sees the quiet half
  (`ci.yml` runs `pnpm test:run` alone). Cost one capable-model debugging
  session in Slice 3.12b; `useDerivedValue` has no `__DEV__` guard at all, so a
  web-reachable one would fail silently in both modes. Fix candidate: pass
  `pluginReactOptions.babel.plugins: ['react-native-worklets/plugin']` in
  `.storybook/main.ts` — the preset spreads `...pluginReactOptions.babel` after
  its own `babelrc: false`, so it merges cleanly and cannot pull in
  `babel.config.js`. Note the cost is **not** "adds a whole-graph Babel pass":
  `vite-plugin-rnw` already Babel-passes every first-party file
  (`defaultIncludeRE = /\.[tj]sx?$/`); the real cost is the worklets plugin's
  own AST walk in Storybook builds, plus plugin-ordering risk. An
  `additionalHooks` setting on `react-hooks/exhaustive-deps` is only a half
  guard — the rule returns early when the deps argument is absent entirely
  (`isEffect` is false for these hooks), so it catches a wrong array but not a
  missing one; a `no-restricted-syntax` selector covers that half. Deferred out
  of Slice 3.12b because it changes every story's build output and wants its
  own verification. Surfaced 2026-08-21.
- **`blocked` is unreachable from every production Actions-menu mount, so a
  canonical rule cannot be honoured.**
  [`actions-menu.md`](../ui/patterns/actions-menu.md) states that
  `Cmd/Ctrl-K` and the trigger "do nothing while a modal, AlertDialog, or
  other Sheet owns the surface", but neither `AppActionsMenu` nor
  `AppActionsMenuPure` forwards `blocked` — only `app/dev/actions-menu.tsx`
  and stories pass it. Blocking overlays do sit over focused routes
  (`app/index.tsx`'s delete AlertDialog and `StoryConfigRecoveryDialog`, the
  reader's `WorldTimeEditSheet`), and `useIsFocused` stays true under all of
  them; a Radix modal blocks pointer events on the trigger but not a
  `capture: true` window keydown listener. Pre-existing, surfaced by Slice
  3.12b's focus-gating work. Fix is to pipe `blocked` through both wrappers.
- **The Actions-menu focus gate is fail-open, and a fifth mount is already
  planned.** `hotkeyEnabled` defaults to `true` at three layers, so a new
  route that mounts `<AppActionsMenu />` and forgets the prop silently
  re-opens the bug with no type, lint, or test failure —
  `app/diagnostics/index.tsx` is a stub that `actions-menu.md` already lists
  as an app-level surface. A navigator-optional hook reading
  `NavigationContext` (re-exported from `@react-navigation/native`, so no
  try/catch) inside the **connected** `AppActionsMenu` would delete all four
  route-side edits and make future mounts correct by default; the plan's
  "Storybook mounts without a navigator" objection holds for `ActionsMenu`
  and `AppActionsMenuPure` but not for the connected wrapper, which has no
  story. Deferred from Slice 3.12b as an approach change to an
  already-signed-off decision. Surfaced 2026-08-21.
- **Hardware back on a phone `Sheet` bypasses `onOpenChange`, so no sheet can
  guard it.** `@rn-primitives/dialog` registers the
  `hardwareBackPress` → `onOpenChange(false)` handler on its `Content`
  (`dist/dialog.js:147`), but `SheetContent anchor="bottom"` routes to
  `BottomSheetContent` (`components/ui/sheet.tsx:205`), which renders a bare
  `BottomSheetModal` — and `@gorhom/bottom-sheet` registers no `BackHandler`
  at all. The press therefore reaches whatever the screen registered; in the
  wizard that is `app/wizard.tsx:159`, which calls `router.back()` and returns
  true, popping the route out from under the open sheet. Surfaced by Slice
  3.12b's AiAssist discard-confirm, where it is the one dismiss path the
  confirm cannot intercept — on Android phone, the platform the decision record
  singled out as unrecoverable. Fix candidate: register a guarded
  `BackHandler` in `BottomSheetContent` mirroring the dialog primitive, which
  would benefit every sheet consumer; deferred because it changes back-button
  behaviour app-wide, not just for AiAssist. Surfaced 2026-08-21.
- **AiAssist's failure-card "Cancel" still drops a non-empty suggestion list
  silently.** Slice 3.12b gated the implicit dismiss paths behind a confirm, but
  `closeOverlay()` stays unconfirmed by design — correct for Discard, Use this
  and Import, arguably not for the Cancel on a **failure** card. Reachable
  deterministically: generate a list, press Generate more, let that call fail;
  `listItems` survives (only the ok branch writes it) and the card offers
  Cancel / Try again. Cancel then resets the list without a word, while Escape
  from the same state now raises a modal. Before the slice both paths were
  silently destructive and at least consistent. Either route that one button
  through the confirm or accept the divergence deliberately. Surfaced
  2026-08-21.
- **Two confirm dialogs omitted `AlertDialogCancel`, so Radix focused nothing
  and the trap never engaged.** Fixed in Slice 3.12b for
  `ai-assist-discard-dialog.tsx` and `discard-dropped-rows-dialog.tsx`, but the
  substrate still permits it: `components/ui/alert-dialog.tsx` happily renders a
  footer of bare `Button`s, and Radix's `AlertDialogContent` suppresses its own
  auto-focus then focuses whatever registered as Cancel — nothing, in that case.
  Five other call sites use the `AlertDialogCancel asChild` idiom correctly, so
  the omission is the outlier rather than the rule; a substrate guard (or a lint
  selector) would stop the sixth. Note `discard-dropped-rows-dialog.tsx` has no
  stories, so its fix is verified by inspection only. Surfaced 2026-08-21.

Drained 2026-08-20. Four items were fixed on the branch that surfaced
them — the corrupt-draft clobber, the suggestion re-roll's reversal
gate, a deliberate cancel logged as an embedder fault, and
`embedding_stale`'s column default. Two went to their owning
milestone's slice-authoring notes in [`roadmap.md`](./roadmap.md):
the per-row delete-vector sweep to M4.2, the main-process
unhandled-rejection handler to M7.3. One went to
[`parked.md`](../parked.md) with a stated signal —
`runSyncStage`'s embed payload, whose fix trades away a documented
no-partial-success contract. Three entries carried claims that were
wrong or materially incomplete and were corrected before they moved.

Previously drained 2026-08-18: items with a downstream owner went to
that milestone's slice-authoring notes in
[`roadmap.md`](./roadmap.md), items with a stated revisit trigger to
[`parked.md`](../parked.md), and the unowned M3 remainder to
Slice 3.12 — since split (2026-08-19) into
[Slice 3.12a](./milestones/03-memory-floor/slices/12a-runtime-integrity.md)
and
[Slice 3.12b](./milestones/03-memory-floor/slices/12b-ui-tooling-contracts.md).
