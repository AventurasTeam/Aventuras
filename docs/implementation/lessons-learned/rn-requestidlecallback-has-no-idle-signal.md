# On Android, `requestIdleCallback` is not an idle callback

React Native 0.83.6 ships `requestIdleCallback`, and on Android it
doesn't wait for idle. `NativeIdleCallbacks.cpp` declares `timeout` and
never assigns it, so the option is ignored, and the task gets idle
priority with its 5-minute expiry. The file itself says there are no
real idle periods. The task therefore runs when the JS queue first
drains, which can be right after the current task, ahead of a WebView's
first paint. Slice 5.1 measured about 0.3 s after a tap on an emulator,
for a ~1 s encoder build that landed before the reader's first paint.

Electron's renderer honours the option, so the same call there runs
after the page has had its turn, or by the timeout. The platforms
disagree, and a test on desktop shows the intended order.

## How to apply

- Don't use `requestIdleCallback` to mean "after paint" or "by the
  timeout" in code that runs on native. Both hold on Electron only.
- To run after a paint, hook the paint signal itself, such as the
  reader's first-paint message, instead of an idle one.
- Plain Node has no such global, so a script that reaches the call
  needs its own. `vitest.setup.ts` supplies a no-op for tests, and
  [Slice 5.5a's probe](../milestones/05-chapters-chapter-close/slices/05a-task-runner.md#open-questions)
  carries the same question for `tsx`.
