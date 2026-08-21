# `beforeunload` cancellation is ignored without sticky user activation

Chromium ignores a `beforeunload` handler's `preventDefault()` entirely
unless the frame has **sticky user activation** — at least one real user
gesture since the document loaded. Without it the unload proceeds and, under
Electron, `will-prevent-unload` **never fires at all**.

This is not a subtle degradation. It is indistinguishable, from the outside,
from having no guard registered: the page reloads through, no dialog appears,
and nothing is logged. A reviewer building a replica harness for Slice 3.12b's
reload guard reproduced "the bug" twice in a row on already-fixed code, purely
because the harness never sent a gesture before triggering the reload.

## Why it matters here

Two consequences for `hooks/use-unsaved-changes-guard.ts`:

- **A surface that becomes dirty without user interaction is silently
  unguarded.** Today every dirty surface got that way because the user typed
  into it, so the activation is always present. A restored draft, a background
  write, or a surface marked dirty on mount would not be.
- **A test that forgets a gesture passes for the wrong reason.** The mutation
  check for the guard — revert the fix, expect the reload to go through — has
  exactly the same signature as a missing gesture. An E2E that navigates
  purely by URL, or fills a field via `page.evaluate` rather than a real
  click, would report the guard as broken when it is fine, or as working when
  it is not.

## How to apply

- Any test that exercises `beforeunload` must land a real user gesture on the
  page first. Driving the UI with `click()` before `fill()` is enough, and is
  what `e2e/tests/reload-guard.spec.ts` relies on.
- If a future surface can become dirty without a gesture, the guard cannot
  protect it on web. Route that case through an in-app confirm instead of
  relying on the unload.

Related: [code-conventions → Testing discipline](../../code-conventions.md#testing-discipline).
