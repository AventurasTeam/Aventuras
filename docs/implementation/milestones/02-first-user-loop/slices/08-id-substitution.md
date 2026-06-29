# Slice 2.8 — ID placeholder substitution library

## Metadata

- **Milestone:** [Milestone 2 — First user loop](../milestone.md)
- **Depends on:** none (pure library, zero runtime deps)
- **Blocks:** [Slice 2.3](./03-wizard.md) (opening-generation
  refs), [Slice 2.7](./07-wiring.md) (per-turn context idMap)

## Goal

The substitution layer between prefix-tagged UUIDs and the short
placeholders the LLM sees: `IdBiMap`, the generic pattern-driven
`substituteIds` walker, the parse-side reverse substitution with
temporary-handle registration for new-entity emission, and the
malformed-placeholder recoverable error class. Pure `lib/` module,
fully specced canonically — this slice is a faithful
implementation, not a design pass.

## Background

Entity IDs are stored as `char_<uuid>` etc.; prompts carry `c1` /
`l1` / `lo1`-style placeholders, allocated per LLM call. The
walker is recursive and type-agnostic — it pattern-matches any
string in the context against the LLM-facing-prefix UUID pattern,
so non-LLM-facing IDs (`entry_*`, `act_*`, `run_*`) pass through
untouched. M2 has two consumers: the wizard's opening generation
(structured-output refs constrained to the cast — at most the
minimal lead entity) and the per-turn context. The heavier
consumers (classifier, chapter-close) arrive in M3 / M5 against
this same surface.

## Required reading

- [`generation-pipeline.md → ID placeholder substitution`](../../../../generation-pipeline.md#id-placeholder-substitution)
  — the complete contract: walker, `IdBiMap`, lifecycle,
  new-entity emission, failure modes. This slice implements it
  verbatim.
- [`data-model.md → ID shape — kind-prefixed UUIDs throughout`](../../../../data-model.md#id-shape--kind-prefixed-uuids-throughout)
  — the prefix registry, LLM-facing vs non-LLM-facing kinds.

## Scope: in

- `IdBiMap` (allocate / lookup both directions, per-kind
  counters, scoped to a single LLM call).
- `substituteIds` walker (strings, arrays, objects; the
  `SUBSTITUTABLE_PREFIXES` pattern).
- Reverse substitution on parse (`parseAndSubstitute`-shaped
  helper): placeholders → UUIDs across a parsed structured
  output; temporary-handle registration when a response
  references a just-created entity again (the new-entity path —
  no M2 consumer emits creates, but the surface is part of the
  canonical contract and M3.2 consumes it unchanged).
- Malformed / unrecognized placeholder → the single recoverable
  error class the retry tier consumes.
- Public-API exposure through the module index per the `lib/*`
  rule.

## Scope: out

- Any integration wiring (2.3 / 2.7 own their call sites).
- New-entity UUID allocation policy beyond the spec (parse
  allocates; the consumers land in M3.2).

## Acceptance criteria

- Round-trip property: for an arbitrary nested fixture containing
  LLM-facing UUIDs, non-LLM-facing UUIDs, and plain strings —
  `parse(substitute(x))` restores exactly the LLM-facing IDs and
  touches nothing else.
- Same UUID appearing twice allocates one placeholder; counters
  are per-kind (`c1`, `c2`, `l1`); two maps don't share state.
- Unrecognized placeholder in a parse fixture raises the
  recoverable error class, not a throw-through.
- Temporary-handle registration: a fixture response creating an
  entity and re-referencing it by an LLM-chosen handle resolves
  both references to one allocated UUID.
- 100% line coverage on this module (pure logic; the bar is
  cheap here).

## Tests

- Vitest only: walker matrix, bimap units, reverse-parse cases,
  property-style round-trip over generated fixtures.

## Open questions

- None — the canonical spec leaves no design freedom; deviations
  found during implementation go back through the spec.

## Implementation notes

- **New-entity / temporary-handle path is a consumer-driven
  primitive.** `IdBiMap.registerHandle(handle, uuid)` plus the
  reverse walker resolving any map-known string is the whole
  mechanism; the walker does **not** auto-detect create nodes. The
  new-entity fixture is illustrative and provisional — the real
  output wire-shape belongs to M3.2 (classifier), which registers
  handles against this same surface unchanged. No M2 consumer emits
  creates.
- **`MalformedPlaceholderError` is module-owned (zero runtime
  deps).** It does not import the pipeline's `PipelineError`;
  [Slice 2.7](./07-wiring.md) maps it to the pipeline
  `recoverable_error` event at the call site (mirrors how
  `lib/pipeline/call-error.ts` maps `lib/ai`'s `CallRetryError`).
- **Reverse-walker boundary for 2.7.** `parseAndSubstitute`
  resolves via `getUuidFor` (covers placeholders **and** registered
  handles); a placeholder-shaped string the map doesn't know
  throws. So 2.7 must run it only over structured reference output,
  never prose / free-text fields — consistent with the contract
  "prose carries names, structured emission carries placeholders."
- **`lib/ids.ts` promoted to folder module `lib/ids/`** with
  `index.ts` as the public API; `generateId` preserved, the five
  external `@/lib/ids` importers unchanged.
- **Coverage caveat.** 100% line coverage holds by line-by-line
  inspection, but the dual-project vitest setup drops `lib/ids`
  from the merged `--coverage` report, so the acceptance bar isn't
  push-button reproducible — logged in
  [`triage.md`](../../../triage.md).
