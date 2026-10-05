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
