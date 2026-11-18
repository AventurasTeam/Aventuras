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
- **Blocks:** [Slice 5.13](./13-close-rerun.md), which re-runs the whole
  close it wires

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
  The comment at `lib/ai/generate.ts:445` naming refinements as a throw
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
  region's token total and the threshold (both replaced by the window's
  bounds, the 2026-11-18 decision below); the branch's active threads.
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
    `lib/pipeline/definitions/suggestion-refresh.ts:156-159` branches
    (the latest candidate after the output-bound decision below).
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
  passes [Slice 5.4](./04-tool-step.md)'s 8k (16,384 after the 2026-11-18
  decision below), reported to `replyCutOff` as a
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
  value wins, as every user-overridable flag does (`lib/ai/catalog.ts:53-57`;
  a published value replaces it after the detection decision below).
- `ResolverInput` gains `requires?: 'toolCalling'`
  (`ResolverInput` in `lib/pipeline/types.ts`), and the `agent` phase's `lore-mgmt`
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
  Providers tab until M7.1. The action reads `Fix story override` when the
  story overrides `lore-mgmt`, by its rule
  ([`generation-pipeline.md → Cut-off replies`](../../../../generation-pipeline.md#cut-off-replies)).
  `useConfigFixAction` in `components/reader/system-entry-actions.tsx`
  applies it to every `FIX_LABEL` kind that reads `Fix profile`, by the
  slot the entry keeps in `systemFailure.target`, so mapping the new kind
  to `fixProfile` is enough.
  The copy names the model, so it needs no `fromOverride`.
- The can't-call-tools entry: canon's **Chapter close's model can't call
  tools**, as `CLOSE_RESOLVER_COPY`'s line through 5.6's
  `describeCloseFailure`, with `Fix profile`, `Retry` and `Dismiss`, since 5.6
  keeps `Retry` beside the fix on every `config-resolver` entry. The copy names
  the model and can't cite a tool badge, which is M7.1's.
- The click's pre-flight. `runPreflight` is exported from `lib/pipeline`, and
  `startManualClose` runs it among its refusals, over the same snapshot
  `driveRun` builds, so a failure writes no `pendingClose` and starts no pass.
  It catches every resolver failure, not only this one. The result gains
  `{ outcome: 'preflight-failed', error }`, since no run exists for a
  `TxResult`. See [Open questions](#open-questions).
- The system-entry writer. `raiseSystemEntry` in
  `lib/actions/story-entries/system-entry.ts`, exported from `lib/actions`,
  carries a standing entry's `submission` across, writes, and patches
  `entriesStore`, where `writeSystemEntry` leaves the store to its route's
  `reload`. The host's `preflight-failed` arm is its first caller, so a loaded
  branch shows the entry without a reload.
- The hint's arm. [Slice 5.4](./04-tool-step.md) lands the keywords, the
  carried arm, `HINT_FIX_TAGS` and the turn and pass keys, and
  [Slice 5.6](./06-close-owed.md) the `close` surface and its key, so this
  slice adds one test: a close failing with a `toolCalling` hint shows the
  hedged line and `Fix profile`, which lands on Providers. Code lands here
  only if that test finds a gap.

**The modal, on C7's store.**

- `openCloseModal` runs the registered surface's `guard` before it sets the
  modal's state, so no trigger can skip it (C7,
  [Slice 5.11](./11-review-window.md)'s `registerSurface`). On the reader that
  guard is the inline edit session's
  ([`reader-composer.md → Inline edit session`](../../../../ui/screens/reader-composer/reader-composer.md#inline-edit-session)):
  a dirty draft raises Save / Discard / Cancel first, since the close reads the
  chapter's stored prose. The reader registers it through `useOverlaySurface`.
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
  through `raiseSystemEntry` (above) with 5.6's `toCloseFailureMeta`, which
  lives in `components/`, and raises a warning toast. A run's result needs
  nothing, since the run's own surfaces speak. The button is disabled with the
  gate's reason while `isUserEditBlocked` holds, reactively.

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
  memo compare holding (`ReaderRow` in `components/reader/reader-surface.tsx`), and
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
  refusals, phase 0, the no-model fallback, the close hint's keys and the
  banner: [Slice 5.6](./06-close-owed.md).
- The overlay store, the host's mount, `registerSurface`, the review window
  and the commit banner: [Slice 5.11](./11-review-window.md).
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
   non-candidate twice completes the phase on `fallbackChapterEnd`'s entry (the
   latest candidate's, after the output-bound decision below) after two calls; a
   reply cut off falls back after one call; a provider failure returns
   `{ status: 'failed' }` and writes no range; an abort returns
   `{ status: 'aborted' }`; with no profile max output the call sends
   8000 (16,384 after the 2026-11-18 decision below), and a profile's
   value replaces it.
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
   lands, a stored value beats it (a published value replaces it, after the
   detection decision below), an absent one stays undefined.
   `lib/db/app-settings/app-settings-schema.test.ts` keeps the flag through a
   parse either way.
8. `components/reader/resolver-failure-copy.test.tsx` covers
   `'tool-calling-off'`, `pnpm typecheck` passes with every record exhaustive, and
   `grep tool-calling-off locales/en/story-settings.json` finds nothing.
9. `lib/actions/chapters/start-manual-close.test.ts`: with the flag `false`, it
   returns `preflight-failed`, writes no `pendingClose` and starts no run, a pass
   included. `components/chapters/chapter-overlays-host.test.tsx`: that result
   writes the entry and toasts, `rejected` only toasts, and a run's result does
   neither. `lib/actions/story-entries/system-entry.test.ts`: `raiseSystemEntry`
   keeps a standing entry's `submission` and patches a loaded branch's store.
10. `components/reader/system-entry-actions.test.tsx`: the can't-call-tools entry
    offers `Fix profile`, `Retry` and `Dismiss`, and a close's `toolCalling` hint
    offers `Fix profile`.

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
16. `chapter-close-starts-menus.spec.ts` and `-inline.spec.ts`: a close started from the Actions
    menu on World, Plot, Story Settings, the reader and the Timeline, from the
    popover, from the in-progress card and from `Close chapter here`, each at a
    picked `ai_reply`, ends with a `chapters` row whose `end_entry_id` is that
    entry, read from the DB, and every entry through it stamped. Chapters are named
    by title or number, never by position (C8).
17. `chapter-close-starts-guards.spec.ts`: with a dirty pane on World, Plot, Story Settings and the
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
  story-tools group, the side table, `raiseSystemEntry`, and
  `readOpenRegionTimes` on a real SQLite fixture. Expectations are literal: a
  bound derived from the constant under test can't fail.
- **Mutation check:** make `closeCandidates` keep the newest reply, make the phase
  always take the fallback, and make `runPreflight` treat an absent flag as off.
  Each must turn a test red. The Auto close spec's candidate has to differ from the
  fallback's entry, or the second mutation passes it.
- **Storybook, browser project:** the modal at both tiers, `EntryCard`,
  `ChapterPopover`, `ChapterInProgressCard`, `AppActionsMenuPure`. Phone tier
  through the viewport, not a narrow wrapper.
- **E2E:** `chapter-close-starts-{menus,inline,guards}.spec.ts` and
  `chapter-close-auto.spec.ts`. All drive the UI and assert the DB, set the
  threshold and flag through seed helpers beside `setClassifierCadence`
  (`e2e/harness/seed.ts:281`), and read entry ids from the DB. Tool steps go through `setToolSteps` with function steps, since a
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

None open: Implementation notes record each answer.

## Implementation notes

- **One slice, two stacked PRs (developer decision at slice
  planning).** PR 1 carries the flag, pre-flight, copy, start, Phase 1
  and its mock; PR 2 the modal, entry points, dev-route removal, E2E,
  proofs and canon. CodeRabbit's 100-file cap made the cut: a split
  frees no dependency edge, since 5.13 needs both the `toolCalling`
  pre-flight and the modal host. The plan came to 23 tasks, 9 in PR 1
  and 14 in PR 2, the proofs last.
- **`Close chapter here` opens the modal with the end picked (developer
  decision).** Canon's "clicking pre-flights" moved to the modal's
  confirm, so four triggers share one confirm path, with the token
  count and the guard. The glyph is Lucide `SeparatorHorizontal`, before
  delete: `Flag` is the faction kind's glyph, and one glyph keeps one
  meaning.
- **Boundary's output bound and fallback (developer decision).** The
  boundary call sends 16,384 max output (8,000 at planning, raised in
  the 2026-11-18 decision below) when the resolved settings, the
  story override's own or else the profile's, set none, and a cut-off
  reports what was sent. A `reply-cut-off` is an unusable reply, like a
  parse failure after the retry, and an unusable reply ends the chapter
  on the latest candidate, the newest reply whose running total is at
  most 1.5× the threshold, else on `fallbackChapterEnd`. A departure
  from canon's plain fallback, which would end one oversized chapter on
  a region auto-close met late, a lowered threshold or a deleted chapter
  left behind; in the usual case both pick the same entry. Metadata
  keeps no default, since its cut-off fails the close, while
  boundary's loses nothing. Canon now says so in `chapter-close.md`
  (Phase 1's Validation, the failure table) and
  `generation-pipeline.md → Cut-off replies`.
- **`toolCalling` detection writes both values (developer decision).** A
  catalog that publishes the flag replaces the stored one, as
  `contextWindow` does, and one that doesn't keeps it, in place of the
  brief's "stored wins". OpenRouter's `supported_parameters` carries it
  on every row (411 of 474 included `tools` on 2026-11-17) and refuses a
  tool request to the others with a 404, so a detected `false` moves a
  mid-close failure to pre-flight; nothing in the app writes the flag
  before M7.1. Detection reads OpenRouter's `supported_parameters` and
  Mistral's `capabilities.function_calling`. NanoGPT publishes
  `capabilities.tool_calling` only under `?detailed=true`, which the
  fetch doesn't send, so its models stay unknown, and the dev llama.cpp
  router publishes nothing. The survey read the rest too: OpenAI's rows
  hold `id`, `created`, `object` and `owned_by`, and Anthropic's
  `capabilities` has no client-tool key. Google's OpenAI-compatible
  endpoint, vLLM, LM Studio, Ollama and NVIDIA NIM publish nothing about
  tools on `/models`, Google, vLLM, LM Studio and NIM by their docs'
  silence rather than a published schema.
- **The tool-calling hint's words (developer decision).** `tool choice`
  and `tool use` joined `tool_choice` and `tools`, for vLLM's 400 and
  OpenRouter's 404, with `generation-pipeline.md → Fatal error
categories` and its `CapabilityHint` union.
- **The proofs' bars (developer decision).** The probe gained a boundary
  arm, `PROBE_BOUNDARY=1`, whose bar is 8 valid picks of 10 with none
  cut off. The seven-task bar is by kind: every task, no failed close
  and no unrecovered cut-off at the step output default; Identity,
  Threads, Lore and Upkeep land a write when they had a start;
  Happenings reads `no-start` on MiniLM; Lifecycle and Awareness are
  reported, with no write required; 8 of 10 runs pass, and 5.5b's cap
  and merge coverage clauses stand. A task had a start when it made a
  model step, a call or a stop. The reversal bar is no JS-thread stall
  over 500 ms on the Fold's release build, for CTRL-Z and redo of a full
  close group, wall time reported. The stall meter, `startStallMeter` in
  `lib/diagnostics`, is committed, so 5.13 reuses it.
- **A pick a reversal stamps is dropped (developer decision).**
  `dropRemovedPick` drops a pick whose entry is gone, stamped into a
  chapter or no longer a reply a chapter can end on, so a redo that
  restores the chapter the user picked costs no failed Send. Canon's
  "a reversal that removes the entry" gained "or closes it" in
  `generation-pipeline.md` and `chapter-close.md`.
- **Withdrawing a manual close, and redo after a dropped pick, stay as
  5.6 shipped them (developer decision).** Cancel defers the pick. A
  pick dropped by CTRL-Z of its turn stays dropped after redo, folded
  into `parked.md → The deferral toast can promise a close that never
runs`: the deferral toast tells the user, and CTRL-Z of the turn a
  pick ends on reads as a change of mind.
- **An automatic close ending on the newest reply stays as shipped
  (developer decision),** with canon's accepted residue standing: after
  the latest-candidate fallback it needs a region whose one reply is the
  head, which a realistic threshold doesn't produce.
- **No further gates on the four triggers (developer decision).**
  `canClose` hides the Actions menu's entry and disables the popover's
  and card's with a reason; the run gate disables all of them with the
  uniform reason. A held branch reaches `startManualClose`'s refusal
  toast, and a deferred owed close opens the modal, where a new pick
  replaces it.
- **`Ready to close` is a text label (developer decision),** in the
  popover's progress row and on `ChapterInProgressCard`'s progress
  line, and the strip's ≥ 90% line in `reader-composer.md` gained its
  auto-close-off reading. It sits inside the counts line after a `·`,
  not on a line of its own: a text-width sibling loses its last word on
  Android ([the lesson](../../../lessons-learned/android-text-subpixel-wrap.md)).
- **`/dev` is gated in release (developer decision):**
  `app/dev/_layout.tsx` redirects home outside `__DEV__`, pinned by
  `dev-gate.spec.ts`, and `first-chapter.spec` moved onto
  `Close chapter here`.
- **A failed click pre-flight writes the system entry and toasts,**
  with no rerun promise, through `raiseSystemEntry`, which carries a
  standing entry's held text and patches a loaded branch's store. From
  World, Plot, Story Settings or the Timeline the entry is off screen.
- **The click's entry keeps its pick, and its Retry re-runs it
  (developer decision, 2026-11-17).** The entry written for a failed
  click pre-flight carries `systemFailure.closePick`, the confirmed end
  entry. Its `Retry` re-runs that pick through the manual start,
  pre-flighting again: a second pre-flight failure rewrites the entry
  with the same pick, and a chain that ran settles as a close's `Retry`
  does. An entry without `closePick` keeps `runOwedClose`. The click
  records no pick by design, so `runOwedClose` would have settled as
  "Nothing left to close", or run a threshold close the user didn't
  pick. Canon's `Fix profile · Retry · Dismiss` row stands;
  `reader-composer.md → Transient pipeline failures` and
  `data-model.md → Entry metadata shape` say so.
- **The close's budgets are raised, then both probes rerun (developer
  decision, 2026-11-18).** After the first probe run missed both bars:
  "Raise the bugets, the dev model has relatively consistently
  demostrated 8k response budget is not enough for it even when it
  doesnt loop. This is mostly inherent to the model itself when given a
  substantial amount of work." Three budgets rise. The step output
  default `TOOL_STEP_MAX_OUTPUT_DEFAULT`, 8,000 to 16,384: the largest
  step reply that finished was 7,710 tokens, 342 steps finished and 8
  attempts were cut off at 8,000 (a cut reply is not a step), and each
  one's retry finished in 522 to 7,710. The largest prompt any step sent
  was 42,754 tokens, so 42,754 plus 16,384 is 59,138, inside the dev
  model's 65,536-token window, but that was measured under 24 steps.
  Upkeep's prompt starts near 31,600 and grows about 274 to 439 tokens a
  step, so a step near the 57th to 64th reaches about 47k to 59k, where
  a reply past roughly 6k to 18k tokens overruns the dev model's window.
  On llama.cpp that reply is a cut-off whose cause is the window, and a
  second cut stops the task as `cut-off`. Identity's prompt grows
  faster, about 475 to 1,471 tokens a step (run 10: 29,510 to 38,534
  over 20 steps; run 7: 29,511 to 42,754 over 10), so a looping Identity
  reaches the window first, near step 25 at run 7's rate. The rerun
  records each task's largest prompt. 16,384 is also the most OpenAI's
  4o models accept, and openai-compatible sends `max_tokens` unchanged,
  so a model with a lower output cap needs its profile's max output set
  (not verified live against a provider). The boundary default
  `BOUNDARY_MAX_OUTPUT_DEFAULT`, 8,000 to 16,384, for the same provider
  cap: picks spent 4,237 to 5,608 output tokens on a 2,492-token prompt,
  and 3 of 10 ran past 8,000. The per-task step budget
  `CLOSE_TASK_STEP_BUDGET`, 24 to 64: Upkeep's prompt listed 43 rows in
  every run (12 characters, 16 places, 14 items, 1 faction), 36 of them
  with no keywords. The three runs stopped at the budget spent 10, 8 and
  11 leading steps on `search_world` (15 in all in run 7); the serial
  runs that finished (5, 8 and 10) spent 1, 4 and 1 leading searches and
  ended in 20, 17 and 20 steps. Near 57 steps is a worst-case estimate
  (36 bare rows, a few conditions, about 15 searches, the finishing
  reply), not a measured run. The cost: a task that loops now runs up to
  64 steps per part, as run 7's Upkeep did on an invented `update_item`
  id until its 24th. 5.5b's bar is unchanged, so a stopped task still
  misses; its output-bound clause reads the step default and judges at
  16,384. Canon says so in `chapter-close.md`, `generation-pipeline.md`,
  `data-model.md`, `testing.md` and `followups.md`. The review of the
  raise found two provider cases: a model whose output cap sits between
  8,000 and 16,383 gets a 4xx, and a server that counts `max_tokens`
  against the window (vLLM) refuses a call whose prompt passes the
  window less 16,384, a full part's first step on windows under roughly
  47k tokens and a late step on larger ones, and the refusal is
  recognized as an overflow. Developer decision, "Q5: A / I'd park B,
  not a followup", keeps the values, records both in canon with the
  profile's max output as the remedy, and [parks the
  clamp](../../../../parked.md#clamp-a-default-max-output-to-the-window).
  "Q7: 1 + park 3" keeps the one shared 64-step budget for every task
  and [parks a no-progress stop](../../../../parked.md#stop-a-task-that-makes-no-progress).
- **A stale pick settles on Retry as nothing left to close (developer
  decision, 2026-11-18).** A failed click's entry whose pick can no
  longer end a chapter, closed into one or deleted, settles on Retry as
  **Nothing left to close** through today's path and copy. Other
  refusals keep the refusal arm. It doesn't clear a deferred owed close:
  a stale pick says nothing about whether a threshold close is owed.
- **The close modal's start row and picker trigger take two lines on
  phone (developer decision, 2026-11-18).** Ref and tag on the first,
  snippet and the right-aligned time on the second; at 320 px the tag
  drops whole below the ref. Tablet and desktop keep one line, and the
  dropdown items keep their anatomy, their head wrapping whole at the
  narrowest widths. Canon's Mobile expression is updated.
- **The copy split is narrower than the brief.** Only
  `CLOSE_RESOLVER_COPY` and `FIX_LABEL` are keyed by `ConfigFailureKind`;
  the turn, pass and suggestion records stay keyed by
  `ResolveFailureKind` and read `'tool-calling-off'` as their generic
  line, since that failure fires only on a close.
- **Already shipped, so no task:** `openCloseModal`'s guard-first
  behaviour and its store test (5.11), the reader's inline-edit guard
  as the registered surface (#751), and the close tool-calling hint
  test. AC10's second half and AC11's store half rest on them.
- **One helper for a bounded structured call.**
  `boundedStructuredCall` in `lib/pipeline` landed with boundary as its
  third caller; the metadata call and the periodic pass moved onto it.
  The shared `ResolveModelConfig` builder went to `triage.md`.
- **Unspent scripted steps fail a spec.** The harness's `close()`
  rejects while a lane still holds steps, naming it, unless the lane was
  set `{ mayEndEarly: true }`; a held call the app drops takes no step.
  The owed spec holds its CTRL-Z and Cancel cases at the first tool
  lane, after the metadata write, and asserts the chapter row exists
  while held, so its "no chapter, no `chapter_close` delta" can fail.
- **A disabled reason shows on native through one compound,**
  `ReasonButton`, in the modal's `Close chapter`, the in-progress card
  and the popover's action. Whether every disabled button does the same
  stays with M9's `disabledReason` pass.
- **The EntryCard head's clearance follows its actions:** `pr-28` up to
  four, `pr-36` for five, `pr-44` for six, so the cluster's width at
  390 px is settled in code and M6's branch or M7.2's flip era needs no
  new rule. The reader's open-region reply shows four today: edit,
  regenerate, `Close chapter here`, delete.
- **The modal opens above a dismissing Sheet.** Its `Dialog` renders on
  `ABOVE_SHEETS_PORTAL_HOST`, so opened from the Actions Sheet it never
  draws under that Sheet as it closes; the popover's action runs from
  its Sheet's dismiss.
- **Boundary's system half lost its review sentence, and its length
  line was reworded (developer decision, 2026-11-18, "Q4b: drop,
  reword").** The sentence was "The chapter ends with the turn you pick
  and the next chapter opens with the turn after it, so where a listed
  turn opens on a new scene or after a time skip, end on the listed turn
  before it; if none is listed before it, choose among the others."
  Cut-off run 5 spent its 8,000 tokens deliberating that rule. The user
  half's old line, with the region's total beside the target, was
  "{{ boundaryRegionTokens }} tokens so far; a chapter runs about
  {{ boundaryThreshold }} tokens." A threshold close usually fires with
  the total near the target (a late auto-close or a lowered threshold
  doesn't), and run 2's reasoning took the line as an order to end now
  and the last candidate. It now states the range the end may fall in:
  "Each turn listed would end this chapter between
  {{ boundaryLengthFrom }} and {{ boundaryLengthTo }} tokens long, all
  good lengths for a chapter, so choose by the story alone."

  The bounds are the candidate window's, half a threshold rounded up to
  one and a half rounded down, from `closeCandidateWindow`, which
  `closeCandidates` uses too. The candidates' own span was passed over:
  its top sits at the running total before the newest reply, near the
  current total, which would bring the "end now" reading back.
  `boundaryRegionTokens` and `boundaryThreshold` are gone, so
  `requestChapterBoundary` no longer takes the series. The rerun on the
  reworded prompt showed what dropping the rule cost: runs 1 and 8
  picked t16, a turn opening on a dated letter ("Old Anchor Inn,
  Bristol, March 1"), which puts the new scene's first turn in the
  closing chapter.

  **A one-sentence guard was tried and reverted (developer rulings,
  2026-11-18, "Q11: Then restore the short guard." and "Q12: C").** The
  guard stated a fact after the natural-ending line: "A turn that opens on
  a new scene or after a time skip begins the next chapter, so it can't
  end this one." The boundary bar's third run, on it at `cbca94d3c`
  (prompt 2,481 tokens, 10:53 to 11:05 UTC), held: 10 of 10 runs picked a
  candidate and none was cut off, with replies of 3,655 to 7,958 output
  tokens, and no run picked t16 or the latest candidate. But six runs (2,
  3, 4, 6, 7 and 9) moved to t15 (position 93). It opens on the squire's
  reply and holds Part Two's opening time skip mid-turn ("It was longer
  than the squire imagined ere we were ready for the sea…", "So the weeks
  passed on…"), and it ends on the letter's lead-in, "we found … the
  following important news:". So those chapters cross the break and close
  on a colon. t14 (position 91), where Part One ends, the real break, fell
  from three picks to two (runs 5 and 8). Run 1 picked t27 (position 117)
  and run 10 t5 (position 73). The prompt shows each candidate by its
  first and last sentences only, so a guard keyed on a turn's opening
  can't see a break inside a turn. The guard came out in `33b8ae215`. The
  shipped prompt is the one the second run measured (`ebd11334c`, 10 of
  10 picked, none cut off), and boundary's code path is unchanged since,
  so no fourth run followed. The third run's record is
  `~/.cache/aventuras-measure/m5-10/probe-20261118T110532Z`. Both kinds
  of mis-pick, one turn late on a scene-opening turn (the second run's
  t16) and a break inside a turn (the third run's t15), are filed under
  [followups → Tuning and play testing](../../../../followups.md#tuning-and-play-testing),
  with candidate display as the lever to try.

- **`firstLastSentences` is tougher than its first cut.** It merges
  letterless pieces (French `»`, a bare ellipsis) into the sentence
  before, takes `“` and `«` as closers, uses a lookbehind against
  quadratic backtracking, and caps at a word ending exactly at the cap.
- **`thresholdMet` in `lib/chapters` is the one threshold test,** for
  the automatic close and for the `Ready to close` label.
- **`preflightSnapshot` builds the pre-flight snapshot for both the run
  and the click** (PR 1's review), and `startPickedCloseChain` shares
  the manual start's composition with the click entry's Retry.
- **The stall meter logs a tail beside the longest gap.** `tailGapMs`,
  a second meter over 250 ms after the reversal resolves, sits beside
  `longestGapMs`, because default-priority renders land after the
  promise resolves.
- **`chapter-close-starts` is split by describe** into `-menus`,
  `-inline` and `-guards` (`testing.md → Workers`), with the shared
  starts in `e2e/flows/close-start.ts`.
- **Monitor items.**
  - End entries that moved: none. Task 9's chapter E2E specs passed
    unchanged. One existing spec changed, for the reason the plan
    explains: `periodic-classifier-gated.spec.ts` now counts two gated
    actions on an off-head reply, the edit and `Close chapter here`.
  - The re-pin after a close under World or Plot: didn't fire. A
    throwaway spec held the close's Awareness lane, moved to World and
    to Plot, and released it: the reader returned at the tail, with no
    jump button.
  - The dirty-and-busy trace: didn't fire, in the guard specs and the
    desktop smoke.
  - Two closes in one turn: not run. Its signal needs auto-close
    turned on late, and `chapter-close-auto` seeds it on, so its one
    `chapter-close` run can't show the case. Parked (developer, slice
    review):
    [`parked.md → Two closes in one turn when auto-close is turned on late`](../../../../parked.md#two-closes-in-one-turn-when-auto-close-is-turned-on-late).
  - The native guard's round trip: not measured with an editor open.
    The Android smoke opened the modal after the Sheet dismissed, in
    about 3 s, with no editor.
  - The `Fix profile` route for `'tool-calling-off'`: the copy names the
    working remedies, as designed.
  - The grown-window measure: pending on the Fold.
- **A confirmed pick that fails its check drops the owed one (developer
  decision, slice review).** The click's failed pre-flight, or its
  entry's `Retry` failing again, clears the branch's `pendingClose`, so
  the next Send owes no close at an earlier failed close's pick (one the
  threshold owes still runs) and the entry's `Retry` closes at the
  confirmed pick. Canon:
  [`chapter-close.md → Manual user-triggered close`](../../../../memory/chapter-close.md#manual-user-triggered-close)
  and
  [`generation-pipeline.md → Multi-run txState`](../../../../generation-pipeline.md#multi-run-txstate).
- **A lone boundary candidate is the end, with no call (developer
  decision, slice review).** Every usable answer would name it, so the
  call could only fail the close; two or more still call. The boundary
  measure's 34 candidates still cover the call. Canon:
  [`chapter-close.md → Phase 1`](../../../../memory/chapter-close.md#phase-1--boundary-selection).

### Seven-task measure

Bar: the proofs' bar above, set at planning. The table below is the
first run, with the 8,000-token step output and the 24-step budget.
`PROBE_RUNS=10 PROBE_OVERLAY=1 pnpm probe:close` at `5f49358e1` on
`Gemma4-26B-A4B-QAT-MTP` (window 65,536 tokens, read from `/v1/models`),
on the dataset seed with the test overlay.

| Run | Happenings | Lore             | Identity         | Threads | Upkeep                   | Lifecycle | Awareness | Steps                   | Tokens in / out    | Wall time | Report size  |
| --- | ---------- | ---------------- | ---------------- | ------- | ------------------------ | --------- | --------- | ----------------------- | ------------------ | --------- | ------------ |
| 1   | no-start   | held             | held             | held    | held                     | held      | held      | 2 / 3 / 2 / 3 / 5 / 1   | 565,973 / 38,507   | 566.5 s   | 15,617 bytes |
| 2   | no-start   | held             | held             | held    | held                     | held      | held      | 2 / 2 / 2 / 3 / 7 / 4   | 672,389 / 53,522   | 714.4 s   | 16,414 bytes |
| 3   | no-start   | missed: no write | held             | held    | missed: no write         | held      | held      | 2 / 15 / 2 / 1 / 8 / 1  | 978,488 / 32,706   | 487.3 s   | 9,849 bytes  |
| 4   | no-start   | held             | held             | held    | missed: stopped (budget) | held      | held      | 2 / 2 / 7 / 24 / 2 / 1  | 1,305,829 / 29,104 | 439.9 s   | 10,667 bytes |
| 5   | no-start   | held             | held             | held    | held                     | held      | held      | 2 / 14 / 2 / 20 / 4 / 3 | 1,504,717 / 29,308 | 458.3 s   | 15,334 bytes |
| 6   | no-start   | held             | held             | held    | missed: stopped (budget) | held      | held      | 2 / 5 / 6 / 24 / 2 / 2  | 1,507,712 / 52,471 | 727.5 s   | 14,134 bytes |
| 7   | no-start   | held             | missed: no write | held    | missed: stopped (budget) | held      | held      | 2 / 10 / 4 / 24 / 2 / 5 | 1,688,416 / 52,762 | 720.0 s   | 8,776 bytes  |
| 8   | no-start   | held             | held             | held    | held                     | held      | held      | 3 / 2 / 6 / 17 / 6 / 3  | 1,238,330 / 43,958 | 613.8 s   | 13,173 bytes |
| 9   | no-start   | held             | held             | held    | held                     | held      | held      | 3 / 3 / 2 / 3 / 3 / 3   | 522,336 / 39,088   | 551.9 s   | 13,354 bytes |
| 10  | no-start   | held             | held             | held    | held                     | held      | held      | 2 / 20 / 7 / 20 / 2 / 1 | 1,868,898 / 43,143 | 603.4 s   | 19,256 bytes |

Steps list the model steps of Lore, Identity, Threads, Upkeep, Lifecycle
and Awareness in that order; Happenings had no start in any run.

Verdict: `bar: 6 of 10 runs passed; a cap reached in 8 runs, merge_threads
called in 10: missed`. Eight-k cut-offs, each recovered by the retry: run 1
once, run 2 twice, run 6 twice, run 7 once, run 8 once, run 10 once. The
largest report value is 215 characters (`update_character`
`state.traits`, run 10), and the largest report 19,256 bytes (run 10).
Saved at `~/.cache/aventuras-measure/m5-10/probe-20261118T061707Z`.

The transcripts, read by hand:

- Upkeep's three budget stops come from the 24-step budget against 43
  rows when the model emits one call per step: six runs went serial (4,
  5, 6, 7, 8, and 10 from its retry on, its first step having been cut
  off at 8,000 tokens with 23 calls, none of which ran), and the batched
  runs 1, 2 and 9 finished in 3 steps. Runs 4 and 6 landed 13 writes
  before the stop.
- Run 7's Upkeep looped `update_item` on an invented id.
- Run 3's Lore sent `turns: [true]`, was rejected and gave up. Its
  Upkeep wrote its calls as text, with no tool calls.
- Run 7's Identity sent arrays as JSON strings seven times.

The bar code fails a task with a recorded stop even after landed writes.
Read by its landed writes instead, runs 4 and 6 would pass, and the count
would be 8 of 10.
The developer's call on this miss is the 2026-11-18 budget-raise
decision above: tune, then rerun.

#### Seven-task rerun on the raised budgets

`PROBE_RUNS=10 PROBE_OVERLAY=1 pnpm probe:close` at `ee9b39acf` (a step's
default max output 16,384, a task's step budget 64) on
`Gemma4-26B-A4B-QAT-MTP` (window 65,536), from 06:47 to 08:41 UTC on
2026-11-18. Saved at
`~/.cache/aventuras-measure/m5-10/probe-20261118T085624Z/close-out-2`.

| Run | Happenings | Lore             | Identity                 | Threads | Upkeep | Lifecycle | Awareness | Steps                     | Tokens in / out    | Wall time | Report size  |
| --- | ---------- | ---------------- | ------------------------ | ------- | ------ | --------- | --------- | ------------------------- | ------------------ | --------- | ------------ |
| 1   | no-start   | held             | held                     | held    | held   | held      | held      | 2 / 5 / 3 / 4 / 3 / 7     | 738,607 / 47,197   | 675.5 s   | 38,148 bytes |
| 2   | no-start   | missed: no write | missed: stopped (window) | held    | held   | held      | held      | 1 / 2 / 10 / 3 / 10 / 1   | 910,976 / 65,682   | 743.6 s   | 15,609 bytes |
| 3   | no-start   | held             | held                     | held    | held   | held      | held      | 2 / 2 / 2 / 5 / 2 / 5     | 530,924 / 38,994   | 567.6 s   | 26,731 bytes |
| 4   | no-start   | held             | held                     | held    | held   | held      | held      | 2 / 3 / 2 / 29 / 2 / 3    | 1,447,081 / 37,542 | 531.8 s   | 15,324 bytes |
| 5   | no-start   | held             | held                     | held    | held   | held      | held      | 2 / 10 / 8 / 2 / 8 / 3    | 1,145,193 / 56,325 | 721.4 s   | 16,598 bytes |
| 6   | no-start   | held             | held                     | held    | held   | held      | held      | 2 / 30 / 2 / 44 / 5 / 3   | 3,825,250 / 71,086 | 878.8 s   | 21,340 bytes |
| 7   | no-start   | held             | held                     | held    | held   | held      | held      | 2 / 13 / 10 / 26 / 2 / 15 | 2,398,697 / 49,609 | 722.8 s   | 21,339 bytes |
| 8   | no-start   | held             | held                     | held    | held   | held      | held      | 2 / 3 / 2 / 19 / 8 / 15   | 1,651,821 / 60,874 | 789.8 s   | 13,193 bytes |
| 9   | no-start   | held             | held                     | held    | held   | held      | held      | 2 / 4 / 7 / 3 / 3 / 4     | 749,966 / 53,657   | 676.2 s   | 25,892 bytes |
| 10  | no-start   | held             | held                     | held    | held   | held      | held      | 2 / 24 / 2 / 18 / 3 / 4   | 1,810,290 / 35,406 | 542.6 s   | 18,049 bytes |

Steps list the model steps of Lore, Identity, Threads, Upkeep, Lifecycle
and Awareness in that order; Happenings had no start in any run.

Verdict: `bar: 9 of 10 runs passed; a cap reached in 9 runs, merge_threads
called in 10: met`; the source's sha256 is unchanged. Six replies were cut
off, all at 16,384 tokens, and each recovered on its retry: run 2 twice,
runs 5, 6, 8 and 9 once each. The largest finished reply is 13,593 tokens
(run 6, Identity step 1), which the old 8,000 would have cut. The largest
prompt is 57,153 tokens (run 6, Identity step 30). Upkeep took up to 44
steps (run 6) and Identity 30, past the old 24, and both held.

Run 2's two misses:

- Lore replied "No lore was established in this chapter." and made no call.
- Identity's step 1 cut off at 16,384, and its retry (8,756 output tokens)
  sent nine `update_character` calls, one with `turns` padded by 1,324
  `true` entries. The SDK answers an invalid call itself, and its answer,
  the whole value plus one issue per bad entry, came back as a 238,990
  character tool result. Step 2's prompt was then 116,118 tokens, and
  llama.cpp refused it as over the 65,536 window, which stops a later step
  as `window`. Under the old 8,000 cap that retry would have been cut too,
  a `cut-off` stop and still a miss.

Developer decision, 2026-11-18 ("Q8: A"): the bar stands as met, with
run 2 on record, and no code change and no third run follow in this
slice. The followup carries a bounded echoed answer, a list repair and a
sampling measure, filed under
[followups → Tuning and play testing](../../../../followups.md#tuning-and-play-testing).

### Boundary measure

The table below is the first run, with the 8,000-token default.
`PROBE_RUNS=10 PROBE_BOUNDARY=1 pnpm probe:close` at `5f49358e1` on
`Gemma4-26B-A4B-QAT-MTP`, over the dataset chapter's region at the
story's 24,000 threshold: 34 candidates, a prompt of 2,492 tokens.

| Run | Outcome       | Ends on (position) | Latest candidate (position) | Largest reply (output tokens) | Wall time | Tokens in / out |
| --- | ------------- | ------------------ | --------------------------- | ----------------------------- | --------- | --------------- |
| 1   | picked        | 117                | 131                         | 4,346                         | 53.8 s    | 2,492 / 4,346   |
| 2   | picked        | 131                | 131                         | 4,646                         | 55.1 s    | 2,492 / 4,646   |
| 3   | picked        | 131                | 131                         | 5,188                         | 62.8 s    | 2,492 / 5,188   |
| 4   | picked        | 93                 | 131                         | 5,608                         | 66.2 s    | 2,492 / 5,608   |
| 5   | reply-cut-off | 131                | 131                         | 8,000                         | 91.9 s    | 2,492 / 8,000   |
| 6   | picked        | 131                | 131                         | 4,237                         | 48.3 s    | 2,492 / 4,237   |
| 7   | picked        | 131                | 131                         | 4,942                         | 60.5 s    | 2,492 / 4,942   |
| 8   | picked        | 131                | 131                         | 4,276                         | 51.9 s    | 2,492 / 4,276   |
| 9   | reply-cut-off | 131                | 131                         | 8,000                         | 96.3 s    | 2,492 / 8,000   |
| 10  | reply-cut-off | 131                | 131                         | 8,000                         | 97.7 s    | 2,492 / 8,000   |

Verdict: `boundary: 7 of 10 runs picked a candidate, 3 cut off: missed`.
Run 2's reasoning reads "23,907 tokens so far; a chapter runs about
24,000" as the chapter ending now and takes the last candidate; run 5
spent its 8,000 deliberating the end-on-the-turn-before rule. The
developer's call on this miss is the 2026-11-18 budget-raise decision
above: tune, then rerun.

#### Boundary rerun on the raised budgets

`PROBE_RUNS=10 PROBE_BOUNDARY=1 pnpm probe:close` at `ebd11334c` (the
16,384 boundary default and the reworded prompt) on the same model: 34
candidates at the 24,000 threshold, a prompt of 2,454 tokens. Saved at
`~/.cache/aventuras-measure/m5-10/probe-20261118T085624Z/boundary-out-2`.

| Run | Outcome | Ends on (position, turn) | Latest candidate (position) | Largest reply (output tokens) | Wall time | Tokens in / out |
| --- | ------- | ------------------------ | --------------------------- | ----------------------------- | --------- | --------------- |
| 1   | picked  | 95, t16                  | 131                         | 3,701                         | 45.4 s    | 2,454 / 3,701   |
| 2   | picked  | 91, t14                  | 131                         | 2,529                         | 30.6 s    | 2,454 / 2,529   |
| 3   | picked  | 131, t34                 | 131                         | 4,949                         | 58.9 s    | 2,454 / 4,949   |
| 4   | picked  | 117, t27                 | 131                         | 7,032                         | 82.3 s    | 2,454 / 7,032   |
| 5   | picked  | 131, t34                 | 131                         | 7,503                         | 92.8 s    | 2,454 / 7,503   |
| 6   | picked  | 91, t14                  | 131                         | 4,688                         | 57.9 s    | 2,454 / 4,688   |
| 7   | picked  | 117, t27                 | 131                         | 8,338                         | 99.2 s    | 2,454 / 8,338   |
| 8   | picked  | 95, t16                  | 131                         | 5,991                         | 73.3 s    | 2,454 / 5,991   |
| 9   | picked  | 91, t14                  | 131                         | 6,200                         | 76.1 s    | 2,454 / 6,200   |
| 10  | picked  | 131, t34                 | 131                         | 7,417                         | 92.9 s    | 2,454 / 7,417   |

Verdict: `boundary: 10 of 10 runs picked a candidate, 0 cut off: held`; the
source is unchanged. Run 7's 8,338-token reply would have been cut at the
old 8,000.

The picks spread over four turns, where the first run took the latest
candidate in 5 of its 7 picks:

- t14 (3 runs) ends on the squire's "not one of us must breathe a word of
  what we've found", where the novel's Part One ends.
- t27 (2 runs) ends "before they should go aboard the schooner on a visit
  of inspection", the end of the Spy-glass chapter.
- t34 (3 runs) is the latest candidate, a quiet pause ("Hands will want
  supper.").
- t16 (2 runs) opens on a dated letter ("Old Anchor Inn, Bristol, March
  1"), a new scene, so those two runs put the scene's first turn in the
  closing chapter: the mis-pick the dropped sentence guarded against (see
  the Q4b note).

### Reversal measure

Bar: no JS-thread stall over 500 ms on the Fold's release build, for
CTRL-Z and for redo of the full close group; wall time is reported. On
the dataset branch, its seed's close, timed by `startStallMeter` around
`undoLastAction` and `redoLastAction` alone, never the confirm.

| Platform, build                                                            | CTRL-Z wall / longest stall (2 runs)       | Redo wall / longest stall (2 runs)          |
| -------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| Desktop production bundle, Linux x86_64, kernel 7.2.6-arch2-1, `f0c98545c` | 387 / 98 ms and 332 / 92 ms (tails 54, 29) | 191 / 101 ms and 177 / 98 ms (tails 35, 29) |

The group was the dataset seed's close: "1 lore row removed, 35 other
changes reversed". A tail is `tailGapMs`, the longest gap in the 250 ms
after the reversal resolves.

Fold release build. Pending: runs on PR 2 before merge, and its bar
decides the merge.

### Grown-window close measure

Bar, 5.2's: no JS-thread stall over 500 ms and no gap between the
reader document's paints over 500 ms over one close on
`pnpm db:seed:long`'s 60-chapter branch with the reader grown to its
first chapter, on the Fold's release build. The branch's open region
holds 14 entries and no entities.

Pending: runs on PR 2 before merge, and its bar decides the merge.
