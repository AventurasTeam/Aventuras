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
    an entity with no description.

- **Revisit leaving places off the `# Places` map.** The map leaves
  out retired places and `injection_mode = 'disabled'` ones (unless
  current), and hangs a left-out place's children under its nearest
  listed ancestor (`lib/world/location-map.ts`,
  [`piggyback.md → What the writer sees`](./memory/piggyback.md#what-the-writer-sees)).
  The per-turn writer compares a re-created place with the siblings
  under its real `parent_location_id` (`planLocations`,
  `matchNewLocation`), so a place whose parent is hidden, re-created by
  exact name under the parent the map shows, is an unflagged duplicate
  ([`→ Matching before creating`](./memory/piggyback.md#matching-before-creating)).
  Retired parents cause it as well as disabled ones, and both leave
  active children behind: retiring a place, by the periodic classifier
  or a World Save, changes only its own status, and a mode change only
  its own column, so neither moves nor retires its children. Candidate
  directions, none chosen: always list disabled places and keep only
  retired ones off; show a hidden parent as a bare name line; match a
  re-created place against the parent the map shows. Raised 2026-10-11
  by the locations-and-items-from-prose slice review, reopened by the
  developer from its dismissals.

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
