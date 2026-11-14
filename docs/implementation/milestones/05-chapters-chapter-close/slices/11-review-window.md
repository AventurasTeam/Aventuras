# Slice 5.11 — Review window

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.2](./02-first-chapter.md) (`close_report`,
  `hasCloseReport`, the seed's close shape),
  [Slice 5.3](./03-reader-chapters.md) (the entry jump),
  [Slice 5.5b](./05b-identity-threads.md) (real calls in a real report),
  [Slice 5.7](./07-chapter-timeline.md) (the card hosting
  `Review changes`)
- **Blocks:** [Slice 5.10](./10-two-starts.md), which builds its modal
  host on this slice's store, and [Slice 5.13](./13-close-rerun.md),
  which opens its re-run confirm from the review window

## Goal

The user sees what a close changed. This slice ships the review window,
the root host and overlay store it opens through, the commit banner
with `Review`, and `Review changes` on the Timeline's card. It should
run beside [Slice 5.8](./08-prose-tasks.md) and
[Slice 5.9](./09-chapter-wide-tasks.md), so `close_report` meets its
only reader while the tools can still adjust.

## Background

A close has no suggestion queue, so the user reviews it afterwards, in
a read-only window that never opens by itself. The window joins two
sources: `chapters.close_report` holds each tool call's rows, `why`,
`turns`, result and new values, and the deltas under the close's
`action_id` hold the old values. Every close delta anchors on the end
entry, so a row's cited entry comes from the report, never from
`delta.entryId`. The report stays out of `chaptersStore`, which holds
only `hasCloseReport`, so the window reads it when it opens. The host
sits above the router, because the banner's `Review` fires on whichever
screen is up.

## Required reading

- [`chapter-timeline.md → Review window`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#review-window)
  in full, with its sketch, and the wireframe's review block in
  [`chapter-timeline.html`](../../../../ui/screens/chapter-timeline/chapter-timeline.html).
- [`chapter-timeline.md → Per-card actions`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#per-card-actions)
  and
  [`Mobile expression`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#mobile-expression)
  — `Review changes`, its phone overflow entry, the Sheet.
- [`chapter-close.md → Review`](../../../../memory/chapter-close.md#review)
  — what the report holds, what's left out, the not-applied rule.
- [`chapter-close.md → Tools and writes`](../../../../memory/chapter-close.md#tools-and-writes)
  and
  [`When a task stops`](../../../../memory/chapter-close.md#when-a-task-stops)
  — the three results, and what `stopped` reports.
- [`chapter-close.md → Logs and anchors`](../../../../memory/chapter-close.md#logs-and-anchors)
  — why every delta names the same entry.
- [`reader-composer.md → During a memory update`](../../../../ui/screens/reader-composer/reader-composer.md#during-a-memory-update)
  and [`toast.md → Action button`](../../../../ui/patterns/toast.md#action-button)
  — the commit notice, which shipped as a banner, not a toast.
- [`delta-log-row.md → Compound API`](../../../../ui/patterns/delta-log-row.md#compound-api)
  and
  [`Click behavior`](../../../../ui/patterns/delta-log-row.md#click-behavior)
  — the compound this slice extends.
- [`layout.md → Stacking`](../../../../ui/foundations/mobile/layout.md#stacking)
  and
  [`Surface bindings`](../../../../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces)
  — Modal on desktop, Sheet (tall) on phone, dismiss then navigate.
- [`save-sessions.md → Navigate-away guard`](../../../../ui/patterns/save-sessions.md#navigate-away-guard--global-intercept)
  — what a row press must not bypass.
- [`architecture.md → Delta history diff resolution`](../../../../architecture.md#delta-history-diff-resolution)
  — why a delta can't give the new value.
- [`code-conventions.md → State placement`](../../../../code-conventions.md#state-placement).
- [`testing.md → Selector strategy`](../../../../testing.md#selector-strategy).
- Lessons:
  [`no-harmless-id-leaks.md`](../../../lessons-learned/no-harmless-id-leaks.md#how-to-apply),
  [`rn-primitives-portal-context.md`](../../../lessons-learned/rn-primitives-portal-context.md#two-patterns-that-work),
  [`portal-owner-mount-is-not-open.md`](../../../lessons-learned/portal-owner-mount-is-not-open.md#how-to-apply).
- Milestone contracts:
  [C1](../milestone.md#c1--a-closes-delta-shape),
  [C4](../milestone.md#c4--close_report-v1),
  [C7](../milestone.md#c7--chapter-overlays),
  [C8](../milestone.md#c8--seed-stability),
  [C11](../milestone.md#c11--tool-results),
  [C15](../milestone.md#c15--entry-jump-and-chapter-time-ranges),
  [C16](../milestone.md#c16--flip-rule).

## Scope: in

**Reads,** in `lib/history/close-read.ts`. This module, not
`lib/chapters`: `lib/history` already imports `lib/actions`, while
`lib/chapters` stays a near-leaf that `lib/pipeline` and `lib/retrieval`
import.

- `readCloseReport(db, branchId, chapterId)`: the row's column, parsed
  by the schema in `lib/db/story-entries/close-report.ts`, null on a
  chapter no close wrote. A report failing the schema throws.
- `loadCloseDeltas(db, branchId, chapterId, actionId)`: the by-action
  read. `deltas` has no `action_id` index, so it first takes the
  chapter's own lowest and highest `log_position` under the action
  through `deltas_chain_idx`. Those are the `chapters` create and the
  `close_report` update, the group's first and last deltas (C1). It
  then reads that range through `deltas_log_position_uniq`, filtered on
  `action_id`, skipping `story_entries` targets, in log order. Redo
  re-inserts deltas at their own positions
  (`lib/actions/delta/redo.ts:288-291`), so the range survives a
  CTRL-Z and redo.

**The review model,** `buildCloseReview` in
`lib/history/close-review.ts`, pure over the report, the deltas and a
lookup of names and kinds the host passes.

- **Rows come from `report.calls`.** The deltas only supply old values,
  so a delta with no call is never a row. That leaves out stamps,
  `retrieval_count` resets, normalization and a merge's link rows by
  construction, and no filter can miss one.
- **Changes** read only landed calls, those with `result: 'ok'`. A
  landed `update` is one row per landed field: the keys of `values`,
  less the `skippedFields` entries, on `rows[0]`. Its target line is the
  report's name and `fieldPathLabel(table, path)`, and its summary is
  `old → new`. A landed `create_lore` is one row with `values.body` as
  its summary. A landed call carrying `survivor` is one `delete` row per
  absorbed row (its `rows` less the survivor), plus one `update` row per
  `values` field on the survivor. Each row carries the call's `why` and
  the latest of its `turns` by entry position.
- **Omitted:** an `ok` call with no field and no `survivor`, per C4,
  which also drops the reads, since the ledger records one as `ok` with
  no `values`. A redundant-row merge can land with no `values`, and its
  `survivor` keeps it.
- **Old values** pair from the tail. The kth-from-last landed write of
  a field on a row pairs with the kth-from-last delta naming that path
  on that row, read through `changedPaths`, and a `values` key is that
  delta path (C4). A merge's link-row delta has no call of its own, and
  Happenings runs first, so it drops as a leading extra. A field two
  parts wrote still pairs each write with its own delta. With no
  matching delta the summary is the new value alone. Old values aren't
  cut: the log is their only copy, and canon's answer to no per-change
  revert is that the old value is on screen. New values show as the
  report holds them, cut by its writer.
- **Rendering an old value.** A string as stored, a list joined by
  commas, a row id through its store's name, an entry id through
  `formatEntryRef`.
- **Areas,** in canon's order, empty ones omitted: Lore (`lore`),
  Characters and factions (`entities` of kind `character` or `faction`),
  Places and items (`location` or `item`), Threads, Happenings, Awareness
  (`happening_awareness`). Rows keep run order inside an area. An entity
  absent from its store takes its kind from its latest delete delta,
  read as `lib/history/link-ends.ts:267-285` reads names: it sorts in
  code, since an `ORDER BY log_position` scans the branch.
- **Names** are the report's, as they stood at the close.
- **Not applied,** derived on read by canon's rule. A `rejected` or
  `skipped` call yields one row per field of its `values`, and an `ok`
  call one per `skippedFields` entry. A field is dropped when the same
  `task`, in any later call of the run, landed the same `tool` on the
  same row and field. A refused call with no `values`, a merge's
  included, is one row by its `tool` and rows. It drops once the same
  `task`, in a later call, lands the same `tool` on a row the two calls
  share, or that `tool` at all when it has no rows. A call the common
  checks refused records every id argument as its rows, and a landed
  call the rows its tool picks, so one shared row is the match. Known
  cost: a value-less slip the model never retried is hidden once that
  task lands the same tool for something else, on one of its rows or,
  with none, anywhere; it held nothing to apply. A refused merge carries
  no `survivor` and is always one row by its `tool` and rows, with its
  proposed text as the summary, whatever `values` holds. A later landed
  merge by that task over the same rows drops it. A refused
  `create_lore` shows its title. Its minted id is one no retry shares,
  so it matches a later landed `create_lore` by that task with the same
  title, trimmed and case-folded (C4), and a corrected create drops out.
  Each row shows the proposed value and its reason, the field's own in
  `skippedFields`, which a `rejected` or `skipped` call carries only
  when its fields were lost for different reasons (C4), or else the
  call's: `USER_EDITED_SINCE_PROSE`, `later-turn` and `row-gone` through
  `t()` keys, and every refusal through its stable key's label. A stored
  reason that isn't a key reads `other`.
- **Stopped early.** One line per `stopped` entry: the task's label, its
  part unless the part is 0, and the reason, for `budget`, `window` and
  `cut-off`. `noToolCalls` adds canon's note there.

**`DeltaLogRow` extension,** in
`components/compounds/delta-log-row.tsx`, leaving its current default
shape as it is:

- `footer?: ReactNode`, rendered under the row and **outside** its
  `Pressable`, aligned to the summary column, so the entry link is never
  an interactive nested in `accessibilityRole="button"`.
- `showMeta?: boolean`, default true, which drops the meta line.
- `summaryLines?: number | null`, default 2, with null for no clamp. The
  review passes null, since a two-line clamp on `old → new` hides the new
  value.

**The window,** `ReviewWindow` in
`components/chapters/review-window.tsx`, a pure view taking the model.

- Dispatches on `useTier()`, as `OverflowMenu` does: a `Dialog` whose
  `DialogContent` sets `scrollable={false}` above phone, a `Sheet` with
  `SheetContent size="tall"` on phone. The head stays pinned and the list
  scrolls in `ContextScrollView`, so gorhom owns the gesture on native.
- Title `Review — Chapter <N>: <title>`, from the store row. Foot `Done`.
- Order: Stopped early, not folded; Not applied, a collapsed `Accordion`
  headed `Not applied (<count>)`, omitted at zero; then Changes by area.
- Each Changes row is a `DeltaLogRow` with `showMeta={false}`,
  `summaryLines={null}`, and a footer holding `why` and the
  `entry #n →` link, labelled through `formatEntryRef`. The link meets
  the 44 px floor on phone.
- Each Not applied row is the same row, with the proposed value as its
  summary, the reason in its footer and no entry link, as the wireframe
  draws it.
- Loading, failed with Retry (a read error, or a report failing its
  schema, logged through `logger`), and an empty state for a report with
  nothing to show.
- All reads resolve in the host, above the portal, and reach the view as
  props: `useEntryIndex`, the queries and the row stores. A gorhom Sheet's
  content sees no outer provider.

**Press routing,** `reviewRowHref` in
`components/chapters/review-row-href.ts`:

| Row                   | Target                                            |
| --------------------- | ------------------------------------------------- |
| `lore`, `entities`    | `railRowHref`, by `lore` or the entity's kind     |
| `threads`             | `railRowHref`, `thread`                           |
| `happenings`          | `railRowHref`, `happening`                        |
| `happening_awareness` | `plotHref`, the parent happening, tab `awareness` |
| A landed merge's row  | An absorbed row presses to its `survivor`         |

A Changes row and a Not applied row press by the same rules (see
[Implementation notes](#implementation-notes)). A target absent from its store
doesn't press, whichever row names it: a row since deleted, a survivor
since deleted, or a refused `create_lore`, which has no row. A later
merge's survivor isn't followed. Liveness reads the stores reactively, so a row
that goes under an open window stops pressing. The entry link is
`readerHref(branchId, entryId)` from
[Slice 5.3](./03-reader-chapters.md) (C15).

**Overlay store and host (C7).**

- `lib/stores/ui/chapter-overlays.ts`, on the `@/lib/stores` barrel and
  in `resetAllStores`, as `chapterOverlaysStore`. It exposes
  `openCloseModal({ branchId, endEntryId? })` and
  `openReviewWindow({ chapterId })` as C7 pins, `closeReviewWindow()`, and
  `registerSurface` below. `openCloseModal` runs the registered surface's
  guard before it sets its state, so no trigger can skip it, and with no
  surface it sets it at once. That state has no reader until
  [Slice 5.10](./10-two-starts.md).
- `ChapterOverlaysHost` in `components/chapters/chapter-overlays-host.tsx`,
  mounted beside `<MemoryRunToasts />` (`app/_layout.tsx:116-117`), inside
  `BottomSheetModalProvider`. This slice renders the review; 5.10 adds the
  modal.
- **One derived rule covers a reversal and a stale banner.** The host
  selects the chapter by the open id from `chaptersStore`. When that row
  is absent or `hasCloseReport` is false, it clears the id in an effect
  and renders nothing. The id is pruned, not hidden: a redo restores the
  same chapter id, and the window must not reopen by itself.

**Surface guard registration.**

- `registerSurface({ guard, navigate })` returns its own unregister. The
  latest registration wins, and a stale unregister does nothing.
- `useOverlaySurface(guard?)` in `hooks/use-overlay-surface.ts` registers
  in `useFocusEffect`, and re-registers when `guard` changes. It's focus,
  not mount, since a Stack keeps pushed-under screens mounted. `guard`
  defaults to `(proceed) => proceed()`, per C7, a module constant so the
  default doesn't re-register on every render. `navigate`
  is the route's `useSurfaceNavigate`: the root host has no
  `NavigationContext`, so its own would push a second World over the first
  (`hooks/use-surface-navigate.ts:58-60`).
- Call sites: World, Plot and `app/chapter-timeline/[branchId].tsx` pass
  `useRowSessionGuard`'s `guard`, Story Settings passes
  `session.requestLeave`, and the reader passes nothing, having no pane
  to guard, so it takes the default.
- A press closes the window, then runs
  `surface.guard(() => surface.navigate(href))`. Closing first keeps the
  stack flat: the guard's dialog never sits over the window, and the
  Sheet dismisses before the route moves. Cancel at the guard leaves the
  user on their pane with the window closed. A second press during the
  Sheet's exit is dropped, as `ReaderBrowseChip` does.
- With no surface registered (App Settings, Diagnostics), the host's own
  `useSurfaceNavigate` pushes.

**Commit banner,** its result held by `hooks/use-memory-run-toasts.ts`.

- A `run_complete` for `CHAPTER_CLOSE_KIND` with `outcome: 'completed'`.
  The event names no chapter or branch (`lib/pipeline/types.ts:72-81`),
  so the handler takes the highest `sequenceNumber` in `chaptersStore`,
  reads its report, and goes on only when `report.actionId` equals the
  event's. It holds the result in `chapterOverlaysStore.closeResult`.
- The close's progress banner turns into the done state, `Chapter
closed: <title>` at the info tone. With stopped tasks it takes the
  warning tone, `Chapter closed, but <n> tasks stopped early`, with
  singular and plural keys. Both carry `Review`, calling
  `openReviewWindow({ chapterId })` and clearing the result, and ×.
- It stays until ×, `Review`, the chapter reversing, a newer close
  committing, or the story closing or switching branch. A later run's
  progress takes the slot while it runs, and the done state returns
  after.
- A failed report read logs and holds the info state.
- `beforeTurn` isn't read. Canon gives the commit notice no before-turn
  arm, so a close that commits under Send shows as any other. The
  failure toast's arm on it is [Slice 5.6](./06-close-owed.md)'s.

**`Review changes`,** flipped from hidden per C16. `ChapterCard` is
props-in, so the route's card data takes `hasCloseReport`, and the card's
one list of action entries gains the entry, behind `⋯` on phone, calling
`openReviewWindow({ chapterId })`, which on phone waits for the menu's Sheet
to finish dismissing. A running pipeline doesn't disable it:
the window writes nothing.

**Seed.** `chap_hero_2` gains a `closeReport` that parses by its schema,
with a landed change, a Not applied write and a stopped task. Its group
gains, after [Slice 5.2](./02-first-chapter.md)'s stamps and in C1's
order, one agent `update` and the `close_report` update, under
`act_chapter_2` and anchored on the end entry. `chap_hero_1` stays null, so a chapter no close wrote
stays covered. Ids, titles and positions don't move (C8).

**Chrome and canon.**

- Every new string routes through `t()`: the window in the `chapters`
  namespace [Slice 5.3](./03-reader-chapters.md) or
  [Slice 5.7](./07-chapter-timeline.md) registers, and the banner's copy beside
  `chrome.memoryUpdateFailed` in `locales/en/common.json`.
- `chapter-close.md → Review` says that a refused create matches a later
  landed create by the same task with the same title, trimmed and
  case-folded, since its minted id is one no retry shares.
- `delta-log-row.md → Compound API` and `Click behavior` gain the three
  props and the entry link.
- `component-inventory.md` gains shipped rows for the window and the
  host, and `DeltaLogRow`'s row names the new props.
- If the plan keeps pressable Not applied rows, `chapter-timeline.html`
  changes in the same commit.

## Scope: out

- Per-change revert, which canon excludes.
- The delta diff cache (M6.4). The review never derives a new value from
  the log.
- The `close_report` column, schema, writer and store projection
  ([Slice 5.2](./02-first-chapter.md)), and the ledger that fills it
  ([Slice 5.5a](./05a-task-runner.md)), except that the ledger now
  records a stable key for every refusal (see
  [Implementation notes](#implementation-notes)).
- Sizing `CLOSE_REPORT_VALUE_BOUND`
  ([Slice 5.5b](./05b-identity-threads.md)).
- The entry jump itself ([Slice 5.3](./03-reader-chapters.md)).
- The Timeline's route, card, per-card session and overflow
  ([Slice 5.7](./07-chapter-timeline.md)).
- The close modal, its host, and `Close chapter…` through the surface
  guard ([Slice 5.10](./10-two-starts.md)).
- The failure and deferred toasts, and `beforeTurn` on successors
  ([Slice 5.6](./06-close-owed.md)).
- What a chapter delete or divider-only removal does to the report
  ([Slice 5.12](./12-chapter-delete-rollback.md)). The host's rule closes
  the window either way.
- Translating the review (M8.1). It shows source-language values.
- Row History, which already hides resets and needs no change.

## Acceptance criteria

**Reads and the model.**

- `readCloseReport` returns the report, null on a chapter no close wrote,
  and throws on one failing the schema. `loadCloseDeltas` returns only the
  close's deltas: a title save on the chapter, another action's delta
  inside the range and every stamp are absent, and it returns the same
  rows after a CTRL-Z and redo (`lib/history/close-read.test.ts`).
- Rows come out in canon's area order, with the entity split by kind, and
  an entity deleted since keeps its area
  (`lib/history/close-review.test.ts`).
- Old values come from the deltas and new ones from the report. A field
  written in two parts pairs each write with its own delta, a write with
  no delta shows the new value alone, and a list, a row id and an entry id
  each render as text. A kept awareness row a merge took from 0.2 to 0.6
  and `set_pin` took from 0.6 to 0.9 reads `0.6 → 0.9` (same file).
- Stamps, resets, normalization deltas, a read tool, a restated field and
  an `ok` call with no field and no `survivor` produce no row, and a landed
  merge with no `values` does (same file).
- Not applied holds a refused write, drops one the same task later landed
  on that row and field, keeps one a different task landed, and lists a
  partly landed call under both sections. A known reason reads through its
  key, and a stored reason that isn't a key reads `other`. A `skipped` call whose fields were
  lost for different reasons shows each with its own (same file).
- A refused call with no `values` drops once its task lands the same
  tool on a shared row, or anywhere when it has no rows. An
  `update_lore` refused for an unread row, then landed after `read_row`,
  leaves no Not applied row. Neither does a `create_lore` refused for an
  empty `why`, then landed, nor a refusal naming two rows, a written row
  and a reference, followed by the same tool landing with one of them. A
  value-less refusal the task never retried stays (same file).
- A refused `create_lore` drops out when the same task later landed a
  `create_lore` titled `the tithe ` against its `The Tithe`, and stays when
  a different task did or the title differs. A refused merge holding
  `values` is one Not applied row, with its proposed text as the summary,
  and gives no `delete` row under Changes (same file).
- Stopped early names the task, the part and the reason, omits the part
  at 0, and carries the note on `noToolCalls` with no stopped task (same
  file).

**Press and guard.**

- A merge's absorbed row presses to its survivor, an awareness row to its
  parent happening's `awareness` tab, and a target absent from its store
  or a refused `create_lore` gives no href
  (`components/chapters/review-row-href.test.ts`).
- A press closes the window before running the guard, a guard that
  doesn't proceed doesn't navigate, a surface registered with the default
  guard, as the reader's is, navigates, and with no surface the host
  pushes (`components/chapters/chapter-overlays-host.test.tsx`).
- `registerSurface` is last-wins, a stale unregister leaves the newer
  surface in place, and `openCloseModal` runs the surface's guard before
  it holds its input, holding nothing when the guard doesn't proceed
  (`lib/stores/ui/chapter-overlays.test.ts`).
- `useOverlaySurface` registers on focus, drops it on blur, and
  re-registers when `guard` changes
  (`hooks/use-overlay-surface.test.tsx`).

**Reversal and the banner.**

- A chapter leaving the store closes the window, a redo of it doesn't
  reopen it, and `openReviewWindow` on an absent chapter renders nothing
  and leaves no id
  (`components/chapters/chapter-overlays-host.test.tsx`).
- A committed close holds its result, so the banner reads `Chapter
closed: <title>` at info with no stopped task, and the warning tone
  with its count otherwise, each with `Review` calling `openReviewWindow`.
  It holds with `beforeTurn` true and false, and an aborted or failed
  close, or a report whose `actionId` differs, holds nothing
  (`hooks/use-memory-run-toasts.test.tsx`). The banner shows a held
  result only while its chapter is the open branch's highest, and
  progress takes the slot while a run is live
  (`components/compounds/memory-run-banner.test.tsx`).

**Surfaces.**

- `e2e/tests/chapter-review.spec.ts`, by `pnpm test:e2e -- chapter-review`
  after `pnpm build:web`: `Review changes` shows on
  `The Keep Leans Closer` and not on `Nine Days of Rain`. The window lists
  the seeded report, and a row press lands on that row in World.
- The same spec: with that card dirty, a row press raises
  `Unsaved changes` before anything moves, Cancel stays on the Timeline,
  and Discard lands in World. The entry link lands the reader on the cited
  entry.
- `chapter-card.stories.tsx`, play: `Review changes` shows with
  `hasCloseReport`, stays absent without it, stays enabled in the `Blocked`
  story, and at 390 px sits behind `⋯`.
- `Compounds/DeltaLogRow`'s existing stories stay green, with new ones for
  `footer`, `showMeta={false}` and `summaryLines={null}`, and a play where
  a press on the footer's link doesn't fire the row's `onPress`.
- `components/chapters/review-window.stories.tsx` covers the full report,
  `noToolCalls`, the empty, loading and failed states, a long value, an
  unpressable row, and the phone Sheet at 390 px.
- On Android, the window opens as a tall Sheet from the banner and from the
  `⋯` overflow, its list scrolls under the pinned head, and a row press
  dismisses it before the route moves. Run on the device loop.

**Seed, docs and gates.**

- `lib/db/devtools/seed-dataset.test.ts`: `chap_hero_2`'s report parses by
  its schema, its new deltas anchor on the chapter's end entry with the
  `close_report` update last, and `chap_hero_1`'s report is null.
- `delta-log-row.md → Compound API` lists the three props, and
  `component-inventory.md` lists `ReviewWindow` and `ChapterOverlaysHost`.
- `pnpm lint`, `pnpm format:check`, `pnpm compiler:check`,
  `pnpm typecheck`, `pnpm lint:docs` and `pnpm test:run` pass.

## Tests

- **Vitest, `--project unit`:** `lib/history/close-read.test.ts` on
  `createTestDb`, as `lib/history/query.test.ts` is;
  `lib/history/close-review.test.ts` over hand-written reports and delta
  lists; `lib/stores/ui/chapter-overlays.test.ts`;
  `components/chapters/review-row-href.test.ts`;
  `components/chapters/chapter-overlays-host.test.tsx` and
  `hooks/use-overlay-surface.test.tsx` under jsdom; and
  `hooks/use-memory-run-toasts.test.tsx`, extended.
- **Reversal under an open window** is a host test driving the store. No
  user path reaches it today: only the reader binds CTRL-Z, and that key
  stands down under a registered overlay
  (`app/reader-composer/[branchId].tsx:178-184`). C7 requires it regardless,
  and a later path would otherwise leave a window on a chapter that's
  gone.
- **Storybook, browser project:** `Compounds/Chapters/ReviewWindow`, the
  `DeltaLogRow` additions and `chapter-card.stories.tsx`, with plays for
  the collapsed Not applied, a row press and the entry link.
- **E2E:** `e2e/tests/chapter-review.spec.ts` and
  `e2e/locators/review-window.ts`, on the seeded report. It proves the
  seams nothing cheaper reaches: the root host over the router, and the
  surface guard, which C7 records as run on the Timeline only. Selectors
  by role and name through i18n, chapters by title (C8). It writes
  nothing, so it asserts where the press landed.
- **Mutation check.** The slip rule, the tail pairing and the host's
  id prune are the assertions most likely to pass vacuously. Break each
  once and see its test fail. Write expected text as literals, never from
  the constant under test.
- **Manual:** the Android pass above, and a desktop smoke through the
  `electron-app` MCP of the banner's `Review` from World and from the reader.
  A real run behind the banner first happens in
  [Slice 5.10](./10-two-starts.md)'s end-to-end close; the hook test holds
  it until then.

## Open questions

- **How does a rollback count a review edit it sweeps?** Routed to
  [Slice 5.12](./12-chapter-delete-rollback.md#open-questions), as
  [Slice 5.7](./07-chapter-timeline.md#open-questions) routed the same
  question for the Timeline's edits, so one rule serves both: 5.12
  rewrites `rollbackCountsOf` and owns `rollback-confirm.md → Counts`.
  Until it lands, a review edit to a chapter's title, summary or theme,
  anchored on no entry, on a chapter the rollback spares is reverted by
  its log position and counted nowhere.
- **Should C4's `values` and `skippedFields` carry their row?** In a
  multi-row call, Changes' `rows[0]` rule has no row for a `values` key,
  and Not applied's same-row match has none for a `skippedFields` entry. A path landed
  on one row and lost on another ([5.5a's rule](./05a-task-runner.md#implementation-notes),
  developer decision, 2026-11-08) reaches only the model, never Not
  applied, a rule refusal included, which narrows canon's not-applied
  rule ([`chapter-close.md → Review`](../../../../memory/chapter-close.md#review)).
  Where nothing landed, a path lost on two rows for different reasons
  shows only its first loss's reason. A landed merge's link-row losses
  hit the same limit (gap C in Implementation notes): one is dropped when
  another link lands its path, and two characters' losses on one path
  collapse. Triage:
  [A landed merge's link-row losses can't name their row](../../../triage.md).
  Surfaced by 5.5a.

## Implementation notes

**Developer decisions** (planning, 2026-11-13).

1. **Re-run is Slice 5.13's.** It needs 5.12's delete set and 5.10's
   whole close. 5.13 owns how the review reads a re-run's group, the
   host closing the window when a re-run replaces the report, the
   `Re-run…` footer button and the re-run's banner copy. A re-run's
   commit shows in the banner too (`Chapter <N>'s close re-ran` with
   `Review` and a dismiss, warning tone when tasks stopped early), one
   durable notice for the one window; its cancel and failure stay toasts with no action, as
   does the fallback toast for a re-run undone with no journal to write
   back. Until 5.13, the commit handler shows a re-run's commit as a
   close's.
2. **Every refusal's reason is a stable key.** The ledger records the key
   and the model's tool result keeps its instruction text. C4 already
   defines `reason` as a key; the shipped ledger stored instructions with
   per-close handles (`c2`, `t12`) and a raw lore id. `keyedReason`
   writes `<key>: <instruction>` for every close-built free-text reason,
   and `CLOSE_REASON_KEYS` sits beside the report schema in
   `lib/db/story-entries/close-report.ts`. This deviates from Scope:
   out ("the ledger that fills it"), so 5.11 grew into the writer.
3. **Not applied rows press** to their row (the call's first, a refused
   merge's keep) when it is live, by Changes' routing and guard. Canon
   keeps the proposed value so the user can apply it by hand;
   `chapter-timeline.md → Review window` and the wireframe gained it.
4. **Multi-row calls keep C4's shape.** Changes attaches fields to
   `rows[0]`, and a Not applied field counts as corrected when a later
   landed call by the same task and tool shares any row. It handles
   `flag_duplicate`'s landed row order without a schema change, at the
   cost of the known gaps below.
5. **The commit toast became a persistent banner.** On commit the close's
   `MemoryRunBanner` turns into `Chapter closed: <title> [Review] [×]`.
   A toast's `Review` raced its auto-dismiss, and on phone it opened over
   Sheets: gorhom's default `switch` stacking restores a covered Sheet,
   and replacing a Sheet that holds a draft drops it silently. The banner
   sits under every Sheet and scrim.
6. **A stored reason that isn't a key reads `other`**, with a
   `logger.warn`, not "an unknown one as stored". It follows from keys
   everywhere. The schema keeps `reason` a string, so an older report
   still parses.

**Deviations from the brief.**

- **The review passes no entry to `DeltaLogRow`**, so a Changes row is
  named `update Kael`, not `update Kael, entry #n`, and the footer link
  carries the entry. No fourth prop; `delta-log-row.md → Click behavior`
  gained a sentence.
- **`SheetContent.onDismissed`** runs once after a presented sheet's exit
  animation, whatever closed it. The plan relied on the late
  `onOpenChange(false)`, but rn-primitives' controlled
  `useControllableState` drops it after a programmatic close on web.
  `OverflowMenuEntry.opensSheet` runs from it, so `⋯` opens the review
  only after the menu's Sheet has gone; gorhom's `onDismiss` fires on
  Android, checked on the slot AVD.
- **The banner shows a held result only while its chapter is the open
  branch's highest-sequence chapter.** Without it, a stale run-to-done
  handoff showed and announced the previous close's result.
- **The review shows `loading` until the entry index has read**, else old
  values show raw entry ids. A failed index read falls through to `ready`.
- **Value display.** A cleared value reads `old → none`; `state.unplaced`
  (a top mark) shows the new value alone; `commonKnowledge` reads
  `No → Yes`; a known `entry_` id reads `entry #n` on every value side;
  entity and thread statuses read through the `world:` and `plot:`
  status labels, and the top mark through `chapters:review.topLevel`
  (the stored literal is `CLOSE_TOP_LEVEL_VALUE`). Not applied rows
  render proposed values the same way (`reviewValueText`).
- **An untargeted Not applied row** (a refused call that resolved no row)
  is named by a per-tool label (`chapters:review.tool.*`), falling back
  to `history:unknownTarget`, never a raw tool id. A test ties the labels
  to the close's write tools. An empty `rows[].name` (a `set_pin` refused
  by the common checks) takes the live store's name, else the table's
  label.
- **The 5.9 merge.** `merge_happenings` and `set_pin`'s refusals gained
  keys and labels: five merge refusals reuse the thread-merge keys, with
  labels worded to fit both, and `set_pin`'s labels say "decay
  resistance", not "pin". A landed or skipped happening merge records
  keep's derived writes (`occurredAtEntryId`, `commonKnowledge`) in
  `values`, since C4 takes new values from `values`. That also changes
  later tasks' writes-so-far line, which now lists the anchor and the
  flag after the description, pinned by a test. A happening's link-row
  losses are labelled through the link tables' labels.
- **List length.** Unvirtualized. A 22-row report scrolled on the slot
  AVD with no review-specific jank (5.63% janky frames against the
  Timeline's own 8.16%, software emulator).
- **Smaller picks.** `update_place`'s `state.parent_location_id` and
  `state.unplaced` count as one Not applied field; a value-less refusal
  is corrected by any later `ok` call of its task and tool sharing a row;
  a refused merge's summary is `values.description ?? values.title ?? ''`.
  Story Settings registers its surface inside `StorySettingsSurface`,
  where `useStorySettingsSaveSession()` is reachable.

**Known gaps.**

- A mutual `flag_duplicate`'s second row is unlisted (Decision 4).
- A landed merge's link-row losses show under the kept happening with no
  character named (Decision 4), and C4's path-keyed `skippedFields` drops one when
  another link on the merge lands that path and collapses two
  characters' losses on one path. Fixing it needs `skippedFields` to
  carry a row, a C4 v1 shape change; see Open questions.
- A fork that copies chapter ids keeps the window open on a branch
  switch. Unreachable until fork ships (M6.1).
- The guard C7 records as inferred is E2E-run on the Timeline only; a
  press over a dirty World pane is unit-covered.
- The review window has no exit animation: the host unmounts it as the id
  clears (triage).

**What constrains 5.10, 5.12 and 5.13.**

- **C7's store is the one door.** `chapterOverlaysStore` holds the review
  id, the close modal request (5.10 reads it), the banner's `closeResult`
  and the registered surface. `openCloseModal` runs the surface's guard
  before it holds its input, so a trigger can't skip it, and a guard that
  doesn't proceed holds nothing. 5.10 builds its modal on it.
- **One hold rule.** `overlayChapterHolds` and `closeResultHolds`, in the
  store file, are shared by the host and the banner: a chapter holds
  while it has a report on the open branch. Reversal, a re-run replacing
  the report (5.13) and a delete (5.12) all clear through it, so a change
  there changes both. The id is pruned, not hidden, because a redo
  restores the chapter id.
- **Every new refusal adds a key and a label.** A close-built reason goes
  through `keyedReason` with a `CLOSE_REASON_KEYS` member and a `t()`
  label under `chapters:review.reason`, or it reads `other` and logs a
  warning. 5.12 and 5.13 follow that for anything they refuse.
- **5.13 owns the re-run's footprint:** its group writes no `chapters`
  create, so `loadCloseDeltas`' range rule (create to report update) is a
  close's only. A rollback's count of a review edit is 5.12's (Open
  questions).
