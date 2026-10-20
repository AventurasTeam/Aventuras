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

- **Play-check entity state in prompts.** Entity state reaches every
  generation prompt
  ([`architecture.md → Entity state on the template surface`](./architecture.md#entity-state-on-the-template-surface)),
  and nobody has played it. Four assumptions ride on the model: the
  writer restates a visual category rather than appending to it, keeps
  to the word bound
  ([`piggyback.md → Trailing block format`](./memory/piggyback.md#trailing-block-format)),
  isn't pulled into bringing on stage the characters whose full rows
  sit elsewhere, and, in the fallback, doesn't read a character the turn
  names as present
  ([`piggyback.md → Fallback classifier context`](./memory/piggyback.md#fallback-classifier-context)).
  The visual-cut warning measures the first two; only play shows the
  last two. The shortfall warning measures one more: that the writer
  moves no more of a stackable than its payer holds. Raised 2026-10-19
  by the entity-state implementation.

- **Retrieval budget defaults.** The per-type budgets
  (`stories.settings.retrievalBudgets`, entities 1200) are
  placeholders, expected to rise severalfold. Entity rows now carry
  their state
  ([`retrieval.md → Token estimation`](./memory/retrieval.md#token-estimation)),
  so at the default a fully described character can outgrow the whole
  entity budget, which budget fill skips permanently
  ([`retrieval.md → Budget-fill termination`](./memory/retrieval.md#budget-fill-termination)):
  the characters a user invested in most become the ones retrieval
  can't seat. Nothing compares a generation prompt against the model's
  window either (`maxInputTokens` is read by the embedder only), while
  the structural floor now seats more, and how a provider's overflow
  error reaches the user is unverified. Raised 2026-10-19 by the
  entity-state design.

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
  - a Setting, Genre or Tone the user starts with a newline renders a
    blank line under its heading;
  - the Gregorian calendar line reads "time in seconds (1 seconds per
    second)", now inside the cached system half;
  - the periodic classifier's Known relationships and Known happenings
    lines print a character's name, a view's kind and a happening's
    title as stored, so a newline in one starts a line the model may
    read as another fact (`classifier-context.ts`); Known entities and
    Places already collapse theirs with `flat` / `oneLine` (raised
    2026-10-18 by the classifier factions slice review);
  - the fallback classifier's roster leaves a blank line between its
    active and staged entries;
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
