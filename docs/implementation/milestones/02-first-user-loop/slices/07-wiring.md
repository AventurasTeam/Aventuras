# Slice 2.7 — End-to-end wiring + smoke-scaffolding teardown

## Metadata

- **Milestone:** [Milestone 2 — First user loop](../milestone.md)
- **Depends on:** [Slice 2.1](./01-provider.md) (resolution chain
  AND the hardened `callWithRetry` — `maxRetries: 0`, SDK
  timeouts, Retry-After backoff all ship there),
  [Slice 2.3](./03-wizard.md), [Slice 2.5](./05-reader.md),
  [Slice 2.6](./06-pack-engine.md),
  [Slice 2.8](./08-id-substitution.md),
  [Slice 2.9](./09-preflight.md)
- **Blocks:** [Slice 2.10](./10-recovery-ui.md)'s badge half
  (this slice's story-open path writes the open-failure state
  the badge renders)

## Goal

The convergence slice: declare the real `per-turn` pipeline and
wire user action → translation short-circuit → context build →
bundled-pack render → real provider call → streamed entry write →
UI refresh; wire the M1.5 working-set `hydrate(branchId)` trigger
on story-open; and tear down the M1 smoke scaffolding. After this
slice the M2 definition-of-done loop runs on real traffic.

## Background

Everything this slice connects already exists when it starts: the
orchestrator, transaction lifecycle, and streaming write paths
shipped in M1; the resolution chain and hardened `callWithRetry`
in 2.1; the reader's trigger path against the stub seam in 2.5;
the bundled per-turn template in 2.6; the idMap in 2.8; the
pre-flight in 2.9. M2's per-turn pipeline is deliberately thin:
a `user-action-translation` phase implementing only the
same-language short-circuit (English is the fixed source
language; no translation settings UI exists before M7.2, so the
short-circuit is the only reachable path — the M8.1 real call
drops into this slot), then the narrative phase. No classifier,
no retrieval, no suggestions, no `chainsTo` (chapter-close does
not exist until M5.2). The prompt buffer is the cadence rule's
single-open-chapter degenerate case: the last
`partialChapterBuffer` entries verbatim.

## Required reading

