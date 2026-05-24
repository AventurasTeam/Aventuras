# Memory pipeline — scope

What "memory" means in this app's domain, what this folder owns, and
the external touchpoints it leans on. The companion `README.md`
indexes the topic files; this doc carries the framing those files
share.

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
- [`architecture.md → Prompt templates and authoring`](../architecture.md#prompt-templates-and-authoring)
  — the single-context principle and Liquid template model.
- [`architecture.md → Retrieval / injection phase`](../architecture.md#retrieval--injection-phase)
  — the structural floor and per-mode invariants.
- [`generation-pipeline.md → Transaction lifecycle`](../generation-pipeline.md#transaction-lifecycle)
  and [`generation-pipeline.md → Concurrency model`](../generation-pipeline.md#concurrency-model)
  — single-writer invariant and the gate / concurrency declaration
  shape this design's background classifier consumes.
