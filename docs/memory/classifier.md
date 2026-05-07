# Periodic classifier contract

A background agent that runs on a configurable cadence (see
[`cadence.md → classifierCadence`](./cadence.md#user-tunable-knobs))
and reads the recent prose window not yet covered by piggyback's
per-turn writes. Its job is populating the structured graph that
retrieval queries against.

## What the classifier writes

- **Happenings** — `happenings`, `happening_involvements`,
  `happening_awareness`. New rows for events extracted from the prose
  window, with `decay_resistance` set per awareness row from the
  model's per-character severity judgment at extraction time.
- **Status transitions** — `entities.status` flips:
  - `staged → active` when prose mentions a staged entity in scene
    (the slow path; see
    [Staged-entity promotion](./edge-cases.md#staged-entity-promotion)).
  - `active → retired` on hard finality signals only (death, exile,
    faction-disbanded). Conservative bias.
- **First-introduction descriptions** — when the classifier extracts
  a genuinely new character (no name match against existing
  entities), it authors the initial `description` from prose. After
  first introduction, the classifier never amends `description` (the
  authorship contract in
  [`data-model.md → World-state storage`](../data-model.md#world-state-storage)
  remains intact).

## Disambiguation on new-character mentions

For every "new character" candidate the classifier extracts, code-side
reconciliation runs before the create / promote decision. Flow:

1. **Name lookup** against the entity index (active, staged, retired).
   O(1) hash check. The classifier itself doesn't need to know about
   every character; the index does.
2. **No name match** → genuinely novel character. Create fresh entity.
3. **Name match found** → embedding similarity between the
   classifier-extracted description and the existing entity's
   description. Existing entity's embedding is cached (see
   [`retrieval.md → Embedding infrastructure`](./retrieval.md#embedding-infrastructure));
   the extracted description embeds once.
   - **High similarity** (`sim ≥ τ_high`) → promote staged → active OR
     treat as already-known active mention. Update entity if the
     extracted description adds information.
   - **Low similarity** (`sim < τ_low`) → create new entity with
     `name_collision_flag = true` for World-panel review.
   - **Ambiguous** (`τ_low ≤ sim < τ_high`) → conservative create-new
     with the flag, defer to user.

Thresholds (`τ_high`, `τ_low`) are tunable. Defaults TBD empirically
once real story data exists; sensible starting ranges (e.g. 0.75 /
0.50 cosine) until tuning lands.

## Background-task framing

The periodic classifier runs as a background agent, not a synchronous
pipeline phase:

| Field            | Value                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `gateBehavior`   | `'no-gate'`                                                                                                          |
| `conflictPolicy` | `'concurrent-allowed'`                                                                                               |
| `affordance`     | `'pill-only'` (or `'invisible'` — UI surface design TBD)                                                             |
| `writeSet`       | happenings, happening_involvements, happening_awareness, entity status flips, first-introduction entity descriptions |

The single-writer invariant in
[`architecture.md → Generation transactions and edit gating`](../architecture.md#generation-transactions-and-edit-gating)
relaxes to **single-writer-per-write-set** in v1. Piggyback's
write-set and the classifier's write-set are disjoint at the
row-and-field granularity (see
[`cadence.md → Concurrency`](./cadence.md#concurrency)).

If the user starts a new turn while the classifier is mid-run, both
proceed. The classifier holds its own `action_id` for its writes; the
user-turn pipeline holds its own. Reverse-replay on rollback peels
them off independently.

`'abort-self'` was rejected as wasteful — it discards in-flight
classifier work that doesn't conflict with the new turn's writes
anyway.
