# Slice 5.7 — Chapter Timeline

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.1](./01-token-measure.md) (C5's hook and
  numbers), [Slice 5.3](./03-reader-chapters.md) (C15's jump and
  time-range read)
- **Blocks:** [Slice 5.10](./10-two-starts.md),
  [Slice 5.11](./11-review-window.md),
  [Slice 5.12](./12-chapter-delete-rollback.md)

## Goal

The Chapter Timeline as a real in-story route: a card per closed
chapter, whose title, theme, summary and keywords the user reads and
edits under a per-card save session, and an in-progress card for the
open region. It gives a close's metadata a place to be seen and
corrected, and it's the host 5.10, 5.11 and 5.12 flip their actions on.

## Background

The Timeline is a single-pane route: cards in `sequence_number` order,
then a last card for the open region, which has no row. One card is
expanded at a time, and its editor is a row save session like World's
and Plot's, so a Save is one `updateChapter` under one `action_id` with
source `user_edit`. Only the reader binds CTRL-Z, so that's where an
edit reverses. Everything here runs on seeded chapters and needs no
close. `Close chapter…`, `Delete…` and `Review changes` belong to later
slices and ship disabled or hidden, per C16.

## Required reading

- [`chapter-timeline.md → Layout`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#layout)
- [`chapter-timeline.md → Per-chapter card`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#per-chapter-card),
  through
  [`Save session — per card`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#save-session--per-card)
- [`chapter-timeline.md → In-progress chapter card`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#in-progress-chapter-card)
- [`chapter-timeline.md → Empty state`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#empty-state),
  [`Top-bar`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#top-bar)
  and
  [`Mobile expression`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#mobile-expression)
- [`save-sessions.md → Save bar`](../../../../ui/patterns/save-sessions.md#save-bar--the-visible-ui)
  and
  [`Navigate-away guard`](../../../../ui/patterns/save-sessions.md#navigate-away-guard--global-intercept)
- [`touch.md → Save bar on phone`](../../../../ui/foundations/mobile/touch.md#save-bar-on-phone)
- [`principles.md → Edit restrictions during in-flight generation`](../../../../ui/principles.md#edit-restrictions-during-in-flight-generation)
  and
  [`Universal in-story chrome`](../../../../ui/principles.md#universal-in-story-chrome)
- [`actions-menu.md → Contextual zone`](../../../../ui/patterns/actions-menu.md#contextual-zone)
- [`reader-composer.md → Top-bar — in-world time display`](../../../../ui/screens/reader-composer/reader-composer.md#top-bar--in-world-time-display)
- [`collapse.md → Single-pane surfaces`](../../../../ui/foundations/mobile/collapse.md#single-pane-surfaces--no-collapse)
- [`milestone.md → C5`](../milestone.md#c5--token-reads-and-the-progress-hook),
  [`C15`](../milestone.md#c15--entry-jump-and-chapter-time-ranges),
  [`C16`](../milestone.md#c16--flip-rule) and
  [`C8`](../milestone.md#c8--seed-stability), which this slice consumes
- [`milestone.md → C4`](../milestone.md#c4--close_report-v1),
  [`C7`](../milestone.md#c7--chapter-overlays) and
  [`C13`](../milestone.md#c13--chapter-delete), for what the card hosts
- [Milestone 4 → C12 — Keyword normalizer](../../04-world-plot-read-surfaces/milestone.md#c12--keyword-normalizer)
- [Slice 5.3 → Scope: in](./03-reader-chapters.md#scope-in) for
  `readerHref`, `useChapterTimeRanges`, `chapterTimeRangeLabel` and the
  popover's `Manage chapters →` callback
- Lessons:
  [No harmless id leaks](../../../lessons-learned/no-harmless-id-leaks.md),
  [Save-session story harness](../../../lessons-learned/save-session-harness-sync-refresh.md),
  [Storybook viewport and `useTier`](../../../lessons-learned/storybook-viewport-usetier-async.md),
  [Portaled overlays](../../../lessons-learned/portaled-overlay-outlives-screen-focus.md)

## Scope: in

**The route and its plumbing.**

- `app/chapter-timeline/[branchId].tsx`, wired as
  `app/plot/[branchId].tsx` is: `useColdOpenStory`,
  `useStoryLeaveGuard`, `useStoryGenerationGate(storyId, branchId)`,
  `useRowSessionGuard`, `useMasterDetailBack(true, …)`,
  `StoryStatusPill`, and `AppActionsMenu` with
  `surface: 'chapter-timeline'` and no `contextual`, since
  `actions-menu.md` leaves that zone empty. Breadcrumb
  `<story-title> / Chapters`, no `centerExtras`, the cards in a
  `KeyboardInsetColumn` around a scroller, column capped as the
  wireframe's `.timeline-col`.
- `chapterProgress` takes `useChapterProgress(storyId)` (C5), making
  this the fifth route on it, with no `onChapterProgressPress`: the
  popover is reader-only chrome.
- `hooks/use-story-leave-guard.ts`: `IN_STORY_ROUTES` gains
  `chapter-timeline/[branchId]`, or a pop onto the Timeline during a
  run raises a false abort-confirm.
- `components/compounds/go-to-group.ts`: `chapter-timeline` gets
  `route: (story) => /chapter-timeline/<branchId>`. No surface is
  unbuilt after that, so `SurfaceEntry`'s `landsLater` arm, the disabled
  branch in `buildGoToGroup` and `chrome.goTo.chapterTimelineLandsLater`
  all go.
- `hooks/use-cold-open-story.ts`: `surface` gains `'chapter_timeline'`,
  in snake case. The value lands in a log event name, and
  `EVENT_NAME_REGEX` (`lib/diagnostics/kinds.ts:18`) warns on a hyphen.
- A `chapters` i18n namespace, unless 5.3 made one:
  `locales/en/chapters.json`, `resources` and `ns` in
  `lib/i18n/i18n.ts`, and `NAMESPACES` in `e2e/harness/i18n.ts`.

**The save path.**

- `lib/chapters/chapter-draft.ts`: `chapterDraftSchema`, with title and
  summary required after trimming, as lore's title and body are, and
  theme free to go blank; `EMPTY_CHAPTER_DRAFT`; `chapterDraftFrom`; and
  `chapterActions`,
  which returns one `updateChapter` with source `user_edit` holding the
  changed columns, or nothing. Keywords go through `dedupeTerms` as
  `lorePatch` does (`lib/world/lore-draft.ts:63-65`), per M4's C12:
  padding and repeats aren't edits, and a re-cased term is. These take
  `Pick<Chapter, …>`, not `Chapter`, because C4 moves the store row's
  type and 5.2 may land on either side of this slice. `lib/chapters`
  gains only `zod`, `lib/keyword-terms` and type imports. It has no
  runtime edge to `lib/world`, whose `sameList` stays out of reach,
  since `lib/retrieval` and `lib/pipeline` import this module.
- `lib/actions/row-save/commit-row-save.ts`: `RowSaveKind` gains
  `'chapter'`. `saveChapter` in `lib/actions/chapters/save-chapter.ts`
  follows `saveLore`, with `idPrefix: 'chap'` and `flatRowSaveResult`,
  and is exported from `lib/actions/index.ts` with `ChapterSaveResult`.
  Its log events, `action_layer.chapter_save_rejected` and
  `action_layer.chapter_save_failed`, follow from `rowKind`.
- `lib/actions/chapters/register.ts:105-106`: the update handler's
  not-found return carries `code: TARGET_NOT_FOUND`, as `updateLore`'s
  does (`lib/actions/lore/register.ts:108-112`). Without it a Save on a
  row that went reads `failed`, not `not-found`.
- `useChapterRowSession` in `components/chapters/`, shaped as
  `useLoreRowSession`: `onSession` hands the route its handle, a landed
  save toasts, and a refused one toasts too, since the bar's notice has no
  visible text on phone.
- That session is hosted at the card list, above every card, for the
  route's whole life, so the phone bar can sit outside the scroller. With
  no card open, the empty state included, it holds the reserved `rowKey`
  `none` and `EMPTY_CHAPTER_DRAFT`, as lore's `create:` keys and
  `EMPTY_LORE_DRAFT` do. No field renders, so nothing can dirty it,
  `RowSaveBar` renders nothing and no write can start. Opening a card
  sets `rowKey` to the chapter id, which resets the form. A host mounted
  only while a card is open would have to wrap the scroller, remounting it
  on every toggle, or feed the phone bar across a portal.
- `components/chapters/chapter-copy.ts` holds the field labels, issue
  text, refusal text and token labels.

**The cards.** All in `components/chapters/`, props in, no store reads,
so stories run without a database.

- `ChapterCard`, collapsed: `Chapter <N> — <title>` with a disclosure,
  then `<time range> · <token count> · <theme>`, with the token count
  compact (`12.4k tok`) and theme as plain text. The whole head presses,
  with `aria-expanded`. `ExpandableRow` isn't usable: it requires
  `onRemove` and expands a multi-set (`expandable-row.tsx:18,65`).
- `ChapterCard`, expanded: Title and Theme in `Input`, Summary in a
  `Textarea` of four to six rows, Keywords in `TagInput`, all under
  `FormRow`. Read-only beside them: time range, the full token count,
  `closed_at` through the `relativeTime.dateWithYear` key, and
  `entries <a>–<b>` from `useEntryIndex(branchId)` positions. A not-ready
  or failed index drops the entry range and blocks nothing else.
- `components/chapters/chapter-timeline-data.ts`, pure, as
  `components/plot/plot-route-data.ts` is, turns the branch's rows, C15's
  ranges, the entry index and the calendar frame into card props:
  `sequence_number` order, the latest flag, the entry range, and each
  time label through 5.3's `chapterTimeRangeLabel`. The route builds the
  frame as `components/reader/world-time-editing.ts:42-48` does. A format
  miss drops the label.
- `useTimelineTimeRanges(branchId, focused)` in `components/chapters/`
  wraps 5.3's `useChapterTimeRanges`, so the route calls its `refetch()`
  on each return to focus, per C15. The app's query client never goes
  stale (`lib/cache/query-client.ts`), and a world-time edit moves neither
  part of the key, so flipping `enabled` alone would read nothing.
- `Chapters · <N> closed + 1 in progress` above the cards, counting the
  branch's rows, and the in-progress card alone when there are none.
- `ChapterInProgressCard`, taking `useChapterProgress`'s return:
  `In progress · since <start time>` from C15's null chapter, with no
  `since` when that read has no time; `<current> / <threshold> tok` and a
  thin bar in the strip's tone, sharing 5.3's tone classes rather than
  copying them; the italic placeholder; and `Close chapter…`, full-width
  on phone, disabled with a reason. It doesn't expand.

**One card expanded at a time.**

- A pure `nextExpandedChapter` in `components/chapters/` decides the
  expanded id, so its rules are unit-tested. An id whose row left the
  store is dropped, not kept for a redo to revive. New means above a
  baseline: the highest `sequenceNumber` seen when the route first has
  rows, rising as later chapters land, so each expands at most once. The
  first rows a mounted route sees expand nothing, or a reload would pop an
  editor open unasked, the trap `expandable-row.tsx:13-16` names. A new
  chapter then expands by the default under
  [Open questions](#open-questions).
- Every transition goes through `useRowSessionGuard`'s `guard`:
  expanding another card, collapsing the open one, `Jump to chapter →`,
  `←`, the breadcrumb, GO TO and the Story Settings icon.
- `RowSaveBar` sits at the card's bottom edge on tablet and desktop, and
  by the default under [Open questions](#open-questions) below the
  scroller on phone, with `enabled` from route focus for Cmd/Ctrl-S.
  `RowLeaveDialog` answers the guard. A Save asks no question, so
  `RowConfirmDialog` isn't mounted.

**The action row.** One list of entries per card, so each flip in C16
is a line or two.

- `Jump to chapter →` is live and calls
  `navigateGuarded(readerHref(branchId, startEntryId))` (C15).
- `Regenerate summary` is disabled with a reason until M7.2.
- `Delete…` shows on the latest chapter's card only, by highest
  `sequenceNumber` on the branch, disabled with a reason until 5.12
  (C13, C16).
- `Review changes` isn't rendered. 5.11 adds it behind `hasCloseReport`
  (C16's hidden exception), so this slice reads no report state.
- On phone, `Jump to chapter →` keeps its label and the rest move behind
  an `OverflowMenu`, with `destructiveEntry` for `Delete…`.

**Flips and canon.**

- The reader route passes the popover's `Manage chapters →` callback,
  navigating to `/chapter-timeline/<branchId>`, which flips it on desktop
  and in the phone Sheet (C16).
- `chapter-timeline.md`: the head's reach line gains the Actions menu's
  `Open Chapter Timeline`; the head's Actions-menu bullet stops claiming
  close, re-open and jump commands; the Layout sketch's `←` moves left;
  the time range and its sketches read as `chapterTimeRangeLabel` writes
  them; the in-progress row and placeholder settle; the gating bullet
  names what a run disables; the in-card save-bar paragraph (`:159-163`)
  and the phone save-bar line (`:480-485`) stop contradicting `touch.md`;
  and, if 5.3's chip stays static, `Jump to chapter →` loses
  its chip-highlight sentence. Each follows
  [Open questions](#open-questions).
- `chapter-timeline.html`, in the same commit: `←` on the left, the head
  without its number column, the in-progress card, the strip's tones,
  ranges, and the fields in the in-flight state.
- `save-sessions.md → Where applied`: the guard fires, it doesn't block,
  and the phone bar's position.
- `principles.md → What's gated`: chapter metadata joins the list,
  matching `commitRowSave`'s refusal.
- `generation-status-pill.md`: "Chapter Timeline is unwired" and "Done
  for Reader, World, Plot and Story Settings" flip.
- `docs/observability.md`: `chapter_save_rejected`,
  `chapter_save_failed`, `chapter_timeline_story_not_found` and
  `chapter_timeline_story_load_failed`.
- `component-inventory.md`: shipped rows for both cards.
- `parked.md → Unsaved-changes guard folder placement` goes: it waited
  on these cards, and the dialog already sits in `components/compounds/`.

**Stories and locators.** `chapter-card.stories.tsx`,
`chapter-in-progress-card.stories.tsx`, `e2e/locators/chapter-timeline.ts`,
and `goToChapterTimelineRow` in `e2e/locators/chrome.ts`.

## Scope: out

- `Close chapter…`'s action, the modal, `STORY TOOLS` and the
  availability predicate ([Slice 5.10](./10-two-starts.md)).
- `Review changes`, the review window and any `hasCloseReport` read
  ([Slice 5.11](./11-review-window.md)).
- `Delete…`'s action and confirm
  ([Slice 5.12](./12-chapter-delete-rollback.md)).
- `Regenerate summary`'s run (M7.2): canon doesn't specify it.
- Timeline commands in the Actions menu's contextual zone, which
  `actions-menu.md` leaves empty.
- The jump itself, the `entry=` param, the time-range read, the strip's
  tone, tooltip and press, and what the chapter chip highlights on
  arrival ([Slice 5.3](./03-reader-chapters.md)).
- `useChapterProgress` and `chapterProgressTone`
  ([Slice 5.1](./01-token-measure.md)).
- What `chapters.token_count` means after an edit in a closed chapter:
  [Slice 5.1 → Implementation notes](./01-token-measure.md#implementation-notes).
  The card shows the stored column.
- A CTRL-Z binding on this route: the key stays the reader's.
- `chapter-timeline.md`'s modal, review-window and delete sections, and
  their wireframe rows, which 5.10, 5.11 and 5.12 own.
- Chapter merge, split and bulk edits, which canon defers.

## Acceptance criteria

**Route.**

- `e2e/tests/chapter-timeline.spec.ts`: on the hero story, the Actions
  menu's `Open Chapter Timeline` lands on `/chapter-timeline/<branchId>`,
  showing `Chapters · 2 closed + 1 in progress` and the cards
  `Nine Days of Rain` and `The Keep Leans Closer` in that order above
  the in-progress card. Assertions go by title (C8).
- The same spec: `Manage chapters →` in the reader's popover reaches the
  route, and its lands-later reason is gone.
- `hooks/use-story-leave-guard.test.tsx`: the `it.each` of in-story
  routes includes `chapter-timeline/[branchId]`.
- `components/compounds/go-to-group.test.ts`: the entry routes to
  `/chapter-timeline/br_1`, and no entry is disabled.
  `grep -rn chapterTimelineLandsLater app components locales` finds
  nothing.
- `hooks/use-cold-open-story.test.tsx`: `'chapter_timeline'` logs
  `app.chapter_timeline_story_not_found`, which matches
  `EVENT_NAME_REGEX`.

**Save.**

- `e2e/tests/chapter-timeline.spec.ts`: editing the title and adding a
  keyword on `The Keep Leans Closer`, then Save, leaves both on the
  `chapters` row and exactly one new `deltas` row, with
  `target_table = 'chapters'` and `source = 'user_edit'`. CTRL-Z in the
  reader restores both columns.
- `lib/chapters/chapter-draft.test.ts`: `['  Amulet ', 'amulet', 'Keep']`
  saves as `['Amulet', 'Keep']`; padding and repeats alone produce no
  action; a re-cased term does; an unchanged draft returns no actions; a
  blank title or summary fails the schema and a blank theme passes.
- `lib/actions/chapters/save-chapter.test.ts`: a blocked gate returns
  `in-flight` and writes no delta; a gone row returns `not-found`; on a
  row at `embedding_stale = 0`, a title save leaves it and a summary save
  sets it. It starts at 0 because seeded rows start stale.

- `components/chapters/use-chapter-row-session.test.tsx`: each refusal
  code reads its translated text, a throwing `onSaved` doesn't read as a
  failed save, and the handle reaches `onSession` and clears on unmount.
  With no card open the session is clean under the reserved key and
  `requestLeave` proceeds at once, and opening a card loads its row.

**One card, and the guard.**

- `e2e/tests/chapter-timeline.spec.ts`: with a dirty card, expanding
  another raises `Unsaved changes`; Cancel keeps the card and its text;
  Discard switches. Collapsing the dirty card and pressing
  `Jump to chapter →` each raise it too.
- `components/chapters/chapter-expansion.test.ts`: the first rows a
  mounted route sees expand nothing; an expanded id is dropped when its
  row goes and doesn't come back with the row; a chapter above the
  baseline expands once, only with no run and no dirty card; a dirty card
  never loses expansion to it.
- `chapter-card.stories.tsx`, play: a `Blocked` story shows the fields
  and Save disabled with the reason, and Discard and
  `Jump to chapter →` live. An invalid draft disables Save with its
  reason and leaves Discard live.

**Cards.**

- `chapter-card.stories.tsx`, play: the latest card shows
  `Jump to chapter →`, `Regenerate summary` and `Delete…`, the last two
  disabled with their reasons; an earlier card has no `Delete…`; neither
  has `Review changes`. At 390 px, `Jump to chapter →` keeps its label
  and `⋯` lists the rest.
- `chapter-in-progress-card.stories.tsx`, play: one story per tone
  renders `14,200 / 24,000 tok` with its bar; `since` is absent on a null
  time; `Close chapter…` is disabled with a reason; nothing expands. The
  empty-state story renders `Chapters · 0 closed + 1 in progress`.
- `components/chapters/chapter-timeline-data.test.ts`: rows come back in
  `sequence_number` order whatever the store's order, another branch's
  row is dropped, only the highest sequence is latest, a chapter missing
  from the ranges or missing a format has no time label, and an entry id
  absent from the index gives no entry range.
- `components/chapters/use-timeline-time-ranges.test.tsx`, on
  `createQueryClient()`: a return to focus on an unchanged key shows the
  changed read. A bare `new QueryClient()` has `staleTime: 0` and would
  pass with no `refetch()`.
- `components/chapters/chapter-copy.test.ts`: `12400` reads `12.4k tok`
  and `840` reads `840 tok`.
- The E2E spec: `Jump to chapter →` from a closed card lands on the
  reader with the row for that chapter's `start_entry_id`, read from the
  DB, in view.

**Canon.**

- Each of these greps finds nothing: `re-open`,
  `Hides while the keyboard` and `chrome at the screen edge` in
  `chapter-timeline.md`, `unwired` in `generation-status-pill.md`, and
  `is blocked` in `save-sessions.md`. `grep -E 'Day [0-9]+–[0-9]+'` finds
  nothing in the Layout sketch.
- `chapter-timeline.html`, opened in a browser, shows `←` on the left, and
  with `in-flight` selected the inputs read disabled and
  `Jump to chapter →` stays live. `component-inventory.md` lists both
  cards as shipped.

**Gates.**

- `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, `pnpm format:check`,
  `pnpm compiler:check` and `pnpm test:run` pass, and
  `pnpm test:e2e -- chapter-timeline.spec` passes after `pnpm build:web`.
- Manual on the Android dev client at phone width: `⋯` opens its Sheet,
  and typing in Summary keeps the field and the save bar above the
  keyboard.
- Desktop smoke through the `electron-app` MCP: a reload on the route
  comes back to it, and with a turn running the pill names its phase and
  cancels it, and the banner shows.

## Tests

- **Unit, `--project unit`.** `chapter-draft`, `save-chapter`,
  `chapter-expansion`, `chapter-timeline-data`, `chapter-copy`,
  `go-to-group`, and `commit-row-save` for the new kind.
- **Hook.** `use-chapter-row-session`, new, on
  `components/world/use-lore-row-session.test.tsx`'s shape;
  `use-timeline-time-ranges`, new, on the app's query client; and
  `use-story-leave-guard` and `use-cold-open-story`, extended.
- **Storybook, browser project.** Both cards at desktop and at 390 px
  through the viewport, not a narrow wrapper. The harness refreshes data
  synchronously, per the session lesson, and wraps tier assertions in
  `waitFor`.
- **E2E.** `e2e/tests/chapter-timeline.spec.ts` on the seeded hero story:
  route, save and undo, guard, jump. Drive through the UI, assert the DB.
  It reads `start_entry_id` from the DB and hard-codes no entry position,
  since 5.2 moves the seed's chapter ends (C8).
- **Mutation check.** The expansion rules and the keyword no-op are the
  assertions most likely to pass vacuously. Break each once and see the
  test fail.

## Open questions

Each has a default this doc builds on. Slice planning confirms it, and
any change amends the scope above.

- **What expands after a close?** Canon expands the new card "by
  default", which for a close started elsewhere, or over a dirty card,
  would raise the guard unprompted. Default: a new latest chapter expands
  once no run is in flight, only with no card dirty, and it never raises
  the guard. A close's row appears before its run ends and can reverse,
  so the row's arrival alone can't be the trigger. New is measured from
  the rows the route first has, so a story's first chapter, landing under
  an empty Timeline, stays collapsed.
- **Where does the save bar sit on phone?** `chapter-timeline.md` says it
  hides under the keyboard. `touch.md` reversed that in M4.4, and a bar
  inside the scroller can't ride the keyboard. Default: on phone the bar
  is a sibling of the scroller inside `KeyboardInsetColumn`, where
  `save-sessions.md` puts every other bar, and tablet and desktop keep it
  in the card. The session already sits above the card, so nothing else
  moves. Does the developer accept the bar moving by tier?
- **What does a run disable?** The `.md` says card edits; the wireframe
  says Save, `Delete…` and `Close chapter…`. Default: the fields and Save,
  as World and Plot do, plus those two actions. `Jump to chapter →` and
  expand or collapse stay live, since navigation and reads aren't gated.
- **How does a time range read?** The sketches show `Day 2–3`, but the
  formatter's output is opaque, so only identical strings can collapse.
  The `.md` writes `<start time> – <end time>`, and 5.3's
  `chapterTimeRangeLabel`, the one function both surfaces share, writes
  `<first> → <last>`. Default: the function's form, one label when they
  match and nothing with no world time, with the `.md` corrected to it.
- **Which wins where the `.md` and wireframe differ?** Default: the `.md`
  for the head, `Chapter <N> — <title>`; the `.md`'s in-progress row
  without a title placeholder; the wireframe's fuller placeholder,
  `Summary, theme, and keywords generate on close.`; and full numbers on
  the in-progress card, matching the popover's label.
- **May a theme be blank?** Canon calls it a free-form tag and the column
  is `NOT NULL`. Default: yes, stored as an empty string, which also drops
  it from the collapsed line.

- **How does a rollback count a user's chapter edit it sweeps?**
  [Slice 5.2](./02-first-chapter.md) made `rollbackCountsOf` count a
  `chapters` delta only as a create (developer decision), so a close's
  `close_report` update no longer reads as world state. A user's own
  `updateChapter` (a title or summary save, anchored on no entry) on a
  chapter the rollback spares is still reverted by its log position, and
  the confirm modal now reports nothing for it. Suggested: count a
  non-create `chapters` delta when its chapter's create isn't in the
  swept set, which keeps the close's report silent.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
