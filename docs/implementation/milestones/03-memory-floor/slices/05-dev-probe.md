# Slice 3.5 — Developer-only retrieval probe: first captures, parity test

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.4](./04-retrieval.md) (serializes the C4
  ranker trace; parity test re-runs the pure module)
- **Blocks:** none in M3 (M7.5's rich probe surface reads what this
  slice writes)

## Goal

The first `probe_captures` writes and the correctness backstop for
everything 3.4 built: the capture writer records light-mode ranker
state in the ranker's transaction behind the two-level gate, FIFO
eviction holds the per-story cap, a developer-only inspection
affordance makes captures readable during implementation, and the
simulator-vs-prod parity test pins the pure-ranker contract. The
rich user-facing probe screen is deliberately M7.5.

## Background

Calibrating the ranker later is guesswork without captured state,
and debugging retrieval failures without a capture of the failed
pass is the worst UX — so captures land with retrieval, not with
the probe screen. A capture is written right after the ranker emits
its selection, in the same transaction, including on failure (with
`failure_reason`). Both gates default off
(`app_settings.diagnostics.enabled` and
`stories.settings.probe_mode_active`, landed in M1.5); capture
writes are best-effort and never block a turn. The simulator that
M7.5 ships must mirror the prod ranker bit-for-bit — the shared
pure module plus this slice's parity test is what makes that
trustworthy.

## Required reading

- [`probe.md → Capture model`](../../../../memory/probe.md#capture-model)
  — when a capture writes, the light-mode field inventory, the
  `probe_captures` shape, FIFO-at-100, capture cost + best-effort
  posture.
- [`probe.md → Simulator contract`](../../../../memory/probe.md#simulator-contract)
  — the pure-module mirror requirement this slice's parity test
  pins (the simulator UI itself is M7.5).
- [`probe.md → Followups → v1-internal`](../../../../memory/probe.md#v1-internal)
  — the simulator-math validation item this slice resolves.
- [`probe.md → Schema delta`](../../../../memory/probe.md#schema-delta)
  — gates, non-delta-logged posture, fork behavior.
- [`observability.md → Gating model`](../../../../observability.md#gating-model)
  — the diagnostics master gate the app-level toggle rides.

## Scope: in

- **Capture writer:** assemble the light-mode record from the C4
  trace (identity, params snapshot, three queries with per-query
  metadata and Q3 sentence scores, per-type candidate rows, funnel
  summary, structural-floor list, stale counts); gzip payload;
  write in the ranker's transaction; FIFO eviction at 100 per story
  (across branches) in the same transaction; failure-capture path
  with `failure_reason` and partial state; write-failure = log and
  proceed.
- **Gating:** both toggles must be on to write; existing captures
  stay readable when either flips off; per-capture delete and
  clear-all-for-story actions (direct deletes, not delta-logged).
- **Deep-mode hook:** the capture writer accepts a
  per-capture deep flag and stores query + candidate vectors when
  set. The reader-side opt-in checkbox ships with the M7.5 surface;
  in M3 the flag is reachable from the dev affordance only.
- **Developer inspection affordance:** a minimal dev-only surface
  (debug-gated; shape at planning — likely a JSON view over
  captures for the open story) plus structured `logger.debug`
  score summaries per pass. Not a designed screen; M7.5 owns that.
- **Parity test:** re-run the pure ranker module over a captured
  state with identical params and assert selection + score
  equality with the capture — the simulator-math validation item
  from probe.md, resolved here.

## Scope: out

- The memory-probe screen (browse / inspect / simulate UX),
  per-entry probe icon in the reader, per-turn deep-capture
  checkbox by the Send button — M7.5.
- Cross-capture aggregation, multi-turn playback — post-v1 per
  canon.
- Any new schema — `probe_captures` and both gate fields landed in
  M1.5.

## Acceptance criteria

- With both gates on, a turn writes one light capture whose payload
  round-trips (gunzip → JSON) to the documented field inventory
  against a fixture pool; with either gate off, no write (vitest).
- Capture 101 for a story evicts the oldest across branches in the
  same transaction (vitest).
- A fault-injected retrieval failure (embedder down at query embed)
  still writes a capture with `failure_reason` and the reached
  partial state (vitest).
- A fault-injected capture write failure (constraint violation)
  does not fail the turn; the failure logs (vitest).
- Parity: for three captured fixture states (normal, budget-
  saturated, bypass-triggered), the re-run module reproduces the
  captured selection and scores exactly (vitest — the load-bearing
  test).
- Fork: captures do not copy to the new branch (vitest over the
  branch-copy exclusion — asserted against the M1.5 fork fixture if
  present, else a direct query assertion).

## Tests

- Vitest throughout (this slice is mostly tests + a writer);
  no Storybook scope (no designed compounds).
- Manual: dev affordance renders captures for a real seeded story;
  a deep capture's size lands in the expected ~100x-light order.

## Open questions

- **Dev affordance shape** — JSON viewer route vs logger-only; pick
  the cheapest thing that lets implementation debugging read
  captures (it is disposable once M7.5 lands).
- **Params-snapshot source** — v1 ranker knobs are hardcoded
  constants (tuning surface parked); the snapshot should read the
  same constants module so the simulator diff is honest. Confirm at
  planning.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
