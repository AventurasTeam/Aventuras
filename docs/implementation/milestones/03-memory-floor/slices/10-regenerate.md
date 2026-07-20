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
  (refine is a wizard-opening affordance, 3.6); the composer +
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

- **Re-dispatch layer** — reuse the C6 `submitTurn`-shaped action
  minus the entry write, vs a pipeline-internal re-run entry point;
  pick at planning (affects where the "same wrapped input" is
  sourced from — the surviving `user_action` entry's content is the
  natural source).

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