- [`generation-pipeline.md → Pipeline declaration`](../../../../generation-pipeline.md#pipeline-declaration)
  and [`V1 declarations`](../../../../generation-pipeline.md#v1-declarations)
  — the per-turn shape: `hard-gate`,
  `blockedBy: ['per-turn', 'chapter-close']`,
  `affordance: 'pill-and-banner'`.
- [`generation-pipeline.md → Streaming lifecycle in the narrative phase`](../../../../generation-pipeline.md#streaming-lifecycle-in-the-narrative-phase)
  — placeholder → chunks → `commitStreamingEntry`; abort
  placeholder cleanup.
- [`generation-pipeline.md → Run-scoped state`](../../../../generation-pipeline.md#run-scoped-state--intermediates-and-per-kind-contexts)
  — `PerTurnContext` shape; M1 shipped the minimal base, this
  slice adds the per-turn `inputs` / `story` / `settings` fields.
- [`architecture.md → user-action-translation`](../../../../architecture.md#user-action-translation-pre-narrative)
  — the short-circuit contract and why the phase slot exists now.
- [`architecture.md → The single-context principle`](../../../../architecture.md#the-single-context-principle)
  and [`Settings: strict types, defaults at load`](../../../../architecture.md#settings-strict-types-defaults-at-load)
  — `generationContext` assembly, `userSettings` slice, per-story
  settings parse on story-open.
- [`memory/cadence.md → User-tunable knobs`](../../../../memory/cadence.md#user-tunable-knobs)
  — the buffer composition rule this slice implements in its
  degenerate case.
- [`generation-pipeline.md → ID placeholder substitution`](../../../../generation-pipeline.md#id-placeholder-substitution)
  — where `substituteIds` sits in the lifecycle (context
  construction, pre-render).
- [`observability.md → turnCaptureSink`](../../../../observability.md#turncapturesink)
  — the per-turn capture this slice populates with real traffic.
- [`followups.md`](../../../../followups.md) — the
  smoke-scaffolding teardown ledger entry this slice resolves.

## Scope: in

- **Per-turn `Pipeline` declaration** registered with the
  orchestrator, resolver inputs declared per
  [Slice 2.9](./09-preflight.md)'s shape (narrative only in M2),
  no `chainsTo`.
- **Turn-submit action (C6 owner):** the named action 2.5's
  composer calls — takes the final wrapped content, owns the
  `user_action` entry write (`worldTime` inherited from the
  preceding entry per the classifier contract's action-layer
  rule) and the run dispatch under one turn `actionId`.
- **`PerTurnContext` extension:** the per-kind context fields M1
  deferred — `inputs` (user action, action type, raw input) plus
  the `story` / `settings` slices — land on the run context this
  slice's phases read.
- **`user-action-translation` phase** — short-circuit
  implementation only: target language is structurally `en` in
  M2, typed text goes directly to content, no translation row,
  no LLM call.
- **Context build:** per-turn `generationContext` getter over the
  hydrated stores — entries buffer (last `partialChapterBuffer`
  entries of the single open chapter), definition blocks,
  `userSettings` slice, `intermediates.idMap` populated via
  [Slice 2.8](./08-id-substitution.md) before render.
- **Narrative phase:** render the bundled per-turn template
  (C2), call the resolved narrative model through
  `callWithRetry` + the streaming lifecycle, map
  `CallRetryError → PipelineError` on exhaustion, commit via
  `commitStreamingEntry` with provenance metadata (`tokens`,
  `model`, `generationTimingMs`, `reasoning` when exposed).
- **Story-open wiring:** navigation into the reader parses
  `stories.definition` / `settings` (failure feeds the
  [Slice 2.10](./10-recovery-ui.md) badge state) and fires the
  M1.5 `hydrate(branchId)` trigger (the gate shipped it
  unwired).
- **Real-traffic observability:** `httpCallSink` entries and a
  `turnCapture` per run, `kind` + `anchorEntryId` stamped by the
  orchestrator.
- **Smoke-scaffolding teardown:** remove
  `components/reader/smoke/` (the `'smoke'` pipeline, its phase,
  `runSmoke`), the reader-route smoke trigger, and the
  `registerStubProvider()` seam in `lib/ai`; resolve the
  [`followups.md`](../../../../followups.md) entry (the landing
  debug button is [Slice 2.4](./04-story-list.md)'s removal).

## Scope: out

- Real translation call (M8.1), classifier phases (M3.2 / M3.3),
  retrieval (M3.4), suggestions emission (M3.7), `chainsTo` +
  chapter-close (M5.2).
- Regenerate (M3) — the pipeline supports re-running by design
  but the reader affordance is deferred.
- Pre-flight framework itself — [Slice 2.9](./09-preflight.md)
  (this slice declares inputs and relies on the walk).

## Acceptance criteria

- On desktop and Android against a real OAI-compat endpoint:
  submit → user_action entry appears → reply streams into the
  placeholder → commit writes the row + create delta + metadata
  in one transaction → `turnCapture` and redacted `httpCallSink`
  entries exist for the turn.
- Buffer correctness: with `partialChapterBuffer = 3` and five
  entries, the rendered prompt contains exactly the last three
  entries plus the definition blocks — prompt snapshot test
  against a mocked provider.
- Cancel mid-stream: run completes `aborted`, placeholder
  removed, no `story_entries` row, no orphan deltas.
- Provider exhaustion mid-turn surfaces the LLM-call-failed
  system entry (written through 2.9's helper); the entry's
  `Retry` button ([Slice 2.5](./05-reader.md)'s affordance)
  re-runs the turn through the C6 action end-to-end.
- Kill the process mid-stream; next boot's recovery pass finds
  the orphan run, reverse-replays (zero entry deltas exist —
  the pre-commit case), and the run row is resolved.
- Story-open hydrates the working-set stores, and the reader
  renders from them: a vitest exercises the story-open path with
  a spied query layer and asserts no entry / domain reads are
  issued outside the hydrate call (post-hydrate reads go through
  store selectors).
- `grep` finds no `registerStubProvider`, `components/reader/smoke`,
  or `TODO(spine)` smoke markers; the followups entry is removed
  in this slice's PR.

## Tests

- Vitest: prompt-assembly snapshot (buffer + definition +
  placeholder substitution), short-circuit phase (no translation
  row, content passthrough), submit-action `actionId` grouping
  (user_action + reply deltas reverse as one turn), abort and
  failure paths against a mocked provider.
- Manual: the full definition-of-done loop on both platforms;
  kill-mid-turn recovery.

## Open questions

- Whether the `user_action` entry create lives inside phase 0 of
  the run or in the submit action before `runPipeline` — both
  satisfy the `actionId` grouping contract; pick at planning
  against how abort-before-stream should treat the user's text
  (keep vs reverse).
- **Per-turn context-builder hygiene** (surfaced by Slice 2.6). The
  builder must emit the `generationContext` variable names pinned in
  `lib/prompts`'s `templateContextMap.ts` (a mismatch only fails at
  integration); normalize empty or whitespace-only definitional
  fields, since LiquidJS `!= blank` treats whitespace as non-empty
  and would leak an otherwise-guarded section header; and guard
  array contents passed to the `prose_join` / `json` filters, which
  stringify `null` / `undefined` literally.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
