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

- **ONNX Runtime's Android native library is unpinned.**
  `onnxruntime-react-native`'s `android/build.gradle` resolves the
  native AAR as `latest.integration`, and every version it has ever
  resolved stays extracted under the package's `android/build/`. The
  2026-10-20 debug APK shipped 1.28.0 (matched by size and GNU
  build-id) although 1.31.0 is the newest resolved, so the shipped
  runtime depends on stale local build state; the likely mechanism,
  unconfirmed, is its `CMakeLists.txt` globbing every extracted AAR and
  taking the first. A clean clone or CI build ships whatever Maven
  serves that day, untested against the app and the 1.24.3 JS binding,
  and 1.28 to 1.31 already grew the arm64 library by 5.6 MB. Fix: pin
  the version in `patches/onnxruntime-react-native.patch` (npm's 1.24.3
  or the tested 1.28.0 is the open choice) and clear the stale
  extracts.

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

- **The resolve dialog's Rename body keeps its input names when a row
  is renamed elsewhere.** `RenameBody` in
  `components/compounds/collision-resolve-dialog.tsx` resets only when
  the pair's ids change, so an untouched form then reads as changed and
  Save could send the old name back. Reasoned, not reproduced; rare.
  Raised 2026-10-10 by the partial-name collisions code review.

- **The mock LLM's validator doesn't check the newer state fields.**
  `scripts/mock-llm/respond/tagged-block.ts` renders every field the
  parser reads, but `stateBlockSchema` in `scripts/mock-llm/validate.ts`
  knows nothing of creates, conditions, drops or retrieval queries, so
  a malformed authored one passes validation and fails the app's
  parser at serve time (a drop with no id renders `id="undefined"`).
  Raised 2026-10-11 in the locations-and-items-from-prose PR; the
  rendering half was closed by the AI writer map.

- **Nine migration tests carry their own copy of two helpers.**
  `migrationTags` and `applyMigration` are copied byte for byte into the
  seven migration tests under `lib/db/__tests__/`, plus
  `lib/db/embeddings/stale.test.ts` and `lib/embedder/service.test.ts`.
  They belong in `lib/db/__tests__/test-db.ts`, which tests in other
  modules already import. One `refactor(test):` commit would move them
  and replace the copies with an import. Raised 2026-10-16 by the
  mentioned places slice review's simplifier pass, which skipped it as
  outside that slice.

