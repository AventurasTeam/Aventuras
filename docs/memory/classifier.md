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

## Embedding compute boundary

The classifier emits rows and embeds them in the same transaction —
new happenings, first-introduction entity descriptions, and any
other write touching an embedded field go through the eager-sync-
on-write contract specified in
[`retrieval.md → Compute lifecycle`](./retrieval.md#compute-lifecycle).
The classifier itself runs as a background agent (see
[Background-task framing](#background-task-framing) below), so the
inline embed cost stays off the user-facing critical path.

If the embedder is unavailable at write time (local model still
initializing, provider mode network down), the metadata write
succeeds, the row is marked `embedding_stale = 1`, and a worker
drains the flagged set when the embedder is healthy again. Same
path as any other embedded-field write — no classifier-specific
deferral mechanism.

The classifier does not modify already-embedded fields on existing
rows. Status flips touch `entities.status` only, which isn't
embedded. If a future extension lets the classifier modify an
embedded field, it goes through the same eager-sync contract — no
special path required.

The transient embedding computed in the disambiguation flow below
(extracted description for the similarity check) is a decision-time
computation, not a persisted embedding write — outside this
boundary.

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
| `affordance`     | `'pill-only'` — folds into the generation indicator at low priority (see below)                                      |
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

**Pill priority.** The classifier surfaces on the existing
generation indicator pill with low priority — user-initiated
narrative wins when both are in flight; the classifier pill shows
when nothing higher is running. No ETA in the popover (run length
isn't predictable). Chapter-close uses `'pill-and-banner'`
(blocking workload, separate visual treatment); periodic classifier
shares the pill, not the banner. The pill is unconditional — if
something's generating it shows, no fail-only or quiet-success
mode.

## Settings · Memory · Classifier panel

The Story Settings · Memory tab surfaces classifier controls and
state for the active branch in a compact panel.

### Cadence config

In-place edit of `stories.settings.classifierCadence` and
`piggybackMode`. The buffer-aware indicator from
[`cadence.md → User-tunable knobs`](./cadence.md#user-tunable-knobs)
renders inline so the user sees the cadence-vs-recent-buffer
overlap.

### Status block

Reflects the classifier's current state:

- **Idle** — `Last run N turns ago, processed P happenings + Q awareness rows.`
- **Running** — `Running... processed N of M turns.` Mirrors the pill.
- **Retrying** — `⚠ Last run failed (X of 3 attempts), retrying in N minutes.` Visible to users who look in Settings; doesn't escalate elsewhere.
- **Failed-persistent** — `⚠ Classifier failed after 3 attempts: [reason].` Inline `[Retry]` + `[View error details]`. Also surfaces as a top-bar error pill in the affected story — same visual vocabulary as the cluster-1 staleness pill; tap routes back here. Two different reasons, one UX pattern: error pill is the discovery channel, Settings panel is the resolution channel.

### Manual override

`[Run classifier now]` triggers an immediate pass over unprocessed
turns. Disabled while a run is actively in flight; enabled in
**idle** and **retrying** states (lets the user preempt the
auto-retry backoff). The **failed-persistent** inline `[Retry]`
is the equivalent action surfaced from the loud-error path.

### Auto-retry policy

A failed run schedules auto-retry with exponential backoff: **30
seconds → 2 minutes → 5 minutes**. After 3 retries exhausted, the
classifier enters **failed-persistent** state. Cadence-triggered
runs suspend in that state — no point spamming a broken provider
on every cadence tick — until the user explicitly retries. Cadence
resumes from the next normal trigger after a retry succeeds.

The retry policy applies to whatever caused the failure (rate
limit, network drop, provider 5xx). Errors that aren't transient
(invalid API key, model removed from provider catalog) hit
failed-persistent on the original failure plus the three retries
just like any other; the user resolves at the source (re-key,
swap profile, etc.) rather than waiting for retries to magically
succeed.

### Persistence

Per-branch classifier status — current state, last-success-at,
last-error, retry-attempt count — persists alongside the branch.
Concrete shape (`branches.classifier_status?: JSON` field vs
sidecar table) is an implementation detail; this design pins what
gets stored, not where.

The panel sits in the same Memory tab as the embedder controls
(see
[`model-management.md → Embedder config`](./model-management.md#embedder-config--where-it-lives-in-settings))
and the cluster-1 staleness panel. Wire-level layout lands at the
per-screen Story Settings design pass.
