# Slice 3.10 — Reader regenerate over the shared reversal sweep

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.3](./03-classifier.md) (the C3 shared
  reversal sweep — regenerate must drain the in-flight classifier
  and clamp the watermark like any prose reversal)
- **Blocks:** none

## Goal

The regen action on AI entries goes live: regenerating a reply
reverses its turn through the shared sweep, then re-runs the
per-turn pipeline from the same user input — no confirm in the
common case. Added at milestone promotion: the roadmap's
cross-cutting table assigned reader regenerate to M3 but no slice
bullet owned it.

## Background

Regenerate is "roll this turn back, then generate again": the same
delta reversal as rollback (survival anchor sparing lagging
classifier facts about surviving turns, `reversalInProgress`
bracket, classifier-cancel drain, watermark clamp — all C3),
followed by re-dispatching the per-turn pipeline against the
still-standing user action. Discarding the prior take is the
action's point, so it fires without a confirm; the confirm branch
canon defines for turns that chained a chapter close is dormant
until M5.2 (no chapter-close exists in M3) but the seam is named so
M5.2 lands it without reshaping this flow. The regen glyph shipped
on EntryCard's action cluster in M2.5's subset as deferred; this
slice enables it.

## Required reading

- [`reader-composer.md → Per-entry actions`](../../../../ui/screens/reader-composer/reader-composer.md#per-entry-actions)
  and
  [`Regenerate confirmation`](../../../../ui/screens/reader-composer/reader-composer.md#regenerate-confirmation)
  — action placement, no-confirm common case, the chapter-close
  confirm branch (M5-dormant).
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  and [`Survival anchor`](../../../../data-model.md#survival-anchor)
  — reversal semantics; regenerate is explicitly named as a
  survival-anchor consumer ("it fires even on
  regenerate-the-last-reply, when a catch-up pass landed between
  the reply and its regenerate").
- [`generation-pipeline.md → Prose reversals and the classifier barrier`](../../../../generation-pipeline.md#prose-reversals-and-the-classifier-barrier)
  — regenerate is one of the four bracketing reversal kinds.
- [`ui/patterns/entry-card.md → Action cluster`](../../../../ui/patterns/entry-card.md#action-cluster)
  — regen's per-kind availability (AI entries only).

## Scope: in

- **Regenerate action:** on an AI entry — resolve the turn's first
  `log_position` and its entry set, reverse the positional suffix
  through the C3 sweep, keep the originating `user_action` entry,
  and re-dispatch the per-turn pipeline under a fresh turn
  `action_id` with the same wrapped input (the C6 turn-submit
  surface from M2 or its pipeline-internal equivalent — planning
  decision on which layer re-dispatches).
- **Regen on the latest reply and on older replies:** regenerating
  a non-terminal reply is a deeper rollback (later entries go too)
  — it routes through the same sweep. **Slice design decision, not
  canon:** the canonical
  [regenerate confirmation](../../../../ui/screens/reader-composer/reader-composer.md#regenerate-confirmation)
  defines a confirm only for the chapter-close case; this slice
  extends the M2.5 rollback-confirm vocabulary to the multi-entry
  older-reply case (cascade counts before proceeding) while the
  terminal-reply case stays confirm-free. Recorded here rather
  than in canon; flag for a future reader-composer design pass if
  the behavior should be canonized.
- **UI wiring:** enable the ↻ glyph per the action-cluster matrix;
  in-flight edit restrictions (no regen during a running pipeline);
  streamed replacement renders through the existing streaming entry
  states.
- **Chapter-close seam (named, dormant):** the pre-sweep check
  "does this turn's group include a chapter-close chain" is
  structured so M5.2 adds the cost-confirm without touching the
  common path.

## Scope: out

- Refine-with-guidance on replies — not in canon for reader entries
  (refine is a wizard-opening affordance, 3.6a); the composer +
  suggestions are the steering surface.
- Swipe-switch between alternate takes — not a v1 reader feature;
  the barrier lists it for completeness but no surface exists.
- The chapter-close confirm branch's live path — M5.2.
- Changes to the sweep itself — C3, owned by 3.3.

## Acceptance criteria

- Regenerating the terminal reply: old reply entry + its piggyback
  deltas + classifier facts anchored to it reverse; facts anchored
  to earlier turns survive; `processedThrough` clamps; a new reply
  streams in under a fresh `action_id`; the user action entry is
  untouched (vitest end-to-end over the stub provider — the
  canonical catch-up-pass-then-regenerate scenario).
- Regenerate fires with no confirm on the terminal reply;
  regenerating an older reply surfaces the rollback-confirm modal
  with correct cascade counts before proceeding (vitest on the
  gate; manual on the modal).
- Regenerate during an in-flight classifier run drains it first
  (C3 bracket) and the reversal never strands committed classifier
  deltas about the regenerated turn (vitest with the controllable
  stub).
- Regen is unavailable during any in-flight pipeline and on
  non-AI entries (matrix per the action cluster).
- A mid-stream failure of the regenerated call surfaces the M2
  failure vocabulary and leaves the log at the post-reversal state
  (no orphan placeholder — same contract as a normal turn).
- CTRL-Z after a completed regenerate undoes the new take (the
  regenerated turn is a normal undoable unit).

## Tests

- Vitest: the end-to-end regenerate scenario, older-reply cascade
  path, barrier interleaving, failure-mid-regen, undo-after-regen.
- No new compounds expected (glyph + modal already shipped); manual
  smoke on desktop + Android with a real provider.

## Open questions

- **Re-dispatch layer** — resolved at planning; see
  [Implementation notes](#implementation-notes).
- **Failure entry lost to the pre-dispatch tail clear** — regenerate
  drops a standing system entry before dispatching (the sweep spares
  system entries, which carry no create deltas, so one would strand
  between the user action and the new reply). If the regenerate then
  rejects or throws, nothing replaces it, and the _earlier_ failed
  turn's Retry affordance is gone. Needs either a host-side
  pre-check or a way to defer the clear past the action's guards.
- **Confirm-time count staleness (M5.2)** — the cascade counts are
  resolved when the modal opens. Unreachable in M3 (no background
  writer adds entries or closes chapters), but once chapter close
  lands, a background close while the modal sits open would make the
  confirmed cascade larger than the displayed one.
- **Per-mount regenerate guard** — the in-flight guard is a route
  ref, so it cannot serialize two mounts of the same branch. Correct
  today (single reader surface); would need to move into a store if
  the rail ever hosts a second one.
- **E2E test coupling** — `reader-regenerate.spec.ts`'s second test
  builds on the first's DB state. `mode: 'serial'` makes a retry skip
  rather than mislead, but the seeded hero branch already carries
  non-terminal `ai_reply` rows, so the cascade test could be made
  self-contained (and LLM-free) later.

## Implementation notes

**Re-dispatch layer** — resolved to an action-layer `regenerateTurn`
in `lib/actions/turns/`, sharing `submitTurn`'s scaffolding (the
per-branch queue, extracted to `branch-queue.ts`; embedder-swap
admission), not a pipeline-internal re-run entry. The "same wrapped
input" needs no sourcing at all: the per-turn pipeline reads its
prompt and insert position from the branch tail in SQLite, so once
the sweep removes the reply, the surviving `user_action` **is** the
tail — byte-for-byte the DB shape a normal submit leaves after its
own `user_action` insert. The sweep composes the C3 primitives
through `resolveSweep`, which this slice extracted in
`story-entries/operational.ts` after `rollbackToEntry`,
`undoLastAction`, and regenerate became a third copy of the same
window-materializing sequence; each caller keeps its own tail and its
own redo-stack policy, which is not uniform (undo deliberately does
not clear).

**Non-success convergence** — failed, rejected, and aborted outcomes
all converge to the M2 failed-turn model: a follow-up sweep unwinds
the standing `user_action` too, landing the branch in exactly the
state a failed `submitTurn` leaves, so the existing Retry machinery
re-submits through the normal path without duplicating the action.
This is why the acceptance criterion "the user action entry is
untouched" holds on the happy path only. Two failure modes needed
their own handling: a `DeltaReplayError` from the follow-up sweep is
tolerated (logged with `committed`, which separates "user action
still standing" from "store stale") rather than costing the caller
the run result and the user's text; and a throw out of
`regenerateTurn` gets a toast plus a store resync, **not** a system
failure entry — the throw carries no submission, so that entry's
Retry would be doomed, and in the partial-sweep cases a Retry on a
stale submission would append a duplicate turn.

**Composer draft on cancel** — cancelling a regenerate restores the
swept action text only into an _empty_ composer. Unlike `submitTurn`,
regenerate never clears the composer, so an unconditional restore
would destroy text the user typed; the swept action is unrecoverable
in that branch, but the user asked to discard that turn and never
agreed to lose their draft.

**E2E** — added `e2e/tests/reader-regenerate.spec.ts` (terminal
no-confirm, older-reply cascade) beyond the slice's original Tests
section, per [`testing.md → Coverage`](../../../../testing.md#coverage-thorough-not-exhaustive),
which names "regenerate / undo a turn" as an in-scope alternative
flow. Its DB reads poll rather than reading straight after a
visible-text wait: the reader renders stream chunks live, so the DOM
resolves before the entry and its delta commit.