- **The head turn's membership test is written out four times.**
  `resolveHeadTurn` in `lib/head-turn` is the one definition of the
  head turn, but the "is this entry its tail or origin" test on top of
  it is restated in `isHeadTurnEntry`
  (`lib/actions/story-entries/operational.ts`), `resolveInvalidationScope`
  (`lib/actions/story-entries/classifier-facts.ts`), `headTurnIdsOf`
  (`components/reader/row-reversal-flags.ts`) and
  `resolveSaveAndRegenTurn` (`components/reader/save-and-regen.ts`).
  [`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)
  asks for one rule. If they drift, an edit could interrupt a pass and
  then do a bare write, or the reader could offer an edit the action
  layer refuses. Raised 2026-10-21 by the gated classifier slice's
  task reviews.

- **Undo's tooltip names the pass when a refresh blocks it.** With a
  suggestion refresh running beside a pass, `gateReason` follows the
  pill to the pass (`Updating memory. Cancel to edit.`), but the
  refresh is what blocks a head reversal, so Undo's tooltip names the
  wrong run and the Cancel it points to doesn't enable Undo. Read, not
  probed. Raised 2026-10-21 by the gated classifier slice's task
  reviews.

- **Reader rows show no disabled reason.** `ReaderRow` in
  `components/reader/reader-surface.tsx` passes no `disabledReason` to
  `EntryCard`, so during a pass a disabled off-head pencil sits beside
  a live regenerate and delete with no tooltip
  ([`principles.md → Affordance loci`](../ui/principles.md#affordance-loci),
  its disabled-controls rule).
  Raised 2026-10-21 by the gated classifier slice's task reviews.

- **The reader's bottom pin ignores scrollbar drags and keyboard
  scrolls.**
  [`reader-document.md → Entry list`](../ui/patterns/reader-document.md#entry-list-fully-rendered-flow-layout)
  says the user's first gesture breaks the open-at-bottom pin, but
  `components/reader/reader-surface.tsx` stops it only on wheel and
  touch drag. A scrollbar drag or a keyboard scroll (arrows, Page Up)
  inside the pin's window is pulled back to the bottom each frame.
  The window is ~10 frames after landing or after an engaged stream
  end, and a whole stream when one starts inside it or the reader
  opens mid-stream. Pre-existing for the landing pin; the gated
  classifier branch extends the same pin to stream end. Raised
  2026-10-21 by the gated classifier slice's task reviews.

- **E2E in a scratch worktree can bundle with no routes.** A worktree
  with symlinked `node_modules` built a web bundle that found no routes
  ("No routes found"), so every test timed out at 30 s. The suspected
  cause: the shared `/tmp/metro-cache` keys expo-router's context
  transform by project-relative path, so two worktrees at the same
  depth share an entry pointing at a deleted `app/`. Worked around
  with a scratch-only `cacheStores` override. Reported by a review
  agent and not reproduced here. Owner: dev tooling
  ([`dev-environment.md`](../dev-environment.md) or
  [lessons-learned](lessons-learned/README.md)). Raised 2026-10-21 by
  the gated classifier slice's task reviews.

- **On an Android phone the keyboard hides the reader's inline editor.**
  Pre-existing: main behaves the same. On an emulator (411×914 dp, the
  suggestion strip open), Edit on an entry near the bottom autofocuses
  its `Textarea` (`components/compounds/entry-card.tsx`), and the
  keyboard leaves the reader 180 CSS px above the suggestion strip and
  composer. The editor grows the row, so the reader has already left the
  bottom and the viewport-shrink re-pin doesn't fire. The textarea
  then sits at 162–386 px, only its top 18 px above the strip. For
  a long last row it sits at 211–435 px, fully hidden. Nothing scrolls
  it into view: Android's WebView never scrolled a focused field into
  view in any run, and the reader has no code that does. A fix that
  keeps a focused inline editor in view when the reader shrinks would
  also cover two cases where the re-pin had helped. The re-pin now
  holds for a focused editor
  ([`reader-composer.md → Autoscroll`](../ui/screens/reader-composer/reader-composer.md#autoscroll)),
  so they behave as on main again. On the stock phone, a long last
  row's editor kept its lower half and Save in view (79 px of the
  textarea, against 13 px without the re-pin). On a very tall reader
  (density 300), the whole textarea stayed in view, against 149 of
  its 224 px. Raised 2026-10-21 by the gated classifier slice review's
  R1 probe.

- **A failed-pass entry can lose the turn's text to an occupied
  draft.** The entry carries the turn's text only when the composer
  couldn't take it back: the user typed a new draft during Send's owed
  pass, which can run up to the classifier's timeout (ten minutes
  unset) with the composer editable
  ([`reader-composer.md → Custody of the turn's text`](../ui/screens/reader-composer/reader-composer.md#custody-of-the-turns-text)).
  From there a committed Retry and `Dismiss` both hand it into the
  still-occupied draft and drop it with the `failedTurnTextDropped`
  toast, as Custody allows; a Send of the new draft drops it silently
  in the tail clear, as a turn-failure entry's does today. Only
  clearing the draft first, then `Dismiss`, keeps it, and nothing says
  so. A turn-failure entry escapes the Retry half because its Retry
  resends the stored text. Candidate fixes: keep the entry as a notice
  when a Retry commits over an occupied draft; or carry a dropped
  entry's submission onto the next entry. Raised 2026-10-22 in the
  pass failure policy slice's Task 7 review.

- **A refused Send destroys the earlier failure entry's text.**
  `runSubmit` drops the system tail before it dispatches
  (`app/reader-composer/[branchId].tsx`), and `dropSystemTail`'s own
  comment says a dispatch that then refuses has destroyed the entry's
  `submission` for nothing unless it puts the entry back. The
  `aborted` arm restores it; the `rejected` arm (the blocked one,
  around `:714`) writes a new failure entry for this Send's text
  instead, so the earlier turn's text, which outlives a restart only
  on that entry, is gone. The pass-refusal arms do the same: a Send
  whose owed pass fails, or that meets a held branch, clears the
  earlier failure entry in the tail drop and writes only this Send's
  text (`:684-700`). The system entry is a branch singleton, so the
  earlier entry can't simply be put back beside the new one. Raised
  2026-10-22 in the pass failure policy slice's Task 7 review.

- **`retries: 1` also applies to the opt-in real-provider smoke.**
  `playwright.config.ts:20` sets it for every spec, and
  `e2e/tests/classifier-real-provider.smoke.spec.ts` sets only a
  timeout. A model failure there doubles the run's worst case, and one
  that passes on the retry reports as flaky rather than failed. Raised
  2026-10-22 in the pass failure policy slice's Task 11 review.

- **The pass and turn failure copy resolvers repeat each other.**
  `describePassFailure` and `toPassFailureMeta`
  (`components/reader/system-entry-actions.tsx:89`, `:112`) repeat
  `describeTurnFailure` and `toSystemFailureMeta`'s four-way
  config-resolver key ternary (`:49-56`) and the provider detail
  format. A new `ResolveFailureKind` must be added in both or it
  silently falls through to the `providerMissing` copy; a
  per-vocabulary `Record<ResolveFailureKind, key>` would make it
  exhaustive. Raised 2026-10-22 in the pass failure policy slice's
  branch review.

- **A completed regenerate drops a cleared failure entry's
  submission.** `runRegenerate` in `app/reader-composer/[branchId].tsx`
  clears the system tail before dispatching (`:789`); the throw arm
  hands `dropped.failure.submission` back (`:807`), but on a completed
  regenerate `planRegenerateOutcome` returns `'none'`
  (`components/reader/regenerate-outcome.ts:39`) and the submission is
  not handed back. Raised 2026-10-22 in the pass failure policy
  slice's branch review.

- **The commit-msg hook doesn't check the subject.**
  `scripts/check-commit-msg.sh` counts only the body's lines, while
  `CLAUDE.md` caps the subject at 72 characters. Four of the pass
  failure policy slice's commits ran 73 to 75 (`28950818`, `042c011c`,
  `0f8086c0`, `21ae1f2f`). Raised 2026-10-23 by its slice review.

