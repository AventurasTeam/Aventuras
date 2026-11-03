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

- **A turn's `config-resolver` entry offers Retry.**
  `useSystemEntryActions` (`components/reader/system-entry-actions.tsx`)
  returns `onRetry` unless the pass is `held` or `resolved`, where
  [`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat)
  lists `Fix profile · Dismiss` for a missing provider. Existing drift
  that no M5 slice owns. Raised 2026-11-01 by the M5 promotion.
- **React Query reads pause offline in the Electron renderer.**
  `createQueryClient` (`lib/cache/query-client.ts`) sets no
  `networkMode`, so once the window's `offline` event fires a read on a
  new key pauses, though these are local SQLite reads.
  `useEntryIndex` (`hooks/use-entry-index.ts:91`) and `useRowSignals`
  (`hooks/use-row-signals.ts:67`) have this on main, and
  `useChapterProgress` opts out for itself, as 5.3's
  `useChapterTimeRanges` and `useStoryChapterNumbers` do. One default in
  `createQueryClient` fixes the two, and the three hooks' own lines can
  then go. Raised 2026-11-01 by Slice 5.1's planning.
- **The mock LLM's token count has no run guard.**
  `scripts/mock-llm/respond/wire.ts:48-52` keeps its own `countO200k`,
  though its comment says it mirrors `countTokens`. On a fixture with a
  run over 512 code points the two differ by a few tokens per cut, and
  the mock pays the quadratic cost. No `e2e/` or mock fixture repeats
  100 times or more, so nothing hits this today. Now that `lib/tokens` is
  a leaf the mock could import `countTokens`, as `scripts/mock-llm/control.ts`
  already value-imports `@/lib`, though long-run counts would change and
  that wants an E2E run. Raised 2026-11-01 by Slice 5.1's review.
- **Two definitions of the open region omit `system`.**
  [`data-model.md → Chapters / memory system`](../data-model.md#chapters--memory-system)
  and `readPromptBuffer`'s docblock (`lib/retrieval/buffer.ts:49`) define
  it by `chapter_id IS NULL` alone, while `openRegionWhere` also leaves
  out `system` rows. Raised 2026-11-01 by Slice 5.1's review.
- **`useEntryIndex`'s docblock overclaims.** `hooks/use-entry-index.ts:67`
  says `settleCount` and the tail cover every `story_entries` write, but
  world-time edits and system entries move neither. It's harmless there,
  since `readEntryIndex` selects no metadata and excludes `system`.
  `useChapterProgress`' docblock has the narrower wording. Raised
  2026-11-01 by Slice 5.1's review.
- **Uncaught synchronous renderer errors reach no diagnostics entry.**
  `lib/boot/rejection-handler.ts:67` listens for `unhandledrejection`
  only, so on desktop a throw in a timer or an idle callback reaches the
  console alone. Raised 2026-11-01 by Slice 5.1's review.
- **A test comment cites a slice.**
  `lib/actions/story-entries/register.test.ts:308` names the slice "Kind
  coverage", a class `.claude/rules/code.md` bans. Raised 2026-11-01 by
  Slice 5.1's review.
- **Two docs lag the tokenizer.**
  [`tech-stack.md → js-tiktoken`](../tech-stack.md#6-js-tiktoken) says
  `cl100k_base` or `o200k_base` and that tables load on demand, where
  `lib/tokens` imports o200k's ranks statically.
  [The token lesson](./lessons-learned/token-fixtures-need-real-prose.md)
  says the build takes ~272 ms, and `lib/tokens/index.ts` ~285 ms.
  Raised 2026-11-01 by Slice 5.1's review.
- **Slice 5.1's doc needs three corrections.** Its brief kept the doc
  read-only for the closing review.
  - [Implementation notes](./milestones/05-chapters-chapter-close/slices/01-token-measure.md#implementation-notes)
    say the guard's overflow comes at "at least about 700,000 tokens".
    That's the density of `x` alone. The limit is about 5.6 million code
    points of one run whatever its shape, and a run of spaces reaches it
    at about 43,700 tokens, dashes at 87,400 and newlines at 350,000. The
    note's conclusion holds for a better reason: counting 5.5 million
    spaces blocks for about 120 s under Node first, and past the limit
    the turn fails with nothing written.
  - Scope and Acceptance describe the `lib/chapters` rule as a `disallow`
    on `lib/db`. It now bars value imports of every lib module and of app
    code, per
    [C5](./milestones/05-chapters-chapter-close/milestone.md#c5--token-reads-and-the-progress-hook).
  - Implementation notes say a tap during the build is untested. The
    closing review ran three on the emulator, and each was queued and
    handled 23 ms after the build ended.

  Raised 2026-11-02 by Slice 5.1's closing review.

- **A route mounted during a read starts the strip at 0.**
  `useChapterProgress` holds its last read per hook, so World, Plot or
  Story Settings mounting while a read runs show 0 until it lands, though
  the hidden reader still holds the number. The window is the read's own
  length, on the order of milliseconds, and it heals by itself. Slice
  5.3's count labels make it readable. `useEntryIndex`'s
  `seedFromLastRead` is the precedent if it ever shows. Raised 2026-11-02
  by Slice 5.1's closing review.
- **A failed Send logs nothing.** The reader's catch
  (`app/reader-composer/[branchId].tsx:804`) writes the failure card and
  no log line, and nothing emits `action_layer.user_write_rejected`, which
  [`observability.md → Subsystem emission inventory`](../observability.md#subsystem-emission-inventory)
  lists. Slice 5.1 adds one route there, `countTokens` throwing on a run
  of about 5.6 million code points, and the card still shows the failure.
  The fix belongs with every user write, not this one. Raised 2026-11-02
  by Slice 5.1's closing review.
- **Two test and logging helpers have no home yet.** The `run()` and
  `entry()` factories repeat across `hooks` tests: the terminal stub
  appears in 28 files, and more than 12 define their own `entry`. The
  `error instanceof Error ? …` log field has 40 or more sites and no
  shared helper. Each needs a new home and a sweep of files on main.
  Raised 2026-11-02 by Slice 5.1's closing review.
- **Two older types the token slice builds on stay loose.**
  `contentEditUndoPayload` (`lib/actions/story-entries/classifier-facts.ts:98`)
  returns `Record<string, unknown>`, though its keys are known.
  `ScreenShell`'s `chapterProgress` is in-story only by doc comment on a
  flat props type, where a union on `variant` would make in-story callers
  pass it. Raised 2026-11-02 by Slice 5.1's closing review.

- **`loadOlderEntries` doesn't re-check after its await.** It captures
  `minPosition`, reads, and inserts
  (`app/reader-composer/[branchId].tsx`), so a `reload()` during the
  read leaves a gap, against
  [`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md#loaded-set-model)'s
  one contiguous window. A short stale read clears `hasOlder`, and a
  read from a branch just left sets it on the new one. A gap sits above
  `oldestLoadedPosition`, where a jump's re-check can't see it, so
  `useEntryJump` tells a row in the DB but not held "That entry is no
  longer on this branch". `onNearTop`
  (`components/reader/reader-surface.tsx`) has no in-flight guard
  either, which is how two boundary loads can start from one oldest
  row. A boundary load started before a jump to the branch's first row
  and finishing after it sets `hasOlder` true again (its read is a full
  50), so the shimmer comes back, and the next load at rest drops it
  under a reader landed at `scrollTop` 0, shifting the row up. Nothing
  at any layer covers `loadOlderEntries`: stories stub
  `onNearTop`, and no unit test or E2E spec reaches it. Read from the
  code, not reproduced. Raised 2026-11-02 by 5.3's task reviews; the
  shimmer symptom added 2026-11-03 by 5.3's Task 19a review.

- **The reader path is still built by hand.** `readerHref`
  (`components/reader/reader-href.ts`) is the slice's one builder, but
  `app/wizard.tsx`, `app/index.tsx`, `app/plot/[branchId].tsx`,
  `app/world/[branchId].tsx`, `app/story-settings/[storyId].tsx` and
  `components/compounds/go-to-group.ts` still write
  `/reader-composer/${…}` themselves. Raised 2026-11-02 by 5.3's task
  reviews.

- **A pressable row has the browser's focus outline, not the canon
  ring.** `components/compounds/delta-log-row.tsx` and
  `components/compounds/list-row.tsx` show `outline: auto 1px` under
  `:focus-visible` in Chromium, where
  [`color.md`](../ui/foundations/color.md#focus) gives list rows the 2 px
  `--focus-ring`. 5.3 makes History's rows interactive in production and
  the slice leaves its focus styling unchanged. Raised 2026-11-02 by 5.3's
  task reviews.

- **`isEditableTarget` has never had a story on the upward path.**
  `reader-surface.tsx` guards typing in a field from the scroll-key
  gestures. 5.3 pins the downward half with a story; nothing fails if
  the guard goes from the upward one. Raised 2026-11-02 by 5.3's task
  reviews.

- **`userInterrupted`'s comment says the opposite of its code.**
  `lib/reader-scroll/autoscroll.ts` says it "Doesn't latch", and the
  body latches. Raised 2026-11-02 by 5.3's task reviews.

- **`history-tab.test.tsx` may hold a rare timing flake.** The test at
  `components/history/history-tab.test.tsx:307` failed once during a
  mutation run that can't reach it, then passed 43 reruns. The
  message wasn't captured, so this is suspected, not confirmed. A second
  test in the file, the one on refetching for an unshown link end's
  rename while a search is set, failed once in a loaded run on the same
  day and passed alone and in two reruns. Raised 2026-11-02 by 5.3's
  task reviews.

- **What marks a flashback is stated two ways.**
  [`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md#top-bar--in-world-time-display),
  [`entry-card.md`](../ui/patterns/entry-card.md#world-time-footer) and
  `components/reader/worldtime-decoration.ts` treat a stored `worldTime`
  of 0 as a flashback, while
  [`data-model.md`](../data-model.md#in-world-time-tracking)'s
  classifier contract has a flashback emit a delta of 0, and
  `lib/piggyback/apply.ts` stores the previous time plus the delta, so
  a classifier-written flashback keeps the running clock. 5.3's chapter
  ranges skip a world time of 0 as canon says, so they exclude no
  classifier-written flashback but do exclude the opening: chapter 1's
  range and `since <time>` start at the first row past the origin. The
  developer's call whether the filter stays. Raised 2026-11-02 by 5.3's
  task reviews.

- **One failed read logs once per mounted `useEntryIndex`.** It logs
  from an effect on `error` (`hooks/use-entry-index.ts`), and every
  mounted observer receives the same error; `useChapterProgress` moved
  its log into the fetch for this reason, and 5.3's two new hooks do the
  same. Nothing pins `retry: false` on any of them either: a retry would
  log three times and hold a label about 3 s. Raised 2026-11-02 by 5.3's
  task reviews.

- **`jumpToBottom` can throw before the reader document registers.** On
  native, the route calls `documentRef.current?.jumpToBottom()`, and
  expo's DOM proxy returns `undefined` for a method not yet registered,
  so the Actions entry or the hotkey during the veil throws with no
  catch. 5.3 routes a chapter press through the `entry` param's paint
  gate; this path has none. Read from the code, not run. Raised
  2026-11-02 by 5.3's task reviews.

- **A scrollbar drag isn't a gesture to the reader's pins.**
  `gestureActiveRef` in `components/reader/reader-surface.tsx` tracks
  touch only, and a scrollbar press interrupts only at pointerdown, so a
  pin that starts during a thumb drag (stream end, viewport shrink, a
  chapter break) can tug the view for about 10 frames. Raised 2026-11-02
  by 5.3's task reviews. Nor is a touch fling's momentum:
  `gestureActiveRef` turns false at `touchend`, so a close's break that
  commits in the first frame or two of an upward fling from the bottom,
  while the reader still reads within ~20 px of it, re-pins against the
  fling, and the viewport-shrink re-pin, older than 5.3, has the same
  guard. [`reader-document.md`](../ui/patterns/reader-document.md#entry-list-fully-rendered-flow-layout)
  counts a touch fling as mid-gesture. Read from the code, not
  reproduced; added 2026-11-03 by 5.3's slice review.

- **Three overlay primitives carry stale or missing behaviour.**
  `components/ui/popover.tsx` never clears rn-primitives' responder
  claim on native, so every scroller inside a Popover has to route
  around it. `components/ui/scroll-component.tsx` says gorhom's scroll
  view "lacks most ScrollView methods", which its declared type
  contradicts. A bottom `Sheet` ignores Escape on web
  (`components/ui/sheet.tsx`), which matters in a narrow Electron window
  at phone tier. Raised 2026-11-02 by 5.3's task reviews.

- **The chapter popover's fixed cap has no short-window handling.**
  Its list stops at 320 px, so the long-list popover measures 472 px,
  and below about 560 px of window height its actions can fall
  off-screen with nothing to scroll them. Not run at that height;
  Electron sets no minimum window height. Raised 2026-11-02 by 5.3's
  task reviews.

- **A chip's hit slop misses the phone floor at compact density.**
  `CHIP_HIT_SLOP` (`components/ui/chip.tsx`) gives 32 + 8 = 40 px at
  compact on phone, Browse included, under
  [`touch.md`](../ui/foundations/mobile/touch.md)'s 44 px floor, which
  holds at every density. Raised 2026-11-02 by 5.3's task reviews.

- **A story after a phone-viewport story can start at the wrong tier.**
  In `components/shells/screen-shell.stories.tsx` the next story's first
  render logged tier `phone` at width 1200, with `window.innerWidth`
  already back at desktop, so a tier-sensitive negative assertion there
  can pass vacuously; the same assertion went red alone with `-t` and
  green in a full-file run. 5.3's phone stories wait for a phone-only
  element first. Raised 2026-11-02 by 5.3's task reviews.

- **Two test fixtures model states that can't happen.**
  `ArchivedDraft` in `components/story/story-card.stories.tsx` is a
  state [`story-card.md`](../ui/patterns/story-card.md) says never
  exists. `worldTimeOf` in `e2e/tests/reader-worldtime-edit.spec.ts`
  reads an entry by id alone, though entry ids repeat across branches;
  not checked whether the seed trips it. Raised 2026-11-02 by 5.3's task
  reviews.

- **Four doc lines read stale after 5.3.**
  [`story-list.md`](../ui/screens/story-list/story-list.md#story-card--text-first)
  says the card shows the current chapter "for active stories", where
  [`story-card.md`](../ui/patterns/story-card.md) and the shipped card
  label archived stories too.
  [`navigation.md`](../ui/foundations/mobile/navigation.md)'s phone diagram
  labels the top bar ~44 px, while `--bar-h-md` runs 48 to 64 px by
  density. [Milestone 5](./milestones/05-chapters-chapter-close/milestone.md)
  still describes C5's percent interim and C16's `Count labels` flip,
  which 5.3 never needed, since it binds 5.1 directly.
  [`delta-log-row.md`](../ui/patterns/delta-log-row.md)'s Plot `Used by`
  entry links Plot's mobile section, not its History tab. Raised
  2026-11-02 by 5.3's task reviews.

- **A `DeltaLogRow`'s name hides its content.** On a pressable row the
  `aria-label` replaces the row's text as its name, so a screen reader
  never hears the summary, field path, source or time, and two rows of
  one target at one entry still sound alike. On a row that can't be
  pressed the `aria-label` sits on a role-less element, which ARIA doesn't
  let be named, so most screen readers ignore it.
  [`testing.md`'s selector table](../testing.md#selector-strategy) also
  still lists delta-log rows as having no role and no label. Raised
  2026-11-02 by 5.3's task reviews.

- **`--selection-bg` selects no text.**
  [`color.md`](../ui/foundations/color.md#final-slot-inventory) and
  [`tokens.md`](../ui/foundations/tokens.md#color-slots) give it the
  text-selection role, but nothing applies it there: inputs select with
  `selection:bg-accent selection:text-accent-fg` (`components/ui/input.tsx`,
  `components/ui/textarea.tsx`, `components/compounds/tag-input.tsx`), and
  narrative prose has no `::selection` rule. Since 5.3's Q7 a jump's landed
  card tint is its only use. Either apply it to selection, and decide
  whether inputs move to it, or narrow its documented role. Raised
  2026-11-02 by 5.3's Q7 review.

- **A second jump to the landed row doesn't restart its tint.** Within
  1.5 s of a landing, a jump to the same entry calls `setLandedId` with
  the id it already holds, so neither the clear timer nor the card's CSS
  animation restarts, and the second landing shows only what's left of
  the first fade (`components/reader/reader-surface.tsx`, `startLanding`
  and the `landedId` effect). From reading, not run; the row fade before
  Q7 behaved the same. Raised 2026-11-02 by 5.3's Q7 review.

- **An accent override would fade the dark landed tint below its
  floor.** Under an override, default-light's and default-dark's
  `--selection-bg` is derived
  ([`color.md → Accent-derivation algorithm`](../ui/foundations/color.md#accent-derivation-algorithm)),
  and dark's is 30% accent over `--bg-base`, already soft. But
  default-dark's `--landed-tint-share`, 22%, was tuned for its own
  `#1e3a8a`. With the curated blue `#2563eb`, default-dark's own
  accent, the landed card's peak falls to OKLab ΔE 2.3 on an
  `ai_reply` and 3.9 on a `user_action`, below the 4.7 floor the
  registry invariant holds dark themes to
  ([`tokens.md → Color slots`](../ui/foundations/tokens.md#color-slots)).
  Red, teal, violet and neutral grey give 1.9 to 2.6 on an `ai_reply`.
  The override isn't wired yet: only the `accentOverride` setting
  exists. The likely fix is to derive the share in JS where the theme
  is applied, beside `--selection-bg`, and move the invariant onto that
  derivation. Raised 2026-11-02 by 5.3's Q10 review.

- **Parchment's landed tint barely shows on a `user_action` card.**
  Light themes paint `--selection-bg` at full strength. Parchment's
  `#e8d8a8` is only OKLab ΔE 1.7 (WCAG 1.04) from its `--bg-sunken`
  `#ecdcb4`. Default-light's tint, by contrast, is 4.7 from its own,
  which is the floor dark themes are now held to. Q10 left light themes
  out by decision, so nothing pins this. Either hold light themes to the
  same floor, which would need parchment's tint to change colour since
  it is already at full strength, or accept it. Computed from tokens,
  not recorded. Raised 2026-11-02 by 5.3's Q10 review.

- **A gesture made before a jump's veil shows is lost, and the landing
  yanks the view.** `useEntryJump` (`components/reader/use-entry-jump.ts`)
  reads the target's rows from the database before it calls `land`, and
  its `superseded` check knows only a newer jump or a branch change, so a
  scroll, drag or wheel during the read isn't seen and `land` then moves
  the view to the target anyway. The jump veil shows only after a short
  delay (Slice 5.3's Q15), so the window left is the shorter of that delay
  and the host read, which took 84 ms at the median at 20 chapters and
  372 ms at 60 (Galaxy Z Fold, release build, from the
  [Android measure](./milestones/05-chapters-chapter-close/slices/03-reader-chapters.md#android-measure)).
  Once the veil shows it swallows touches: on the Fold, two swipes across
  it moved nothing and didn't cancel the landing. On web a scroll key
  with the page focused can still reach the reader under it. On desktop
  a trackpad scroll started during the read is still a live wheel chain
  when the landing arrives, so the landing holds it for up to about 3 s
  rather than only moving the view. Nothing is built for the window
  that's left. Raised 2026-11-02 by Slice 5.3's Android measure;
  narrowed 2026-11-03 by the delayed veil.

- **A jump to the window's oldest row lands without its break, and at
  the branch's top can shift.** A target already in the window lands at
  once and reads nothing (`components/reader/use-entry-jump.ts`), so
  when it is the window's oldest loaded row, the previous chapter's end
  row isn't loaded and its break doesn't exist when it lands; a later
  boundary load mounts the break just above the screen. On a branch
  whose first row is the window's oldest with `hasOlder` still true (a
  50-row branch, or a last boundary load of exactly 50), entry 1 shifts
  up about 12 px when the shimmer drops. Reading the row above first
  doesn't hold on native: expo-dom injects the landing call before the
  route's props emission, so the document lands on the old layout. A fix
  has to order the landing after the document commits the host's write,
  a bridge-contract change; the sliding window in
  [`followups.md`](../followups.md#ux)'s "Native reader rows rerender
  per emission" reworks this path. Raised 2026-11-03 by 5.3's final
  review.

- **A shrinking viewport can pull a landing to the bottom.** The
  surface's `ResizeObserver` (`components/reader/reader-surface.tsx`)
  writes `scrollTop` to the bottom when the viewport shrinks under a
  reader near the bottom, with no landing guard, so an Android keyboard
  opening during a landing that starts near the bottom pulls the reader
  there. Predates Slice 5.3. Read from the code, not reproduced. Raised
  2026-11-03 by 5.3's final review.

- **The reader's back arrow does nothing after a cold deep link.** A
  reader opened by `aventuras://reader-composer/<branch>` from a stopped
  app has no screen under it, and its `←` doesn't fall back to the story
  list. Seen on the Fold in 5.3's phone pass; the route's back handler
  predates the slice. Raised 2026-11-03.

- **Reader story plays log `Cannot find single active touch`.** The
  synthetic `Event('touchstart')` and `touchend` dispatches in
  `components/reader/reader-surface.stories.tsx` carry no `touches`, and
  React Native Web's responder logs this error for each. The plays still
  pass, but the noise hides real errors in a run's console. Raised
  2026-11-02 by 5.3's fling-halt review.

- **The jump landing loop wants a pure decision function.**
  `startLanding` in `components/reader/reader-surface.tsx` now holds
  about nine closure variables and four gates (layout, finger, wheel
  chain, rest), the one-frame touch halt, the wheel hold and the settle
  rule, tested only through rAF-timed plays. A per-frame decision
  function in `lib/reader-scroll`, beside `createAutoscrollMachine`
  (inputs: laid out, finger down, chain live, scroll position, row
  offset, height; outputs: write, hide or restore overflow, highlight,
  done), would make those rules unit-testable. A `useEntryLanding` hook
  would only move the coupling. Do it before the next behaviour change
  to the landing loop. Raised 2026-11-03 by 5.3's fling-halt review.
  Three known gaps wait on it:
  - **The wheel hold can start a frame late.** Whether the chain is
    still arriving is judged by handling time (`performance.now()`
    against the last wheel handled), so when the commit that brings a
    pending target's row outlasts the 100 ms chain gap, the first
    landing frame reads the chain as ended and writes no hold, and
    momentum queued behind the commit scrolls the reader for a frame
    before the landing corrects it. Trigger: on desktop, a popover jump
    above the window during trackpad momentum, with a row commit over
    100 ms. Extracting the loop alone won't fix it, since the caller
    would still compute "chain live" the same way: judge it by the
    wheel events' own times, as `handleWheel` already does for whether
    a wheel continues the chain. Done when
    `JumpPendingHaltsWheelMomentumOnceItsRowArrives`
    (`components/reader/reader-surface.stories.tsx`) expects zero
    unheld frames again, with no allowance for `commitOutlastedChain`,
    under a commit forced past 100 ms. A slow CI runner showed it;
    raised 2026-11-03 by PR #698's review.
  - **A landing never settles while a reply streams.** `settled` needs
    the scroller's height unchanged, and every chunk changes it, so the
    loop runs to its 600-frame cap (about 10 s at 60 Hz, 5 s at
    120 Hz), moving a target near the tail up as the reply makes room
    and keeping the break re-pin off meanwhile. Decide whether growth
    below the target counts against settling. Raised 2026-11-03 by
    5.3's slice review.
  - **Two rules fail no test when removed:** the 600-frame cap and the
    height part of the settle rule. Pin both in unit tests once the
    loop is a function. Raised 2026-11-03 by 5.3's slice review.

- **`documentPainted` resets only on `onReady`.** In
  `app/reader-composer/[branchId].tsx`, `documentPainted` and its ref
  turn false in `handleReady` and true in `handleFirstPaint`, so if
  `ReaderDocument` remounts behind the placeholder, the boot veil and
  `entryLinkReady` read the old document's paint until the new one sends
  `onReady`. Worse, the document's handle goes stale: expo's DOM
  wrapper (`node_modules/expo/src/dom/webview-wrapper.tsx`) builds its
  ref proxy only while `ref.current` is null and never clears it, so
  after a remount `documentRef` still points at the first WebView, and
  every later `jumpToEntry` or `jumpToBottom` is dropped silently: an
  out-of-window jump's veil stays up for its 30 s bound, and an
  in-window jump does nothing. Shown with expo's wrapper and a stand-in
  WebView, not on a device. No remount within one route instance is
  reachable today; an in-place branch switch would make one. Raised
  2026-11-03 by 5.3's Task 9 review; the stale handle added by 5.3's
  slice review.

- **The native chapter list's pin doesn't follow the reader's own
  scrolls.** In `components/reader/chapter-popover.tsx`, native unpins
  the list only in `onScrollBeginDrag`, which gorhom calls with no lock
  check. Two gaps follow:
  - An accessibility scroll (TalkBack's scroll actions start no drag)
    leaves the list pinned, so a later `onContentSizeChange` or
    `onLayout` pulls it back to the last row: a chapter closing while
    the list is open, range labels arriving after a refetch, a Sheet
    height drag, or an unfold. Raised 2026-11-03 by PR #698's review.
  - On the phone Sheet, a drag on the list while the Sheet is still
    rising unpins it, though gorhom holds the list at the top until the
    Sheet unlocks, so at the unlock `showLastRow` does nothing and the
    list opens on chapter 1. Read from gorhom 5.2.14's source
    (`useScrollHandler`, `useScrollable`); added 2026-11-03 by 5.3's
    slice review.

  Web's upward-offset rule can't move over as is to the phone Sheet,
  where gorhom's snap to the top before the unlock would read as a
  scroll up. The tablet Popover scrolls in gesture-handler's
  `ScrollView` with no Sheet lock, so the web rule may carry over there.
  A fix must show on a device that a TalkBack scroll unpins the list,
  that the snap before the unlock and a drag during the rise don't
  leave it off its last row, and that a later content-size or layout
  change doesn't pull a TalkBack-scrolled list back. Read from the
  code, not reproduced.

- **Escape after a strip-opened chapter popover focuses the chip.** On
  web, the progress strip's hit area opens the popover through the
  chapter chip's trigger (`components/reader/reader-chapter-chips.tsx`),
  so closing it returns focus to the chip, not to the strip that opened
  it, where the dialog pattern returns focus to the invoking element.
  Seen in a story probe. A fix needs the strip's element to reach the
  popover's close. Raised 2026-11-03 by 5.3's slice review.

- **The branch top is defined two ways.**
  [`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md#loaded-set-model)
  says a non-root branch's top is its first post-fork entry, while
  [`data-model.md`](../data-model.md#branch-model)'s fork copies entries
  1..N into the new branch, and 5.3's jump (`readsBranchTop`,
  `components/reader/use-entry-jump.ts`) treats the row with nothing
  above it as the top. Separately, `lib/actions/turns/submit-turn.ts`
  says real branches have position gaps, while `use-entry-jump.ts`
  relies on there being none; no writer that leaves one was found
  (entries append at the tail, a rollback deletes a suffix, and the
  system entry is cleared before an action and re-appended at the
  tail). A gap would drop the boundary shimmer early and stop older
  loads above it. Raised 2026-11-03 by 5.3's slice review.

- **The theme CSS generator has no runtime caller.**
  `lib/themes/core/css-generator.ts` has had no caller outside its tests
  since M1: `global.css` is written by hand and guarded by
  `lib/themes/core/registry.test.ts`. 5.3 kept the generator in step
  with each dark theme's `--landed-tint-share`, but nothing checks the
  two agree. Wire it into a build step or a test that compares its
  output with `global.css`, or drop it. Raised 2026-11-03 by 5.3's slice
  review.
