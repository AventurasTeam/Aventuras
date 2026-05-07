# Aventuras — memory

How memory works in the app: keeping prose and structured world state
consistent turn by turn, surfacing older content when relevant, and
assembling the per-turn generation context.

[`data-model.md`](../data-model.md) says what's stored;
[`architecture.md`](../architecture.md) says how the pipeline runs
end-to-end. This folder says how those tables stay consistent with
the prose, what gets injected into each generation call, and how
older content ranks against the current scene.

Living docs. Many decisions in here landed across one long design
session; rationale alongside the choice where useful.

---

## What this doc owns

"Memory" in this app is overloaded across distinct concepts:

- **Per-turn scene metadata** — who is in the scene, where, when.
- **In-context retrieval** — what beyond the structural floor gets
  injected each call.
- **Long-term character knowledge** — `happening_awareness` rows and
  how they persist or decay.
- **Slow-evolving identity** — `traits` / `drives` / `agenda` arrays
  on entity state.
- **Procedural memory** — the delta log itself (rollback path).

This folder owns the **pipeline** between them: cadence (when does
each agent run), retrieval (how is per-turn context assembled), and
the contract each layer holds with the others. Storage tables stay
canonical in [`data-model.md`](../data-model.md). UI affordances for
user-facing knobs sit with the relevant Story Settings / App Settings
screens.

---

## Doc tree

The design splits across topic files. Read in this order for a
linear walk; each file is self-contained for reference once you know
the shape.

- **[cadence.md](./cadence.md)** — three-layer cadence model
  (piggyback / periodic classifier / chapter-close), why each layer,
  user-tunable knobs (`recentBuffer` / `fullChapterInBuffer` /
  `classifierCadence`), concurrency contract.
- **[piggyback.md](./piggyback.md)** — per-turn writes contract:
  trailing tagged block, computed bookkeeping, jsonrepair fallback,
  capability gate, mode-mixing across a story.
- **[classifier.md](./classifier.md)** — periodic classifier
  contract: write set, disambiguation on new-character mentions,
  background-task framing.
- **[chapter-close.md](./chapter-close.md)** — 5-phase chapter-close
  pipeline: catch-up, boundary selection, metadata, lore-mgmt
  (5 sub-jobs), lifecycle review, failure modes, manual close.
- **[retrieval.md](./retrieval.md)** — embedding infrastructure,
  query construction, candidate pools, hybrid retrieval per type,
  pinning (`decay_resistance`), per-type budgets, the ranker
  (scoring + MMR + budget-fill + bypass + chapter-match boost).
- **[edge-cases.md](./edge-cases.md)** — name collision +
  disambiguation, staged-entity promotion, retirement, cutaway /
  multi-scene entries, v1 limitations.
- **[followups.md](./followups.md)** — schema impact summary,
  Settings UX implications, v1-blocking work, cross-doc updates,
  parked / post-v1 items.

---

## Cross-references — outside this folder

Authoritative material in other docs that this folder depends on or
extends:

- [`data-model.md → World-state storage`](../data-model.md#world-state-storage)
  — `entities` shape, status lifecycle, authorship contract.
- [`data-model.md → Happenings & character knowledge`](../data-model.md#happenings--character-knowledge)
  — `happenings`, `happening_involvements`, `happening_awareness`
  shapes.
- [`data-model.md → Chapters / memory system`](../data-model.md#chapters--memory-system)
  — chapter trigger and atomic-commit shape.
- [`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)
  — delta log, reverse-replay.
- [`data-model.md → Injection modes`](../data-model.md#injection-modes--unified-enum--structural-invariant)
  — the structural invariant for active+in-scene; the unified enum
  this design renames.
- [`architecture.md → Generation context and prompt templates`](../architecture.md#generation-context-and-prompt-templates)
  — the single-context principle and Liquid template model.
- [`architecture.md → Retrieval / injection phase`](../architecture.md#retrieval--injection-phase)
  — the structural floor and per-mode invariants.
- [`architecture.md → Generation transactions and edit gating`](../architecture.md#generation-transactions-and-edit-gating)
  — single-writer invariant and the gate-declaration shape this
  design's background classifier consumes.
