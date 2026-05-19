# Documentation

Project documentation for Aventuras. Wireframes and design rationale
that drive UI work, schema and architectural decisions that drive
implementation, and the open questions tracked across the project.

## What's here

- **[architecture.md](./architecture.md)** — cross-cutting code
  shape: prompt templates and authoring, settings, agent
  orchestration overview, translation as a pipeline concern,
  retrieval phase invariants.
- **[generation-pipeline.md](./generation-pipeline.md)** — the
  generation pipeline framework: phases, orchestrator, action layer,
  event bus, transactions, concurrency model. The shape every
  concrete pipeline kind plugs into.
- **[data-model.md](./data-model.md)** — schema, decisions, the
  `entities` / `lore` / `threads` / `happenings` shapes. What's
  stored.
- **[memory/](./memory/README.md)** — how prose and structured world
  state stay consistent turn by turn, what gets injected into each
  generation call, how older content ranks against current scene
  context. Multi-file: cadence, piggyback contract, periodic
  classifier, chapter-close pipeline, retrieval (embeddings, queries,
  ranker, pinning, budgets), edge cases, schema impact + followups.
- **[calendar-systems/](./calendar-systems/README.md)** — tiered-counter
  primitive for in-world date-time display, classifier vocabulary,
  and (eventually) user-authored fictional calendars. Design spec,
  interactive PoC, and shareable preset JSONs.
- **[tech-stack.md](./tech-stack.md)** — tech choices and rationale.
- **[followups.md](./followups.md)** — active outstanding items the
  current milestone (v1) needs answered or that block v1 work.
- **[parked.md](./parked.md)** — deferred items: post-v1 confirmed
  - parked-until-signal.
- **[implementation/](./implementation/README.md)** — how
  implementation work is decomposed and tracked. Authoring
  conventions for milestones and slices live in
  [conventions.md](./implementation/conventions.md); per-milestone
  docs and slice work live under
  [milestones/](./implementation/milestones/README.md).
- **[ui/](./ui/README.md)** — UI design: principles + per-screen
  wireframes and docs.
- **[explorations/](./explorations/README.md)** — dated session
  records of design discussions. Frozen historical reasoning;
  canonical docs are authoritative once a design lands.
- **[conventions.md](./conventions.md)** — documentation conventions:
  structure rules, naming, cross-references, principles-vs-patterns
  split, README-as-index, followups hygiene, wireframe authoring,
  tooling, common pitfalls.
