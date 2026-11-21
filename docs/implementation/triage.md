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
