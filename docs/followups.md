# Follow-ups

Top-level ledger of **active** outstanding items — design questions
or work the current milestone (v1) needs answered, or that block
other v1 work. Resolved items are **removed** (not crossed out); the
commit that resolves an item carries the resolution narrative. v1 work
held for the end of the cycle sits under
[Tuning and play testing](#tuning-and-play-testing).

Items confirmed for a future milestone or parked indefinitely
pending signal live in [`parked.md`](./parked.md). Movement between
the two files is normal as scope clarifies; see
[`conventions.md → Followups vs parked`](./conventions.md#followups-vs-parked)
for the placement rule.

## Data-model

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
    awareness merge, the per-chapter `retrieval_count` reset; and a
    thread it resolves through `updateThread` keeps the
    `resolved_at_entry_id` it had, since only a user's status change
    clears it, so the close sets the ref itself;
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
  (its role, the story's mode and lead, and the narration person, which
  [`data-model.md`](./data-model.md) says governs how the AI writes
  prose but no bundled template renders, the wizard's opening
  included), which today are one output-format line; the wizard's system halves, empty because each
  shared context macro mixes the output contract with grounding that
  changes as the user fills the wizard in, so each splits into a
  contract macro and a grounding macro; and the blocks the split left in
  a user half only because they point at its content by position. The
  pass is done when every story and settings input the user sets
  reaches the prompts that should carry it. It comes before play
  testing, which needs those inputs in place to tune against; tuning
  the wording is [prompt tuning](#tuning-and-play-testing). Raised
  2026-10-11.

  The pass also takes the whitespace and wording nits the halves PR's
  reviews found in the bundled prompts, all older than the split
  (routed from triage 2026-10-11):
  - a Setting, Genre or Tone the user starts with a newline renders a
    blank line under its heading;
  - the Gregorian calendar line reads "time in seconds (1 seconds per
    second)", now inside the cached system half;
  - the periodic classifier's Known relationships lines print a
    character's name and a view's kind as stored, so a newline in one
    starts a line the model may read as another fact
    (`classifier-context.ts`); Known entities, Places and Known
    happenings already collapse theirs with `oneLine` (raised
    2026-10-18 by the classifier factions slice review);
  - the fallback classifier's roster leaves a blank line between its
    active and staged entries;
  - a place name with a newline breaks the location map's tree: the
    rest of the name lands at column 0, where it reads as a top-level
    place (`lib/world/location-map.ts`). A retired reason is already
    flattened to one line there; the name isn't (raised 2026-10-15 by
    the retired and disabled places slice review).

- **`buildClassifierActions` has outgrown one function.**
  `lib/classifier/plan.ts`'s planner runs about a thousand lines; its thread and awareness blocks share about ten of the
  planner's locals
  (`anchor`, `proseSource`, `entryPosition`, `inTurnOrder`, `iconOf`,
  the drop lists, `planned`), so a split wants a shared planner
  context rather than more closures. Raised 2026-10-23 by the AI
  writer map's Task 20 review.

  The planner also plans the reply list by list, each list judged
  against what the earlier lists planned as though it landed, where
  canon checks a fact against what earlier facts in the reply changed
  ([`classifier.md → What the classifier writes`](./memory/classifier.md#what-the-classifier-writes)).
  Two facts about one row, from different turns and in different
  lists, can then be judged in the wrong order. The AI writer map's
  slice review fixed one case: a mentioned place's matching now sees
  the placements of its turn and earlier ones, so the reply no longer
  folds two places into one. The rest waits for per-row planning in
  turn order across lists, one queue of each row's facts each judged
  against the state after the earlier ones (the review's option A),
  which the split is the moment for:
  - **A rename against a placement.** Renames plan after every
    placement, so a turn-1 rename is judged where a turn-3 move leaves
    the place. When a user edit refuses the move as it lands, the
    rename has already become a `name-taken` clash, and the flag lands
    across different parents. Option A fixes it.
  - **A create against a rename.** Creates plan before renames, so a
    turn-1 rename of the old mill to "Varn" and a turn-3 mention of a
    new "Varn" in the same region create a second "Varn" and flag the
    mill, where successive passes would reuse the renamed mill. Option
    A fixes it.
  - **A promote against a retire.** A staged character a turn-3
    mention promotes is promoted before a turn-1 retire is judged, so
    the retire becomes plannable: the character is promoted, then
    retired, where successive passes would only promote it. Option A
    fixes it.
  - **A new place waiting for a later turn's parent.** New places settle
    in turn order, but each waits for its own parent, so a turn-1 place
    under a new place of turn 3 settles after it. It then matches
    against the placements of turns up to its parent's and counts later
    turns' new places as its earlier creates: a turn-1 Cellar under a
    turn-3 Loft takes over a turn-2 unplaced Cellar, a turn-1 write on a
    row turn 2 creates, under a parent turn 3 creates. Per-row planning
    alone doesn't give a turn-1 place a turn-3 parent; the likely fix
    creates it unplaced at its own turn and places it at its parent's.
  - **A twin across a placement.** Two new places with one name and
    declared parent map to the first before any other match, even when
    a placement of a turn between them moved the first one's row: a
    turn-1 "Cellar" under the Keep reuses and places the unplaced
    cellar, a turn-2 placement moves it under the Inn, and a turn-3
    "Cellar" under the Keep, carrying "the vault", maps to it. That is a
    silent mis-merge: the keyword lands on the moved row and the Keep's
    cellar is never created, where successive passes would create it
    anew under the Keep. The developer kept the twin rule as settled;
    a fix needs option A and a twin keyed on where the first one's row
    sits by then, which reopens the twin of a create a takeover placed.
  - **Two renames to one name, the first refused.** When a user edit
    refuses the first rename as it lands, the second, planned as a
    clash against it, writes only a keyword and its flag is refused,
    so the revealed name is lost. Option A leaves this one, since
    canon's two-layer check lets a planned write be refused when it
    lands; its fix is writing the clash outcome at write time, the
    alternative to the rename's write-time no-op.

  Raised 2026-10-24 by the AI writer map's slice review; routed from
  triage 2026-10-24.

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

- **Implement held text and the details disclosure.** A system entry
  shows the turn's text it keeps as a clamped quote with a copy button
  and a custody line, and folds its failure detail behind a collapsed
  `Details` disclosure under the buttons
  ([`entry-card.md → System entry`](./ui/patterns/entry-card.md#system-entry)).
  Today `EntryCard` renders the detail inline and the text nowhere. The
  work: `EntryCard`'s `heldText` and `onCopy`, the reader surface
  reading the text from the row's metadata, the `onCopySystemText`
  bridge action
  ([`reader-document.md → Bridge contract`](./ui/patterns/reader-document.md#bridge-contract)),
  the held entry's two strings merged and the pass notice's copy
  trimmed
  ([`reader-composer.md → Custody of the turn's text`](./ui/screens/reader-composer/reader-composer.md#custody-of-the-turns-text)),
  with `memoryHeldNoText`'s users (`describePassFailure`, its test, the
  reader-surface stories) and the unused `systemEntry.viewDetails` key
  gone, and the E2E touch points: `retrieval-embed-failure.spec.ts`
  asserts the embed detail visible, and the `memoryHeld` locator keys
  the merged copy. Raised 2026-10-27 by the held-text design.

## Tuning and play testing

v1 work held for the end of the cycle, once every base system is
online and real stories exist to measure against: the polish era of
the roadmap's
[sequencing thesis](./implementation/roadmap.md#sequencing-thesis).
Unlike [parked-until-signal](./parked.md#parked-until-signal) items,
these will be done; they wait because tuning earlier tunes against
systems still changing. Their instruments land first: the
[memory probe](./memory/probe.md) (M7.5) and the per-turn token usage
breakdown under [UX](#ux).

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
  when the prose changes it, puts `top` only where nothing could
  contain a place, and puts an item down only when it stays there at
  the turn's end, since a drop records where the item ends up; a pass
  tells a reveal from an alias and a return from a memory.

  A pass's parse rate under the larger schema held on the seed
  (2026-10-26, a local Gemma 4 26B A4B on `br_hero_main`: 20 of 20
  first-attempt parses with mentioned places off, 19 of 20 with them
  on, the miss a JSON syntax slip a parse retry recovered), but a
  played story's longer replies are untested. That run's probe still
  read a reply the server cut off and `jsonrepair` closed as a parse,
  which setting no max output made unlikely, not impossible; the
  probe now counts cut-offs, so a re-run tells them apart. A pass
  whose reply won't parse fails a Send rather than costing memory, so play re-runs
  `pnpm probe:classifier` on a played branch, with `PROBE_MAX_OUTPUT`
  at the classifier profile's max output
  ([`testing.md → Real-provider checks`](./testing.md#real-provider-checks)),
  and splitting the pass into two calls is the remedy if the rate
  falls. A parse proves only the reply's shape, so play also checks
  that replies fill the schema's new fields.

- **Retrieval tuning.** The ranker's defaults are starting guesses:
  decay rates (`λ_type`), MMR diversity (`λ_div`), the similarity
  thresholds, `kw_boost`, `τ_revive` and the per-query weights,
  calibrated against the
  [scale-assumed pool sizes](./memory/retrieval.md#scale-assumptions)
  with the memory probe as the instrument. The per-type budgets
  (`stories.settings.retrievalBudgets`, entities 1200) are
  placeholders, expected to rise severalfold. Entity rows now carry
  their state
  ([`retrieval.md → Token estimation`](./memory/retrieval.md#token-estimation)),
  so at the default a fully described character can outgrow the whole
  entity budget, which budget fill skips permanently
  ([`retrieval.md → Budget-fill termination`](./memory/retrieval.md#budget-fill-termination)):
  the characters a user invested in most become the ones retrieval
  can't seat. The budgets can rise now that the
  [context window check](./architecture.md#model-context-window)
  refuses a prompt over a known window rather than sending it, and the
  [truncation cross-check](./architecture.md#truncation-cross-check)
  flags a server that cut one; until the
  [window-relative accounting](./memory/retrieval.md#structural-floor-takes-budget-first)
  fits a prompt to the window, a story whose prompt outgrows it stops
  its turns where the window is known or the server rejects the prompt,
  and is cut silently, with a warning toast, where neither holds. The
  [Tier-2 knob surface](./parked.md#tier-2-retrieval-ranker-knob-tuning-surface)
  waits on these defaults settling. Raised 2026-10-19 by the
  entity-state design (the budgets).

- **Prompt tuning.** Once the prompt content pass has every input in
  the prompts, play tunes their wording for the writing itself: the
  narrator's narrative writing, prose and behaviors. The
  narrator's output-format line also left the end of the prompt for
  the system half, unmeasured; tuning checks where it reads best.
  Raised by the developer 2026-10-25, split from the prompt content
  pass.

- **Classifier prompt: interface and structure.** The periodic
  classifier's prompt is twenty rules in one list, then the reply
  format as a TypeScript type whose comments carry a few field
  descriptions. A first pass on 2026-10-27 named each output list in
  its rule and described the fields a name doesn't explain. Left for a
  pass that can measure itself:
  - an evaluation set first: a few hand-written windows with the facts
    each should yield (a fight across turns, a recounted past event, a
    name reveal, a faction changing sides, a character learning of a
    listed happening), scored by the parse probe. The hero branch's
    opening the probe reads today is thin, repeating prose, so its
    counts measure nothing;
  - sections instead of the flat list: the task, the inputs, the rules
    that hold everywhere (IDs and handles, provenance, scene, silence),
    then each output list in the order the model writes it. Today
    `knownAwareness` is written last but explained in the fourth rule;
  - what counts as a happening, which no rule says beyond the category
    examples;
  - each turn's prose inside its own delimiters, the reason behind each
    rule that isn't obvious, a short worked example, and no capitals for
    emphasis;
  - room to reason before the JSON, weighed against a pass that already
    takes 75-157 s on the dev model;
  - `sourceTurn` optional in the reply type, so a missing one parses and
    falls back to the window head, while the rules ask for it on every
    entry.

  A field description reaches the model only when the reply format is
  written into the prompt, the profile's structured output on auto.
  Forced on, the schema goes to the server alone, and llama.cpp turns
  it into a sampling grammar the model never reads (other providers
  unverified), so the rules repeat whatever a description says. Raised
  by the developer 2026-10-27.

- **Parked items play gives a signal for.** Each waits on evidence
  only play produces, so play checks them rather than letting the
  signal pass unseen:
  - [Narrative quality empirical risk under suggestion fold](./parked.md#narrative-quality-empirical-risk-under-suggestion-fold)
  - [Split capability flag for `<suggestions>` parse reliability](./parked.md#split-capability-flag-for-suggestions-parse-reliability)
  - [Recency-bias diversity mitigation for suggestion category mix](./parked.md#recency-bias-diversity-mitigation-for-suggestion-category-mix)
  - [Multi-axis salience](./parked.md#multi-axis-salience)
  - [Prompt-cache optimization](./parked.md#prompt-cache-optimization)
  - [Calibrating the token estimate per model](./parked.md#calibrating-the-token-estimate-per-model)
