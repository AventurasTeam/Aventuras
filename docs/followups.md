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

- **Before the next reversal-planner rule — `buildUndoOps` carries
  every reversal rule in one loop.** `buildUndoOps` in
  `lib/actions/delta/reverse-replay.ts` is ~260 lines, its per-delta
  loop ~215, holding the live and held arms, re-own and tombstones,
  with four hand-synced per-row presence structures (`working`,
  `absent`, `tombstones`, `endsAbsent`) beside the held copies'
  `removed` flags, and five closures re-created per delta; the
  stranded-writes pass and the two refusals follow the loop. Extract
  the create, delete and update arms (and their held variants) into
  named helpers, and consider one per-row state, before the next rule
  lands. The likely next rules are the redo refusal parked as
  [a kept create in a redo group](./parked.md#a-kept-create-in-a-redo-group-fails-redo-with-a-raw-sqlite-error)
  and the translation residual in
  [roadmap M8.1](./implementation/roadmap.md#m8--translation--vault-parent-shell).
  Behaviour-neutral; the reverse-replay and reversal suites are the
  safety net. Raised in the reversal-integrity PR's review
  (2026-10-05).

- **Nothing introduces a location the prose moves to.** The per-turn
  writer, piggyback or the fallback classifier, sets
  `currentLocationId` only from the location ids its prompt offers
  (the structural floor's and retrieval's) and otherwise keeps the
  previous one
  ([`piggyback.md → What piggyback writes`](./memory/piggyback.md#what-piggyback-writes)).
  The periodic classifier creates characters only, so a move to a new
  place, or to a known one retrieval didn't offer, leaves the old
  location in the next prompt and on every in-scene character until
  the user fixes it. Direction, decided 2026-10-05: the per-turn writer
  emits either a known location id or an interim place name, and the
  periodic classifier reconciles interim names into locations,
  matching an existing one before creating one. The per-turn writer
  reports only major moves; a place inside a location is a child
  location through `parent_location_id`, not free text. Raised by the
  2026-10-05 triage pass. Open:
  - Where the interim name lives, presumably entry metadata beside
    `currentLocationId`, and what in-scene characters'
    `state.current_location_id` holds meanwhile: null or the last
    known location.
  - Whether reconciliation back-fills the new id onto the entries and
    characters that carried the interim name. Those are ids inside
    JSON columns, which revives the parked
    [closure gap](./parked.md#the-reversal-closure-doesnt-follow-ids-inside-json-columns).
  - Whether the classifier sets `parent_location_id` on a location it
    creates.
    [`data-model.md → LocationState shape`](./data-model.md#locationstate-shape)
    says no classifier path writes it in v1, and its planner would
    need the cycle walk.
  - A test for "major" the model can apply, and how interim names for
    one place ("the road", "the forest road") collapse to one
    location.
  - Rendering the parent chain in the prompt (a shop inside a square
    inside a city), which the LocationState shape specifies and no
    runtime template does yet.
  - Items share the gap: nothing machine-creates one, so an item first
    mentioned in prose can't be transferred.

- **Name-collision detection misses partial-name duplicates.** Layer B
  reconciliation (`lib/classifier/reconcile.ts`) gates on an exact
  `normalizeTerm` name match against existing characters, so "Kael" and
  "Kael Stormborn" never reach the embedding comparison: the classifier
  creates a second row with no flag, and no surface offers a merge.
  Keywords and aliases are not consulted either. Only characters are
  reconciled at all, though canon gives the flag to all four kinds.
  Scene presence is unused too: the classifier's window carries each
  turn's prose but not the `sceneEntities` saved in its metadata, and
  Layer B compares names and descriptions only, so a "new" character in
  a turn whose scene already names the existing row (strong evidence of
  a classifier miss) still lands as a flagged duplicate. Revisit
  together, developer-requested: feed each window turn its saved
  metadata state, resolve or promote such a character to the existing
  row, and consider correcting past entries' scene presence once a
  duplicate is resolved — a merge rewrites only the tail scene, so
  earlier entries keep naming the deleted loser and render it as
  "Entity no longer exists". Found during 4.2c planning (2026-10-06);
  the classifier is M3.3's substrate, outside 4.2c's scope.
  Verified 2026-10-09, with four corrections. Exact matching is canon's
  own rule
  ([`classifier.md → Disambiguation on new-character mentions`](./memory/classifier.md#disambiguation-on-new-character-mentions)),
  so partial matching is a canon change. Only characters are reconciled
  because only characters are machine-created (the extraction schema
  has `newCharacters` alone); the four-kinds line in `world.md` is
  about the column. Earlier entries render the loser as an
  Unknown-entity chip, and leaving them so is canon
  ([`world.md → Delete`](./ui/screens/world/world.md#delete)), so
  correcting past scenes would reverse a decision rather than close a
  gap. And every collision surface keys on the exact name (the derived
  pairs, `collisionPairOf`, orphaned-flag clears, the pill's count), so a
  partial-name flag would be invisible and unresolvable without the
  stored partner in the next entry. The design questions are the
  developer's: what counts as a namesake (token prefix, a keyword or
  alias hit, scene presence), and whether a partial match flags the row
  or resolves to the existing one. Routed from triage 2026-10-09.
- **The classifier drops why it flagged a row.** `reconcileNewCharacter`
  returns a `FlagReason` (`distinct`, `ambiguous`, `no-signal`), the
  similarity and the best-matching namesake, and its type comment says
  the reason is "carried explicitly for the collision-review surface",
  but `lib/classifier/plan.ts` persists only the 0/1 flag. The resolve
  dialog could say "descriptions differ" or "couldn't compare", and a
  stored partner id would let World pair the flagged row with the
  namesake the classifier actually compared rather than guessing by
  name. Both need a schema column. Found during 4.2c planning
  (2026-10-06). Verified 2026-10-09: the decision carries the reason and
  similarity but not the namesake, which `reconcile.ts` computes and
  drops, so storing a partner widens its return type too. A partner id
  is an id inside a column: rename, merge and delete would have to clear
  or rewrite it, the family of
  [the parked JSON-columns gap](./parked.md#the-reversal-closure-doesnt-follow-ids-inside-json-columns).
  World's name-based guess differs from the classifier's comparison only
  with three or more namesakes. Moves with the entry above. Routed from
  triage 2026-10-09.
