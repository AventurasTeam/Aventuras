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

- **Implement partial-name collision detection.** Designed 2026-10-10
  ([exploration record](./explorations/2026-10-10-partial-name-collisions.md));
  the spec is canon:
  [`classifier.md → What the classifier reads`](./memory/classifier.md#what-the-classifier-reads)
  for each turn's saved scene, the alias rule and the alias list,
  [`classifier.md → Disambiguation on new-character mentions`](./memory/classifier.md#disambiguation-on-new-character-mentions)
  for the matching rule, the decision table and the partner and reason,
  [`edge-cases.md → Schema`](./memory/edge-cases.md#schema) for the two
  `entities` columns and their CHECK, and
  [`world.md → Collision review and entity merge`](./ui/screens/world/world.md#collision-review-and-entity-merge)
  for World's pairing, copy and clear rules. It touches the classifier
  (`lib/classifier`, its prompt, schema and context), `lib/world`'s
  collision helpers and World's collision surfaces. The CHECK rebuilds
  `entities`, so a development database holding flagged rows needs a
  reseed. Lands as a standalone PR, before the location design reuses
  the matcher.

- **Implement locations and items from prose.** Designed 2026-10-10
  ([exploration record](./explorations/2026-10-10-locations-and-items-from-prose.md));
  the spec is canon:
  [`piggyback.md → New locations and items`](./memory/piggyback.md#new-locations-and-items)
  for the location map, held items, the creation tags and matching,
  with that file's What piggyback writes, auto-promote and fallback
  classifier changes;
  [`data-model.md → LocationState shape`](./data-model.md#locationstate-shape)
  and the entry `stateReport`; and
  [`world.md → Surfacing`](./ui/screens/world/world.md#surfacing) for
  the `same-parent` reason and the re-parent clear. It reuses the
  matcher, flag, partner and reason columns, so it lands after the
  partial-name collision PR.

- **The periodic classifier creates factions and mentioned places.**
  Factions follow the character path: a new-faction list in the
  extraction, reconciled by Layer B
  ([`classifier.md → Disambiguation on new-character mentions`](./memory/classifier.md#disambiguation-on-new-character-mentions))
  with the same matcher, flag, partner and reason, plus membership
  facts writing characters' `faction_id`, which the authorship contract
  gives the classifier and nothing machine-writes yet. Mentioned places
  are places the prose establishes but the scene doesn't enter: the
  periodic classifier creates them behind a story setting that defaults
  to off, matched by the per-turn writer's sibling rule
  ([`piggyback.md → Matching before creating`](./memory/piggyback.md#matching-before-creating))
  and parented from the window. Open: which writer wins when the
  per-turn writer and a pass create the same new place in one window
  (leaning the pass, or the pair goes to collision review); and
  re-checking the parked
  [closure gap](./parked.md#the-reversal-closure-doesnt-follow-ids-inside-json-columns),
  since a pass is reversed by positional sweeps while later turns stay.
  Raised 2026-10-10.

- **Chapter-close agent design.** Chapter close is designed in
  [`memory/chapter-close.md`](./memory/chapter-close.md), but not
  concretely enough to implement. Promoted from the developer's notes
  2026-10-10, with an addition: upkeep of the locations and items the
  per-turn writer creates with only a name, a short description and a
  parent, meaning their state (`condition`), keywords and a
  description refresh. A refresh reverses the authorship contract's
  user-only description
  ([`data-model.md → Authorship contract`](./data-model.md#authorship-contract)),
  so the design decides whether chapter close may rewrite one.

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
  shows whether the location map needs collapsing as a story grows.
  Wanted in v1, design deferred. Raised by the developer 2026-10-10.
