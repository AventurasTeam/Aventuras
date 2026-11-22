# gorhom drops a present sent while its modal dismisses

**Symptom.** A bottom `Sheet` whose `open` flips back to true during its
slide-out (about 0.7 s on web) stays open in React with nothing on
screen. Its Escape and Back handlers still claim the next press, it
keeps a blocking overlay registered, so overlay-gated hotkeys go inert,
and a trigger that sets `open` to true does nothing until something
closes it.

**Why.** Two gorhom behaviours meet (5.2, `@gorhom/bottom-sheet/src`):

- `BottomSheetModal.dismiss()` runs a forced close, and `snapToIndex`
  returns early while one is in progress, so the `present()` sent
  meanwhile is dropped.
- The forced close completes through the callbacks captured when it
  began, so the modal unmounts and calls the `onDismiss` of the close's
  render. Under rn-primitives' controlled state that render's
  `onOpenChange` is closed over `open = false`, and reporting `false`
  against it is a no-op, so the consumer is never told.

**How to apply.**

- `components/ui/sheet.tsx` holds the fix for every consumer: a reopen
  during a dismiss the primitive started waits for gorhom's `onDismiss`,
  then presents again, and reports no close. A consumer needs no hold
  of its own.
- Anything wired into gorhom's `onDismiss` or `onClose` reads current
  state through a ref, never the render's props: the callback that runs
  may be the one from the render that started the close.

**Testing.** `ReopenDuringExit` in
[`components/ui/sheet.stories.tsx`](../../../components/ui/sheet.stories.tsx)
closes a settled sheet from code and reopens it 80 ms later. Unit tests
can't reach it, since they stub gorhom.

Found 2026-11-22 in a triage pass, from an entry raised by Slice 5.13's
review.
