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
  - 2026-10-25, the 2026-10-24 triage pass: `Trigger Opens Overlay`
    failed once in a full parallel Storybook run (145 files) at a
    commit whose `components/wizard/` matched main's, and passed 3 of
    3 alone. The other two full runs that day were green.

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **A run off the open story pre-flights without the story's override.**
  `driveRun` passes `storySettings` only when the run's story and branch
  are the open ones (`ownStory`), so a run on another story checks the
  profile's model, not the override's. 5.10's tool-calling check inherits
  this. Whether such a run is reachable today is unchecked. Raised in
  5.10's PR 1 review.
- **One builder for `ResolveModelConfig`.** Every structured and tool
  caller builds `{ providers, profiles, assignments, storyModels }`
  inline from `appSettingsStore` and the open story: ten sites in
  `lib/pipeline`, among them the close's boundary call, agent phase and
  metadata call, the periodic pass, suggestion refresh, per-turn and
  pre-flight (`grep -rn "storyModels:" lib components` lists them), and
  `components/wizard/wizard-assist.ts` passes the app settings as one,
  with no `storyModels`. A field added to the type can be missed at one of them.
  A builder in `lib/pipeline` beside `boundedStructuredCall`, which
  lifted the call sequence but not the config, would keep them alike.
  Routed from Slice 5.10's planning, 2026-11-17.

- **Story viewport presets are copied per file.** `phone390` is defined
  in each of `chapter-in-progress-card`, `review-window`, `chapter-card`
  and `close-chapter-modal` stories; one preset in
  `.storybook/preview.tsx` would hold it. Raised in 5.10's PR 2 review.
- **`reader.retrySystemEntry` isn't scoped to entry rows**
  (`e2e/locators/reader.ts`), unlike `dismissSystemEntry`, whose comment
  notes a toast shares the name; a toast with a Retry action would trip
  strict mode. Raised in 5.10's PR 2 review.
- **`scripts/close-probe-bar.ts` judges the output-bound clause at the
  step default.** Line 100 compares a step's reply to
  `TOOL_STEP_MAX_OUTPUT_DEFAULT` even when the probe profile sets a max
  output, so if the Q5 remedy is ever applied to the probe profile the
  clause judges at the wrong bound. Raised by Slice 5.10's final review,
  2026-11-18.
- **RN-Web's `PressResponder` presses a button on a held Space's
  repeat.** It starts a press on any Space keydown on a `role="button"`
  element, repeats included (no `event.repeat` check;
  `node_modules/react-native-web/dist/modules/usePressEvents/PressResponder.js`,
  `isValidKeyPress` and `onKeyDown`), and fires `onPress` on the matching
  keyup, so a Space held from elsewhere whose auto-repeat lands on a
  button presses it on release. Generic to every RN-Web button, not the
  close modal. Most OS keyboards stop a held key's auto-repeat once
  another key (Tab) is pressed, which makes it hard to reach (not
  verified per platform). A fix would belong in the `Button` primitive
  or a pnpm patch. Raised by CodeRabbit on Slice 5.10's PR 2,
  2026-11-18.
- **A Dialog opened without a trigger returns focus to `<body>` on
  close.** Radix's modal `DialogContent` focuses only its
  `DialogTrigger` when it closes (`@radix-ui/react-dialog`,
  `onCloseAutoFocus`), and 28 of the app's 30 Dialog and AlertDialog
  consumers open from state with no trigger, so focus falls to
  `<body>` and the next Tab starts at the top of the page. Seen on the
  close modal opened from the reader popover, the Actions menu and
  `Close chapter here` (desktop dev build). Where the opener unmounts as
  the dialog opens (a popover row, a menu option), returning to it isn't
  enough, so a fix needs a return target per opener;
  [`overlays.md`](../ui/patterns/overlays.md) has a close-focus rule for
  Sheet and Popover but none for Dialog, and
  [`import-dialog.md → Accessibility`](../ui/patterns/import-dialog.md#accessibility)
  says the primitive returns focus to the trigger, which holds only
  with one. Raised in 5.10's slice review, 2026-11-18.
- **A deep link into another story skips the story-leave guard.** A deep
  link is a push, which the story-leave guard doesn't see, so one into
  another story while a run holds skips the guard that cancels runs
  (reasoned from the `app.json` scheme, not run on a device; Electron
  registers no protocol). Slice 5.10 gated `/dev` but left this path; it
  is the open path in
  [`parked.md` → A write that commits while a story opens is lost from its stores](../parked.md#a-write-that-commits-while-a-story-opens-is-lost-from-its-stores).
  Routed by 5.10's slice review, 2026-11-18, from that slice's Open
  questions.
- **Small shared homes Slice 5.10 left as copies.** Its review's
  simplifier pass skipped four because each needs a home it couldn't
  create: the open-region test `chapterId == null && canEndChapter(row)`
  in `components/reader/close-here-entries.ts` and
  `lib/actions/story-entries/prose-reversal.ts` (a predicate beside
  `canEndChapter` in `lib/chapters`); the `CalendarFrame` memo in
  `components/chapters/close-chapter-modal.tsx`,
  `app/chapter-timeline/[branchId].tsx` and
  `components/reader/world-time-editing.ts` (a `useCalendarFrame` hook);
  the `Ready to close` label with its Android note in
  `chapter-in-progress-card.tsx` and `chapter-popover.tsx` (a small
  component, with its inventory row); and the metadata phase's re-map of
  a result `requestChapterMetadata` already narrows
  (`lib/pipeline/definitions/chapter-close-metadata.ts`). No defect in
  any; each copy can drift. Raised in 5.10's slice review, 2026-11-18.
