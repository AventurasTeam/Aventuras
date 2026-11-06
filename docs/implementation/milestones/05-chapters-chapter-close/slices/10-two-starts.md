# Slice 5.10 — The two starts and the whole close

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.1](./01-token-measure.md),
  [Slice 5.3](./03-reader-chapters.md),
  [Slice 5.6](./06-close-owed.md),
  [Slice 5.7](./07-chapter-timeline.md),
  [Slice 5.8](./08-prose-tasks.md),
  [Slice 5.9](./09-chapter-wide-tasks.md),
  [Slice 5.11](./11-review-window.md). It comes after everything it wires.
- **Blocks:** none

## Goal

Both closes become reachable: the user's pick from every surface, and the
threshold's real boundary selection. This slice delivers the close modal
on the root host, `STORY TOOLS` and `Close chapter…`, `Close chapter here`,
`Ready to close`, Phase 1's model call and the `toolCalling` flag with its
gate. It then proves the whole close end to end, with the milestone's Auto
close E2E, the full seven-task `pnpm probe:close` run and the reversal cost
of a full group.

## Background

A chapter is only ever created by a close, and the two starts are one
pass: the threshold begins with boundary selection, and the user's pick
skips it. When this slice starts, a dev route starts manual closes, an auto
close ends on the no-model fallback, and every user entry point sits on
main disabled with a reason. A close runs on a model unless its
`toolCalling` flag is off, so most models run with the flag unknown, and M5
can set the flag only from a catalog or the DB. Every task is on main by
now, which is why the proofs live here.

## Required reading

