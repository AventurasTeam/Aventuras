# Slice 5.3 — Reader chapters and jump to entry

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.1](./01-token-measure.md), for chapter chrome
  only. The jump and the measure don't need it, and the labels bind
  `useChapterProgress` directly
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
- [`followups.md → UX`](../../../../followups.md#ux), "Native reader rows rerender per emission"
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
  move. Then one read from the row above that position (a break hangs off
  the previous chapter's end row) up to the window's oldest row, one
  store write, one `rows` emission. A loop of 50-row chunks is ruled
  out: each chunk would re-emit the whole window, and `patch` clones the
  Map and notifies every selector per row
  (`lib/stores/factory/working-set-store.ts:21-36`,
  `hooks/use-branch-tail-id.ts:5`), so the store factory gains a bulk
  insert.
- A `reload()` or a boundary load landing during that read can't leave a
  gap: if the window's oldest row moved, the read reruns against it, and
  a branch change drops it. A read whose target is the branch's first
  row sets `hasOlder` false in the tick of its store write, so the
  shimmer leaves in the rows' commit; otherwise `hasOlder` stays true
  until the boundary load at rest proves the top with a short load, as
  today.
- `jumpToEntry(entryId)` on `ReaderSurfaceHandle` and
  `ReaderDocumentRef`, dispatched by platform as `jumpToBottom` is. The
  surface holds the target until the row is in the DOM, since on native
  `rows` and the call cross the bridge apart. On landing it cancels the
  bottom pin and anchor hold, disengages autoscroll, writes the scroll
  position with no animation, and re-asserts each frame until the height
  holds, as `startBottomPin` does. Any user gesture breaks that: a wheel,
  touch drag, scrollbar press or scroll key; a downward key or wheel
  leaves autoscroll engaged. A wheel that continues a chain already
  running at the jump (a trackpad's momentum) doesn't break it: the
  landing halts the chain and lands at once, for up to about 3 s; a
  wheel in the other direction is a new gesture. Nothing is written
  under a finger.
- A transient background tint and fade on the landed row's card, kept off
  `ReaderRow`'s memo. It starts on the first landing frame, not at the call.
- History: `DeltaLogRow`'s `entryId` is the formatted label, so
  `HistoryRowView.entry` pairs it with the raw id (`lib/history/humanize.ts`),
  null when no label resolved. `HistoryTab` takes `onOpenEntry`, the
  four detail panes pass it, and World and Plot route it through
  `navigateGuarded(readerHref(…))`. A row with no live entry stays
  non-interactive. `DeltaLogRow`'s only change is a pressable row's
  accessible name, which carries its entry (`update Kael, entry #47`;
  developer decision, 2026-11-02).

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
- The chapter chip shows on every tier, as `Chapter 1 ▾` with no closed
  chapter, and `navigation.md`'s empty state changes to match. The time
  chip hides only when it would render empty.

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
  `Chapter <n>` naming the chapter that follows, time at close from that
  row's decoration. A chapter whose end row isn't loaded has no break
  until it is.
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
- A hover tooltip with the exact numbers through `ReasonTooltip`, on an
  invisible hit area of about 9 px reaching up into the bar's empty
  bottom edge. It's a no-op on native, and every in-story route gets it
  from the shell at tablet and desktop.
- `onChapterProgressPress` from the route, on the same hit area. Only
  the reader passes it, at tablet and desktop, and it opens the popover.
  The phone strip stays passive and has no hit area: it is 3 px, and the
  chip sits right under it.

**Story card.**

- A per-story read beside `rehydrateStories`: `max(sequence_number) + 1`
  over each story's `current_branch_id`.
- `useStoryChapterNumbers` reads it through React Query, keyed on
  `settleCount` while the list is focused, and calls `refetch()` on each
  return to focus, since the client never goes stale. The list stays
  mounted under the reader and `rehydrateStories` runs once at its mount
  (`app/index.tsx:81-83`), so a close would otherwise leave the label
  stale. Hidden, it neither reads nor re-renders on a settle, and the
  cards keep their last labels until the read on return lands.
- `selectStoryCards` and `toStoryCardData` take the numbers: a draft stays
  null, and a story with no row reads 1.

**Canon, in the same PR as the code it describes.**

- `story-card.md` lines 28, 71-75 and 126 lose the deferral.
- `delta-log-row.md → Click behavior`: History's rows press to their
  entry, and Diagnostics keeps its deferral.
- `world.md → History tab` and `plot.md`: a History row with a live entry
  is no longer inert.
- `reader-composer.md`: `Loaded-set model` says a jump prepends into the
  one window and where it lands, the stale
  `Streaming while in a non-recent window` paragraph goes, the strip's
  click names its tiers, and the break names the following chapter.
- `reader-document.md → Bridge contract` gains `chapterBreaks` and
  `jumpToEntry`.
- `navigation.md → Reader chip strip` and its wireframe: the chapter chip
  always shows, the time chip has no `▾`, the chips say what each reads,
  Browse is pinned outside the scroller, and the strip's height is
  corrected.
- `reader-composer.md`: the `A chapter break mounting at the bottom`
  paragraph beside `Viewport shrink at the bottom`.
- `reader-composer.html`: the strip's "passive chrome" comments, the
  popover's `12 entries · 6.2k`, which `.md` doesn't list and isn't
  built, and the break, to match `.md`.
- `component-inventory.md`: new rows, and `ScreenShell`'s, `DeltaLogRow`'s
  and `HistoryTabView`'s.

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
   the row exists lands when `rows` brings it; a wheel after a pause or
   in the other direction breaks the landing, and one continuing a chain
   is halted until its bound;
   a stream growing below a jump doesn't pull the view back.
7. A History row with no live entry has no press affordance, and a
   pressable one is named with its entry
   (`components/history/history-tab-view.stories.tsx`,
   `components/compounds/delta-log-row.stories.tsx`).

**Chrome**

8. On desktop the top bar shows `Chapter 3 ▾` and the time chip on the
   hero story, and `Chapter 1 ▾` on a story with no closed chapter
   (`e2e/tests/reader-chapters.spec.ts`).
9. The time chip truncates a long label at 260 px with the full text
   available, and renders nothing with no frame or on a format miss
   (`components/reader/time-chip.stories.tsx`).
10. At phone width the strip scrolls sideways with Browse pinned and
    starts about 16 px in (`components/shells/screen-shell.stories.tsx`),
    and the chip shows `Chapter 1 ▾` there with no closed chapter
    (`components/reader/reader-chapter-chips.stories.tsx`).
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
    doesn't press. A `git grep` for `function chapterProgressTone` and
    `chapterProgressTone =` over `lib`, `components`, `hooks` and `app`
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
23. `pnpm build:web && pnpm electron:compile && pnpm test:e2e e2e/tests/reader-chapters.spec.ts`
    passes. The path form, because `-- reader-chapters` matches the
    absolute path, which a worktree of that name carries for every spec.

## Tests

- **Vitest, unit:** the tone, `readChapterTimeRanges` over `createTestDb`,
  `chapterTimeRangeLabel`, the break table,
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

## Implementation notes

- **The chapter chip shows the open chapter, static (developer decision,
  2026-11-01).** It matches the time chip and the strip, which read the
  live edge. Tracking the chapter in view would re-render the host on
  each change, and on Android re-emit the whole window. `navigation.md`
  says what each chip reads, and [Slice 5.7](./07-chapter-timeline.md)
  drops the Timeline's sentence about the chip highlighting a chapter on
  arrival.
- **The phone chip always shows (developer decision, 2026-11-01).** A
  deviation from the brief: `chapterChipVisible` and its file weren't
  built. Hidden until the first close, phone would have no popover or
  token count through a whole first chapter, while the strip stays up
  for Browse anyway. `navigation.md`'s empty state changed with it, and
  [Slice 5.10](./10-two-starts.md) lost its sentence about the popover
  being out of reach.
- **The strip presses at tablet and desktop, through a hit area
  (developer decision, 2026-11-01).** An addition to the brief. 3 px is a
  poor target, so an invisible area of about 9 px reaches up into the
  bar's empty bottom edge, and it carries the tooltip on all four routes
  at tablet and desktop. It's a sibling of the `progressbar`, since a
  native touch never reaches outside a 3 px parent and a `progressbar`'s
  children leave the accessibility tree. The phone strip stays passive
  and has no hit area.
- **A jump lands the row's top just under the viewport's top (developer
  decision, 2026-11-01).** With a break directly above the row the break
  lands there, so a chapter jump opens under its heading. There's no
  scroll animation, the card's tint fades over about 1.5 s, and a row too
  near the tail stops at the bottom.
- **The landed row's card tints and fades back (developer decision,
  2026-11-02).** In light themes the card's background starts at
  `--selection-bg` and eases out to its own background over 1.5 s from
  the first landing frame, and the row wrapper stays clear. It was
  chosen over the wrapper's `--tint-hover` band and an accent outline.
  The duration reaches the card through a custom property set from the
  same constant that clears the mark.
- **Dark themes soften the landed card's tint, each by its own share
  (developer decision, 2026-11-02).** At full strength `--selection-bg`
  read as a selected card in dark themes (default-dark's `#1e3a8a` is a
  saturated blue), so dark themes lay it over the card's own background
  as a layer that fades out over the same 1.5 s; light themes keep the
  full-strength tint above. At a shared 30%, two themes' `ai_reply`
  peaks nearly vanished (catppuccin-mocha and aventuras, ΔE about 2.4),
  because their `--selection-bg` sits next to their `--bg-raised`. So
  each dark theme sets `--landed-tint-share`, the smallest share at
  which its fainter card stands out as far as default-light's (ΔE 4.7);
  default-dark lands at 22%. The cost: catppuccin-mocha's and
  aventuras's `user_action` peaks rise to ΔE 11.4 and 9.6 (WCAG 1.43 and
  1.33, against default-light's 1.22 and catppuccin-latte's 1.33 on an
  `ai_reply`). It was chosen over one shared share and over an
  accent-based tint, which evened `ai_reply` but changed the hue and
  over-shot royal, cyberpunk and fallen-down.
- **`reload()` is unchanged after a jump.** A failure path takes the
  reader back to the trailing 50, as it does after a long scroll up.
- **The fixture stays out of the default seed, and a release install
  takes it over a debug one (developer decision, 2026-11-01).**
  `pnpm db:seed:long` writes a SQLite file, `pnpm device:push-db` puts it
  in a debug install, and the release APK goes over that with
  `adb install -r`, keeping data, so the measured build stays
  non-debuggable. [Slice 5.2](./02-first-chapter.md)'s dataset uses the
  same route. It ran on the Fold for the measure below, and
  [dev-environment.md → Measuring on a release build](../../../../dev-environment.md#measuring-on-a-release-build)
  records it.
- **The card reads `Chapter 1` with no close (developer decision,
  2026-11-01),** matching the chip. A draft stays null, and the label
  stays null until the first read lands, so a story with chapters never
  flashes `Chapter 1`.
- **A break names the chapter that follows (developer decision,
  2026-11-01).** A deviation from the brief: `Chapter 3 · <time>` sits
  below chapter 2's last entry, with the time still the time at close.
  With two closed chapters the brief's label would read `Chapter 2` over
  the open chapter's text while the chip says `Chapter 3`.
- **Chapter chrome waited for Slice 5.1 (developer decision,
  2026-11-01).** A deviation from the brief: the jump went first, and
  chrome started once 5.1's slice review finished, on 5.1's stack. It
  moved onto `main` when 5.1 merged, binding `useChapterProgress`
  directly. No percent branch shipped, so C5's interim shape and C16's
  `Count labels` flip didn't apply.
- **The measure and the phone pass ran after chrome, against the Scope's
  "The measure, first" (developer decision, 2026-11-01).** Nothing had tested the
  one-window model while chrome was built, and the measure then missed
  the streaming bar, so the model's cost is real. The bar the developer
  set at planning (2026-11-01): at 20 chapters a jump lands within 3 s,
  with a visible loading state if it takes over 1 s, and a streamed
  reply, first chunk painted to final text painted, takes at most 1.5x
  its 50-row time on a fixed-rate mock, with 500 ms the longest gap
  between paints; at 60 chapters, no renderer kill. The developer
  cleared the miss (2026-11-02): 5.3 ships as built, and the fix is
  [a followup](../../../../followups.md#ux) to be planned as a slice in
  M5, with a sliding reader window. The numbers are in
  `### Android measure`. The phone pass ran on the Fold, closed (phone
  tier) and open (tablet tier), on a release build, covering the strip,
  the chip strip, the Sheet and the popover, jumps and History links.
  A reader stuck on `Loading story…` on a later open reproduces on
  `origin/main` and has its own fix.
- **The `chapters` namespace starts here,** registered in
  `lib/i18n/i18n.ts` and `e2e/harness/i18n.ts`, so
  [Slice 5.7](./07-chapter-timeline.md)'s "unless 5.3 made one" step is
  done, and 5.7 and [Slice 5.11](./11-review-window.md) add their copy to
  `locales/en/chapters.json`.
- **`loadOlderEntries` moved to `insertMany`,** since a loop of `patch`
  clones the Map 50 times per chunk on a grown window.
- **A newer jump replaces one in flight,** dropping the landing held or
  sent before it, and a pending target drops on a branch change or a
  gesture. A wheel continuing a chain running at the jump isn't one.
- **A jump made during momentum halts it (developer decision,
  2026-11-02).** The alternative was waiting for the scroll to finish
  and then jumping. A touch fling stops (`overflow-y` hidden for one
  frame) and the row lands at once. A trackpad's momentum, which the page
  can't stop, is held with `overflow-y` hidden while the wheel chain
  lasts, up to about 3 s; a wheel after a pause or in the other
  direction is a new gesture and drops the jump. A finger on the glass
  still wins. The scroller keeps `scrollbar-gutter: stable`, so the
  toggle doesn't reflow the window, at the cost of an empty gutter of
  about 10 px on a short desktop reader. Device-verified on the Fold
  (touch) and in Electron with trusted wheel input; real OS trackpad
  momentum isn't verified.
- **A jump that needs a read shows a loading veil, once it has waited
  200 ms (developer decision, 2026-11-03).** The surface's
  `onEntryLanded` fires once per jump: on its first landing frame, once
  painted, or when its target drops. `useEntryJump` lifts the veil
  (`Loading entries…`) on it, so a jump whose landing signals sooner
  never shows it; one landing just past the delay can flash it for a few
  frames. On native a landing whose document hasn't painted is held
  host-side until it paints, and the veil has a fixed upper bound. A
  newer jump joins the wait of the one it replaces.
- **A jump's read starts at the row above its target,** so the break
  above a chapter's first entry exists when it lands. A target that is
  the branch's first row drops the boundary shimmer in the same commit.
  An in-window jump still reads nothing (criterion 5), so a target at the
  window's oldest row lands without the break above it; that case is in
  [triage](../../../triage.md), since fixing it orders the landing after
  the document commits, a bridge-contract change.
- **A break can still shift content.** One mounting above the viewport
  moves it by its own height, which canon accepts as uncompensated, so
  criterion 15's story asserts that no scroll write happened, not that
  the pixels held.
- **A tail at world time 0 shows the story's origin time** on the time
  chip, as the entry footers do: `branchWorldTime` returns 0, and the
  formatter renders 0 as the origin.
- **The phone chip strip keeps the 44 px touch floor.** Its padding sits
  inside the scroller, since a scroll view doesn't hit-test past its own
  edge, which makes the strip about 53 px, not canon's former ~36 px;
  `navigation.md` now says so.
- **A chapter-popover press goes straight to the jump once the reader is
  ready,** since a round trip through the `entry` route param re-sends
  the window twice on native. Before then (not focused, not hydrated, or
  on native not painted) it takes the param, so a press before paint
  waits instead of failing.
- **The popover's list scrolls differently per tier.** On tablet and
  desktop it scrolls in gesture-handler's `ScrollView`, since
  rn-primitives' Popover content claims the responder. On phone it
  scrolls to its last row once gorhom unlocks the list's scrolling, and
  stops re-pinning once the user drags. Both repeat the scroll a frame
  later, since Android runs a frame's scroll commands before its layout
  and the first would clamp to the rows' old height.
- **`useChapterTimeRanges` and `useStoryChapterNumbers` log a failed read
  from the fetch,** as 5.1's `useChapterProgress` does, not from an effect
  as `useEntryIndex` does, so one failure logs once however many
  instances are mounted.

### Android measure

Bar, set at planning: at 20 chapters, landed within 3 s with a visible
loading state over 1 s, a streamed reply within 1.5× its 50-row time on
a fixed-rate mock, and no gap between paints over 500 ms; at 60
chapters, no renderer kill. All timed inside the document.

Device: SM-F966B, Android 17, closed (cover screen, phone tier). Build:
release, `arm64-v8a`, not debuggable, from commit `f235bd324` with the
measure's temporary marks on top, uncommitted. Fixture:
`pnpm db:seed:long`, with real prose and metadata, whose weight is an
assumption: no real rows exist to compare with. Its replies repeat 12
distinct texts, and their reasoning and summaries repeat likewise; that
isn't expected to move these numbers, but it isn't verified at the
WebView's text shaping. The mock streamed one 1,496-character reply at
400 characters a second, in chunks of 6. A landing is a jump to entry 1
from a fresh 50-row window; a grown window is the landed one, entry 1 to
the tail.

| Measure                                 | 20 chapters       | 60 chapters         | Bar                 | Verdict          |
| --------------------------------------- | ----------------- | ------------------- | ------------------- | ---------------- |
| Landed (median of 3)                    | 2,634 ms          | 10,704 ms           | 3 s at 20           | pass             |
| Rows in the window                      | 2,661             | 7,941               |                     |                  |
| App PSS, landed                         | 454 MB            | 704 MB              |                     |                  |
| Renderer PSS, landed                    | 777 MB            | 1,993 MB            |                     |                  |
| Reply, baseline median                  | 4,152 ms          | 4,180 ms            |                     |                  |
| Reply, grown window                     | 2,913 ms          | 12,350 ms           | 1.5× baseline at 20 | pass, misleading |
| Longest paint gap, grown                | 1,561 ms          | 12,350 ms           | 500 ms at 20        | miss             |
| Final paint after host finish, grown    | 414 ms            | 18,760 ms           |                     |                  |
| Commits during the reply, baseline      | 173               | 173                 |                     |                  |
| Commits during the reply, grown         | 6                 | 4                   |                     |                  |
| Commit time, grown (median)             | 510 ms            | 2,019 ms            |                     |                  |
| Payload per emission                    | 4.8 MB            | 14.2 MB             |                     |                  |
| Renderer kill                           | none              | none                | none at 60          | pass             |
| Host read time (median of 3)            | 84 ms             | 372 ms              |                     |                  |
| Second jump, popover, grown             | 102 ms            | 207 ms              |                     |                  |
| Commits, press to landed (popover)      | 1 (24 ms)         | 1 (34 ms)           |                     |                  |
| Second jump, History link, grown        | 2,357 ms          | 5,942 ms            |                     |                  |
| Commits, press to landed (History link) | 2 (1,051, 681 ms) | 2 (2,233, 2,343 ms) |                     |                  |

The commit rows count the document's commits from the user's entry
appearing to the final paint; the baseline's take about 12 ms each, and
its payload is about 90 KB.

The landing passes at 20 chapters but takes over 1 s, so the reader
needs its loading state. It shows only once a jump that needs a read
has gone a short delay without signalling its landing (developer
decision, Q15), so a jump whose landing signals sooner never shows it. The pass has a margin of about 12%, on a
fixture whose weight is assumed. Of the median run's 2,634 ms, its own
host read takes 79 ms (the table's 84 ms is the median of three), the
host's re-render, the bridge and the document's parse about 0.5 s up to
the document's render, the commit that mounts the window about 1.4 s,
and the frames up to the landed paint about 0.6 s. At 60 chapters the
same parts take about 0.4, 2.2, 5.7 and 2.5 s. Read from the code, not
observed: `land` runs only after the read in `use-entry-jump.ts`, so a
gesture during the host read isn't seen, and the landing yanks it.
Momentum isn't a gesture to the landing loop either: in one untimed try,
a chapter pressed during a fling landed, and the fling then carried the
view about 1,000 px past it. An explicit jump now halts the fling
before it lands.

The streamed reply misses at 20 chapters: its longest gap between
paints is 1,561 ms against 500. The developer cleared the miss (decision
Q13, 2026-11-02): 5.3 ships as built, and the fix is
[a followup](../../../../followups.md#ux) to be planned as a slice in
M5. The reply's 1.5× row reads as a pass only because the grown
window painted three chunks in all and the first already held 207
characters, so the measure starts late; the final text painted 414 ms
after the host finished, where at 50 rows it painted within 70 ms of
it. At 60 chapters the reply painted one partial text, 301
characters, before the final one, which came 18.8 s after the host
finished. The renderer survived the landings, the turn and both
second jumps at 60; its PSS at the landing was 1,993 MB. Each grown
turn was sent from entry 1, so autoscroll stayed disengaged, as
[canon says](../../../../ui/screens/reader-composer/reader-composer.md#autoscroll),
and the reply streamed below the fold. A grown turn sent at the tail,
with autoscroll engaged, wasn't run.

A second jump from the grown window is fast from the popover, since the
row is already in the window. From a History link it isn't: leaving the
reader for World re-emits the window twice (commits of 637 and 784 ms
at 20 chapters, 2,074 and 2,955 ms at 60), and the return re-emits it
twice more before the landing.

The prediction this slice was planned around, that a grown window stalls
streaming, held. Each host emission carries the whole window: 4.8 MB at
20 chapters and 14.2 MB at 60, against about 90 KB at 50 rows. The
document can't keep up, so updates merge before they commit: a reply
commits 173 times at 50 rows, but 6 times at 20 chapters and 4 at 60, at
a median of 510 ms and 2,019 ms against about 12 ms. A chapter close
that re-emits once per entry, 132 times, would hold a 20-chapter window
for about 72 s, (510 + 33 ms stringify) × 132, and a 60-chapter one for
about 5 minutes, (2,019 + 166 ms) × 132. That arithmetic counts the
commit and the host's stringify only, not the parse and layout around
each commit that the landing split shows, and it applies only if the
updates arrive more than one commit apart. The closer proxy is the
measured lag of the final paint behind the host, 0.4 s at 20 chapters
and 18.8 s at 60. [Slice 5.2](./02-first-chapter.md) doesn't plan to
measure it on a grown window, and its
[Open questions](./02-first-chapter.md#open-questions) ask whether it
should ("Does the close's measure run once with the reader grown?").
