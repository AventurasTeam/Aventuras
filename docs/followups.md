# Follow-ups

Top-level ledger of **active** outstanding items — design questions
or work the current milestone (v1) needs answered, or that block
other v1 work. Resolved items are **removed** (not crossed out); the
commit that resolves an item carries the resolution narrative.

Items confirmed for a future milestone or parked indefinitely
pending signal live in [`parked.md`](./parked.md). Movement between
the two files is normal as scope clarifies; see
[`conventions.md → Followups vs parked`](./conventions.md#followups-vs-parked)
for the placement rule.

## Data-model

- **Implement classifier factions.** The periodic classifier creates
  the factions the prose establishes and sets and clears characters'
  `faction_id`
  ([`classifier.md → Factions`](./memory/classifier.md#factions)),
  with the per-field user precedence and reversal rules it needs
  ([`cadence.md → User edits and classifier writes`](./memory/cadence.md#user-edits-and-classifier-writes),
  [`generation-pipeline.md → Reverse-replay`](./generation-pipeline.md#reverse-replay)).
  Designed 2026-10-18
  ([exploration record](./explorations/2026-10-18-classifier-factions.md)).
  The plan must check:
  - that the reversal's per-sub-field keep, which covers every
    schema-backed column (`story_entries.metadata` too), and its null
    for a `state` reference naming a row that doesn't exist, the place
    parent's later CTRL-Z of a move included, each have a test that
    fails on the code before the change, since none is reachable
    until a pass writes `state`; the code comments stating the old
    rule go with them (`lib/actions/delta/reverse-replay.ts`,
    `lib/actions/delta/row-closure.ts`);
  - that World's delete builds its writes under the branch lock's
    shared hold, as the collision merge does
    (`applyDeltaActionGroupBuilt`), since its re-points come from a
    store snapshot today (`lib/world/entity-delete.ts`);
  - how History renders a classifier change to `state.faction_id`;
  - whether the mock LLM can return a reply with `newFactions` and
    `memberships`, for the E2E decision
    ([`testing.md`](./testing.md)).

- **Entity state in the narrator's prompt.** No entity `state`
  reaches the narrator but in-scene characters' held items, the items
  lying at the current location and the location map: an entity renders
  as its name, status and description
  (`lib/retrieval/rendered-text.ts`, `lib/prompts/bundled/memory-blocks.ts`,
  `lib/prompts/bundled/per-turn.ts`), so a character's `visual`,
  `traits`, `drives`, `voice` and faction, a place's or item's
  `condition` and a faction's `standing` and `agenda` never reach it.
  The design decides which fields render and where (in-scene lines,
  the current location, ranked rows, pinned rows), what they cost (an
  in-scene line counts against the structural floor's budget, a ranked
  row's text is what the ranker measures), and whether an in-scene
  character's faction is seated beside them, since a faction is never
  in a scene. It also covers the per-turn writer emitting a visual
  change as the full new value without being shown the current one
  (`lib/prompts/bundled/state-emission.ts`). Raised 2026-10-18 by the
  factions design.

- **Chapter-close agent design.** Chapter close is designed in
  [`memory/chapter-close.md`](./memory/chapter-close.md), but not
  concretely enough to implement. Promoted from the developer's notes
  2026-10-10, with an addition: upkeep of the locations and items the
  per-turn writer creates with only a name, a short description and a
  parent, and of the places a pass creates from mentions
  ([`classifier.md → Mentioned places`](./memory/classifier.md#mentioned-places)),
  meaning their state (`condition`), keywords and a
  description refresh. A refresh reverses the authorship contract's
  user-only description
  ([`data-model.md → Authorship contract`](./data-model.md#authorship-contract)),
  so the design decides whether chapter close may rewrite one. It
  never retires a place: a destroyed place stays active, its
  destruction a `condition`
  ([`data-model.md → LocationState shape`](./data-model.md#locationstate-shape)).

- **Prompt content pass.** The
  [system and user halves](./architecture.md#system-and-user-halves)
  moved today's prompts into the new shape without rewriting them, and
  the content still needs writing: the narrator's standing instructions
  (its role, the story's mode and lead), which today are one
  output-format line; the wizard's system halves, empty because each
  shared context macro mixes the output contract with grounding that
  changes as the user fills the wizard in, so each splits into a
  contract macro and a grounding macro; and the blocks the split left in
  a user half only because they point at its content by position. The
  narrator's output-format line also left the end of the prompt for the
  system half, unmeasured; the pass checks where it reads best. v1
  work, since the shipped prompts have to be good, once the halves land.
  Raised 2026-10-11.

  The pass also takes the whitespace and wording nits the halves PR's
  reviews found in the bundled prompts, all older than the split
  (routed from triage 2026-10-11):
  - the In-scene loop leaves two blank lines before the next heading in
    the narrative (`per-turn.ts`), the fallback classifier
    (`piggyback-fallback-classifier.ts`) and the suggestion refresh
    (`suggestion-refresh.ts`);
  - a Setting, Genre or Tone the user starts with a newline renders a
    blank line under its heading;
  - the Gregorian calendar line reads "time in seconds (1 seconds per
    second)", now inside the cached system half;
  - the periodic classifier's Known entities line ends on a dangling
    dash for an entity whose description is the empty string;
  - the fallback classifier's roster leaves a blank line between its
    active and staged entries;
  - the suggestion refresh's In scene list prints an empty line under
    an entity with no description;
  - a place name with a newline breaks the location map's tree: the
    rest of the name lands at column 0, where it reads as a top-level
    place (`lib/world/location-map.ts`). A retired reason is already
    flattened to one line there; the name isn't (raised 2026-10-15 by
    the retired and disabled places slice review).

## UX

- **Per-turn token usage breakdown.** Every turn records the tokens
  each section of its prompt used (in-scene and retrieved entities, the
  location map, the story history, retrieved happenings, lore, threads,
  the instructions and so on) in its entry's metadata, and a UI shows
  them. Today an entry keeps only totals (`metadata.tokens`), and the
  Memory probe's per-pool numbers
  ([`memory/probe.md`](./memory/probe.md)) cover only retrieval's pools
  and the structural floor, and only on captured turns; the design
  should build on the probe's accounting rather than beside it, and
  shows whether the location map needs collapsing as a story grows. The
  breakdown also records each call's cache read and write tokens
  (`usage.inputTokenDetails`), the only measure of whether a cache
  marker pays.
  Wanted in v1, design deferred. Raised by the developer 2026-10-10.
