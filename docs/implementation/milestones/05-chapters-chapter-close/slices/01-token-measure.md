# Slice 5.1 — Token measure

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** none
- **Blocks:** [Slice 5.2](./02-first-chapter.md) (it may start at once,
  and lands after this one for its `token_count` source and the
  migration order), [Slice 5.6](./06-close-owed.md),
  [Slice 5.7](./07-chapter-timeline.md),
  [Slice 5.10](./10-two-starts.md); partly
  [Slice 5.3](./03-reader-chapters.md), for its count labels

## Goal

One token measure stored in SQLite, so the chapter trigger, the
progress strip, Phase 1 and the close modal read the same number. The
slice delivers `story_entries.content_tokens`, kept current on every
content write; the `openRegionSeries` read those consumers share;
`useChapterProgress` on the four in-story routes, replacing a strip that
reads 50 rows out of a store; and a leaf `lib/tokens` module the seed
and the action layer can import. Nothing closes yet: the trigger's first
reader is [Slice 5.6](./06-close-owed.md).

## Background

The strip sums `countEntryTokens` over `entriesStore`, which holds a
trailing 50 rows, so it under-reports a longer region, shrinks when
`reload()` re-hydrates, and builds the tiktoken encoder during render.
[Canon's measure](../../../../data-model.md#chapters--memory-system)
is a stored o200k count of `content`, written with the entry and on a
content edit, restored by that edit's undo, with a null reading as 0. A
translated story needs no rule of its own, since `content` is already
the source language. `metadata.tokens` can't stand in: it's stale after
an edit, counts the state block stripped before
persist, uses the provider's tokenizer, and is absent on `user_action`
and `opening` rows. A content edit is spliced into a reversal rather
than dispatched, so a count in the create handler never reaches it, and
that path counts for itself.

## Required reading

- [Contract C5](../milestone.md#c5--token-reads-and-the-progress-hook)
  whole, Migration order included: this slice provides it.
- [Contract C8](../milestone.md#c8--seed-stability): why nothing here
  may pin a seeded entry position.
- [Contract C10](../milestone.md#c10--what-a-chapter-may-end-on): the
  predicate this slice creates, and the rule behind `canClose`.
- [Contract C16](../milestone.md#c16--flip-rule): the count-label flip.
- [`data-model.md → Chapters / memory system`](../../../../data-model.md#chapters--memory-system):
  the boundary trigger and the measure.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback):
  why an edit's undo restores the column.
- [`data-model.md → Backup & export format`](../../../../data-model.md#backup--export-format):
  the table-by-table manifest this slice checks.
- [`generation-pipeline.md → chainsTo on predecessor`](../../../../generation-pipeline.md#chainsto-on-predecessor):
  `closeOwed`, the read's first pipeline consumer.
- [`generation-pipeline.md → Prose reversals and the interrupt`](../../../../generation-pipeline.md#prose-reversals-and-the-interrupt):
  the bracket an edit runs in, whose end ticks `settleCount`.
- [`reader-composer.md → Top-bar — chapter navigation`](../../../../ui/screens/reader-composer/reader-composer.md#top-bar--chapter-navigation):
  what the strip measures, and the color thresholds.
- [`code-conventions.md → Module structure`](../../../../code-conventions.md#module-structure)
  and [`State placement`](../../../../code-conventions.md#state-placement):
  the two new modules, and SQLite as canonical.
- [`testing.md → Fixture + seed contract`](../../../../testing.md#fixture--seed-contract)
  and [`Tier 1 — assert in the database`](../../../../testing.md#tier-1--assert-in-the-database).
- [`lessons-learned → Token-counting fixtures must be prose`](../../../lessons-learned/token-fixtures-need-real-prose.md#how-to-apply):
  entry writes reach the real encoder from this slice on.

## Scope: in

- **The column.** `story_entries.content_tokens`, a nullable integer
  (`contentTokens` in Drizzle), and one migration from
  `pnpm db:generate`, landing before 5.2's per C5's Migration order. No
  backfill. `StoryEntry` gains a required key: with the column alone,
  `tsc --noEmit` reports 50 errors in 28 files (measured at 0f28204f0),
  nearly all fixture literals, which take `contentTokens: null`.
- **`lib/tokens`.** `lib/retrieval/tokens.ts` moves to
  `lib/tokens/index.ts` with `git mv`, importing only `js-tiktoken`, and
  exports `countTokens`, `TOKENIZER_IDENTITY` and a new
  `warmTokenEncoder`. `lib/retrieval/index.ts:53` re-exports the first
  two. `lib/retrieval/run.ts:53` and the tests that import `./tokens`
  take the leaf. A `boundaries/dependencies` rule in `eslint.config.js`,
  beside `lib/diagnostics`', keeps it a leaf, since the value cycle it
  prevents fails only on Android at boot. It disallows `lib-module` and
  `lib-file` targets both: `lib/*.ts` is a separate element
  (`eslint.config.js:46-50`), so naming one would let
  `@/lib/keyword-terms` through. `countTokens` guards long runs, per
  Implementation notes.
- **Counting at create.** `fullRow`
  (`lib/actions/story-entries/register.ts:44-55`) sets
  `contentTokens: countTokens(entry.content)`, whatever the payload
  holds, so user actions and replies share one site. The opening's
  direct insert (`lib/actions/stories/create-story.ts:153-166`) counts
  for itself. The count is of stored `content`, not `promptProse`.
- **Counting on an edit.** `contentEditSet`
  (`lib/actions/story-entries/operational.ts:130-133`) writes the new
  count, `contentEditPatchColumns` (`:135-142`) carries it to the store,
  and `contentEditUndoPayload`
  (`lib/actions/story-entries/classifier-facts.ts:98-108`) records the
  old value under the column key `contentTokens`, not a `$` meta key.
  Undo and redo then need no code: `restorablePayload`
  (`lib/actions/delta/reverse-replay.ts:556`) restores a column outside
  `columnSchemas` as a whole value, and redo's snapshot is the whole
  row. The new key touches nothing that identifies an edit, since
  `isContentEditDelta` and `proseLogPosition` key on `content`, and
  `story_entries` isn't a History table (`HISTORY_TABLES`).
- **What stays uncounted.** `writeSystemEntry` leaves the column null, as
  `system` rows sit outside the region. Raw inserts keep working with no
  change: `e2e/harness/seed.ts:329,554`, `bench/fixture.ts:260` and
  `lib/pipeline/definitions/__tests__/phase-db.ts:44` list their columns,
  so their rows hold a null.
- **The encoder.** `countEntryTokens`, its memo, `__resetTokenCache`,
  `__tokenCacheSize` and `__tokenComputeCount` go, with the re-export.
  `warmTokenEncoder()` builds the encoder once. `loadAndPublish`
  (`lib/actions/stories/operational.ts:188-191`) schedules it after
  `publish`, beside `kickStoryDrain`, off the open's own task, so the
  build doesn't land on the first Send. On Android it runs during the
  open, ahead of first paint, per Implementation notes. `openStory` and
  `loadOpenStory` both pass through there.
- **The read.** `lib/db/story-entries/open-region.ts`, exported from
  `@/lib/db`, which `lib/retrieval`, `lib/pipeline` and `hooks` already
  import, so the read adds no module edge:
  - `openRegionWhere(branchId)`, the one predicate, replacing the copies
    at `lib/retrieval/buffer.ts:62-65` and
    `lib/pipeline/definitions/entry-reads.ts:81-85`.
  - `openRegionSeries(branchId, ctx)`, returning
    `{ id, kind, position, tokens }[]` in position order, with `tokens`
    a number and a null read as 0. `ctx` needs only `db`, so the hook
    can pass the runtime handle.
- **`lib/chapters`.** A new module of pure rules and constants, with no
  value import of `@/lib/db` (C5). The same `boundaries/dependencies`
  addition holds that, with a `disallow` on `lib/db` limited by
  `dependency: { kind: 'value' }`, so a later slice can't add one past a
  one-time check. It's narrower than `lib/tokens`' leaf rule, since
  [Slice 5.7](./07-chapter-timeline.md) imports `lib/keyword-terms`
  here. Types from `@/lib/db` use the `import type` declaration: the
  rule reads `import { type X }` as a value import, and that's the
  spelling `consistent-type-imports` autofixes to. Both rules were
  tried with `lintText` on a scratch copy of the config at 0f28204f0. It
  exports:
  - `canEndChapter`, per C10, true only for an `ai_reply` and taking
    a row with a `kind`, so `.some(canEndChapter)` reads directly.
  - `chapterProgressTone(percent)` in `chapter-progress-tone.ts`,
    returning `'success'` under 80, `'warning'` from 80 and `'danger'`
    from 90, per C5.
  - `chapterProgressOf(series, threshold)`, the pure arithmetic behind
    the hook, and its `ChapterProgress` type,
    `{ tokens, threshold, percent, tone, canClose }`. `percent` clamps
    to 0–100, and a non-positive or non-finite threshold reads 0, as
    `openRegionProgress` does today.
- **`useChapterProgress(storyId)`.** `hooks/use-chapter-progress.ts`,
  moved from `hooks/use-open-region-tokens.ts` with `git mv`.
  `useOpenRegionTokens`, `openRegionProgress` and the stale "imported
  stories" line at `:15` go. It reads `openRegionSeries` through React
  Query, keyed on branch, `settleCount` and the branch's tail id, as
  `useEntryIndex` does (`hooks/use-entry-index.ts:76-100`). `threshold`
  stays out of the key and applies at render, so a threshold change
  moves `percent` with no read. It returns a stable object, and:
  - Keeps the scope rule: a story that isn't the open one reads as
    zeros, with `canClose` false.
  - Holds the last read while a new key loads, tagged by branch, since
    the key changes on every settle and tail move and a bare `useQuery`
    would drop the strip to 0 each time.
  - On a failed read, logs `app.chapter_progress_read_failed` and keeps
    the last value. The event joins
    [`observability.md → Subsystem emission inventory`](../../../../observability.md#subsystem-emission-inventory).
- **Routes and shell.** `app/reader-composer/[branchId].tsx:1469,1523`,
  `app/world/[branchId].tsx:222,589`, `app/plot/[branchId].tsx:157,435`
  and `app/story-settings/[storyId].tsx:213,347` move to the hook.
  `ScreenShell.chapterProgress` (`components/shells/screen-shell.tsx:49`)
  takes `ChapterProgress`, and the strip's width reads `percent`. What
  it renders doesn't change: `clampProgress` stays, and undefined still
  renders 0. `components/shells/screen-shell.stories.tsx` moves to the
  new prop.
- **The seed.** One map at `allEntries`
  (`lib/db/devtools/seed-dataset.ts:1809`) fills the column on hero,
  fork, rich and filler rows alike, importing `@/lib/tokens`, never
  `@/lib/retrieval`. `delta_hero_1`'s undo payload (`:1107`), the seed's
  one content edit, gains `contentTokens`, or its CTRL-Z restores the
  text and leaves the edited count.
- **The flip (C16).** If 5.3 is on main when this lands, this slice
  tightens `tokens` and `threshold` to required, reuses its
  `chapterProgressTone`, and flips its count labels and tooltip from
  percent to numbers. If this lands first, 5.3 binds directly.
- **Stale pointers.** `scripts/mock-llm/respond/wire.ts:44` and
  [the token-fixture lesson](../../../lessons-learned/token-fixtures-need-real-prose.md#how-to-apply)
  name the old path. The lesson also names `countEntryTokens` (`:27`) and
  `hooks/use-open-region-tokens.test.tsx` (`:46`), which moves with the
  hook.
- **Manifest check.** `story_entries` already reads Travels in the
  export manifest and Copy 1..N in the branch-copy manifest, and the
  column travels with its row, so neither needs an edit. `.avts` has no
  entry kind (`lib/avts/envelope.ts:6`).

### The carried deferrals

This slice closes the five M5.1 deferrals. Promotion replaces the
roadmap entry that carried them, so they're restated here with anchors
and numbers corrected.

| Deferral                                          | Evidence at 0f28204f0                                                                                                                                                                                                                                           | Closed by                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `metadata.tokens.completion` is the wrong measure | Stale on edit (`lib/actions/story-entries/operational.ts:130`, `:188`), counts the stripped block and uses the provider's tokenizer (`lib/pipeline/definitions/per-turn.ts:486`), absent on `user_action` and `opening` (`lib/actions/turns/submit-turn.ts:99`) | The new column. `tokens` stays a provider-usage triple                                  |
| The strip reads a 50-entry window                 | `ENTRIES_WINDOW_SIZE` (`lib/actions/story-entries/recent-window.ts:7`). 50 entries at realistic length read 37.7% of the default threshold, and 100% takes about 132                                                                                            | `openRegionSeries`                                                                      |
| The strip shrinks across a reload                 | `hydrate` replaces the map (`lib/stores/factory/working-set-store.ts:38-39`), and the reader's `reload()` re-hydrates to 50 on a failed turn (`app/reader-composer/[branchId].tsx:498-506`)                                                                     | `openRegionSeries`                                                                      |
| The encoder builds on the reader's first render   | ~285 ms (`lib/retrieval/tokens.ts:6`, the lesson says ~272), not the 116 and 135 ms the deferral cited. Never measured on a device                                                                                                                              | The hook stops counting, and `warmTokenEncoder`. The Android number lands in this slice |
| `countEntryTokens`' memo is never pruned          | A module-level `Map` (`lib/retrieval/tokens.ts:30`), with `__resetTokenCache` test-only                                                                                                                                                                         | The memo goes                                                                           |

## Scope: out

- Strip tone rendering, its tooltip and its press on `ScreenShell`:
  [Slice 5.3](./03-reader-chapters.md). This slice computes `tone` and
  renders nothing with it.
- The popover's `chapter progress` label and the story card's chapter
  label: [Slice 5.3](./03-reader-chapters.md). The Timeline's
  in-progress card: [Slice 5.7](./07-chapter-timeline.md).
- `closeOwed` and `nextMemoryRun`'s close branch:
  [Slice 5.6](./06-close-owed.md).
- Phase 1's candidates, the modal's `tokens in range`, `Ready to close`
  and `Close chapter…`'s availability:
  [Slice 5.10](./10-two-starts.md).
- `chapters.token_count` at close, the seed's close shape, `CHAP1_END`
  and `CHAP2_END`, and what the strip shows mid-close:
  [Slice 5.2](./02-first-chapter.md).
- `metadata.tokens`, which stays what it is, and the entry card, which
  keeps reading `tokens.completion`.
- A covering index for the read. The read scans the branch, as
  `readPromptBuffer` does twice a turn.
- Recounting M8.1's source-language rewrite of a user action, once
  that phase is real. `lib/pipeline/definitions/per-turn.ts:543-557` is
  a no-op until then.

## Acceptance criteria

- **Migration.** `pnpm db:generate` reports no changes on the finished
  branch, `pnpm db:check` and `pnpm db:check:format` pass, and
  `lib/db/schema.test.ts` asserts `content_tokens` is nullable.
- **Create.** A `createStoryEntry` for a `user_action` and for an
  `ai_reply` stores `countTokens(content)` in the DB row and the store
  row, and a payload holding `contentTokens: 999999` doesn't win
  (`lib/actions/story-entries/register.test.ts`). `createStoryWithBranch`
  stores the opening's count (`lib/actions/stories/create-story.test.ts`).
- **Edit, undo, redo.** An edit writes the new count to the DB and
  `entriesStore`, its delta's payload holds the old count, CTRL-Z
  restores the old count in both, and redo restores the new one. A row
  with a null count round-trips as null, and a Save with unchanged text
  writes nothing (`lib/actions/story-entries/undo-content.test.ts`,
  `lib/actions/delta/redo.test.ts`).
- **The read.** Over `createTestDb`, `openRegionSeries` returns all 60
  rows of a 60-row region in position order, across position gaps. It
  leaves out `system` and stamped rows, keeps the `opening`, and reads a
  row inserted with no count as 0
  (`lib/db/story-entries/open-region.test.ts`, with a raw insert for the
  null). The three raw-insert sites pass with no edit.
- **One predicate.** `git grep -n "isNull(storyEntries.chapterId)" -- lib`
  hits only `lib/db/story-entries/open-region.ts`, and
  `lib/retrieval/buffer.test.ts` and
  `lib/pipeline/definitions/entry-reads.test.ts` pass unchanged.
- **Tone and `canClose`.** `lib/chapters/chapter-progress-tone.test.ts`,
  against literals: 79.9 is `success`, 80 and 89.9 are `warning`, 90 and
  100 are `danger`. `canClose` is false for an opening-only region
  and a region of user actions, and true once it holds an `ai_reply`.
- **The hook.** `hooks/use-chapter-progress.test.tsx` shows all of:
  - zeros for another story, no story and a branch switch;
  - a refetch on a `settleCount` tick and on a tail move;
  - the last number standing while the next read is pending, and no
    earlier branch's number after a switch;
  - a threshold change moving `percent` with no new read;
  - a failed read logging once and keeping the last number, with the
    event listed in `docs/observability.md`.
- **Shell.** `git grep useOpenRegionTokens -- app components hooks lib`
  finds nothing, and the `ScreenShell` stories pass with
  `aria-valuenow` reading the prop's `percent`.
- **Encoder.** `git grep -E "countEntryTokens|TokenCache|__token" -- hooks lib`
  finds nothing. One encoder is built across a warm and two counts
  (`lib/tokens` test, with a constructor spy). A story open schedules
  one warm past `publish`, doesn't run it inline, and an open cancelled
  before publish schedules none
  (`lib/actions/stories/operational.test.ts`). The build's time on the
  Android dev client is in Implementation notes.
- **Count guard.** `lib/tokens/tokens.test.ts`, on an `encode` spy: a run
  of non-whitespace, of whitespace, or of newlines and slashes over 512
  code points is cut, never inside a surrogate pair, and no text is
  dropped. Text with no such run reaches `encode` once, whole.
- **Module edges.** `lintText` cases in
  `lib/db/__tests__/boundary.test.ts`, on fixture paths inside each
  module, read `boundaries/dependencies`, so the check needs no
  hand-made mutation and holds on every later PR:
  - In `lib/tokens`, `@/lib/text` (a `lib-module`) and
    `@/lib/keyword-terms` (a `lib-file`) are flagged, and `js-tiktoken`
    isn't.
  - In `lib/chapters`, a value import of `@/lib/db` and the inline
    `import { type X }` spelling are flagged. `import type` from
    `@/lib/db` and `@/lib/keyword-terms` aren't.
  - `git grep -n "@/lib/retrieval" -- lib/db/devtools` finds nothing.
- **Seed.** Every non-system seeded row's `contentTokens` equals
  `countTokens(content)`, and every seeded content-edit delta carries
  `contentTokens` (`lib/db/devtools/seed-dataset.test.ts`). Neither test
  names an entry position, so 5.2's move to `CHAP1_END = 29` leaves them
  green.
- **The strip, end to end.** `e2e/tests/chapter-progress.spec.ts`, on a
  branch with more than 50 open entries: `aria-valuenow` equals the
  percent from SQL's `SUM(content_tokens)` on open, after a failed turn
  and after a window reload. It rises on an edit and returns on CTRL-Z.
  World shows the same value as the reader.
- **Stale pointers.** `git grep -E` for
  `retrieval/tokens|use-open-region-tokens|countEntryTokens` over `lib`,
  `scripts` and `docs/implementation/lessons-learned` finds nothing.
- **Manifests.** Both manifests in `data-model.md` already show
  `story_entries` travelling and copying whole, and the diff touches
  neither.
- **Landing order.** Whichever of 5.1 and 5.3 lands second,
  `git grep -E "function chapterProgressTone|chapterProgressTone ="`
  finds one definition, and the labels 5.3 ships show counts.
- **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm compiler:check`, `pnpm lint:docs` and `pnpm test:run` pass.

## Tests

- **Vitest, `lib/`.** `open-region.test.ts` over `createTestDb`, and
  `lib/chapters`' pure functions. `lib/tokens`, with `tokens.test.ts`
  moved beside it and the memo cases dropped. The action tests named
  above, `seed-dataset.test.ts`, and the two lint rules in
  `lib/db/__tests__/boundary.test.ts`.
- **Vitest, hook.** `hooks/use-chapter-progress.test.tsx` moves with the
  hook and keeps its scope cases, mocking the read as
  `hooks/use-entry-index.test.tsx` does.
- **Storybook.** The `ScreenShell` stories, on the new prop.
- **E2E (desktop).** `e2e/tests/chapter-progress.spec.ts` drives the
  strip through the UI and asserts against SQL, with a `chapterProgress`
  locator added to `e2e/locators/chrome.ts`. `story_rich` seeds 60 open
  entries (`N_RICH`, `seed-dataset.ts:1586`), so it needs no harness
  row. `mock.failNextNarrative()` gives the failed turn.
- **Fixtures.** Expected counts come from `countTokens` on the literal
  text, and tone expectations from literals, not from a constant under
  test. Text that reaches the real encoder is prose. The first entry
  write in each test file now pays the encoder build, which CI runs
  several times slower: a new timeout there is that build, not a flake.

## Implementation notes

- **`countTokens` guards long runs (developer decision, 2026-11-01).**
  An addition to the brief. `js-tiktoken`'s merge is quadratic in one
  regex word: 16,000 repeated characters took 10 s raw and about 320 ms
  through the guard, which cuts any run of non-whitespace, of
  whitespace, or of newlines and slashes at 512 code points and sums the
  parts. Whitespace needs its own arm, since o200k's pattern matches a
  whole whitespace run as one word. The third kind came in during
  implementation: o200k's punctuation word runs on through newlines and
  slashes, so `//\n` repeated is one word with no long run of the other
  two kinds, and took 10 s at 16,000 characters against 345 ms cut. That
  is the only arm mixing the two at unbounded length, so the three kinds
  cap every word at 1,025 code points. Each cut moves the count by a few
  tokens, the most measured being 4, which proves no bound. A percentage
  is the wrong unit: a short run can move 18%, and the "about 1%" the
  developer first accepted held only on long fixtures. Spaced prose
  never reaches the cut; a long CJK paragraph has no whitespace, so it's
  cut too, which moved one count by 0.06%. A run's cost follows its
  UTF-8 bytes, so a guarded emoji run takes about 340 ms per 1,000:
  linear, and kept at 512. It sits inside `countTokens` because
  `windowCheckMiddleware` counts the whole prompt on every model call,
  so one such reply would stall each later call while it sits in the
  buffer, and [Slice 5.5b](./05b-identity-threads.md) counts per tool
  step. `TOKENIZER_IDENTITY.version` stays: it names the vocabulary,
  which didn't change. One run of about 5.6 million code units overflows
  V8's regexp stack and `countTokens` throws, where the encoder alone
  didn't. That's at least about 700,000 tokens, so it stays; Hermes is
  unmeasured.
- **`chapters.token_count` is a snapshot at close (developer decision,
  2026-11-01).** An edit in a closed chapter leaves it, and a re-close
  after a delete recomputes it. That needs no new write path, and
  [Slice 5.12](./12-chapter-delete-rollback.md) already reads it this
  way, summing `content_tokens` where it needs a live number. Canon
  says so in
  [`data-model.md → Chapters / memory system`](../../../../data-model.md#chapters--memory-system)
  and
  [`chapter-timeline.md → Expanded state`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#expanded-state).
- **`updateChapter` narrows in [Slice 5.2](./02-first-chapter.md), not
  here (developer decision, 2026-11-01).** `UPDATABLE` goes down to
  `title`, `summary`, `theme`, `keywords` and `closeReport`. 5.2 already
  edits that list, and only `lib/actions/chapters/register.test.ts` uses
  the columns going.
- **The entry card stays on `tokens.completion` (developer decision,
  2026-11-01).** The card reports what the provider said a generation
  produced, and the strip measures story text against the chapter
  budget. After an edit the card still describes the generation
  truthfully.
- **A warm can outlive a cancelled open (developer decision,
  2026-11-01).** A narrowing of the brief. The warm is scheduled in
  `loadAndPublish`, and `openStory` can still return cancelled after
  that publishes, so "a cancelled open schedules none" holds for a
  cancel before publish. A later cancel's warm does no harm: it's a
  no-op once the encoder exists, and the open that replaced this one
  needs the encoder anyway.
- **The warm stays in `loadAndPublish` on `requestIdleCallback`
  (developer decision, 2026-11-01).** A narrowing of the brief, which
  wanted the build clear of first paint. `InteractionManager` is
  deprecated in React Native 0.83 and Electron's renderer has the
  global. Node and jsdom don't, so `vitest.setup.ts` gives one no-op and
  production code carries no fallback. The 2,000 ms timeout only works
  on Electron: React Native 0.83.6's `NativeIdleCallbacks.cpp` never
  assigns it and has no idle signal, so on Android the warm is the
  lowest-priority task, with no 2 s bound, and it runs during the open.
  No phone was available, so these are from an x86_64 emulator
  (`sdk_gphone64_x86_64`, Android 16) on a debug build. Over three cold
  opens the encoder build took 982 ms (942 to 1,325, the highest on the
  first open after Metro's bundle), starting within about 0.3 s of the
  tap in the two runs timed and at least 1,714 ms ahead of the host's
  first-paint message. Both cross the lines this slice's planning drew,
  a build of 1,000 ms or more and a warm ahead of first paint, so the
  developer chose. With the warm no-oped, tap to first paint took 1.92
  to 1.99 s against 2.04 and 2.17 s, so the warm costs about 0.05 to
  0.25 s, since the WebView's boot overlaps it. That's three samples
  against two, and the warmed runs also carried a temporary count of
  about 0.5 s on the JS thread that shipped code doesn't, so it likely
  overstates the cost. `first-paint` is when the host hears of it, not
  when the user sees it. A tap during the build is untested. Without the
  warm that second lands on the first Send, and past first paint, where
  a plain timer would put it, it lands while someone may be typing; no
  timer was measured. On the same device a count of 2,006 characters of
  prose took 3.7 ms and 10,030 took 13 ms, and the guard's first run on
  Hermes read `tokens=500` on 4,000 `x` characters, in 480 to 560 ms
  (940 on the first open). Other long-run shapes weren't measured on
  Hermes, and on Node a run of emoji costs about 15 times a run of `x`.
  Plain Node has no `requestIdleCallback` either, so `loadOpenStory`
  throws under `tsx`;
  [Slice 5.5a's probe](./05a-task-runner.md#open-questions) carries that
  question.
- **The warm doesn't cover story creation (developer decision,
  2026-11-01).** `components/wizard/finish.ts:339` reaches
  `create-story.ts`' count before any open, so the first story created
  after launch pays the build at Finish. It stays as it is.
- **A turn runs on `story_rich`,** a creative story with no lead, so the
  strip's E2E uses it and adds no harness rows. The fallback of filler
  on the hero branch wasn't needed. Its undo presses CTRL-Z, as the
  acceptance says.
