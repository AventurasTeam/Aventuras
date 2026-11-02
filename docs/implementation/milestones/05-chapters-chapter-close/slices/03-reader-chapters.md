# Slice 5.3 — Reader chapters and jump to entry

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** none. [Slice 5.1](./01-token-measure.md) is a partial
  edge: until it lands, labels read a percent with no number
  ([C5](../milestone.md#c5--token-reads-and-the-progress-hook),
  [C16](../milestone.md#c16--flip-rule)).
- **Blocks:** [Slice 5.7](./07-chapter-timeline.md) (`Jump to chapter →`,
  the time-range read), [Slice 5.10](./10-two-starts.md) (the popover's
  entry point), [Slice 5.11](./11-review-window.md) (the entry link)

## Goal

The reader shows where it is in the chapters and can jump to any of
them. This slice delivers the `entry` route param and `jumpToEntry`
([C15](../milestone.md#c15--entry-jump-and-chapter-time-ranges)), with
History's rows as their first link; the chapter chip, the passive time
chip and the phone chip strip; the chapter popover with per-chapter time
ranges; inline chapter breaks; the progress strip's tone, tooltip and
press; and the story card's chapter label. Jump comes first in the plan,
because it is the slice's one unmeasured risk.

## Background

None of this chrome was ever built: M2.5's static chip and passive time
chip didn't land, so `ScreenShell.centerExtras` has no caller and the
strip is a fixed `bg-accent` bar. The reader holds one contiguous window
of fully laid out rows, so a jump can only load older rows until its
entry is present, and on native every `rows` emission carries that whole
window over the bridge, stream chunks included. Chapter rows come from
`chaptersStore`, hydrated whole at story open, but per-chapter world time
sits in `metadata` on rows outside the window, so it needs a SQL read.
This slice writes no chapter: it runs on the seeded ones, as Plot's E2E
has since M4.

## Required reading

- [`reader-composer.md → Top-bar — chapter navigation`](../../../../ui/screens/reader-composer/reader-composer.md#top-bar--chapter-navigation),
  [`Top-bar — in-world time display`](../../../../ui/screens/reader-composer/reader-composer.md#top-bar--in-world-time-display)
  and [`Mobile expression`](../../../../ui/screens/reader-composer/reader-composer.md#mobile-expression)
  — the chips, strip, popover and break.
- [`reader-composer.md → Loaded-set model`](../../../../ui/screens/reader-composer/reader-composer.md#loaded-set-model),
  [`Jump buttons`](../../../../ui/screens/reader-composer/reader-composer.md#jump-buttons)
  and [`Anchor preservation under shifts`](../../../../ui/screens/reader-composer/reader-composer.md#anchor-preservation-under-shifts)
  — the rules a jump has to keep.
- [`reader-document.md → Entry list`](../../../../ui/patterns/reader-document.md#entry-list-fully-rendered-flow-layout)
  and [`Bridge contract`](../../../../ui/patterns/reader-document.md#bridge-contract)
  — full layout, the one anchor rule, no scroll write mid-gesture, what
  crosses to the document and how.
- [`parked.md → Native reader rows rerender per emission`](../../../../parked.md#native-reader-rows-rerender-per-emission)
  — why a grown window costs more than the jump itself.
- [`navigation.md → Reader chip strip`](../../../../ui/foundations/mobile/navigation.md#reader-chip-strip-phone-only)
  and [`touch.md → Chip-strip safe zone`](../../../../ui/foundations/mobile/touch.md#chip-strip-safe-zone)
  — the phone strip and its empty state.
- [`layout.md → Surface bindings`](../../../../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces)
  — Popover on desktop, Sheet (medium) on phone.
- [`principles.md → Universal in-story chrome`](../../../../ui/principles.md#universal-in-story-chrome),
  [`Reader-only chrome`](../../../../ui/principles.md#reader-only-chrome)
  and [`What's not gated`](../../../../ui/principles.md#whats-not-gated).
- [`delta-log-row.md → Click behavior`](../../../../ui/patterns/delta-log-row.md#click-behavior)
  — the History link this slice turns on.
- [`story-card.md → Compound API`](../../../../ui/patterns/story-card.md#compound-api)
  and [`story-list.md → Story card`](../../../../ui/screens/story-list/story-list.md#story-card--text-first).
- [`chapter-timeline.md → Per-card actions`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#per-card-actions)
  — what `Jump to chapter →` will expect of the link.
- The milestone's [C5](../milestone.md#c5--token-reads-and-the-progress-hook),
  [C7](../milestone.md#c7--chapter-overlays),
  [C8](../milestone.md#c8--seed-stability),
  [C15](../milestone.md#c15--entry-jump-and-chapter-time-ranges) and
  [C16](../milestone.md#c16--flip-rule).
- Lessons: [the expo-dom bridge](../../../lessons-learned/expo-dom-bridge-identity-and-rejections.md#how-to-apply),
  [scroll anchoring](../../../lessons-learned/scroll-anchoring-rnweb-tree.md#how-to-apply),
  [Portal context](../../../lessons-learned/rn-primitives-portal-context.md#how-to-apply),
  [disabled clicks](../../../lessons-learned/rn-primitives-disabled.md#how-to-apply),
  [overlays and focus](../../../lessons-learned/portaled-overlay-outlives-screen-focus.md#how-to-apply).

## Scope: in

**The measure, first.** Before any chapter chrome, on an Android device
and a release build, on a branch of 20 chapters at about 132 entries each
and one of 60, the chapter counts `bench/fixture.ts` prices against, with
entries at real prose length (the seed's one-liners understate layout):

- time from press to landed for a jump to chapter 1 from a fresh 50-row
  window;
- renderer and app PSS once landed;
- one streamed turn at that window size, because each chunk re-emits the
  whole window and the window doesn't shrink after the jump.

The fixture stays out of the default seed (C8). The bar set at planning,
the numbers, the device and the build go in Implementation notes.

**Jump to entry (C15).**

- An `entry=<entryId>` param on `app/reader-composer/[branchId].tsx`,
  read through `useRouteLink`. `readerHref(branchId, entryId?)` in
  `components/reader/reader-href.ts` is the one builder, as `worldHref`
  and `plotHref` are; 5.7 and 5.11 build their links with it.
- A link is handled once the reader is focused and hydrated, and on
  native painted. `useSurfaceNavigate` sets the param before it
  dismisses, and a reader under another screen isn't laid out
  (`components/reader/reader-surface.tsx:480`); a call into a document
  that hasn't sent `onReady` is lost.
- The reader clears `entry` after handling it, so a second link to the
  same entry jumps again and a reload doesn't.
- `components/reader/use-entry-jump.ts` is the host half, shared by the
  link and the popover. A row in the window jumps at once. Otherwise it
  reads the entry's position on this branch; no row means a toast and no
  move. Then one read from that position up to the window's oldest row,
  one store write, one `rows` emission. A loop of 50-row chunks is ruled
  out: each chunk would re-emit the whole window, and `patch` clones the
  Map and notifies every selector per row
  (`lib/stores/factory/working-set-store.ts:21-36`,
  `hooks/use-branch-tail-id.ts:5`), so the store factory gains a bulk
  insert.
- A `reload()` or a boundary load landing during that read can't leave a
  gap: if the window's oldest row moved, the read reruns against it, and
  a branch change drops it. `hasOlder` stays true until a short load
  proves the top, as today.
- `jumpToEntry(entryId)` on `ReaderSurfaceHandle` and
  `ReaderDocumentRef`, dispatched by platform as `jumpToBottom` is. The
  surface holds the target until the row is in the DOM, since on native
  `rows` and the call cross the bridge apart. On landing it cancels the
  bottom pin and anchor hold, disengages autoscroll, writes the scroll
  position with no animation, and re-asserts each frame until the height
  holds, as `startBottomPin` does. A wheel, touch drag, scrollbar press
  or upward key breaks that, and nothing is written under a finger.
- A transient highlight on the landed row, kept off `ReaderRow`'s memo.
- History: `HistoryRowView.entryId` is the formatted label
  (`lib/history/humanize.ts:25`), so the view also carries the raw id,
  set only when a label resolved. `HistoryTab` takes `onOpenEntry`, the
  four detail panes pass it, and World and Plot route it through
  `navigateGuarded(readerHref(…))`. A row with no live entry stays
  non-interactive. `DeltaLogRow` doesn't change.

**Chips and the phone strip.**

- `components/reader/chapter-chip.tsx`: `Chapter <n> ▾`, `n` being the
  branch's highest `sequenceNumber` plus one, or 1 with no closed
  chapter.
- `components/reader/time-chip.tsx`, passive: clock icon and the
  formatter's output for `branchWorldTime`, 260 px at most, through
  `TruncatedText`, with no `▾` and no press. It renders nothing with no
  frame or on a format miss.
- Both go in the reader's `centerExtras`, which `ScreenShell` already
  places inline or in the phone strip.
- The phone strip's state chips sit in a horizontal `ScrollView` with
  about 16 px of left padding. Browse stays outside it, right-anchored.
- Empty state per `navigation.md`, as one pure predicate,
  `chapterChipVisible(tier, closedChapters)` in
  `components/reader/chapter-chip-visibility.ts`: on phone the chapter
  chip hides until the branch has a closed chapter, and desktop and
  tablet always show it. The shell takes `centerExtras` as opaque nodes,
  so the rule can't live there. The time chip hides only when it would
  render empty.

**Popover.** `components/reader/chapter-popover.tsx`, Popover on desktop
and tablet, Sheet (medium) on phone, dispatched as `OverflowMenu` does:

- Closed chapters oldest first, `<n> · <title>` over a time range,
  pressable; the open chapter last, `in progress`, highlighted, not
  pressable, with `since <time>`. No time means no line. Long lists
  scroll and open on the last row.
- Pressing a closed row closes the overlay, then jumps to its
  `startEntryId`.
- The progress bar and `chapter progress · 8,420 / 24,000 tok`, in the
  strip's tone. The label binds directly to 5.1's numbers, and no percent
  branch ships.
- `Close chapter manually` and `Manage chapters →`, disabled with a
  reason (C16). Each is an optional callback, so a flip is a line: 5.10
  passes `openCloseModal({ branchId })` and 5.7 the route. The Timeline
  link's reason reuses `chrome.goTo.chapterTimelineLandsLater`, which 5.7
  drops.
- Data resolves above the Portal and reaches a pure view as props, since
  a Sheet's content doesn't see outer providers.

**Time ranges (C15).**

- `readChapterTimeRanges(branchId, db)` in
  `lib/db/story-entries/chapter-time-ranges.ts`, beside `open-region.ts`,
  exported from `@/lib/db`. `lib/chapters` takes no value import of
  `@/lib/db` (C5). One query grouped by `chapter_id`: `min` and `max` of
  `metadata.worldTime`, excluding 0 and `system` rows. With `system` out,
  the `null` group is exactly C5's open region.
- `useChapterTimeRanges(branchId, { enabled })` keys on `settleCount` and
  the tail, as `useEntryIndex` does, and returns `refetch`. A world-time
  edit moves neither (`lib/actions/story-entries/world-time.ts:74`), and
  the app's query client never goes stale (`lib/cache/query-client.ts`),
  so flipping `enabled` on a cached key fetches nothing. The popover calls
  `refetch()` each time it opens, per C15.
- `chapterTimeRangeLabel` in `components/reader/chapter-time-range.ts`:
  `<first> → <last>`, one label when both format the same, since the UI
  can't parse the formatter's string. 5.7 uses the same function.

**Inline breaks.**

- `chapterBreaks` on `ReaderSurfaceProps`, a side table keyed by end
  entry id, computed in `components/reader/chapter-breaks.ts` and
  memoized, as `worldTimeDecorations` is.
- Plain web markup below the end row, `role="separator"`: thin rule,
  `Chapter <n>`, time at close from that row's decoration. A chapter
  whose end row isn't loaded has no break until it is.
- A break mounting above a reader at the bottom re-pins the bottom, or a
  commit landing a close would hide the reply's last lines with no scroll
  event to raise the jump button.

**Strip (C5).**

- `ScreenShell.chapterProgress` already takes the whole `ChapterProgress`
  from `useChapterProgress` on the four routes, as 5.1 shipped it.
- `chapterProgressTone` is already in `lib/chapters`, with C5's values:
  `'success'` under 80, `'warning'` from 80, `'danger'` from 90.
- `components/compounds/chapter-progress-bar.tsx` holds the one map from
  tone to `bg-success`, `bg-warning` and `bg-danger`. The strip and the
  popover render it, and 5.7's in-progress card reuses it.
- A hover tooltip with the exact numbers through `ReasonTooltip`. It's a
  no-op on native, and every in-story surface gets it from the shell.
- `onChapterProgressPress` from the route. Only the reader passes it, at
  tablet and desktop, and it opens the popover. The phone strip stays
  passive: it is 3 px, and the chip sits right under it.

**Story card.**

- A per-story read beside `rehydrateStories`: `max(sequence_number) + 1`
  over each story's `current_branch_id`.
- `useStoryChapterNumbers` reads it through React Query, keyed on
  `settleCount`, and calls `refetch()` on each return to focus, since the
  key doesn't move on focus and the client never goes stale. The list
  stays mounted under the reader and `rehydrateStories` runs once at its
  mount (`app/index.tsx:81-83`), so a close would otherwise leave the
  label stale.
- `selectStoryCards` and `toStoryCardData` take the numbers: a draft stays
  null, and a story with no row reads 1.

**Canon, in the same PR as the code it describes.**

- `story-card.md` lines 28, 71-75 and 126 lose the deferral.
- `delta-log-row.md → Click behavior`: History's rows press to their
  entry, and Diagnostics keeps its deferral.
- `reader-composer.md`: `Loaded-set model` says a jump prepends into the
  one window, the stale `Streaming while in a non-recent window`
  paragraph goes, and the strip's click names its tiers.
- `reader-document.md → Bridge contract` gains `chapterBreaks` and
  `jumpToEntry`.
- `reader-composer.html`: the strip's "passive chrome" comment, the
  popover's `12 entries · 6.2k`, which `.md` doesn't list and isn't
  built, and the break, to match `.md`.
- `component-inventory.md`: new rows, and `ScreenShell`'s.

## Scope: out

- `Close chapter here`, `Ready to close` and the modal behind
  `Close chapter manually`: [Slice 5.10](./10-two-starts.md).
- `content_tokens`, `openRegionSeries` and `useChapterProgress`:
  [Slice 5.1](./01-token-measure.md).
- `Jump to chapter →` and the in-progress card's bar:
  [Slice 5.7](./07-chapter-timeline.md).
- The review window's entry link and `DeltaLogRow`'s nested link:
  [Slice 5.11](./11-review-window.md).
- `chaptersOld`: [Slice 5.9](./09-chapter-wide-tasks.md).
- The time chip's popover and era flips: M7.2.
- The branch chip: M6.3.
- Diagnostics' delta-log link: M7.3.
- Translated chapter titles: M8.1.
- A disconnected reader window, which canon and `holdsLiveEdge` rule out.
  A far-end trim is canon's lever and no slice's scope; only a bad measure
  reopens it.

## Acceptance criteria

**Measure**

1. Implementation notes record the bar agreed at planning beside the
   three numbers at both sizes, with device and build.

**Jump** (`e2e/tests/reader-chapters.spec.ts` unless named)

2. From the seeded hero story's fresh window, pressing
   `Nine Days of Rain` in the popover puts the row of that chapter's
   `start_entry_id`, read from the DB, in the viewport.
3. In Plot, pressing a History row whose delta anchors outside the
   50-row window pops Plot and lands on the reader with that row in the
   viewport, so `←` leads to the story list. A second press after scrolling
   away jumps again.
4. A dirty World pane raises its Save / Discard / Cancel before a History
   row leaves.
5. `components/reader/use-entry-jump.test.tsx`: a row in the window reads
   nothing; a target 40 chunks back makes one read and one store write;
   an id not on the branch toasts and writes nothing; a window that moved
   during the read ends contiguous; a branch change drops the read.
6. `components/reader/reader-surface.stories.tsx`: `jumpToEntry` before
   the row exists lands when `rows` brings it; a wheel breaks the landing;
   a stream growing below a jump doesn't pull the view back.
7. A History row with no live entry has no press affordance
   (`components/history/history-tab.test.tsx`).

**Chrome**

8. On desktop the top bar shows `Chapter 3 ▾` and the time chip on the
   hero story, and `Chapter 1 ▾` on a story with no closed chapter
   (`e2e/tests/reader-chapters.spec.ts`).
9. The time chip truncates a long label at 260 px with the full text
   available, and renders nothing with no frame or on a format miss
   (`components/reader/time-chip.stories.tsx`).
10. At phone width the strip scrolls sideways with Browse pinned and
    starts about 16 px in (`components/shells/screen-shell.stories.tsx`).
    `components/reader/chapter-chip-visibility.test.ts`: the chip hides on
    phone with no closed chapter, shows there with one, and shows at tablet
    and desktop either way.
11. The popover's stories at both tiers show closed rows with ranges, the
    highlighted `in progress` row with `since`, both disabled actions with
    their reasons, a long list opened on its last row, and the progress
    label: `chapter progress · 8,420 / 24,000 tok`
    (`components/reader/chapter-popover.stories.tsx`).
12. `lib/db/story-entries/chapter-time-ranges.test.ts`:
    `readChapterTimeRanges` groups by chapter, excludes 0, null and `system`
    rows, keys the open region as `null`, and omits a chapter with no time.
13. `hooks/use-chapter-time-ranges.test.tsx`, under `createQueryClient()`,
    since a bare `new QueryClient()` has a `staleTime` of 0 and would hide
    a missing refetch: after a world-time edit, with the key unchanged,
    `refetch()` returns the new range. `e2e/tests/reader-chapters.spec.ts`:
    retiming a closed chapter's last entry and reopening the popover shows
    the new range.
14. `components/reader/chapter-breaks.test.ts`: one break per closed
    chapter whose end row is loaded, none for another branch's row, and no
    time when the decoration is missing.
15. A break mounting with the reader at the bottom leaves it at the
    bottom; further up, nothing moves
    (`components/reader/reader-surface.stories.tsx`).
16. `lib/chapters/chapter-progress-tone.test.ts`, with literal
    expectations: 79.9 is `success`, 80 and 89.9 are `warning`, 90 and 100
    are `danger`.
17. In `components/shells/screen-shell.stories.tsx` the strip paints each
    tone and carries its tooltip with the exact numbers; with
    `onChapterProgressPress` a click fires it, and without it the strip
    doesn't press. Whichever of 5.1 and 5.3 lands
    second, `git grep -E "function chapterProgressTone|chapterProgressTone ="`
    finds one definition.

**Story card**

18. The hero story's card reads `Chapter 3` (`e2e/tests/reader-chapters.spec.ts`).
19. `lib/stores/stories/view-model.test.ts`: a draft is null, a story with
    no read number is `Chapter 1`.
20. `hooks/use-story-chapter-numbers.test.tsx`, under `createQueryClient()`:
    a `settleCount` tick reads again through the key, and a return to focus
    reads again through `refetch()` with the key unchanged.

**Canon and gates**

21. `git grep -n "until chapters land" docs/ui/patterns/story-card.md`
    finds nothing.
22. Every new string routes through `t()`, and `pnpm lint`,
    `pnpm typecheck`, `pnpm lint:docs`, `pnpm format:check`,
    `pnpm compiler:check` and `pnpm test:run` pass.
23. `pnpm test:e2e -- reader-chapters` passes.

## Tests

- **Vitest, unit:** the tone, `readChapterTimeRanges` over `createTestDb`,
  `chapterChipVisible`, `chapterTimeRangeLabel`, the break table,
  `readerHref`, the store's bulk insert
  (`lib/stores/factory/working-set-store.test.ts`,
  one notification for many rows), `humanizeDelta`'s raw id, the card's
  label and `selectStoryCards`.
- **Hook tests:** `useEntryJump`, `useChapterTimeRanges`,
  `useStoryChapterNumbers`, on `createQueryClient()`, the app's client.
  Mutation-check the race and the one-write assertions: a green test here
  has passed vacuously before.
- **Storybook:** new stories for `ChapterChip`, `ChapterPopover`,
  `ChapterProgressBar` and `TimeChip`; additions to `ReaderSurface`,
  `ScreenShell` and `StoryCard`.
  Phone tier through the viewport, not a narrow wrapper.
- **E2E:** `e2e/tests/reader-chapters.spec.ts` on the seeded hero story,
  since the link's seams are `useSurfaceNavigate` over a mounted reader
  and a load past the window. It reads ids from the DB and names chapters
  by title or number, never by position (C8), so 5.2's seed change doesn't
  touch it. Chip and popover locators join `e2e/locators/reader.ts`,
  through i18n.
- **Manual:** the measure on Android; a desktop smoke through the
  `electron-app` MCP; a phone pass over the strip, the Sheet, a jump and
  a History link.

## Open questions

- **What does the chapter chip reflect?** `navigation.md` calls the chips
  reflectors of the current entry, `reader-composer.md` reads the latest
  entry, and `chapter-timeline.md` has the chip "highlight the same
  chapter on arrival". Recommendation: the open chapter, static, which is
  what this doc's criteria assume. Scroll state doesn't cross the bridge
  at scroll frequency, so tracking needs a new low-frequency callback and
  isn't needed for a jump. The Timeline's sentence then needs correcting.
- **Does the phone chip stay hidden on a story with no closed chapter?**
  Canon says so, and this doc follows it, but it means a phone user has
  no popover or token count through a whole first chapter, while desktop
  shows `Chapter 1 ▾`, and a first manual close is reachable only from the
  Actions menu. Recommendation: drop the rule in `navigation.md`, which
  is a change to one predicate.
- **Should the strip press at all?** `reader-composer.md` says click opens
  the popover and the wireframe says passive. C5 pins a press callback, so
  this doc gives one to the reader at tablet and desktop only. A 3 px
  target is poor on desktop too, so planning may want a taller hit area.
- **Where does a jump land, and how loud is the highlight?** Suggested:
  the row's top just under the viewport's top, no animation, and a fade of
  about 1.5 s. Canon has only the roadmap's "transient highlight".
- **What does `reload()` do after a jump?** It rehydrates to the trailing
  50 (`app/reader-composer/[branchId].tsx:498`), so a failed turn takes
  the reader back to the bottom, as it does after a long scroll up today.
  Recommendation: leave it, unless the measure argues for using it.
- **Where does the measure's fixture live, and how does it reach a
  release install?** Neither known route works: `reseedDevDatabase`
  refuses outside `__DEV__` (`lib/db/devtools/reseed.native.ts:16`), and
  `run-as` can't enter a release build (`scripts/dev-slot/android.ts:67`).
  `bench/fixture.ts` writes 30 entries a chapter (`:33`), not 132, so it
  isn't the generator as it stands. Planning names both the generator,
  outside the default seed, and the delivery. Candidates, neither tried: a
  DB seeded on a debug build with a same-signed release installed over it,
  or a release-variant build marked debuggable, which `run-as` can enter.
  5.2's dataset branch has to reach a device too, so one route should
  serve both. The first task can't start until this is answered.
- **What is the measure's bar, and what does a miss reopen?** Suggested:
  landed in under 3 s at 20 chapters, no renderer kill at 60, and a
  streamed turn that keeps up. Planning sets it. A miss reopens the jump's
  approach, not the layout. The levers are canon's far-end trim, trimming
  back to the recent window at Send or at `Jump to bottom`, and the
  chunk throttle `parked.md` holds. Whether a long jump needs a visible
  loading state is decided by the same number.
- **What does the story card show with no close?** "Current chapter" has
  no row until one closes. Recommendation: `Chapter 1`, matching the
  desktop chip, which is what this doc's criteria assume.
- **What does a break name?** `reader-composer.md` ties each break to the
  closed chapter and its time at close, while the wireframe labels one
  with the chapter that follows. This doc follows `.md`: `Chapter 2` sits
  below chapter 2's last entry. If that reads as a heading for what comes
  next, the label moves to the next number and the time stays.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
