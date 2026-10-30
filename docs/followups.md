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

- **Implement per-row planning.** The periodic classifier's planner
  plans a reply's facts as one queue in turn order, its writes landing
  in the queue's order, and a rename is decided as it lands between the
  rename and the clash
  ([`classifier.md → Planning order`](./memory/classifier.md#planning-order),
  [→ What the classifier writes](./memory/classifier.md#what-the-classifier-writes)).
  `lib/classifier/plan.ts`'s `buildClassifierActions` still plans list
  by list in about a thousand lines; its thread and awareness blocks
  share about ten of the planner's locals (`anchor`, `proseSource`,
  `entryPosition`, `inTurnOrder`, `iconOf`, the drop lists, `planned`),
  so the queue wants a shared planner context rather than more
  closures. The work:
  - the queue, and its writes landing in its order;
  - `renameEntity` sent for a rename and a clash alike, its handler
    deciding between them, with the planner predicting by the
    handler's holder rule (`nameHeldByOther`) rather than its own;
  - the `classifier.rename_clash` log reporting the handler's outcome,
    not the planner's prediction;
  - tests pinning what the queue fixes: a turn-1 rename judged before a
    turn-3 placement moves its place, a turn-3 new place reusing the
    place turn 1 renamed, a turn-1 retire of a staged character planned
    before a turn-3 mention promotes it; and both directions of the
    rename decided as it lands: a first rename the user's edit refuses
    leaves a second rename to its name free to land, and a rename away
    from a name the user's edit refuses leaves a rename to that name a
    clash.

  Raised 2026-10-23 by the AI writer map's Task 20 review and
  2026-10-24 by its slice review; designed 2026-10-30.

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

  Two more placement questions wait on the same measurement: whether
  the wizard's shared macros split into an output contract and the
  grounding that changes as the user fills the wizard in, giving its
  templates a system half; and whether the blocks a user half keeps
  only because they point at its content by position (the ID
  instructions, the state and suggestion emission) move to the system
  half, caching about 1.5k tokens a turn but taking a format directive
  from the end of the prompt, where models follow it best. Play also
  checks the content pass's rules hold: the narrator keeps to the
  lead's attempt and to what each character knows, chips keep their
  voice, and the classifiers don't record a direction as something
  that happened. Added 2026-10-29 by the content pass's design. It
  also watches for the narrator writing a `<user_turn>` of its own,
  copying how its history marks the user's turns; if one shows, the
  reply is stripped of it or told not to (added 2026-10-30 by the
  content pass's implementation).

- **Judge the classifier's descriptions.** A happening's description
  is the story's memory of the scene, recalled later as fact, and the
  evaluation set's checks look for the facts a reply must hold but
  can't see one the prose never had. A judge reads every description
  against the turns instead: `pnpm judge:classifier` writes its blind
  input from probe runs, with the judge's instructions beside it
  ([`testing.md → Real-provider checks`](./testing.md#real-provider-checks)).
  On the evaluation set the prompt, judged before its last two changes,
  invented or got wrong 3 to 5 claims in 60 replies on the dev model,
  besides one misread no rule reached: "her cupbearer ran the same night" told as Tam Rook's death,
  which no other model sampled makes. The set's windows are four
  hand-written turns; a played story's windows run longer, recount more
  and carry a larger cast, so play judges the descriptions of passes
  over played branches. The probe's branch mode saves nothing yet, so
  judging a played branch first needs it to save the window's turns and
  each reply as read, as eval mode does. Whether a judge runs by hand,
  an agent given the instructions, or as a probe step calling a judge
  model is open. Raised 2026-10-29 by the classifier prompt's tuning.

- **Parked items play gives a signal for.** Each waits on evidence
  only play produces, so play checks them rather than letting the
  signal pass unseen:
  - [Narrative quality empirical risk under suggestion fold](./parked.md#narrative-quality-empirical-risk-under-suggestion-fold)
  - [Split capability flag for `<suggestions>` parse reliability](./parked.md#split-capability-flag-for-suggestions-parse-reliability)
  - [Recency-bias diversity mitigation for suggestion category mix](./parked.md#recency-bias-diversity-mitigation-for-suggestion-category-mix)
  - [Multi-axis salience](./parked.md#multi-axis-salience)
  - [Prompt-cache optimization](./parked.md#prompt-cache-optimization)
  - [Calibrating the token estimate per model](./parked.md#calibrating-the-token-estimate-per-model)
  - [A limited narrator in second and third person](./parked.md#a-limited-narrator-in-second-and-third-person)
  - [A twin across a placement](./parked.md#a-twin-across-a-placement)
