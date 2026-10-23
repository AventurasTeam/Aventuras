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
  by the entity-state implementation. The AI writer map adds more
  riding on the models: the per-turn writer writes a condition only
  when the prose changes it and puts `top` only where nothing could
  contain a place; a pass tells a reveal from an alias and a return
  from a memory.

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

- **Periodic classifier context grows with the story.** A pass lists
  every entity, place, relationship view and happening on the branch
  ([`classifier.md → What the classifier reads`](./memory/classifier.md#what-the-classifier-reads)),
  and threads and happening ids now join them. A pass blocks the story,
  so its call is the user's wait, and at the projected thousands of
  happenings
  ([`retrieval.md → Scale assumptions`](./memory/retrieval.md#scale-assumptions))
  the lists alone may outgrow a Fast model's window, and a pass must
  succeed before its branch's next turn
  ([`classifier.md → Failure policy`](./memory/classifier.md#failure-policy)),
  so a prompt past the window stops the story's turns. Bounding them, to
  the window's cast and region, say, needs a design: a pass can't link
  what it can't see, and may not update a field it wasn't shown. Raised
  2026-10-20 by the AI writers design.

- **Chapter-close agent design.** Chapter close's write set is fixed
  by the
  [authorship contract](./data-model.md#authorship-contract), and
  [`memory/chapter-close.md`](./memory/chapter-close.md) specs its
  phases and sub-jobs: a tool loop that hands rejections back, chained
  behind the turn's pass under the gate, interruptible and deferred to
  the next Send, its phase 0 a chain of ordinary passes. Its agent
  isn't designed concretely enough to implement. The design decides:
  - the tool set and what each tool returns, the loop's budget and
    stopping rule on a long chapter;
  - a tool-calling capability flag, detected and user-overridable, and
    what a close does when the `lore-mgmt` model lacks it;
  - the boundary and metadata calls (entries by position, structured
    output);
  - how the close logs and anchors its writes: `story_entries.chapter_id`
    stamped in its own group, anchored on its end entry (the roadmap's
    M5 notes);
  - the actions it needs and lacks: a happening merge, an earliest-wins
    awareness merge, the per-chapter `retrieval_count` reset;
  - whether a cluster it can't decide gets a review flag (happenings
    have no column for one), and what it does with a row already
    flagged;
  - the `name_collision_reason` a flag it raises stores, which
    [`data-model.md → Diagram`](./data-model.md#diagram) leaves open:
    the pair a close judges duplicates is usually not a namesake pair,
    and World clears a flag whose pair isn't one at the next rename or
    merge that touches it
    ([`world.md → Surfacing`](./ui/screens/world/world.md#surfacing)),
    so the reason comes with a way to keep the pair paired;
  - how the user reviews what a close changed;
  - whether boot holds a branch on a close's unreversed orphan as it
    does on a pass's: the reset counts only the pass's, so the next
    pass reads a graph carrying the close's leftover writes
    ([`parked.md → The classifier can read a window holding un-reversed writes`](./parked.md#the-classifier-can-read-a-window-holding-un-reversed-writes)).

  Its failure policy is the pass's: a close that fails runs before the
  next turn and must succeed
  ([`classifier.md → Failure policy`](./memory/classifier.md#failure-policy)).

  Promoted from the developer's notes 2026-10-10; write set fixed
  2026-10-20, failure policy 2026-10-22; its flag's reason left to it
  by the AI writer map.

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
