# Aventuras — memory

How memory works in the app: keeping prose and structured world state
consistent turn by turn, surfacing older content when relevant, and
assembling the per-turn generation context.

[`data-model.md`](../data-model.md) says what's stored;
[`architecture.md`](../architecture.md) says how the pipeline runs
end-to-end. This folder owns the **pipeline** between them — see
[`scope.md`](./scope.md) for the concept enumeration this folder
covers and the external touchpoints it depends on.

## Doc tree

The design splits across topic files. Read in this order for a
linear walk; each file is self-contained for reference once you know
the shape.

- **[scope.md](./scope.md)** — framing: what "memory" means in this
  domain, what this folder owns vs delegates to canonical docs, and
  the external `data-model.md` / `architecture.md` /
  `generation-pipeline.md` cross-references the topic files lean on.
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
- **[model-management.md](./model-management.md)** — embedding
  model lifecycle: curated catalog, onboarding, on-disk layout,
  download flow, license attestation, removal, init-failure
  handling, staleness UI.
- **[edge-cases.md](./edge-cases.md)** — name collision +
  disambiguation, staged-entity promotion, retirement, cutaway /
  multi-scene entries, v1 limitations.
- **[probe.md](./probe.md)** — memory probe contract: per-turn
  capture model (light default, deep opt-in), simulator math,
  FIFO eviction at 100 captures/story, cross-cuts for branch fork
  / model swap / failure capture / param drift. Embedding-mode
  only. Screen UX in
  [`docs/ui/screens/memory-probe/memory-probe.md`](../ui/screens/memory-probe/memory-probe.md).

Memory-pipeline deferrals live in the top-level
[`parked.md → Memory pipeline (parked)`](../parked.md#memory-pipeline-parked).
Calibration and implementation followups are inline in the
canonical docs above (retrieval.md, model-management.md, probe.md).