- **On Android a profile `timeout` may fail every call.** React
  Native's global `AbortController` (abort-controller@3) has no
  `AbortSignal.timeout`, as `lib/abort.ts` notes, yet the AI SDK builds
  one whenever a call sets `timeout` (`AbortSignal.timeout(totalMs)` in
  `node_modules/ai/dist/index.mjs`), and `buildCallSettings`
  (`lib/ai/generate.ts`) sets it from the profile. Read, not run on a
  device. Nothing writes a profile timeout before M7's settings UI;
  under the pass failure policy a classifier profile with one would
  fail every pass, and so every Send at cadence. Raised 2026-10-23 by
  the pass failure policy slice review.

- **The embed-failure spec builds its system-entry selectors inline.**
  `e2e/tests/retrieval-embed-failure.spec.ts` (~:104, :108) calls
  `getByText(t('reader:systemEntry.failure.embed'))` and the
  `failureMessage` twin in the spec, against
  [`testing.md → Selector strategy`](../testing.md#selector-strategy)'s
  "compose from `e2e/locators/`". `reader.systemEntryFailure`
  (`e2e/locators/reader.ts`) now covers the pass copies; widening its
  key union takes these too. Predates the pass failure policy slice;
  raised 2026-10-23 by its slice review.

- **E2E specs inline the current-branch query.** About fifteen specs
  (`periodic-classifier.spec.ts` five times, `turn.spec.ts`,
  `reader-*.spec.ts`, the real-provider smoke and others) run
  `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`
  through `queryApp` beside `currentBranchId` in `e2e/harness/db.ts`,
  which does the same. Predates the pass failure policy slice; its
  slice review's simplifier pass moved only the slice's own copy.
  Raised 2026-10-23.

- **The Select's segment and radio branches go uncontrolled on an
  `undefined` value.** `components/ui/select.tsx`'s `SegmentBranch` and
  `RadioBranch` hand `value` straight to Radix, whose
  `useControllableState` reads `undefined` as uncontrolled, so a caller
  passing `undefined` (legal under `value: string | undefined`) switches
  between controlled and uncontrolled and gets React's warning. The
  dropdown branch maps it to `EMPTY_VALUE`. Raised 2026-10-23 by the AI
  writer map's Task 9 review, whose cast parent picker hit it.

- **The wizard's pack context exposes undocumented cast fields.**
  `components/wizard/wizard-assist.ts`'s cast projection passes
  `unresolvedParentLocationName` and `unresolvedFactionName` to
  user-authored pack templates, while the documented surface
  (`lib/prompts/templateContextMap.ts`) lists only
  `parentLocationId` / `condition` for locations; the file's own rule is
  that anything a pack can reach can't be withdrawn later. Raised
  2026-10-23 by the AI writer map's Task 9 review, which kept the new
  `parentUnknown` out of the same projection.

- **A cast row's unresolved faction can't be cleared with no
  candidates.** `components/wizard/cast-editors.tsx`'s `PickFromCast`
  renders its empty-state text when the cast holds no other row of the
  kind, so a character whose AI-proposed faction the wizard couldn't
  resolve keeps its warning with nothing to pick. The location picker
  now offers `Unknown` and `Top level` there; the faction picker's
  `Unaffiliated` shows only beside other factions, so its empty state
  offers no choice at all. Raised 2026-10-23 by the AI writer map's final PR 1
  review.

- **A merge's story reads two ways.** `lib/world/entity-delete.ts`'s
  `deleteTailOf` reads the tail entry's raw `metadata.currentLocationId`,
  while `storyPlaceOf` (`lib/world/place-rules.ts`) reads it through
  `inheritedEntryMetadata`; `EntityMergeInput` now carries both, and
  they can name different places. Predates the AI writer map; raised
  2026-10-23 by its merge-adoption review.

- **A cast row's dangling faction selects nothing.** In
  `components/wizard/cast-editors.tsx`, a character whose `factionId`
  names no cast faction (a resumed draft whose faction row failed its
  parse: `salvageRows` in `lib/actions/wizard/session.ts` drops the row
  and leaves the reference) shows its faction picker with nothing
  selected, while Finish commits it Unaffiliated (`castRef` in
  `components/wizard/finish.ts`). The location picker now reads such a
  parent as `Unknown` through `castPlacement`; the faction picker has no
  equivalent. Predates the AI writer map; raised 2026-10-24 by its
  slice review.

- **The cast parent picker's empty state can mislead.** When every
  other cast place would close a loop, `parentCandidates`
  (`components/wizard/cast-editors.tsx`) offers none, and the picker
  shows `wizard:cast.editor.noLocationsYet`, "(no locations yet — add
  one with + Add)", although the cast holds places. Predates the AI
  writer map; raised 2026-10-24 by its slice review.

- **A World E2E spec re-checks the delete dialog's copy.**
  `e2e/tests/world-delete-undo.spec.ts` (≈:187-188) asserts
  `world:delete.awareness` and `world:delete.tailScene` text in the
  confirm, which Storybook owns
  ([`testing.md → Test taxonomy`](../testing.md#test-taxonomy): E2E "does not re-verify
  rendering"). The AI writer map dropped the same kind of check from
  its own specs. Predates it; raised 2026-10-24 by its slice review.

- **The AI writer map's code-quality leftovers.** Its slice review's
  simplifier pass skipped these, each needing a home or a design call
  outside the slice's files:
  - `hooks/use-story-place.ts` builds a new value on every entries-store
    change; the review stabilised its one consumer
    (`components/world/use-collision-resolve.ts`) instead of the hook.

  Raised 2026-10-24 by the AI writer map's slice review.
