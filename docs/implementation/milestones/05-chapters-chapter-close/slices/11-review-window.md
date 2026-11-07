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
  host on this slice's store

## Goal

The user sees what a close changed. This slice ships the review window,
the root host and overlay store it opens through, the commit toasts
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
sits above the router, because a toast's `Review` fires on whichever
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
  — the commit toasts.
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
  same row and field. A refused call with no `values` is one row by its
  `tool` and rows. A refused merge carries no `survivor` and is always
  one row by its `tool` and rows, with its proposed text as the summary,
  whatever `values` holds. A later landed merge by that task over the
  same rows drops it. A refused `create_lore` shows its title. Its
  minted id is one no retry shares, so it matches a later landed
  `create_lore` by that task with the same title, trimmed and
  case-folded (C4), and a corrected create drops out. Each row shows the
  proposed value and its reason, the entry's own in `skippedFields` or
  else the call's:
  `USER_EDITED_SINCE_PROSE`, `later-turn` and `row-gone` through `t()`
  keys, and a rule refusal's handler string as stored.
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
[Open questions](#open-questions)). A target absent from its store
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
  mounted beside `<MemoryRunToasts />` (`app/_layout.tsx:115`), inside
  `BottomSheetModalProvider`. This slice renders the review; 5.10 adds the
  modal.
- **One derived rule covers a reversal and a stale toast.** The host
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

**Commit toasts,** in `hooks/use-memory-run-toasts.ts`.

- A `run_complete` for `CHAPTER_CLOSE_KIND` with `outcome: 'completed'`.
  The event names no chapter or branch (`lib/pipeline/types.ts:72-81`),
  so the handler takes the highest `sequenceNumber` in `chaptersStore`,
  reads its report, and goes on only when `report.actionId` equals the
  event's.
- `report.stopped` empty: `toast.info`, `Chapter closed: <title>`. Else
  `toast.warning`, `Chapter closed, but <n> tasks stopped early`, with
  singular and plural keys. Both carry `Review`, calling
  `openReviewWindow({ chapterId })`.
- A failed report read logs and shows the info toast.
- `beforeTurn` isn't read. Canon gives the commit toast no before-turn
  arm, so a close that commits under Send toasts as any other. The
  failure toast's arm on it is [Slice 5.6](./06-close-owed.md)'s.

**`Review changes`,** flipped from hidden per C16. `ChapterCard` is
props-in, so the route's card data takes `hasCloseReport`, and the card's
one list of action entries gains the entry, behind `⋯` on phone, calling
`openReviewWindow({ chapterId })`. A running pipeline doesn't disable it:
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
  [Slice 5.7](./07-chapter-timeline.md) registers, and the toasts beside
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
  ([Slice 5.5a](./05a-task-runner.md)).
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
  key, and an unknown one as stored (same file).
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

**Reversal and toasts.**

- A chapter leaving the store closes the window, a redo of it doesn't
  reopen it, and `openReviewWindow` on an absent chapter renders nothing
  and leaves no id
  (`components/chapters/chapter-overlays-host.test.tsx`).
- A committed close toasts `Chapter closed: <title>` at info with no
  stopped task, and the warning with its count otherwise, each with
  `Review` calling `openReviewWindow`. It toasts with `beforeTurn` true
  and false, and an aborted or failed close, or a report whose `actionId`
  differs, toasts nothing (`hooks/use-memory-run-toasts.test.tsx`).

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
- On Android, the window opens as a tall Sheet from the toast and from the
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
  guard C7 records as inferred, not run. Selectors by role and name
  through i18n, chapters by title (C8). It writes nothing, so it asserts
  where the press landed.
- **Mutation check.** The slip rule, the tail pairing and the host's
  id prune are the assertions most likely to pass vacuously. Break each
  once and see its test fail. Write expected text as literals, never from
  the constant under test.
- **Manual:** the Android pass above, and a desktop smoke through the
  `electron-app` MCP of a toast's `Review` from World and from the reader.
  A real run behind the toast first happens in
  [Slice 5.10](./10-two-starts.md)'s end-to-end close; the hook test holds
  it until then.

## Open questions

- **Do Not applied rows press?** The wireframe draws them unpressable,
  `chapter-timeline.md` doesn't say, and `chapter-close.md → Review` keeps
  the proposed value "so the user can apply it by hand". This doc presses
  them when their row is live, which gives a refused `create_lore` no
  press. Confirm at planning; the wireframe changes with it.
- **What does a toast's `Review` do with another overlay up?** A rail
  Sheet can be open on phone when a close commits, and Sheet over Sheet
  isn't allowed. Check gorhom's stacking behaviour on the device before
  choosing to replace it, or to hold the window until the Sheet dismisses.
- **Is a rule refusal fit to show?** Its `reason` is the handler's string,
  such as `not-a-faction`, which reaches the user unlocalized. It reads
  to the model first, so a label for the review would be a second map.
- **How long does the list get?** Report size is a guess until 5.5b's run.
  The list is a plain scroller; if that number reaches the hundreds, check
  it on Android before shipping it unvirtualized.
- **Does a Changes row's name carry its entry?** Since 5.3 a pressable
  `DeltaLogRow` is named `<op> <target>, entry #n` whatever its press
  opens. Here the press opens World or Plot, the meta line is off, and
  the footer's `entry #n →` link names the entry again, so a screen
  reader hears it twice and the row's name points where its press
  doesn't. Default: the host chooses, through a prop on the extension
  above.

- **How does a rollback count a review edit it sweeps?** Routed to
  [Slice 5.12](./12-chapter-delete-rollback.md#open-questions), as
  [Slice 5.7](./07-chapter-timeline.md#open-questions) routed the same
  question for the Timeline's edits, so one rule serves both: 5.12
  rewrites `rollbackCountsOf` and owns `rollback-confirm.md → Counts`.
  Until it lands, a review edit to a chapter's title, summary or theme,
  anchored on no entry, on a chapter the rollback spares is reverted by
  its log position and counted nowhere.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
