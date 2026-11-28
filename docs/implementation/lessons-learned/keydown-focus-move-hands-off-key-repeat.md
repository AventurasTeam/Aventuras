# A keydown that moves focus hands the key's auto-repeat to the new target

**Symptom.** A held key acts twice. Holding Space on the close modal's
end picker reopened the panel after the pick, and holding Enter on the
Actions menu's search reopened the menu after running the entry.

**Why.** An auto-repeat keydown goes to whatever holds focus now. The
handler that acted on the first keydown moved focus to a button (the
picker's trigger, the menu's `⋯`, which Radix refocuses on close), so
the repeats land there. Chromium activates a `<button>` from the
keyboard by itself: Space arms it on keydown and clicks on keyup, and
Enter clicks on every keydown, repeats included. Probed 2026-11-21 in
Chromium 147 with plain buttons: a held Space whose repeat lands on a
second button after a keydown moved focus clicks it on release, a single
press does not, and a held Enter clicks once per repeat.

RN-Web is not the cause. It renders a `role="button"` Pressable as a
real `<button>`, and its `PressResponder` skips `onPress` on keyup for
native interactive elements, so the click is the browser's own. A patch
to `PressResponder` or a guard in `Button` fixes neither.

**How to apply.**

- The app registers `registerKeyRepeatGuard`
  (`components/ui/key-repeat-guard.ts`, from `app/_layout.tsx`): it drops,
  document-wide, an Enter or Space keydown with `repeat` set that lands on
  another element than the press began on. Without it, holding Enter on a
  story card's `⋯` opened the menu, focused Archive and archived the story
  on release (`e2e/tests/held-key.spec.ts`). The rules below still keep each
  handler right on its own, including in Storybook, where the guard isn't
  registered and user-event's held keys carry `repeat: false`.
- A key handler that moves focus acts on keyup where it can, and ignores
  `event.repeat` when it arms, as the end picker does
  (`components/chapters/close-chapter-modal-view.tsx`).
- Where the action has to run on keydown, as `SearchableOverlayList`'s
  Enter does (RN-Web's `TextInput` submits on keydown), call
  `swallowKeyRepeats(key)` (`components/ui/swallow-key-repeats.ts`) as it
  acts: it drops every keydown of that key until its release.

**Testing.** user-event's held keys (`{Enter>4/}`) send each repeat as a
plain keydown with `repeat: false`, which is why the helper checks no
flag. See `HeldEnterPicksOnce` in
[`components/compounds/actions-menu.stories.tsx`](../../../components/compounds/actions-menu.stories.tsx)
and `SpaceRepeatAfterFocusLossPicksNothing` in
[`components/chapters/close-chapter-modal.stories.tsx`](../../../components/chapters/close-chapter-modal.stories.tsx).

Found 2026-11-21 in a triage pass, from an entry raised by Slice 5.10's
PR 2 review.