- [`chapter-close.md → Phase 1 — boundary selection`](../../../../memory/chapter-close.md#phase-1--boundary-selection),
  [`Manual user-triggered close`](../../../../memory/chapter-close.md#manual-user-triggered-close),
  [`Tool calling`](../../../../memory/chapter-close.md#tool-calling),
  [`Run order`](../../../../memory/chapter-close.md#run-order) and
  [`Failure modes and atomic rollback`](../../../../memory/chapter-close.md#failure-modes-and-atomic-rollback).
- [`chapter-timeline.md → Chapter-close modal`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#chapter-close-modal)
  in full, and
  [`In-progress chapter card`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#in-progress-chapter-card),
  [`Empty state`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#empty-state)
  and
  [`Mobile expression`](../../../../ui/screens/chapter-timeline/chapter-timeline.md#mobile-expression).
- [`reader-composer.md → Top-bar — chapter navigation`](../../../../ui/screens/reader-composer/reader-composer.md#top-bar--chapter-navigation),
  [`Per-entry actions`](../../../../ui/screens/reader-composer/reader-composer.md#per-entry-actions)
  and
  [`Transient pipeline failures`](../../../../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat).
- [`actions-menu.md → Curated core`](../../../../ui/patterns/actions-menu.md#curated-core),
  [`Behavior`](../../../../ui/patterns/actions-menu.md#behavior) and
  [`Gating`](../../../../ui/patterns/actions-menu.md#gating).
- [`save-sessions.md → Navigate-away guard`](../../../../ui/patterns/save-sessions.md#navigate-away-guard--global-intercept).
- [`entry-card.md → Action cluster`](../../../../ui/patterns/entry-card.md#action-cluster),
  [`icon-actions.md → Glyph vocabulary`](../../../../ui/patterns/icon-actions.md#glyph-vocabulary)
  and
  [`iconography.md → Per-entry actions`](../../../../ui/foundations/iconography.md#per-entry-actions).
- [`generation-pipeline.md → Config pre-flight validation`](../../../../generation-pipeline.md#config-pre-flight-validation),
  [`chainsTo on predecessor`](../../../../generation-pipeline.md#chainsto-on-predecessor),
  [`Cut-off replies`](../../../../generation-pipeline.md#cut-off-replies) and
  [`Fatal error categories`](../../../../generation-pipeline.md#fatal-error-categories).
- [`architecture.md → System and user halves`](../../../../architecture.md#system-and-user-halves),
  [`Structured output`](../../../../architecture.md#structured-output--the-json-contract-is-not-pack-content),
  [`Context groups`](../../../../architecture.md#context-groups) and
  [`Detection`](../../../../architecture.md#detection).
- [`data-model.md → App settings storage`](../../../../data-model.md#app-settings-storage)
  and
  [`Chapters / memory system`](../../../../data-model.md#chapters--memory-system).
- [`layout.md → Stacking`](../../../../ui/foundations/mobile/layout.md#stacking)
  and
  [`Surface bindings`](../../../../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
- [`testing.md → Mock LLM`](../../../../testing.md#mock-llm),
  [`Fixture + seed contract`](../../../../testing.md#fixture--seed-contract),
  [`Embedder in E2E`](../../../../testing.md#embedder-in-e2e) and
  [`Test taxonomy`](../../../../testing.md#test-taxonomy).
- The milestone's
  [Definition of done](../milestone.md#definition-of-done), and
  [C1](../milestone.md#c1--a-closes-delta-shape),
  [C2](../milestone.md#c2--pipeline-shape),
  [C3](../milestone.md#c3--the-chapter-context-group),
  [C4](../milestone.md#c4--close_report-v1),
  [C5](../milestone.md#c5--token-reads-and-the-progress-hook),
  [C7](../milestone.md#c7--chapter-overlays),
  [C8](../milestone.md#c8--seed-stability),
  [C10](../milestone.md#c10--what-a-chapter-may-end-on),
  [C14](../milestone.md#c14--the-manual-start-and-pendingclose) and
  [C16](../milestone.md#c16--flip-rule).
- Lessons:
  [a Portal owner stays mounted](../../../lessons-learned/portal-owner-mount-is-not-open.md),
  [the expo-dom bridge](../../../lessons-learned/expo-dom-bridge-identity-and-rejections.md),
  [Dialog's responder claim](../../../lessons-learned/dialog-content-responder-claim.md),
  [a disabled `IconAction` renames itself](../../../lessons-learned/disabled-iconaction-renames-itself.md),
  [disabled clicks](../../../lessons-learned/rn-primitives-disabled.md),
  [no harmless id leaks](../../../lessons-learned/no-harmless-id-leaks.md),
  [the seeded tip moves at the first Send](../../../lessons-learned/seed-tip-position-shifts-at-first-send.md).

## Scope: in

**The catalogs, first.** The plan's first task reads what each provider's
`/models` publishes about tool support and writes the answer into
[`architecture.md → Detection`](../../../../architecture.md#detection). The
dev llama.cpp router's first row has no such field (read 2026-11-01, one
row). If no catalog publishes one, detection stays `unknown`, which runs,
and the catalog bullet below drops out.

**Phase 1 (C2's `boundary`).**

- `closeCandidates(series, threshold)` in `lib/chapters`, pure over
  `openRegionSeries`' rows. It walks the running token total and keeps each
  row passing `canEndChapter` whose total sits from half a threshold to one
  and a half, both inclusive, leaving out the newest reply.
- `chapterBoundarySchema`, plain `{ end_entry_id, rationale }`, exported
  from `lib/pipeline` for the shape below. The phase wraps it in `.refine`
  over that call's candidates, so the rendered block stays static and the
  mock's block match holds. On zod 4.4.3, `z.toJSONSchema` gave identical
  output for both and the parse enforced the refinement (run 2026-11-01).
  The comment at `lib/ai/generate.ts:436` naming refinements as a throw
  goes.
- Candidates reach the model as turn handles, `t1…tN` in position order, the
  spelling `lib/classifier/window.ts:57` and
  [Slice 5.5a](./05a-task-runner.md)'s id layer use. They're per call, since
  no chapter range exists yet. `end_entry_id` carries a handle, which code
  resolves: a floor model can't be trusted to copy a UUID, and an E2E can then
  name a candidate before its entries exist.
- `TEMPLATE_IDS.chapterBoundary`, in the `chapter` group with everything in
  the user half (C3), so it takes no exemption in
  `system-half-stability.test.ts`. Variables, in `templateContextMap.ts`:
  each candidate's handle, position, and opening and closing sentences; the
  region's token total; the threshold; the branch's active threads.
- `firstLastSentences(text)` in `lib/text`, over `promptProse`, as the
  pass's window reads prose. Nothing in `lib` splits sentences today. It
  takes CJK sentence marks and a character cap, so a reply with no sentence
  break can't put its whole prose in the prompt. Boundary reads candidates'
  content by id from SQL, since `openRegionSeries` carries none.
- `chapter-close-boundary.ts`. A standing `pendingClose` makes no call, as
  [Slice 5.6](./06-close-owed.md) leaves it. So does a region with no
  candidate, which takes `fallbackChapterEnd(series)`. Otherwise
  `generateStructured('lore-mgmt', …)` under C2's agent-keyed bound, with
  its same-prompt retry, yielding `recoverable_error` per retried attempt:
  - `ok`: the handle's entry.
  - `failed`, tier `parse` or `reply-cut-off`: `fallbackChapterEnd`, as
    `lib/pipeline/definitions/suggestion-refresh.ts:156-159` branches.
    Logged, with the event added to
    [`observability.md → Subsystem emission inventory`](../../../../observability.md#subsystem-emission-inventory).
    The cut-off half follows [Open questions](#open-questions).
  - `failed`, any other tier: `{ status: 'failed', error }`, so the close
    reverses.
  - `not-configured`: a `config-resolver` failure, as
    `suggestion-refresh.ts:146-155` returns.
  - `aborted`, or a signal aborted after the call: `{ status: 'aborted' }`.

  `rationale` goes to the debug log only. Canon stores it nowhere.

- Output bound. `StructuredCallOptions` gains a default max output, unless
  [Slice 5.2](./02-first-chapter.md) added one for metadata, and boundary
  passes [Slice 5.4](./04-tool-step.md)'s 8k, reported to `replyCutOff` as a
  step reports it. A profile's value wins. A reasoning spiral then costs one
  bounded reply and a fallback, not a timeout that fails the close.

- `storyShape('chapter-boundary', chapterBoundarySchema)` in
  `scripts/mock-llm/shapes.ts`, and an `EXAMPLES` entry naming no candidate,
  so a spec that sets nothing takes the fallback and stays inert. A default
  `chapter-boundary` lane in `scripts/mock-llm/state.ts`, inert like the
  `periodic-classifier` lane: a reply naming no candidate, so `pnpm mock` takes
  the fallback.

**`toolCalling`.**

- `toolCalling: z.boolean().optional()` in `providerCapabilitiesSchema`
  (`lib/db/app-settings/app-settings-schema.ts:21-39`). Optional JSON, no
  migration.
- If a catalog publishes it: `CatalogEntry` gains `toolCalling?`,
  `readToolCalling(raw)` sits beside `readContextWindow`, and
  `normalizeModelCatalog` layers it under the stored capability, so a stored
  value wins, as every user-overridable flag does (`lib/ai/catalog.ts:53-57`).
- `ResolverInput` gains `requires?: 'toolCalling'`
  (`lib/pipeline/types.ts:129-132`), and the `agent` phase's `lore-mgmt`
  input sets it. C2's three `resolves` stay as pinned.
- `runPreflight` passes such an input's resolved model through
  `resolveModelCapabilities` and returns a `config-resolver` failure,
  `failure: 'tool-calling-off'`, only on an explicit `false`. An unknown or
  custom model passes, and a story override reads the override's model,
  since `resolveModel` returns it.
- The type splits. `ResolveFailureKind` (`lib/ai/resolve-model.ts:25`) stays
  the chain's union, since `resolveModel` never returns this failure, so
  `ChainDescription` and the typed key at
  `components/story-settings/models-panel.tsx:49` don't change, and no dead
  copy line lands there. `ConfigFailureKind`, `ResolveFailureKind` plus
  `'tool-calling-off'`, goes in `lib/pipeline/types.ts` as the `failure` of
  `PipelineError`'s `config-resolver` arm. `TURN_RESOLVER_COPY`,
  `PASS_RESOLVER_COPY`, `SUGGESTION_RESOLVER_COPY`, `FIX_LABEL`, 5.6's
  `CLOSE_RESOLVER_COPY` and `EXPECTED` in
  `components/reader/resolver-failure-copy.test.tsx` are keyed by it. `FIX_LABEL`
  maps the new kind to `reader:systemEntry.fixProfile`, which lands on the
  Providers tab until M7.1.
- The can't-call-tools entry: canon's **Chapter close's model can't call
  tools**, as `CLOSE_RESOLVER_COPY`'s line through 5.6's
  `describeCloseFailure`, with `Fix profile` and `Dismiss`. 5.6 already drops
  `Retry` on a `config-resolver` entry. The copy names the model and can't
  cite a tool badge, which is M7.1's.
- The click's pre-flight. `runPreflight` is exported from `lib/pipeline`, and
  `startManualClose` runs it among its refusals, over the same snapshot
  `driveRun` builds, so a failure writes no `pendingClose` and starts no pass.
  It catches every resolver failure, not only this one. The result gains
  `{ outcome: 'preflight-failed', error }`, since no run exists for a
  `TxResult`. See [Open questions](#open-questions).
- The hint's arm. [Slice 5.4](./04-tool-step.md) lands the keywords, the
  carried arm, `HINT_FIX_TAGS` and the turn and pass keys, and
  [Slice 5.6](./06-close-owed.md) the `close` surface and its key, so this
  slice adds one test: a close failing with a `toolCalling` hint shows the
  hedged line and `Fix profile`, which lands on Providers. Code lands here
  only if that test finds a gap.

**The modal, on C7's store.**

- `openCloseModal` runs the registered surface's `guard` before it sets the
  modal's state, so no trigger can skip it (C7,
  [Slice 5.11](./11-review-window.md)'s `registerSurface`). The reader has
  nothing to guard, so its default `(proceed) => proceed()` opens the modal at
  once: it has no save session, and a close writes no entry content, so an open
  inline edit isn't at risk.
- `CloseChapterModal` in `components/chapters/close-chapter-modal.tsx`,
  rendered by `ChapterOverlaysHost`: a pure `CloseChapterModalView`, props
  in, and a connected body rendered only while open, so its reads don't
  run for the life of the app. The state is cleared on Cancel, on confirm,
  and when the open story's branch stops being `branchId`.
- Title, framing sentence, start row, picker trigger, `tokens in range` and
  foot per canon, on `Dialog`, at every tier. `Dialog` already registers as
  a blocking overlay (`components/ui/dialog.tsx:81-82`).
- The start row is the region's first entry, with
  `Chapter <N> ended here` from the highest `sequenceNumber` in
  `chaptersStore`, and no tag on a story with no closed chapter.
- The end-entry panel opens in-flow, newest first, offering only rows
  passing `canEndChapter`, in canon's two-line layout. The default is the
  `endEntryId` passed, when it's still in the list, else the latest reply,
  tagged `latest`. The panel is the dialog's one scroll region
  (`scrollable={false}`), capped so the foot stays on screen, since nested
  scrollers fight on Android. A region with auto-close off has no upper
  bound, so the list virtualizes as `SearchableOverlayList` does.
- Reads. `useEntryIndex(branchId, { enabled })` gives excerpts, positions
  and kinds, and `formatEntryRef` labels them. `openRegionSeries` gives
  tokens. `EntryRef` carries no time, so `readOpenRegionTimes(branchId, db)`
  in `lib/entry-refs`, one query over `openRegionWhere`, gives each row's
  `metadata.worldTime`, formatted with the story's `CalendarFrame`. A row
  with no time shows none. The body calls that read's `refetch()` when it opens,
  for C15's reason: the query client never goes stale, and a world-time edit
  moves neither `settleCount` nor the tail.
- `tokensThrough(series, entryId)` in `lib/chapters` drives the live count.
- `Close chapter` closes the modal at once, since a close runs under the
  banner, and hands `startManualClose(branchId, endEntryId, ctx)`'s promise to
  the host, which outlives the body and may wait minutes for it. `rejected`
  raises a warning toast naming why. `preflight-failed` writes the entry
  through 5.6's system-entry action with `toCloseFailureMeta`, which lives in
  `components/`, and raises a warning toast. A run's result needs nothing,
  since the run's own surfaces speak. The button is disabled with the gate's
  reason while `isUserEditBlocked` holds, reactively.

**Entry points.**

- `buildStoryToolsGroup` in `components/compounds/story-tools-group.ts`,
  beside `buildGoToGroup`. `AppActionsMenuPure` takes it between `GO TO` and
  `APP`. Its one entry, `Close chapter…`, is absent when `canClose` is false,
  disabled with the uniform tooltip while the gate holds, and otherwise calls
  `openCloseModal({ branchId })`. Routes pass `canClose` from the
  `useChapterProgress` return they hold, and the gate the route already holds.
  `AppActionsMenu` reads neither today.
- Popover, per C16: `ChapterPopover`'s `Close chapter manually` gets
  `openCloseModal({ branchId })`, after the overlay has closed, so no Sheet
  sits under the modal.
- Card, per C16: `ChapterInProgressCard`'s `Close chapter…` gets the same
  call.
- Both stay disabled with a reason while the gate holds or `canClose` is
  false, and their "lands later" reasons and keys go.
- `Close chapter here`: `onCloseChapterHere` on `EntryCard`, an `IconAction`
  before delete, gated by `disabled` as branch is. The card shows it when the
  row is eligible and a handler is passed, with no kind test of its own, so C10
  keeps one copy. The head's `pr-28`
  (`components/compounds/entry-card.tsx:1099`) grows to fit.
- Eligibility is a host-computed side table, `closeHereEntryIds`, on
  `ReaderSurfaceProps`: the rows with no `chapterId` passing `canEndChapter`,
  built in `components/reader/close-here-entries.ts` and memoized as
  `worldTimeDecorations` is. `ReaderRow` takes a flat boolean, which keeps its
  memo compare holding (`components/reader/reader-surface.tsx:76-77`), and
  passes the handler only when it's true. The rule stays with the host, across
  the `'use dom'` boundary (`components/reader/reader-document.tsx:1`), where
  every prop is plain data and every function async. The host's
  `onCloseChapterHere: (entryId) => Promise<void>` opens the modal with the end
  picked.
- `Ready to close`: `isReadyToClose(progress, autoClose)` in `lib/chapters`,
  true when auto-close is off, `tokens >= threshold` and `canClose` holds.
  A text label in the popover's progress row and on
  `ChapterInProgressCard`'s progress line. See
  [Open questions](#open-questions).
- `app/dev/chapter-close.tsx` and its `app/dev/index.tsx` line go, as
  [Slice 5.2](./02-first-chapter.md) hands over, with what came with
  them: `useColdOpenStory`'s `'dev_chapter_close'` surface and its test
  case, `e2e/locators/dev-chapter-close.ts`, and the two
  `dev_chapter_close_*` kinds in `docs/observability.md`; an unused union
  member draws no compiler error. `e2e/tests/first-chapter.spec.ts` moves
  onto a real start.

**The proofs.**

- `e2e/tests/chapter-close-auto.spec.ts`, the milestone's Auto close line,
  and the first E2E through scripted tool steps. The fixture needs a
  starting row for each of the seven tasks, or the task makes no call and
  the order can't be asserted: two near-identical happenings for a cluster,
  through the harness's real embedder (`e2e/harness/embedder.ts`), an open
  thread, an off-scene row the prose names, and an active character or faction
  the closed range names, which is what [Slice 5.8](./08-prose-tasks.md)'s
  Lifecycle read selects. The spec scripts Lifecycle's write on that row through
  the placeholder the prompt gives it.
- `pnpm probe:close` over all seven tasks on 5.2's dataset chapter, on the
  dev model, with every step's messages saved. Steps, tokens, wall time and
  report size go in Implementation notes.
- The reversal cost of a full group: how long CTRL-Z of a close and its redo
  take over the whole group on that chapter, on desktop and on Android. The
  numbers go in Implementation notes, and a bad one goes to the developer.

**Canon and inventory, in the same PR as the code.**

- `chapter-close.md`: `Manual user-triggered close` says the entry's button
  opens the modal and the confirm pre-flights; `Tool calling` or
  `architecture.md → Detection` names the catalog field, or says none exists;
  `Ready to close`'s place.
- `chapter-timeline.md → Chapter-close modal`: "Triggered from two places"
  becomes canon's four triggers. `In-progress chapter card` gains
  `Ready to close`.
- `reader-composer.md`: the action table, the AI entry's set and the popover's
  `Ready to close`. `entry-card.md`: Compound API, Per-kind structure, Action
  cluster and the Storybook list. `icon-actions.md → Glyph vocabulary` and
  `iconography.md → Per-entry actions`: the new row.
- `actions-menu.md`: `Close chapter…`'s predicate names `canClose`.
- `save-sessions.md → Intercept categories`: starting a close intercepts,
  since Save would otherwise write a draft over the close's writes.
- `reader-composer.html` and `chapter-timeline.html`, in the same commit: the
  entry's action, `Ready to close`, and the modal's triggers.
- `component-inventory.md`: `CloseChapterModal`, and `EntryCard`'s row.

## Scope: out

- `closeOwed`, `pendingClose`'s lifecycle, `startManualClose`'s other
  refusals, phase 0, the no-model fallback, the system-entry writer, the close
  hint's keys and the banner: [Slice 5.6](./06-close-owed.md).
- The overlay store, the host's mount, `registerSurface`, the review window
  and the commit toasts: [Slice 5.11](./11-review-window.md).
- The popover and the chips, and whether the phone chip hides with no closed
  chapter: [Slice 5.3](./03-reader-chapters.md).
- The Timeline's cards, and what expands after a close, which keeps 5.7's
  default: [Slice 5.7](./07-chapter-timeline.md).
- Regenerate's confirm over a close ending on the newest reply:
  [Slice 5.12](./12-chapter-delete-rollback.md).
- `generateToolStep` and `setToolSteps`: [Slice 5.4](./04-tool-step.md).
  `pnpm probe:close` itself: [Slice 5.5a](./05a-task-runner.md). Every task
  and tool: [Slice 5.5b](./05b-identity-threads.md),
  [Slice 5.8](./08-prose-tasks.md) and
  [Slice 5.9](./09-chapter-wide-tasks.md).
- The rest of `STORY TOOLS`: `Flip era…` and `Set lead character…` (M7.2).
- The tool badge, the `lore-mgmt` warning, the `Chapter close` switches and
  `Set window` on a close's entries (M7.1).
- `closeConversation: single` and `closeTools: shared` (M7.1).
- The two-dialog guard rework. Routing every start through the guard leaves
  dirty-and-busy unreachable, so it's dropped unless a case appears, and
  [`parked.md → A dirty links array on Save overwrites concurrent link writes`](../../../../parked.md#a-dirty-links-array-on-save-overwrites-concurrent-link-writes)
  stays parked.
- A close's display translation (M8.1).
- Tuning:
  [`followups.md → Tuning and play testing`](../../../../followups.md#tuning-and-play-testing).
  The full run answers whether the close holds, not whether it's good.

## Acceptance criteria

Unit paths run with `pnpm vitest run --project unit <path>`.

**Phase 1**

1. `lib/chapters/close-candidates.test.ts`, with literal expectations: a reply
   at exactly half and at exactly one and a half thresholds is a candidate, and
   one token outside either is not; the newest reply never is, including under
   a tail of user actions; `user_action`, `opening` and `system` rows never are;
   a region where none qualifies returns empty.
2. `lib/pipeline/definitions/chapter-close-boundary.test.ts`: a standing
   `pendingClose` and a region with no candidate each make no model call; a
   valid handle sets the range's `endEntryId` to that candidate; a reply naming a
   non-candidate twice completes the phase on `fallbackChapterEnd`'s entry after
   two calls; a reply cut off falls back after one call; a provider failure returns
   `{ status: 'failed' }` and writes no range; an abort returns
   `{ status: 'aborted' }`; with no profile max output the call sends 8000, and
   a profile's value replaces it.
3. The same file: `z.toJSONSchema` of the refined schema equals the plain one's,
   so a change to the wrapper fails here before the mock's match does.
4. `scripts/mock-llm/shapes.test.ts` and `scripts/mock-llm/state.test.ts` pass
   with `chapter-boundary`, and
   `lib/prompts/bundled/system-half-stability.test.ts` passes with no exemption
   for `TEMPLATE_IDS.chapterBoundary`.
5. `lib/text/first-last-sentences.test.ts`: two sentences, one sentence, a CJK
   reply, and a reply with no sentence break, capped.

**`toolCalling`**

6. `lib/pipeline/runtime/preflight.test.ts`: a `lore-mgmt` model with `false`
   returns `failure: 'tool-calling-off'`, `target: 'lore-mgmt'`,
   `phaseName: 'agent'`; `true`, an absent flag and a custom model id pass; a
   story override's model is the one read; a `no-profile-assigned` still comes
   first.
7. `lib/ai/catalog.test.ts`, if a catalog publishes the field: a published value
   lands, a stored value beats it, an absent one stays undefined.
   `lib/db/app-settings/app-settings-schema.test.ts` keeps the flag through a
   parse either way.
8. `components/reader/resolver-failure-copy.test.tsx` covers
   `'tool-calling-off'`, `pnpm typecheck` passes with every record exhaustive, and
   `grep tool-calling-off locales/en/story-settings.json` finds nothing.
9. `lib/actions/chapters/start-manual-close.test.ts`: with the flag `false`, it
   returns `preflight-failed`, writes no `pendingClose` and starts no run, a pass
   included. `components/chapters/chapter-overlays-host.test.tsx`: that result
   writes the entry and toasts, `rejected` only toasts, and a run's result does
   neither.
10. `components/reader/system-entry-actions.test.tsx`: the can't-call-tools entry
    offers `Fix profile` and `Dismiss` and no `Retry`, and a close's `toolCalling`
    hint offers `Fix profile`.

**Modal**

11. `lib/stores/ui/chapter-overlays.test.ts`: a registered guard that doesn't
    proceed leaves the modal shut, one that proceeds opens it with the
    `endEntryId` passed, and a surface with nothing to guard opens it at once.
    `components/chapters/chapter-overlays-host.test.tsx`: the modal's state clears
    when the open story's branch stops being its `branchId`.
12. `components/chapters/close-chapter-modal.stories.tsx`, play: the panel lists
    only replies, newest first; the default is the latest, tagged `latest`; a
    pick updates the trigger and `tokens in range` to the literal count and
    collapses the panel; an `endEntryId` opens with it picked; a story with no
    closed chapter shows the start row with no tag; the disabled state shows the
    gate's reason. At 390 px through the viewport it stays a Modal with the panel
    in-flow.
13. `lib/chapters/tokens-through.test.ts`: the sum runs through the picked entry
    and no further.
14. `lib/entry-refs/read.test.ts`: `readOpenRegionTimes` covers only the open
    region and omits a row with no time.

**Entry points**

15. `components/compounds/story-tools-group.test.ts`: `canClose` false gives no
    entry, the gate gives a disabled entry with its reason, otherwise activating
    calls `openCloseModal` with the branch.
    `components/compounds/app-actions-menu-pure.stories.tsx` shows `GO TO`,
    `STORY TOOLS`, `APP` in that order.
16. `e2e/tests/chapter-close-starts.spec.ts`: a close started from the Actions
    menu on World, Plot, Story Settings, the reader and the Timeline, from the
    popover, from the in-progress card and from `Close chapter here`, each at a
    picked `ai_reply`, ends with a `chapters` row whose `end_entry_id` is that
    entry, read from the DB, and every entry through it stamped. Chapters are named
    by title or number, never by position (C8).
17. The same spec: with a dirty pane on World, Plot, Story Settings and the
    Timeline, `Close chapter…` raises `Unsaved changes` first. Cancel leaves no
    modal, no run and no new `chapters` row, and Discard opens the modal.
18. The same spec, with `toolCalling` false on the `lore-mgmt` model: the confirm
    sends the mock no request, adds no `chapters` row, and writes the system
    entry.
19. `components/compounds/entry-card.stories.tsx`: the action shows with a handler
    and not without one, disabled with its reason under the gate, and at 390 px the
    head's text clears the cluster. `components/reader/close-here-entries.test.ts`:
    only open-region rows passing `canEndChapter` are in the table.
    `components/reader/reader-surface.stories.tsx`: a row outside the table shows
    no action.
20. Stories for `ChapterPopover` and `ChapterInProgressCard`: `Ready to close`
    shows with auto-close off, the threshold met and `canClose` true, and with any
    one of the three flipped it doesn't. `lib/chapters/is-ready-to-close.test.ts`
    pins the same table.
21. `grep -rn "dev/chapter-close" app e2e` finds nothing, and
    `pnpm test:e2e -- first-chapter` passes on a real start.

**The whole close**

22. `pnpm test:e2e -- chapter-close-auto`, after `pnpm build:web`. A turn crosses
    the threshold with entries unprocessed and the cadence not due. The mock's
    `requests` show a `periodic-classifier` call, then `chapter-boundary`, then the
    seven tasks' tool lanes in canon's order. `chapters.end_entry_id` is the
    scripted candidate, which isn't the fallback's entry. Each task's scripted
    write landed. Every delta of the run has `source = 'chapter_close'`, one
    `action_id`, and `entry_id` equal to the end entry. `close_report.calls` holds
    the writes in run order.
23. Implementation notes hold the seven-task `pnpm probe:close` run, with
    `SMOKE_LLM_URL`, `SMOKE_LLM_MODEL` and `PROBE_OUT` set and every step's
    messages saved, at the bar 5.5b's planning set, applied to each task. A miss
    went to the developer before merge.
24. Implementation notes hold how long CTRL-Z of a full close and its redo take
    over the whole group on 5.2's dataset chapter, on desktop and on Android, with
    device and build.

**Gates**

25. Every new string routes through `t()`, and `pnpm lint`, `pnpm typecheck`,
    `pnpm lint:docs`, `pnpm format:check`, `pnpm compiler:check` and
    `pnpm test:run` pass.
26. `grep -l "Close chapter here"` finds `reader-composer.md`,
    `reader-composer.html`, `entry-card.md`, `icon-actions.md` and
    `iconography.md`, and `grep -n "Triggered from two places"` finds nothing in
    `chapter-timeline.md`.

## Tests

- **Vitest, unit:** `closeCandidates`, `tokensThrough`, `isReadyToClose`,
  `firstLastSentences`, the phase, pre-flight, the catalog, the store's guard, the
  story-tools group, the side table, `readOpenRegionTimes` on a real SQLite
  fixture. Expectations are literal: a bound derived from the constant under test
  can't fail.
- **Mutation check:** make `closeCandidates` keep the newest reply, make the phase
  always take the fallback, and make `runPreflight` treat an absent flag as off.
  Each must turn a test red. The Auto close spec's candidate has to differ from the
  fallback's entry, or the second mutation passes it.
- **Storybook, browser project:** the modal at both tiers, `EntryCard`,
  `ChapterPopover`, `ChapterInProgressCard`, `AppActionsMenuPure`. Phone tier
  through the viewport, not a narrow wrapper.
- **E2E:** `chapter-close-starts.spec.ts` and `chapter-close-auto.spec.ts`. Both
  drive the UI and assert the DB, set the threshold and flag through seed helpers
  beside `setClassifierCadence` (`e2e/harness/seed.ts:281`), and read entry ids
  from the DB. Tool steps go through `setToolSteps` with function steps, since a
  step can name only the placeholders its prompt holds. A disabled
  `Close chapter here` renames itself to its reason, so a locator waits for the
  gate to open first.
- **Manual:** on the Android dev client, `Close chapter…` from the Actions Sheet and
  from the popover's Sheet, checking no Sheet stays under the modal and the panel
  scrolls; `Close chapter here` at phone width. Desktop smoke through the
  `electron-app` MCP.
- **Dev model:** the full `pnpm probe:close` run and the full group's reversal
  cost, as criteria 23 and 24.

## Open questions

Each has a default this doc builds on. Slice planning confirms it, and any change
amends the scope above.

- **What does a failed click pre-flight leave behind?** Canon has the click
  pre-flight the close and any pre-flight failure raise a system entry, while the
  run's own pre-flight fires after phase 0. Default: nothing is owed and no pass
  runs, and the entry goes in. From World the entry is off screen, so a warning
  toast goes with it. Unlike 5.6's run failure toast, it promises no rerun. Is the
  toast right, given that canon names only the entry?
- **Does `Close chapter here` open the modal or start at once?** Default: the modal
  with the end picked. It costs a second press and keeps one confirm, the token
  count and canon's uniform flow, and C7's `endEntryId` exists for it. Canon's
  "clicking pre-flights" then moves to the modal's confirm. Which glyph, and where
  in the cluster? Suggested: Lucide `Flag`, before delete. The cluster has no room
  to spare at phone width once M6's branch and M7.2's flip era arrive.
- **What else gates `Close chapter…`?** C5 and C10 settle an empty region and an
  opening-only branch, which hide it. A held branch and a close already owed are
  undecided. Default: neither gates it. A held branch reaches `startManualClose`,
  whose refusal toasts, with no new read per menu render, and a close already owed
  opens the modal and follows 5.6's rule for a second pick. Should a held branch
  show disabled with a reason instead?
- **Where does `Ready to close` sit, and how does it differ from the red strip?**
  Canon says only "near chapter management controls". Default: text in the popover's
  progress row and on the in-progress card. At 90% and over the strip's canon meaning
  is "close imminent", which is false with auto-close off. Does that copy need a line?
- **Does a close landing under World or Plot hide the reply's last lines?** The reader's
  surface records no height while it's hidden, so a break that commits then never re-pins.
  Chromium keeps `scrollTop` across `display:none`, and a break committed while hidden at
  the bottom left the reader short of the tail on return, with no scroll event to raise
  the jump button. That shortfall was seen in Chromium, in a scratch story. On native a
  covered WebView should keep its layout, which is reasoned, not run, so it hasn't been
  observed on a device. Default: on return, re-pin when the reader was at the bottom as it
  hid.
- **Is any dirty-and-busy case left?** By trace, no: every start passes the guard,
  inputs disable while a run holds the gate, and only the reader otherwise starts
  a run. That trace predates 5.7's per-card session, so recheck it there first. A
  case found means the merge and the two-dialog rework come back as a design
  question, not a patch.
- **Is a cut-off boundary reply unusable, or a failed call?** Canon names only a
  provider failure as failed. Default: a `reply-cut-off` takes the fallback, since
  that loses nothing and a failed close stops the next Send.
- **Does boundary take the 8k output default?** Canon states it for a step, and a
  story override otherwise sends no limit. Default: yes, as Scope has it. If 5.2
  answered no for metadata, keep the two calls alike or say why they differ.
- **Can a close run on each side of one turn?** Canon says one close per turn when
  auto-close turns on late, and Send plus the turn's chain gives two.
  [Slice 5.6](./06-close-owed.md) left the chain alone, because this slice's
  candidates are what make it reachable, by capping a chapter's size. Run a story
  with auto-close turned on late and decide whether the turn's chain skips a close
  when its Send ran one.
- **May detection write `false`?** A stored flag beats detection, so a detected
  value is never refreshed and can't be told from the user's. A catalog's `false`
  stops the close on that model, with no switch in the app until M7.1, and with
  auto-close on it stops every Send. Default: if a catalog publishes the capability,
  store what it says; the remedy until M7.1 is a `lore-mgmt` override on the story's
  Models tab, or auto-close off. Should detection write only `true`, leaving the
  rest unknown?
- **Is 5.5b's bar the right one for seven tasks?** Default: the same bar per task.
  A miss on a task 5.5b didn't measure comes back to the developer, and tuning
  stays in followups.
- **Does the size hold?** The estimate is 20 tasks, at the ceiling. Check the plan
  skeleton. If it passes, the modal and entry points can split from Phase 1 and the
  flag, while the proofs need both and stay last.
- **One helper for a bounded structured call?** The sequence
  `boundedSignal`, `generateStructured`, dispose, `retriedAttemptEvents`,
  aborted-versus-expired, `structuredCallFailure` is written out twice
  after [Slice 5.2](./02-first-chapter.md): the periodic classifier pass
  and the close's metadata call
  (`lib/pipeline/definitions/chapter-close-metadata-call.ts`).
  [Slice 5.4](./04-tool-step.md)'s tool step keeps its bound and expiry
  branch inside `lib/ai`, so 5.10's boundary call would be the third copy
  of the pipeline-side sequence, and a helper would have to decide whether
  it also covers the step's in-`lib/ai` expiry branch. Suggested: one
  helper in `lib/pipeline` returning `ok | aborted | failed`, landed with
  the first new caller.
  `ResolveModelConfig` is built inline at each structured caller too
  (`lib/pipeline/runtime/preflight.ts:18`, and under
  `lib/pipeline/definitions/`: `periodic-classifier.ts`,
  `suggestion-refresh.ts`, `per-turn-piggyback.ts`,
  `chapter-close-metadata-call.ts`; `per-turn.ts` builds it inline too),
  and `generateToolStep` takes one (`config`, in
  [Slice 5.4](./04-tool-step.md)). One builder would
  keep a new field from being missed at one of them. Routed from triage
  2026-11-06.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
