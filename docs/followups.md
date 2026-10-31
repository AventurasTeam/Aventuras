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

No open items.

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

- **Story model overrides carry no settings.** A story's override
  (`stories.settings.models`) names a provider and a model, not a
  profile, so it has no output limit, thinking, timeout, temperature or
  structured-output mode, and a chapter close under one runs on the
  defaults
  ([`chapter-close.md → Conversations`](./memory/chapter-close.md#conversations)).
  Overrides need those settings, likely in a form close to App Settings'
  model select; the form is open. Raised by the developer 2026-10-31 in
  the chapter-close agent design.

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

- **Tune the close's agent.** Nothing has measured the agent at size.
  The design's tests used a chapter of about 100 words, five tools and
  three tasks; a real close has 24k tokens, seven tasks and up to six
  tools a task, and only played stories have such a chapter. Play tunes
  the task prompts on the dev model, as the classifier's were, and
  extends the probe to a close, saving each step's messages. It also
  measures what the design left open:
  - whether the agent keeps to the rules at full size, and how many
    steps a task takes against its budget of 24;
  - reasoning spirals: one prompt shape sent the dev model through its
    whole output limit in 7 of 14 runs, with no known cause, so the 8k
    bound and the prompts both need a measure;
  - a rule refined in a later part, which landed as a second lore row in
    3 of 10 runs that dropped reasoning, and needs repeating with it;
  - the profile switches on a few models: whether a list of 17 tools
    costs a weak model what fewer tools are said to save, and whether a
    single conversation does better anywhere;
  - part size, half the window, and how a chapter cut in parts reads;
  - servers that take the tool list and ignore it.

  Raised 2026-10-31 by the chapter-close agent design.

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
  - [Resuming a failed close](./parked.md#resuming-a-failed-close)
  - [A staged row has no retirement](./parked.md#a-staged-row-has-no-retirement)
