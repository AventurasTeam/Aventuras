# Background delta survival anchor — over-reversal, resolved

Resolves the `Background-work log positions need a reservation scheme
to fix reversal over-reversal` followup in
[`followups.md`](../followups.md), removed by the commit that lands
this exploration. That followup was opened by the
[2026-06-02 classifier-reversal-quiesce session](./2026-06-02-classifier-reversal-quiesce.md),
which closed the _in-flight_ race (the `waitForClassifier('cancel')`
barrier and `reversalInProgress` lockout) and the
_already-committed-about-this-turn_ sweep, then scoped the lagging
**over-reversal** out as needing a "position-reservation scheme."

This session takes a different — and lighter — route than that sketch.
Rather than reserve physical `log_position` slots so background writes
sort by semantic position (a write-side change to how positions are
assigned), it keeps positions commit-ordered and makes the reversal /
fork **partition** read a per-delta **survival anchor** off the
existing [`deltas.entry_id`](../data-model.md#entry-mutability--rollback)
column. Same goal — a reversal of turn `T` must spare valid facts about
turns that survive — reached by changing one read-side predicate
instead of the position-assignment invariant. And because the predicate
is _exact_, the followup's "v1 stopgap: reversal-aware watermark vs.
accept the loss" question dissolves: there is no residual loss to
recover from, so nothing to accept.

The substrate this builds on was pinned by the predecessor session and
the deltas substrate: the positional suffix sweep and CTRL-Z algorithm
in [`Entry mutability & rollback`](../data-model.md#entry-mutability--rollback),
the [branch fork model](../data-model.md#branch-model), the distinct
`periodic_classifier` [`deltas.source`](../data-model.md#entry-mutability--rollback),
and the classifier's
[background-task framing](../memory/classifier.md#background-task-framing).

## What this closes vs. defers

Closes:

- The **over-reversal**: a reversal of a later turn no longer sweeps a
  lagging classifier's valid facts about earlier, surviving turns.
  Exact, not bounded — no re-derivation needed.
- Both facets the predecessor folded into the followup: the suffix
  boundary, and the aggressive-cadence CTRL-Z-of-a-turn dangling tail
  (classifier deltas about turn `T` committed above it are swept _because_
  their anchor is `T`; deltas about earlier turns are spared).
- A **latent fork bug** that exists today independent of reversals:
  a lagging classifier delta about a kept entry that committed at a
  tail position ≥ `L` is currently reverse-applied away at fork,
  silently dropping facts about kept turns.
- The previously **unpinned classifier watermark** — "unprocessed
  turns" gains a concrete field.
- Two interactions the anchor introduces or touches: translation
  survival (inherit the target's content anchor) and the chapter-close
  phase-0 `action_id` boundary.

Defers: nothing. The two interactions are resolved inline, not parked.

## The over-reversal, precisely

`deltas.log_position` is `MAX+1` at **commit** time, so it encodes
commit order, not narrative order. A reversal is a positional suffix
sweep — reverse every delta with `log_position ≥ N`. That is correct
only while commit order matches narrative order, which the lagging
periodic classifier violates: it commits facts about old, surviving
turns at new tail positions.

This is **not** a deep-rollback corner case. It fires on the most
common reversal — regenerate the last reply:

- Turn 50 (head) commits deltas at positions 100–102.
- A catch-up classifier pass processes turns 47–49 and commits at
  103–108 — facts about turns that all survive.
- Regenerate turn 50 → sweep `≥ 100` → reverses 100–102 (turn 50,
  correct) **and** 103–108 (facts about 47–49, over-reversed).

The predecessor's barrier does nothing here: it cancels an _in-flight_
pass, but 103–108 are already committed from a prior pass.

## The route not taken — physical position reservation

The followup's sketch was to make positions themselves carry narrative
order: stride foreground assignment (e.g. ×1000) so each turn owns a
gap, and have background facts fill the gap after their provenance
turn; the sweep stays a dumb `≥ N`. It is also exact and also fixes the
fork bug, but it disturbs the append-only `MAX+1` invariant a lot of
the model leans on, introduces gap-overflow as a (remote) failure mode,
and gets fiddly around large non-turn actions — a 600-entry chapter
close emits 600 `chapter_id` deltas in one action, blowing any fixed
stride. A fractional / lexorank `log_position` removes overflow but
changes the column type and ripples through the unique index, the
chain-walk index, fork math, and every read site.

The survival-anchor route lands in the same place (exact reversal,
fork bug fixed) for the cost of one predicate clause, because the
anchor data — `entry_id` on each background delta — was already assumed
to exist (the predecessor's "dangling `entryId`" description relies on
it). We formalize what that anchor must be and make it the partition
key; positions stay untouched.

## The survival anchor

`deltas.entry_id` is best understood not as "the entry that produced
this delta" but as the **survival anchor**: _reverse this delta iff
this entry is reversed_. The four writers map cleanly:

- **Foreground turn delta** (`story_entries` create, piggyback) →
  anchor is its own turn. Already true; `entry_id` = the turn.
- **Background fact** (`periodic_classifier`) → anchor is its
  **provenance** turn (the window entry whose prose produced it).
- **Translation** → anchor is its target's **current content-defining
  delta** (see [Translations](#translations-inherit-the-content-anchor)).
- **No anchor** (`null` — chapter close, user direct edit) → reverse
  positionally, by its own commit position.

This is the honest generalization of `entry_id`, and the whole design
reduces to: _partition reversals and forks by the survival anchor, not
by raw commit position._

## The reversal + fork predicate

Let `B` be the **earliest entry a reversal removes** — for regenerate /
CTRL-Z-of-a-turn, `B` is the undone turn itself; for rollback _to_
entry `M` (which keeps `M`), `B` is `M+1`. The suffix boundary `N` is
`B`'s first `log_position`. The sweep reverses:

```
log_position ≥ N  AND  ( entry_id IS NULL  OR  position(entry_id) ≥ position(B) )
```

`position(x)` reads `story_entries.position`. Foreground deltas in the
suffix anchor to their own turn (≥ B) → always reversed, as today.
`null`-anchor deltas → always reversed. Only a lagging background delta
with anchor _below_ `B` is spared. Membership changes; the
reverse-application order (newest `log_position` first) does not.

Applied in **two** places:

1. **The reversal sweep** — all four prose-reversal kinds (regenerate,
   entry-delete rollback, swipe-switch, CTRL-Z-of-a-turn) funnel through
   the one positional suffix sweep; the predicate replaces the bare
   `log_position ≥ N`.
2. **The fork reverse-apply partition.** Fork from entry `N`; `L` =
   min `log_position` among entry `(N+1)`'s deltas. Corrected:
   - **Copy to the new branch:** `log_position < L`, **plus** background
     deltas with `log_position ≥ L AND position(entry_id) ≤ position(N)`
     — the lagging facts about kept entries that are today wrongly
     rewound away.
   - **Reverse-apply then discard:** the rest of `≥ L`
     (`entry_id IS NULL OR position(entry_id) ≥ position(N+1)`).

**Free integrity invariant.** A background delta survives a reversal
**only if its anchor entry survives** — spared ⟺ `position(entry_id) <
position(B)`, and everything ≥ `B` is what is being deleted. So a
surviving background delta can never point at a deleted entry: no
orphans, no dangling anchors, by construction. This covers entity
creates, `happening_involvements`, and `happening_awareness` uniformly
(an entity introduced at turn X has anchor X, and every fact
referencing it has anchor ≥ X, so they reverse or survive together).

**Orthogonal to the in-flight barrier.** The
`waitForClassifier('cancel')` and `reversalInProgress` machinery from the
[predecessor session](./2026-06-02-classifier-reversal-quiesce.md)
stays exactly as-is: it guards the _racing_ classifier; this predicate
guards _already-committed_ deltas. Both required.

## Provenance stamping (the write-side contract)

The predicate is only as good as the anchor it reads. Every
background-source delta must carry `entry_id` = the entry whose prose
produced **that specific write** — per row, not per pass.

Provenance is a different axis from the narrative anchors
`happenings.occurred_at_entry` (where an event sits in story time;
`null` for the whole temporal / historical class) and
`happening_awareness.learned_at_entry` (when a character learned a
fact). They frequently coincide but must not be conflated:

- **Single-turn extraction** → that turn (the common case).
- **Cross-turn synthesis** ("over three turns a siege unfolded") → the
  **latest contributing turn**. A fact's support is only fully intact
  while its newest evidence survives; anchoring at the earliest
  contributor would leave a stale fact standing after most of its
  evidence rolled back.
- **Status flip** (`staged→active`, `active→retired`) → the turn whose
  prose triggered it.
- **First-introduction description** → the introducing turn.
- **Awareness learned late** (a character learns of an _old_ happening
  now) → the turn that narrated the learning, _not_ the happening's
  provenance. A happening and an awareness row about it legitimately
  carry different anchors.

**Fallback** for an unattributed fact: the window head `E` (the trigger
entry). Conservative — the fact then reverses on any reversal _into or
below_ its window (re-derivable) but never survives as an orphan about
a deleted turn. A safety net, not the main path.

**This closes a pre-existing gap.** `occurred_at_entry` and
`learned_at_entry` already require the classifier to map each
extraction back to a specific window entry, yet no doc ever pinned the
attribution channel. Provenance stamping forces it to exist explicitly;
the **same** per-fact channel feeds all three values, with provenance
read directly and the narrative anchors the classifier's judgment on
top. The output-contract change is therefore "formalize per-fact entry
attribution," not "bolt on a field."

## Translations inherit the content anchor

A translation is a derived artifact of its target, so its survival
should follow the target's — but bound to the **content version** it
translates, not the target's row identity. Inheriting the target's
_create_ provenance is subtly wrong: a happening created at turn 20,
its description user-edited to "v2" at turn 70, its "v2" translation
then anchored at 20 — a reversal to turn 50 reverts the content to "v1"
(the edit at 70 is in the suffix) while sparing the "v2" translation
(anchor 20 < 50). A stale, mismatched survivor — worse than a
re-fetchable miss.

The fix: a translation delta inherits the anchor of its target's
**current content-defining delta** — the target's top-of-chain delta at
translation-write time (`MAX(log_position)` for `target_id`, covered by
`deltas_chain_idx`; one indexed read).

- Never-edited classifier happening → top-of-chain _is_ the create →
  inherits the classifier provenance → spared on unrelated reversals
  (the win: no re-fetch).
- User-edited target → top-of-chain is the edit (`null`) → translation
  anchors `null` → reverses positionally with the edit. No stale
  survivor.
- Translating a `story_entry`'s prose → top-of-chain is the entry's own
  create (`entry_id` = itself) → translation lives and dies with the
  entry.

Racing cases reconcile because content and translation end up anchored
to the same writes (target edited to v3 with re-translation still
pending: a reversal past the v3 edit reverts content to v2 and spares
the v2 translation — consistent). This closes the over-reversal of
translations structurally, to the same bar set for the classifier
itself, rather than leaning on `translation-retry` re-fetch.

## Phase-0 `action_id` boundary

The predicate guards the _positional_ sweep. CTRL-Z of a **chapter
close** reverses an `action_id` **group**, not a suffix — out of the
predicate's reach. So phase-0's catch-up classifier writes must **not**
share the chapter-close batch's `action_id`: if they did, un-closing a
chapter would reverse valid facts about turns that _survive_ the
un-close (they are merely un-chaptered) — over-reversal sneaking back
through the action-group door.

Phase-0 writes carry their own `periodic_classifier` `action_id`(s) +
provenance, which classifier.md already implies for all classifier
work; this pins it at the phase-0 boundary. Mechanically:
[`chapter-close.md`](../memory/chapter-close.md) currently says "Five
phases under one `action_id`" — phases 1–4 share the chapter-close
`action_id`; phase 0 (the classifier running) does not. The CTRL-Z
selection rule is correspondingly "reverse the last **undoable unit**,
skipping only `periodic_classifier` groups" — chapter close is an
undoable unit _regardless of trigger_ (auto token-threshold or manual),
which is exactly why it can't share an id with the background catch-up.

## The watermark — pin + clamp

**Pin it.** Add `processedThrough` — an entry **position** (integer,
matching `story_entries.position`) — to a new `branches.classifier_status`
JSON field that also holds the per-branch classifier state, last-success,
last-error, and retry count that
[`classifier.md → Persistence`](../memory/classifier.md#persistence) had
left without a home. `branches` is not a delta-logged table, so the field
bypasses the log naturally. Semantics: the highest entry position the
classifier has fully processed; the pass range is `(processedThrough,
head]`. This is the concrete thing behind today's "unprocessed turns,"
read by the cadence trigger, `[Run classifier now]`, and chapter-close
phase 0. Storing a position (not an `entry_id`) keeps the clamp pure
arithmetic with nothing to dangle.

**Advance on success** — a pass over `(processedThrough, E]` sets
`processedThrough = E` in its commit transaction.

**Clamp on reversal** — using the same `B`:

```
processedThrough ← min(processedThrough, position(B) − 1)
```

set in the sweep transaction, so re-generated / rolled-back turns get
re-processed. Because the predicate already spared every surviving
turn's facts, this is the _only_ watermark concern; re-processing
resumes cleanly at `B`, never re-deriving a spared fact, so **no
duplicate happenings on a normal reversal**. Not delta-logged — it is
operational state (same rationale as UI-only fields and probe captures
bypassing the log), and an imperative clamp to `position(B) − 1` is
exact, where the sweep has no monotonic pre-value to restore.

**Fork init** — new branch from entry `N`: `processedThrough =
min(parent.processedThrough, position(N))`; the rest of the status
resets to idle (a fresh branch does not inherit failed-persistent
state).

## Adversarial pass

**Load-bearing assumption — truthful provenance.** The design rests on
the classifier stamping the anchor correctly, or conservatively. A
confident mis-attribution (claims turn 40 when the fact depended on
turn 60) spares a fact whose real evidence vanished — a stale survivor.
Bounded by the unattributed-fallback to `E`, the latest-contributing
rule (biases toward over-reversal, never under), and re-derivation; and
it is the _same_ trust already extended for `occurred_at_entry` /
`learned_at_entry`. Worst case is a stale fact until chapter-close
compaction or a user edit — never corruption.

Verified to hold (not assumed):

- **Two passes deep.** Fact about turn 30 (tail position, anchor 30)
  spared while a fact about turn 50 (later tail, anchor 50) reverses, on
  a rollback to 40.
- **Awareness learned late.** Happening from turn 20, character learns
  at turn 60 → the awareness row anchors 60 and reverses at `B = 50`
  while the happening survives — the character had not learned it yet at
  turn 50.
- **No dangling refs**, by the integrity invariant above.
- **No duplicates on normal regenerate** — the clamp re-processes from
  exactly the changed turn.
- **`retrieval_count` rollback stays consistent** — injection-count
  increments from reversed turns drop with the suffix; earlier survive.
- **No migration** — pre-design background deltas (null `entry_id`)
  degrade to old positional behavior via the `entry_id IS NULL` branch.
- **Read sites** — reversal and fork get the predicate; the history UI /
  [`delta-log-row`](../ui/patterns/delta-log-row.md) _benefits_
  (background facts now link to their anchor entry instead of `null`).
  Verify-at-integration: no code keys "is background?" off
  `entry_id IS NULL` (it keys off `source`).

Residual (bounded, documented, not fixed): **redo (CTRL-Y) of a
classifier-processed turn** re-applies the swept facts from the
in-memory redo stack but does not restore `processedThrough`, so the
next pass re-derives that turn — possibly duplicate happenings, cleaned
at chapter-close dedup. Inside the model's existing duplicate tolerance.

## Integration

Canonical edits:

- [`data-model.md`](../data-model.md):
  - `branches` table (ER diagram) — add `classifier_status json`
    (state, last-success, last-error, retry count, and `processedThrough`).
  - `deltas.entry_id` comment — note background deltas carry the
    survival anchor (provenance); translations carry their target's
    content anchor.
  - `Entry mutability & rollback` — the survival-anchor framing; the
    reversal predicate replacing the bare `≥ N`; the CTRL-Z
    "undoable unit, skip `periodic_classifier`" wording (auto-close is
    a unit); the `processedThrough` clamp.
  - `Branch model` — the corrected fork reverse-apply partition and the
    `classifier_status` fork-init rule.
- [`classifier.md`](../memory/classifier.md):
  - Output contract / ID handling — per-fact provenance attribution,
    its relation to `occurred_at_entry` / `learned_at_entry`, the
    cross-turn-synthesis and fallback rules.
  - Persistence — resolve to `branches.classifier_status` JSON; add
    `processedThrough` semantics, reversal clamp, and fork init.
- [`generation-pipeline.md`](../generation-pipeline.md):
  - Prose-reversals section — a pointer that the committed-delta
    over-reversal is closed by the survival-anchor predicate, complementing
    the in-flight barrier.
- [`chapter-close.md`](../memory/chapter-close.md):
  - Phase 0 — phase-0 catch-up writes carry their own
    `periodic_classifier` `action_id` and provenance, distinct from the
    phases-1–4 chapter-close batch `action_id`.
  - `Translation` section — a note that translation deltas inherit
    their target's content-defining-delta anchor, cross-referencing the
    survival-anchor framing in `Entry mutability & rollback`.

Followups: remove the resolved reservation-scheme entry. None added —
both interactions resolved inline.
