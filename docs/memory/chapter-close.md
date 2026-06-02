# Chapter-close pipeline

When the open region crosses the per-story
[`chapterTokenThreshold`](./cadence.md#user-tunable-knobs) (default
24k) AND `chapterAutoClose=true`, OR when the user manually triggers
chapter close at any time, the chapter-close pipeline fires.
[`data-model.md → Chapters / memory system`](../data-model.md#chapters--memory-system)
remains canonical for the trigger and atomic-commit shape; this
section details the phases.

Phases 1–4 commit under one chapter-close `action_id` for atomic
rollback; a single CTRL-Z reverses the entire close. Phase 0 is **not**
in that batch — the periodic classifier it runs holds its own
`action_id`(s) with `source = periodic_classifier` (see
[Phase 0](#phase-0--catch-up-classifier-pass)).

| Phase                           | Mode      | Drives                                                                                                      |
| ------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| **0. Catch-up classifier pass** | Both      | Bring periodic classifier current to chapter boundary                                                       |
| **1. Boundary selection**       | Auto only | LLM picks a natural ending entry within the open region                                                     |
| **2. Chapter metadata**         | Both      | LLM emits title / summary / theme / keywords for the `chapters` row                                         |
| **3. Lore management**          | Both      | Lore creation, identity compaction, stackable normalization, awareness pin tuning, happenings consolidation |
| **4. Lifecycle review**         | Both      | Demote `active → retired` on chapter-scope evidence                                                         |

## What chapter-close no longer owns

Per the cadence stratification, two responsibilities moved out:

- **Staged-entity promotion** — moved to the periodic classifier.
  Mid-chapter introduction is normal narrative pacing; chapter
  boundaries are the wrong cadence.
- **Per-turn state mutations** — entirely piggyback's territory.
  Chapter-close never touches `visual.*`, `current_location_id`,
  inventory, `worldTime`, etc.

Awareness compaction also reshapes: was eager
"summarization-and-delete" of low-salience awareness rows; is now
**enforced at write time** via a `UNIQUE(branch_id, character_id, happening_id)`
constraint on `happening_awareness` plus upsert semantics in the
classifier and user-edit paths. Embedding-driven retrieval lets the
bench grow without performance pressure, and duplicates can't
accumulate in the first place. The
[Multi-axis salience parked entry](../parked.md#multi-axis-salience)
flagged the cost of eager summarization losing detail; upsert is the
cleaner shape than chapter-close sweeps.

## Phase 0 — catch-up classifier pass

Before lore-mgmt and dedup phases run, the periodic classifier must
be current with the chapter boundary. Otherwise lore-mgmt operates
on a partial happening graph (recent turns un-classified) and dedup
can't find rows the classifier hasn't written yet.

**Drain in-flight periodic classifier first.** Phase 0 entry awaits
any periodic-classifier run that was in flight when chapter-close
started — `await waitForClassifier('finish')` blocks until the
in-flight `actionId` resolves (commit or abort). This is the
`'finish'` disposition of the shared classifier-wait primitive; prose
reversals use `'cancel'` (see
[`generation-pipeline.md → Prose reversals and the classifier barrier`](../generation-pipeline.md#prose-reversals-and-the-classifier-barrier)). The wait happens
under chapter-close's `gateBehavior: 'hard-gate'`, so user input is
blocked the whole time; the user can't sneak in a new turn between
the classifier finishing and phase 0 starting. Periodic-classifier
runs are bounded by the cadence overlap window (a few turns), so the
drain is short.

After drain, phase 0 runs the classifier synchronously over any
remaining unclassified entries in the open region. Bounded by the
cadence overlap window — typically a few turns of un-classified
content, fast.

**Phase-0 writes stay off the chapter-close batch.** The catch-up runs
the periodic classifier, so its writes carry their own
`periodic_classifier` `action_id`(s) and per-fact provenance
(`deltas.entry_id`) like any pass — never the phases-1–4 chapter-close
`action_id`. So CTRL-Z of the close (an `action_id`-group reversal of
phases 1–4) leaves phase-0's facts about the surviving, now-un-chaptered
turns intact, and a later deep rollback into the chapter spares them by
the survival-anchor predicate (see
[`data-model.md → Entry mutability & rollback → Survival anchor`](../data-model.md#survival-anchor)).

**Concurrency.** The background classifier's
`concurrencyPolicy.blockedBy` includes `'chapter-close'` — it cannot
start a new pass for the duration of phases 0-4. Chapter-close holds
the user-edit gate via `gateBehavior: 'hard-gate'` per
[`generation-pipeline.md → Concurrency model`](../generation-pipeline.md#concurrency-model);
user edits and new classifier starts are both blocked. One-direction
lock — chapter-close blocks the background classifier; piggyback's
per-turn writes can't be in flight because chapter-close runs between
turns by construction. The drain step above closes the remaining
window: a classifier that was already running when chapter-close
chained-started finishes its own work before phase 0 starts its
classifier pass, so neither writer is concurrent with the other on
`entities.status` / `happenings` / `happening_awareness` rows.

## Phase 1 — boundary selection

**Auto mode only.** Manual user-triggered chapter close skips this
phase; the user-supplied entry is the boundary.

The boundary selection agent reads the open region's entries and
picks a natural ending — scene transition, time skip, arc-beat
resolution, or narrative pause.

**Prompt context:**

- The open region's entry titles, opening sentences, closing
  sentences (compact representation; full prose would blow context
  on long open regions).
- The chapter's accumulated token count and the threshold value.
- Active threads in the chapter's range.

**Output (structured trailing block, same pattern as piggyback):**

```
{
  end_entry_id: string,
  rationale: string  // one sentence explaining the choice
}
```

**Validation.** `end_entry_id` must satisfy
`previous_chapter.end_entry_id < end_entry_id <= current_head`.
Invalid output triggers the standard `callWithRetry` same-prompt
retry (per
[`generation-pipeline.md → Error, cancel, and retry`](../generation-pipeline.md#error-cancel-and-retry));
persistent failure across the retry budget falls back to "current
head as end." (Prompts aren't generated on the fly — the retry
contract is "same prompt, sampling variance catches transient
malformed output.")

The chapter `start_entry_id` is automatically the entry after the
previous chapter's `end_entry_id` (or position 1 if first chapter).

## Phase 2 — chapter metadata

The metadata agent reads the closed range and emits structured
metadata for the `chapters` row.

**Prompt context:**

- All entries in the closed range (the chapter's content).
- The previous chapter's summary, if any, for narrative continuity.
- Active thread titles + statuses.

**Output (structured):**

```
{
  title: string,        // user-editable; LLM-suggested
  summary: string,      // 2-4 sentences distilling chapter content
  theme: string,        // short thematic tag — "betrayal" / "first contact" / etc.
  keywords: string[]    // 3-8 keywords for browse/navigation
}
```

The `keywords` here are **chapter-level browse keywords**, distinct
from `lore.keywords` retrieval keywords. Not load-bearing for v1
retrieval — embedding similarity over candidates is the retrieval
signal. They surface in the chapter list and browse rail.

**Failure mode:** parse failure or empty output produces placeholder
content (`title = "Chapter N"`, `summary = "[summary unavailable]"`,
empty `theme` and `keywords`) so the chapter row still creates. User
can edit afterward.

## Phase 3 — lore management

The substantive phase. Five sub-jobs share a single LLM call (or a
small number of structured calls — implementation detail).

**Prompt context shared across sub-jobs:**

- Closed range entries (the chapter's content).
- Existing lore rows — titles + bodies if budget allows, otherwise
  titles + first paragraphs.
- Cast roster — entities with `status='active'` that appeared in the
  range, with their current `traits` / `drives` / `agenda` /
  `stackables`.

### 3a — lore creation

**Conservative bias** — old apps erred proactive and produced lore
spam. The criterion for emitting a new lore row:

> The chapter explicitly **establishes** a definitional world-rule,
> magic system, religion, faction-charter, cosmology, or IP-specific
> terminology. "Establishes" means the prose explains how something
> _works_ or _is_, not just _mentions_ it.

| Prose                                                                                                                                                     | Lore? | Why                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| "Aria visited the temple of Vael."                                                                                                                        | No    | Visit is an event (happening), not a world-rule.  |
| "The temple of Vael is a relic of the Eldritch covenants, where blood-bound priests once communed with the Forgotten Hour through ritual exsanguination." | Yes   | Definitional explanation of a religious practice. |
| "The Aetherium was acting up again."                                                                                                                      | No    | Mention without explanation.                      |
| "The Aetherium runs on the kinetic resonance of crystalline lattices; without daily harmonic tuning by the keepers, the entire grid faults within hours." | Yes   | Definitional mechanism explanation.               |

**Output per lore creation:**

```
{
  title: string,
  body: string,        // classifier-authored; user can edit
  category: string,    // freeform: "magic-system" / "religion" / etc.
  keywords: string[],  // initial keyword set for retrieval (user can edit)
  priority: number,    // default 50; agent can suggest higher for clearly load-bearing
  injection_mode: 'auto'   // default; user can change
}
```

**Discipline at the prompt level:**

- **Hard cap of 3 lore creates per chapter** by default (tunable in
  app settings). Prevents runaway generation when a chapter happens
  to introduce many world details.
- **Cited evidence required.** Each lore create must include a
  one-sentence justification citing the prose passage that
  established the rule. If the agent can't cite, it shouldn't
  create. Citation parsed at output validation time; uncited rows
  rejected.

### 3b — identity compaction

For each entity active in the chapter, the agent reviews their
identity arrays — `traits`, `drives`, `agenda` (faction-only) —
against soft caps from
[`data-model.md → Soft caps`](../data-model.md#soft-caps--compaction-discipline)
(`traits ≤ 8`, `drives ≤ 6`, `agenda ≤ 4`).

**Operations the agent may emit:**

| Op          | Trigger                                                                                              | Discipline                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Add**     | Chapter prose evidences a new trait/drive/agenda                                                     | Subject to soft cap; if at cap, must replace not append        |
| **Replace** | Adding past soft cap, OR new entry supersedes old (e.g. drive resolved)                              | Drop one to make room; cite which                              |
| **Dedup**   | Two entries are synonyms ("brave" + "courageous")                                                    | Merge to one; pick the more general or more evidenced spelling |
| **Prune**   | Chapter explicitly contradicts an existing entry (e.g. "former alcoholic" 10 chapters past sobriety) | Remove only when contradiction is unambiguous                  |

**Discipline:** don't churn stable identity. "Brave" doesn't get
removed because the chapter happened not to show bravery; it gets
removed only when the chapter explicitly contradicts it.

**Cited evidence:** like lore creation, each compaction op requires
prose citation. Unsupported emissions are rejected at output parse.

### 3c — stackable normalization

Across all character `state.stackables` records, find variant
spellings of the same fungible: `gold` / `Gold` / `gold pieces` /
`gp` → canonical lowercase `gold`. Per
[`data-model.md → Soft caps`](../data-model.md#soft-caps--compaction-discipline).

Mostly **algorithmic** — lowercase, strip pluralization suffix,
deduplicate by canonical form. LLM-driven semantic merging
(`gold` vs. `gold coins` vs. `coin`) is parked; if real usage shows
the algorithmic floor isn't enough, escalate.

### 3d — awareness pin tuning

The agent reviews awareness rows from two sources:

- **Closed-chapter rows** — awareness extracted during the just-
  closed range. Standard review.
- **High-frequency rows from across the story** — awareness rows
  from any chapter whose `retrieval_count` puts them in the top-N
  retrieved across the story so far. Surfaces rows that the
  classifier originally severity-judged conservatively but that
  retrieval has been picking up consistently.

The agent does **not** see individual `retrieval_count` values —
just membership in the high-frequency set ("these rows have been
coming up a lot lately"). Removes the temptation to anchor on numeric
ranking; keeps the judgment narrative ("are these still load-bearing
for the current arc?") rather than data-analytical.

**Operations:**

- **Bump up** (toward 1) — for closed-chapter rows that turned out
  structurally load-bearing for chapter themes, OR for high-
  frequency rows the agent confirms are still load-bearing.
- **Bump down** (toward 0) — for closed-chapter rows that the
  classifier severity-judged high but turned out incidental.

**One-way frequency signal.** The frequency-driven candidate set
only triggers consider-bump decisions, never demote-on-frequency.
Demoting "frequent but irrelevant" rows revives the feedback-loop
concern (rows that fall out of retrieval get demoted, fall out
more, eventually invisible). User-driven demotion is the explicit
path; frequency-driven auto-demotion is not a v1 feature.

**Selection mechanism for high-frequency set:** **per-chapter
counter, reset at chapter close after phase 3d commits**. Counts
accumulate during a chapter via ranker-side increments (each
injected row gets its `retrieval_count` bumped, delta-logged under
the turn's `action_id` for rollback correctness). At chapter close,
top-N is selected from the chapter's accumulated counts; agent
reviews. After phase 3 commits any bumps, all counts reset to 0
(the reset is itself a delta under the chapter-close `action_id`).
Next chapter starts fresh.

**Why per-chapter reset, not lifetime accumulation.** Lifetime
counts create a Matthew-effect feedback loop — early-popular rows
ossify in the top-N because their accumulated count can't be caught
by late-emerging rows, even when the late ones are more relevant
to the current arc. Per-chapter reset breaks this: each chapter's
top-N reflects that chapter's retrieval activity. A row that's
_genuinely_ load-bearing across many chapters keeps re-entering
top-N at each chapter close (accumulating bumps over time, drifting
toward dr=1.0); a transiently-hot row gets bumped once and then
falls out as the arc moves on.

The agent self-regulates within each chapter close — it sees the
row's current `decay_resistance`, so a row already at dr=0.9 with
high frequency doesn't get re-bumped unnecessarily.

Conservative bias on closed-chapter rows — don't touch most.
Only adjust when chapter context makes the original
`decay_resistance` clearly wrong.

### 3e — happenings consolidation

Happenings can drift toward over-granularity at scale (3-6k
happenings over 60 chapters projected per
[`retrieval.md → Scale assumptions`](./retrieval.md#scale-assumptions)).
Sub-job 3e identifies clusters that should merge.

**Candidate identification (algorithmic, no LLM):**

Cluster happenings within the closed chapter range by:

- Embedding similarity ≥ 0.80 (cosine).
- `happening_involvements` overlap ≥ 50% (same cast).
- `occurred_at_entry` proximity within ~3 entries.

All three criteria must hold for cluster membership. Clusters of
≥ 2 rows are passed to the LLM for judgment.

**LLM judgment per cluster:**

| Decision                 | When                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Merge into composite** | Same cast + close time + complementary semantics (sequential phases, one builds on the other, parallel aspects of one event)      |
| **Keep distinct**        | Antonymous narrative meaning ("Aria swore the oath" + "Aria broke it"), different awareness implications, distinct material beats |
| **Delete redundant**     | Same event extracted twice with different framings; keep the more detailed, delete the duplicate                                  |

**Lean toward merge** on tight clusters. Cost asymmetry: under-
merging carries duplication that compounds at scale; over-merging
loses some temporal precision but composite descriptions preserve
the substantive facts. The aggressive-merge default is right at v1's
projected volumes.

**Mechanical merge:**

- `description` — composite, LLM-authored ("X happened, then Y").
- `title` — pick the more general, or LLM-authored composite.
- `occurred_at_entry` — earliest of the cluster (the later events'
  precise timing is lost; acceptable v1 trade).
- `decay_resistance` on the surviving row — max of the cluster.
- Awareness rows merge per-character via the existing
  `UNIQUE(branch_id, character_id, happening_id)` upsert: max
  `decay_resistance`, earliest `learned_at_entry`, source strings
  concatenated where they differ.
- Deleted rows are delta-logged for rollback.

**Conservative override:** when the LLM is uncertain about cluster
membership, default to keep-distinct. The agent can also flag
clusters as "review needed" rather than auto-merging — surfaces in
the World panel for user review (similar to the
`name_collision_flag` recovery path).

## Phase 4 — lifecycle review

The agent reviews `active` entities that haven't appeared recently
and considers retirement on chapter-scope evidence:

- **Auto-retire** when the chapter contains explicit hard-finality
  signal that the periodic classifier may have missed on single-line
  ambiguity (a death scene the classifier read as injury, the
  chapter-scope context confirms otherwise).
- **Surface for user review** when a character's `lastSeenAt` is
  far back AND prose doesn't explicitly justify keeping them
  active. Doesn't auto-mutate; surfaces in the World panel as
  "stale active" via derived `lastSeenAt + worldTime` arithmetic
  (no schema column needed in v1).

Conservative bias: prefer surfacing over auto-retire on weak signal.
The only auto-retire path is hard-finality signal that the periodic
classifier should have caught but didn't.

## Failure modes and atomic rollback

The chapter-close transaction holds the gate per
[`generation-pipeline.md → Transaction lifecycle`](../generation-pipeline.md#transaction-lifecycle).
User edits are blocked; pipeline phase failures cascade as follows:

| Phase                       | Failure mode                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** (catch-up classifier) | Retry once, then proceed with what's classified. Worse retrieval input for downstream phases but not catastrophic.                                                      |
| **1** (boundary selection)  | `callWithRetry` same-prompt retry; final fallback uses head-as-end.                                                                                                     |
| **2** (metadata)            | Placeholder content; chapter row still creates.                                                                                                                         |
| **3** (lore-mgmt)           | Per-emission validation; rejected emissions skipped, accepted ones commit. Phase as a whole may produce zero successful emissions on bad output — chapter still closes. |
| **4** (lifecycle review)    | Skip; not critical.                                                                                                                                                     |

**User abort** at any phase: the orchestrator reverse-replays the
`action_id`'s deltas and exits. UI returns to pre-chapter-close
state. Same path as any in-flight pipeline abort.

**Crash recovery** during chapter-close is the same as any
in-flight transaction — see
[`generation-pipeline.md → Crash recovery via pipeline_runs marker table`](../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table).

## Manual user-triggered close

User can manually trigger chapter close at any time, regardless of
threshold. The user picks the boundary entry explicitly (Phase 1
skipped). Phases 0, 2-4 run normally.

UX surface: a "Close chapter here" affordance on entries in the open
region. Clicking pre-flights the chapter-close pipeline with the
selected entry as boundary.

When `chapterAutoClose = false` AND the threshold is crossed, the
UI shows a "Ready to close" indicator near chapter management
controls, but doesn't auto-fire. User confirms the close manually.
