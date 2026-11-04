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
- **The mock LLM's token count has no run guard.**
  `scripts/mock-llm/respond/wire.ts:48-52` keeps its own `countO200k`,
  though its comment says it mirrors `countTokens`. On a fixture with a
  run over 512 code points the two differ by a few tokens per cut, and
  the mock pays the quadratic cost. No `e2e/` or mock fixture repeats
  100 times or more, so nothing hits this today. Now that `lib/tokens` is
  a leaf the mock could import `countTokens`, as `scripts/mock-llm/control.ts`
  already value-imports `@/lib`, though long-run counts would change and
  that wants an E2E run. Raised 2026-11-01 by Slice 5.1's review.
- **A stale `node_modules` ships dependencies without their patches.**
  After a pull that adds or changes a file in `patches/`, nothing makes
  a developer run `pnpm install`: `lefthook.yml` has no post-merge or
  post-checkout step, and `verifyDepsBeforeRun` is unset in
  `pnpm-workspace.yaml`. Metro then bundles the unpatched package
  without a word. For `patches/expo.patch` that brings back Android
  readers stuck on `Loading story…`, which a phone shows and the
  emulator doesn't
  ([lesson](./lessons-learned/expo-dom-boot-script-races-the-bundle.md)).
  It holds for all five patches. pnpm 10.33.1 has
  `verify-deps-before-run`, which checks before any `pnpm run`. Raised
  2026-11-03 by PR #700's closing review.
- **A route mounted during a read starts the strip at 0.**
  `useChapterProgress` holds its last read per hook, so World, Plot or
  Story Settings mounting while a read runs show 0 until it lands, though
  the hidden reader still holds the number. The window is the read's own
  length, on the order of milliseconds, and it heals by itself. Slice
  5.3's count labels make it readable. `useEntryIndex`'s
  `seedFromLastRead` is the precedent if it ever shows. Raised 2026-11-02
  by Slice 5.1's closing review.
- **Two test and logging helpers have no home yet.** The `run()` and
  `entry()` factories repeat across `hooks` tests: the terminal stub
  appears in 28 files, and more than 12 define their own `entry`. The
  `error instanceof Error ? …` log field has 40 or more sites and no
  shared helper. Each needs a new home and a sweep of files on main.
  Raised 2026-11-02 by Slice 5.1's closing review.
- **`isEditableTarget` has never had a story on the upward path.**
  `reader-surface.tsx` guards typing in a field from the scroll-key
  gestures. 5.3 pins the downward half with a story; nothing fails if
  the guard goes from the upward one. Raised 2026-11-02 by 5.3's task
  reviews.

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

- **A chip's hit slop misses the phone floor at compact density.**
  `CHIP_HIT_SLOP` (`components/ui/chip.tsx`) gives 32 + 8 = 40 px at
  compact on phone, Browse included, under
  [`touch.md`](../ui/foundations/mobile/touch.md)'s 44 px floor, which
  holds at every density. Raised 2026-11-02 by 5.3's task reviews.

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
    5.3's slice review. On the Fold the target held still, against
    that prediction: in 5.3's device session (release build, unfolded),
    a near-tail jump pressed about 3 s into a 30 chars/s reply landed
    with its target as high as the content allowed, about 250 px below
    the top, and the reader's upper half didn't visibly move from the
    landing at 5.6 s to 30 s while the reply grew below. The fixture
    was modified to put a closed one-entry chapter on the tail. Why it
    held isn't known.
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
  reachable today; an in-place branch switch would make one, and would
  also log a false `reader.document_reloaded`, which reads the same
  painted state. Raised 2026-11-03 by 5.3's Task 9 review; the stale
  handle added by 5.3's slice review.

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
    slice review. Not run on the Fold; see "The phone chapter Sheet
    rises on chapter 1, then jumps to its last rows" in the
    [Inbox](#inbox).

  Web's upward-offset rule can't move over as is to the phone Sheet,
  where gorhom's snap to the top before the unlock would read as a
  scroll up. The tablet Popover scrolls in gesture-handler's
  `ScrollView` with no Sheet lock, so the web rule may carry over there.
  A fix must show on a device that a TalkBack scroll unpins the list,
  that the snap before the unlock and a drag during the rise don't
  leave it off its last row, and that a later content-size or layout
  change doesn't pull a TalkBack-scrolled list back. Read from the
  code, not reproduced.

- **The phone chapter Sheet rises on chapter 1, then jumps to its last
  rows.** On the phone, the chapter Sheet shows chapter 1 while it rises
  and snaps to its last rows only once it is fully open, a visible jump
  on every open. gorhom holds the list at the top until the Sheet
  unlocks, and `SheetUnlockWatcher`
  (`components/reader/chapter-popover.tsx`) repeats the scroll to the
  last row only then. Repro: on the folded Fold, open the story "Long
  branch, 20 chapters" from `pnpm db:seed:long` and tap the chapter
  chip. In one recording the Sheet showed chapters 1–6 at 2.95 s and
  3.05 s, and 16–21 at 3.15 s. The developer saw it on the phone. The
  recordings are git-ignored, so the evidence is
  [#698's device comment](https://github.com/AventurasTeam/Aventuras/pull/698#issuecomment-6611307585).
  "The native chapter list's pin doesn't follow the reader's own
  scrolls" in the [Inbox](#inbox) names this snap to the top before the
  unlock only as a constraint on its fix. That entry's rise-drag case
  couldn't be run on the device: adb's input lag, about 0.1 s, can't
  place a drag inside a rise of about 0.2 s, and by hand the list sits
  at chapter 1 with nothing above it to scroll to. Raised 2026-11-03 by
  5.3's device session (developer decision R3).

- **The reader's bottom geometry is still read only at a few moments.**
  `syncJumpButton` (`components/reader/reader-surface.tsx`) raises the
  jump-to-bottom button as a stream grows below the reader and through
  a landing, but other growth below still waits for a scroll event: the
  commit that replaces a streaming card, a reply's late layout, a
  classifier write that makes a row taller. Separately, the chapter
  break's re-pin reads the reader's distance against the last commit's
  height, and in one story setup late layout had shrunk the content
  14 px since that commit (4 of 4 runs), so a reader 10 px from the
  bottom read as 24 px and wasn't re-pinned; the cause isn't pinned
  down. Both from 5.3's slice review, 2026-11-03, in stories, not on a
  device. The same review left Space on a `<button>` or `<summary>` in
  entry HTML to the control; `<video controls>` and `<audio controls>`,
  which the entry sanitizer allows, may take Space too and weren't
  probed.

- **A stale landed signal can end a newer jump's wait for the same
  entry.** The host matches the surface's landed signal by entry id
  alone (`landed` in `components/reader/use-entry-jump.ts`). If a
  landing for entry X reports late, for example when a run failure's
  reload detaches X's row mid-landing and the report crosses the native
  bridge after the user has pressed X again, the new jump's veil lifts
  while its read is still out. That read then lands with no veil, and
  its bound later logs a spurious `bound` drop. Telling the two apart
  needs a per-landing token on the signal, a bridge-contract change.
  From reading, not reproduced. Raised 2026-11-03 by 5.3's slice review.

- **The theme CSS generator has no runtime caller.**
  `lib/themes/core/css-generator.ts` has had no caller outside its tests
  since M1: `global.css` is written by hand and guarded by
  `lib/themes/core/registry.test.ts`. 5.3 kept the generator in step
  with each dark theme's `--landed-tint-share`, but nothing checks the
  two agree. Wire it into a build step or a test that compares its
  output with `global.css`, or drop it. Raised 2026-11-03 by 5.3's slice
  review.
