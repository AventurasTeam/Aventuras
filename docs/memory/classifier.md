# Periodic classifier contract

A background pipeline that runs on a configurable cadence (see
[`cadence.md → classifierCadence`](./cadence.md#user-tunable-knobs))
and reads the recent prose window not yet covered by piggyback's
per-turn writes. Its job is populating the structured graph that
retrieval queries against. Declares against the framework's Pipeline
shape per [`generation-pipeline.md`](../generation-pipeline.md); see
[Background-task framing](#background-task-framing) below for its
declaration values.

## What the classifier reads

The prompt carries the branch's world as lists the classifier
addresses by placeholder id
([ID handling](#id-handling-in-classifier-output)):

- **Known entities** — every entity on the branch, of any kind and
  status, with its description. The classifier sees the whole roster,
  so the [reconciliation](#disambiguation-on-new-character-mentions)
  below is a backstop for a row the model missed, not a lookup the
  model can't do.
- **Known relationships** — the stored views, as the relationships
  bullet below describes.
- **Known happenings** — the branch's happenings by title.
- **Turns to classify** — the window's entries by turn handle, each
  with its prose and the scene saved on it: the entry's
  `sceneEntities` and `currentLocationId`
  ([`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape)),
  as the same placeholder ids. The saved scene includes the user's
  corrections and carries forward over a turn that reported none. An
  id the branch no longer has is left out, so no raw id reaches the
  prompt; an entry with no saved scene, such as a user action, shows
  none.

Two rules lean on the scene and the roster. Prose naming an entity in
a turn's scene refers to that entity. And a shortened or fuller name,
a title or an alias of a listed character is that character, unless
the prose shows it is someone else: it takes the listed id rather than
a `newCharacters` entry, and the new name form goes in the reply's
alias list (the keywords bullet below).

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

  Both are checked against the pass's view — its snapshot plus what
  earlier facts in the same reply changed — when planned, and against
  the row as it stands when the write lands, so a status the user
  changed mid-pass stands. A status the user wrote after the flip's
  prose stands too, even when written before the pass started (see
  [`cadence.md → User edits and classifier writes`](./cadence.md#user-edits-and-classifier-writes)).

- **First-introduction descriptions** — when the classifier creates
  a character, one the
  [reconciliation](#disambiguation-on-new-character-mentions) didn't
  absorb into an existing row, it authors the initial `description`
  from prose. After
  first introduction, the classifier never amends `description` (the
  authorship contract in
  [`data-model.md → World-state storage`](../data-model.md#world-state-storage)
  remains intact).
- **Entity keywords** — the same brand-new-entity object carries
  `keywords`: the titles, epithets and relational references the prose
  used for the character alongside its name ("the Grey Wolf", "the
  innkeeper"). These feed the keyword retrieval pathway, which matches
  an entity on its name plus this list — see
  [`retrieval.md → Keywords schema`](./retrieval.md#keywords-schema).
  Unlike `description`, keywords are **not** frozen after first
  introduction: later passes append newly-observed references through
  the reply's alias list, which names a listed entity of any kind and
  the titles, epithets or name forms the prose used for it. Writes
  are strictly append-and-deduplicate against the row as it stands
  when the write lands, and never remove, so user-authored
  aliases survive every subsequent pass, including one added while the
  pass ran. An alias the user removed after the fact's prose is not
  re-added ([user precedence](./cadence.md#user-edits-and-classifier-writes)).
- **Character relationships** — `character_relationships`. One
  perspective per fact, the subject's view of the object and never the
  inferred inverse, upserted into the pair's row as it stands when the
  write lands. The prompt shows the classifier the stored view for
  every stored pair on the branch whose two characters exist (one
  line per non-null perspective), and it is told to emit a fact only
  when the prose establishes a view or changes one already listed. A
  write repeating the stored view, ignoring case and surrounding
  whitespace, is rejected as a no-op at the action layer — it writes
  no delta. So is one against a view the user wrote, or a pair the user
  deleted, after the fact's prose
  ([user precedence](./cadence.md#user-edits-and-classifier-writes)).

## Provenance attribution

Every delta the classifier commits carries a **survival anchor** in
`deltas.entry_id` — the window entry whose prose produced _that row_ — so
a prose reversal spares facts about surviving turns rather than
over-reversing them (see
[`data-model.md → Entry mutability & rollback → Survival anchor`](../data-model.md#survival-anchor)).
The structured output therefore tags each emitted fact with a provenance
handle drawn from its input window; the parse path resolves it to an
`entry_id` and stamps the delta. Sub-rows produced with a parent (a
happening's involvements) inherit the parent's anchor unless independently
sourced — a character learning of an _old_ happening now anchors to the
turn that narrated the learning, not the happening's.

- **Single-turn extraction** → that turn (the common case).
- **Cross-turn synthesis** → the **latest contributing turn**; anchoring
  at the earliest contributor would leave a stale fact standing after its
  newer evidence rolled back.
- **Status flip / first-introduction** → the triggering / introducing
  turn.
- **Unattributed fallback** → the window head, so the fact reverses on any
  reversal into its window (re-derivable) but never survives as an orphan.

Provenance is a **distinct axis** from the narrative anchors
`happenings.occurred_at_entry_id` (where an event sits in story time; `null`
for the temporal / historical class) and
`happening_awareness.learned_at_entry_id` (when a character learned a fact).
They frequently coincide, but the classifier already had to map each
extraction to a window entry to populate those — provenance formalizes the
single per-fact attribution channel that feeds all three, the anchor read
directly and the narrative fields the classifier's judgment on top.

## ID handling in classifier output

References to existing entities in the classifier's structured
output are **placeholders** (`c1`, `l1`, `hp1`, …), not the
underlying `char_<uuid>` / `loc_<uuid>` / etc. forms — the
substitution layer swaps both directions
(see [`generation-pipeline.md → ID placeholder substitution`](../generation-pipeline.md#id-placeholder-substitution)).
The placeholder universe shown to the classifier covers entities
in the prompt's structured entity/lore/happening/relationship lists.

When the classifier creates a brand-new entity, it emits the
entity as a **full object with no `id` field** — name, description,
state fields, etc. Parse allocates a fresh `char_<uuid>` (or other
kind-appropriate prefix) and registers it in the idMap if subsequent
output references it. Any subsequent reference in the same response
uses a temporary handle the LLM picks; parse maps the temporary
handle to the newly-allocated UUID.

This separation keeps the LLM's surface area small (no UUID
copying) while preserving the existing disambiguation flow below
unchanged — name-match + embedding-similarity work on prose +
embeddings regardless of how identity is rendered to the model.

## Embedding compute boundary

The classifier emits rows but does **not** embed them: new
happenings, first-introduction entity descriptions, and any other
write touching an embedded field land `embedding_stale = 1` and
leave the vector to the pre-retrieval sync stage, per the
[sync-before-read contract](./retrieval.md#compute-lifecycle).
Nothing embeds on the classifier's write path; the dirty rows are
picked up by the opportunistic background worker between turns and,
as a backstop, by the next retrieving pipeline's sync stage — so the
embed cost stays off the user-facing critical path, decoupled from
the write. (The classifier itself runs as a background pipeline; see
[Background-task framing](#background-task-framing) below.)

If the embedder is still unavailable when that sync stage runs
(local model initializing, provider mode network down), the row
stays `embedding_stale = 1` and absent from vec0, and the stage's
blocking failure path applies. No classifier-specific deferral
mechanism — same path as any other dirty row.

The classifier does not modify already-embedded fields on existing
rows. Status flips (with a retirement's `retired_reason`) and keyword
appends touch no embedded field. If a future extension lets the
classifier modify an embedded field, it flags the row dirty the same
way — no special path required.

The transient embeddings computed in the disambiguation flow below
(the candidate's and its namesakes' descriptions, for the similarity
check) are a decision-time computation, not a persisted embedding
write — outside this boundary.

## Disambiguation on new-character mentions

For every "new character" candidate the classifier extracts, code-side
reconciliation runs before the create / promote decision. It compares
the candidate with the branch's characters (active, staged, retired)
and decides whether to absorb it into one of them, create it flagged
for World-panel review, or create it plain. Candidates in one reply
are not compared with each other.

**Namesakes.** Names compare under the keyword-term normalization
(trimmed, case-folded, NFC), split into words on whitespace.

- **Exact** — the two names are equal.
- **Partial** — not exact, and either one name's words appear inside
  the other's, whole and contiguous ("Kael" in "Kael Stormborn",
  "Innkeeper" in "the Innkeeper", but not "John" in "Johnson"), or one
  row's name is among the other's keywords (a candidate "Marta" whose
  keywords hold "the innkeeper", against a row named "the Innkeeper").

The rule pairs rows of one kind, works for any kind, and lives in
`lib/world` beside World's pairing. The classifier reconciles
characters, the only kind it creates; the per-turn writer's locations
and items match under their own rules
([`piggyback.md → New locations and items`](./piggyback.md#new-locations-and-items)). A name in a script written without spaces never
contains another, so it matches only exactly or through a keyword.

**Signals.**

- **Similarity** — every namesake's description is embedded with the
  candidate's in one call and compared by cosine, so the decision
  never depends on whether a vec0 row has drained. A namesake with a
  blank description has no score, and neither does any namesake when
  the call fails or its vectors don't line up (an embedder swap in
  progress).
- **Scene presence** — whether the namesake is in the saved
  `sceneEntities` of the candidate's `sourceTurn`. Ignored when that
  handle fell back to the window head, since the head's scene isn't
  the candidate's.

**Decision.** The first row that applies wins:

| Condition                                                                                     | Outcome                                                                                                    |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| An exact namesake scores `sim ≥ τ_high`, or scores `τ_low ≤ sim < τ_high` and is in the scene | **Absorb** into the best-scoring such row: promote it if staged, otherwise treat the mention as that row's |
| Any exact namesake                                                                            | Create with `name_collision_flag = 1`                                                                      |
| A partial namesake scores `sim ≥ τ_low`, is in the scene, or has no score                     | Create with the flag                                                                                       |
| Otherwise                                                                                     | Create, unflagged                                                                                          |

An exact name keeps the similarity bands, the scene breaking the
ambiguous band's tie. A partial match never absorbs: a misattribution
lands the reply's involvements, awareness and relationships on the
wrong row unreviewed, and nothing splits them apart again. So it flags
only with a second signal and otherwise creates a plain row. Without a
score nothing absorbs; the namesake flags, deferring to the user.
Absorbing appends the candidate's new keywords to the row; its
description stays, per the first-introduction rule above.

**Partner and reason.** A flagged create stores in
`name_collision_partner_id` the namesake it was compared against: the
first of the namesakes that qualified to flag it (every exact one, and
a partial one under the third row's conditions), ordered by score with
the unscored last, then in-scene first, then exact before partial, then
unflagged, older and by id. `name_collision_reason` records why, read
from that partner:

| Reason      | Partner                              |
| ----------- | ------------------------------------ |
| `alike`     | Partial, `sim ≥ τ_high`              |
| `ambiguous` | `τ_low ≤ sim < τ_high`               |
| `distinct`  | Exact, `sim < τ_low`                 |
| `in-scene`  | Partial, `sim < τ_low`, in the scene |
| `no-signal` | No score                             |

The per-turn writer adds one more reason, `same-parent`, for a
location it creates beside a similarly named sibling, and gives an
item's exact namesake `alike` or `ambiguous` by the same bands. World pairs a
flagged row with its partner and states the reason in the resolve
dialog
([`world.md → Collision review and entity merge`](../ui/screens/world/world.md#collision-review-and-entity-merge)).

Thresholds (`τ_high`, `τ_low`) are tunable. Defaults TBD empirically
once real story data exists; sensible starting ranges (e.g. 0.75 /
0.50 cosine) until tuning lands.

## Background-task framing

The periodic classifier runs as a background pipeline — a Pipeline
declaration in the framework's registry, same shape as per-turn and
chapter-close but with different concurrency / gating values:

| Field                           | Value                                                                                                                                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                          | `'periodic-classifier'`                                                                                                                                                                                                                                                                             |
| `gateBehavior`                  | `'no-gate'` — doesn't block user-source writes; they wait out its write phase ([no-gate write phase](../generation-pipeline.md#no-gate-write-phase))                                                                                                                                                |
| `concurrencyPolicy`             | `{ blockedBy: ['periodic-classifier', 'chapter-close'] }` — no double passes; blocked from starting during chapter-close                                                                                                                                                                            |
| `affordance`                    | `'pill-only'` — folds into the generation indicator at low priority (see below)                                                                                                                                                                                                                     |
| Write set (prose, not declared) | happenings, happening_involvements, happening_awareness, new character entities (first-introduction description, keywords, collision flag with its partner and reason), entity status flips with retired reasons, entity keyword appends (aliases and absorbed candidates), character relationships |

Write-set boundaries between the classifier and the piggyback / per-turn
pipeline are enforced via narrow action functions named for field-set
scope (see
[`generation-pipeline.md → Narrow action functions over write-set declarations`](../generation-pipeline.md#narrow-action-functions-over-write-set-declarations)),
not a typed declaration. The single-writer invariant relaxes to
**single-writer-per-write-set** in v1; piggyback's write-set and the
classifier's write-set are disjoint at the row-and-field granularity,
apart from the monotonic `entities.status` overlap (see
[`cadence.md → Concurrency`](./cadence.md#concurrency)).

If the user starts a new turn while the classifier is mid-run, both
proceed. The classifier holds its own `actionId` for its writes; the
user-turn pipeline holds its own. That `actionId` is stamped
`source = periodic_classifier` (distinct from per-turn piggyback's
`piggyback_tagged_block`) and is **never an undo target** — CTRL-Z's
head-selection skips it (see
[`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)).
It survives only for crash recovery.

The classifier's `concurrencyPolicy.yieldsTo` stays empty — it does
NOT abort itself when a foreground _forward_ pipeline starts.
Discarding in-flight classifier work that doesn't conflict with the
new turn's writes is wasteful; the disjoint-write-set property makes
coexistence safe.

A _reversal_ is the exception, handled outside `yieldsTo`. Regenerate,
entry-delete rollback, swipe-switch, and CTRL-Z of a turn reverse prose
the classifier may be mid-consuming, so each brackets its positional
sweep with `await awaitRunTerminal('periodic-classifier', 'cancel')` plus a
`reversalInProgress` start-block (see
[`generation-pipeline.md → Prose reversals and the classifier barrier`](../generation-pipeline.md#prose-reversals-and-the-classifier-barrier)).
The classifier's part of that contract is one **abort-free critical
section**: its commit burst — one LLM response, one burst of deltas —
ignores `signal.aborted` once parsing begins and never returns
`aborted` holding committed deltas. So `'cancel'` either discards a
not-yet-committed run (the LLM stream is cancelled, keeping the
reversal near-instant) or lets a committed burst stand for the
positional sweep to reverse; the standard abort path needs no special
disposition.

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
succeed. A failure while the pass applies its planned writes (a
rejected write rolls the whole pass back) is a failed run too and
takes the same backoff.

### Persistence

Per-branch classifier status — current state, last-success-at,
last-error, retry-attempt count, and **`processedThrough`** — persists in
a `branches.classifier_status` JSON field. `branches` is not delta-logged,
so the status is operational state outside the reversal log.

`processedThrough` is the highest entry position (`story_entries.position`)
the classifier has fully processed; the pass range is
`(processedThrough, head]`. It is the concrete field behind "unprocessed
entries," read by the cadence trigger, `[Run classifier now]`, and
chapter-close phase 0. A successful pass over `(processedThrough, E]` sets
`processedThrough = E` in its commit transaction, in the same write as its
success status, so a pass that fails to advance the watermark never resets
the retry count it then fails against. A prose reversal clamps
it — `processedThrough ← min(processedThrough, position(B) − 1)` for `B`
the earliest removed entry (see
[`data-model.md → Entry mutability & rollback → Survival anchor`](../data-model.md#survival-anchor))
— so changed turns are re-processed without re-deriving spared facts. A
content edit removes no entry and clamps only inside the head turn, where
`B` is the edited entry and the reversal covers everything the clamp
re-reads; below it the edit leaves the watermark alone rather than force a
re-read of an unbounded suffix whose facts survive
([`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)).
At
fork from entry `N`, the new branch sets
`processedThrough = min(parent.processedThrough, position(N))` and resets
the rest of the status to idle.

The panel sits in the same Memory tab as the embedder controls
(see
[`model-management.md → Embedder config`](./model-management.md#embedder-config--where-it-lives-in-settings))
and the cluster-1 staleness panel. Wire-level layout lands at the
per-screen Story Settings design pass.
