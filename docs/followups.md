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

- **Measure the encoder build and a CJK count on a phone.** Slice 5.1
  measured the build on an x86_64 emulator's debug build, 942 to 1,325 ms
  during the open
  ([Slice 5.1 → Implementation notes](./implementation/milestones/05-chapters-chapter-close/slices/01-token-measure.md#implementation-notes)).
  A tap during it is queued, not lost: in three cold opens a Back tap ran
  23 ms after the build ended, so it waits out what's left of it. Text
  entry during the build is untested. On the same device a count of
  40,000 characters took 35 ms of English, 591 ms of Chinese and 2,088 ms
  of Japanese, on the JS thread, and the prompt is counted on every model
  call. A real phone on a release build is unmeasured.
  [Slice 5.5b's per-step measure](./implementation/milestones/05-chapters-chapter-close/slices/05b-identity-threads.md#per-step-count-measure),
  pending on the Fold's release build, times a close's per-step counts
  there in English and Japanese, which answers part of it, not the build.
  Raised 2026-11-01
  by Slice 5.1, moved here 2026-11-02 by its closing review, which added
  the tap and CJK numbers.

- **Native reader rows rerender per emission.** On native, every
  emission re-sends the whole loaded window to the document as a fresh
  JSON copy
  ([lesson](./implementation/lessons-learned/expo-dom-bridge-identity-and-rejections.md)),
  and Slice 5.3's jump grows that window up to the target, so a streamed
  reply on a grown window stalls. The Android measure
  ([Slice 5.3 → Android measure](./implementation/milestones/05-chapters-chapter-close/slices/03-reader-chapters.md#android-measure),
  Galaxy Z Fold, release build) missed its bar: at 20 chapters the
  longest gap between paints was 1,561 ms against 500 ms. A commit took
  510 ms per update at 20 chapters and 2,019 ms at 60, against about
  12 ms at 50 rows, because every row re-renders on each emission, which
  carried 4.8 and 14.2 MB against about 90 KB. Updates merge before they
  commit, so a reply commits 6 and 4 times against 173, and its final
  paint came 0.4 s and 18.8 s after the host finished. The landing at 60
  chapters took 10,704 ms, with the renderer at 1,993 MB. Two more costs
  ride on the same re-send. Leaving the reader for World re-sends the
  window twice, and a History link back double-commits: its second jump
  took 2,357 ms at 20 chapters. A chapter close committed while the
  reader holds a grown window re-sends it for each update, about 72 s at
  20 chapters if no update merged, counting commit and stringify only.
  That is arithmetic, not measured, and the reply's lag is the closer
  proxy. The sliding-window slice below takes a close's stamp burst on
  a grown window as an acceptance case, since
  [Slice 5.2](./implementation/milestones/05-chapters-chapter-close/slices/02-first-chapter.md#implementation-notes)
  measured the burst on a 50-row reader only (developer decision,
  2026-11-05).

  On a long story a jump to an early chapter can outlast the jump veil's
  30 s bound (`JUMP_VEIL_TIMEOUT_MS` in
  `components/reader/use-entry-jump.ts`). The bound starts at the press
  and restarts when the read's rows reach the store, so the read and the
  landing each get 30 s. A jump that runs out is dropped: the veil lifts,
  `reader.entry_jump_dropped` logs cause `bound`
  ([`observability.md → Subsystem emission inventory`](./observability.md#subsystem-emission-inventory)),
  and no toast shows. A read still out then neither writes nor lands. A
  landing already sent to the document isn't withdrawn, so the reader
  may still move to the target once the document commits, with no veil;
  that is read from the code, not seen on a device. In 5.3's device
  session on the Fold (release build, the 60-chapter fixture), a jump to
  chapter 1, pressed during a jump to chapter 5, held the veil about 22 s
  in all, and jumps to chapter 5 alone about 17 to 21 s. In the Android
  measure the read was about 0.4 s of the 10.7 s a jump to entry 1 took
  at 60 chapters, so nearly all of the wait runs under the landing's
  30 s. The bound will drop these jumps on longer stories or slower
  phones until the sliding window below lands. The code stays as built
  (developer decision R2, 2026-11-03).

  Slice 5.3 ships as built, and the fix is to be planned as a slice in
  M5. The measure reopened the far-end trim that
  [`reader-composer.md → Loaded-set model`](./ui/screens/reader-composer/reader-composer.md#loaded-set-model)
  names as the designed lever, which 5.3's Scope: out said only a bad
  measure would. Direction, for that slice's design pass to decide: a
  sliding reader window, which is that lever applied to the document
  only. The document renders a capped slice, while `entriesStore` stays
  contiguous to the branch tail. The turn's working set
  (`lib/pipeline/definitions/working-set.ts`) reads the store's whole
  window, as do, among others, `suggestion-refresh.ts` beside it and
  these hooks: `useBranchTailId`, which `useChapterProgress`,
  `useEntryIndex` and `useChapterTimeRanges` read the tail through,
  `useBranchWorldTime`, `useStoryPlace` and `useRowSignals`.
  `holdsLiveEdge` stays true while the store holds the tail, and the
  document's head-turn checks (`resolveSaveAndRegenTurn`,
  `headTurnIdsOf`, the reader's `isTail`) already leave a slice short of
  the tail without tail actions. While the slice is short of it, the
  streaming entry isn't sent to the document. When it reaches it again,
  the document renders from the host's accumulated text and keeps
  streaming. The cap also bounds the document's share of
  the landing time and the renderer's memory, though the host read still
  grows with rows, 372 ms at 60 chapters. Its size should be set on a
  mid-tier Android phone, since the Fold is a flagship.

  The developer's direction is that this makes chunks that don't re-send
  rows optional, a change to
  [`reader-document.md → Bridge contract`](./ui/patterns/reader-document.md#bridge-contract).
  The levers from when this was parked don't reach the bar alone: a throttle on
  `setStreaming` can't get under 500 ms at about 510 ms per commit, and
  reusing row objects at a seam in `reader-document.tsx` cuts the commit
  but not the payload or the parse. Markdown stays cached, since
  `content` is a primitive. The window would overturn three rules of
  canon: [`No window swap`](./ui/screens/reader-composer/reader-composer.md#loaded-set-model),
  which has a jump grow the one window;
  [Jump to bottom](./ui/screens/reader-composer/reader-composer.md#jump-buttons)
  being a same-window scroll; and the Loaded-set model's definition of
  the window as the contiguous range in memory and DOM, which the store
  and the document would no longer share. Raised 2026-11-02 by Slice
  5.3's Android measure (developer decision Q13).

  **A jump to the window's oldest row lands without its break, and at
  the branch's top can shift.** A target already in the window lands at
  once and reads nothing (`components/reader/use-entry-jump.ts`), so
  when it is the window's oldest loaded row, the previous chapter's end
  row isn't loaded and its break doesn't exist when it lands; a later
  boundary load mounts the break just above the screen. On a branch
  whose first row is the window's oldest with `hasOlder` still true (a
  50-row branch, or a last boundary load of exactly 50), entry 1 shifts
  up about 12 px when the shimmer drops. Reading the row above first
  doesn't hold on native: expo-dom injects the landing call before the
  route's props emission, so the document lands on the old layout. A fix
  has to order the landing after the document commits the host's write,
  a bridge-contract change; the sliding window above reworks this
  path. Raised 2026-11-03 by 5.3's final review. Checked 2026-11-04:
  the shift is exactly `JUMP_LANDING_GAP_PX`, and the bridge change is
  probably avoidable, since the loop re-measures the break every frame
  and a landing the host sends from its own post-commit effect is
  injected after expo's props emission. Not run. Routed from triage
  2026-11-04.

- **The jump landing loop wants a pure decision function.**
  `startLanding` in `components/reader/reader-surface.tsx` now holds
  about nine closure variables and four gates (layout, finger, wheel
  chain, rest), the one-frame touch halt, the wheel hold and the settle
  rule, tested only through rAF-timed plays. A per-frame decision
  function in `lib/reader-scroll`, beside `createAutoscrollMachine`
  (inputs: laid out, finger down, chain live, scroll position, row
  offset, height; outputs: write, hide or restore overflow, highlight,
  done), would make those rules unit-testable. A `useEntryLanding` hook
  would only move the coupling. Do it before the next behaviour change
  to the landing loop. Raised 2026-11-03 by 5.3's fling-halt review.
  Routed from triage 2026-11-05. Three known gaps wait on it:
  - **The wheel hold can start a frame late.** Whether the chain is
    still arriving is judged by handling time (`performance.now()`
    against the last wheel handled), so when the commit that brings a
    pending target's row outlasts the 100 ms chain gap, the first
    landing frame reads the chain as ended and writes no hold, and
    momentum queued behind the commit scrolls the reader for a frame
    before the landing corrects it. Trigger: on desktop, a popover jump
    above the window during trackpad momentum, with a row commit over
    100 ms. Extracting the loop alone won't fix it, since the caller
    would still compute "chain live" the same way: judge it by the
    wheel events' own times, as `handleWheel` already does for whether
    a wheel continues the chain. That remedy is doubtful, reasoned and
    not run: when the landing frame runs before the queued wheel
    handlers, neither time exists yet. Done when
    `JumpPendingHaltsWheelMomentumOnceItsRowArrives`
    (`components/reader/reader-surface.stories.tsx`) expects zero
    unheld frames again, with no allowance for `commitOutlastedChain`,
    under a commit forced past 100 ms. A slow CI runner showed it;
    raised 2026-11-03 by PR #698's review.
  - **A landing never settles while a reply streams.** `settled` needs
    the scroller's height unchanged, and every chunk changes it, so the
    loop runs to its 600-frame cap (about 10 s at 60 Hz, 5 s at
    120 Hz), moving a target near the tail up as the reply makes room
    and keeping the break re-pin off meanwhile. Decide whether growth
    below the target counts against settling. Raised 2026-11-03 by
    5.3's slice review. On the Fold the target held still, against
    that prediction: in 5.3's device session (release build, unfolded),
    a near-tail jump pressed about 3 s into a 30 chars/s reply landed
    with its target as high as the content allowed, about 250 px below
    the top, and the reader's upper half didn't visibly move from the
    landing at 5.6 s to 30 s while the reply grew below. The fixture
    was modified to put a closed one-entry chapter on the tail. Why it
    held isn't known. Checked against the code on 2026-11-05:
    `settled` compares `scrollHeight`, which a chunk changes only when
    it wraps a line or opens a block, so a 30 chars/s reply leaves ten
    still frames between wraps and the loop settles there, which likely
    explains the Fold. The cap is reached only when wraps come faster
    than every ten frames. Not run.
  - **Two rules fail no test when removed:** the 600-frame cap and the
    height part of the settle rule. Pin both in unit tests once the
    loop is a function. Raised 2026-11-03 by 5.3's slice review.

- **A scrollbar drag isn't a gesture to the reader's pins.**
  `gestureActiveRef` in `components/reader/reader-surface.tsx` tracks
  touch only, and a scrollbar press interrupts only at pointerdown, so a
  pin that starts during a thumb drag (stream end, viewport shrink, a
  chapter break) can tug the view for about 10 frames. Raised 2026-11-02
  by 5.3's task reviews. Nor is a touch fling's momentum:
  `gestureActiveRef` turns false at `touchend`, so a close's break that
  commits in the first frame or two of an upward fling from the bottom,
  while the reader still reads within ~20 px of it, re-pins against the
  fling, and the viewport-shrink re-pin, older than 5.3, has the same
  guard. [`reader-document.md`](./ui/patterns/reader-document.md#entry-list-fully-rendered-flow-layout)
  counts a touch fling as mid-gesture. Read from the code, not
  reproduced; added 2026-11-03 by 5.3's slice review.
  Two more gaps of the kind, read from the code and not run: a touch
  drag that leaves the ~80 px band and comes back re-engages autoscroll
  under the finger, and the next chunk writes `scrollTop` beneath it;
  and `handleTouchEnd` clears `gestureActiveRef` on any lift, so a
  second finger still down counts as none. Raised 2026-11-04 by the
  triage pass. Decided 2026-11-05: every write the user didn't ask for
  waits for scroll rest, as `reader-document.md` says, and
  `reader-composer.md` now agrees. Build it on a rest signal apart from
  `gestureActiveRef`, which the landing loop's write gate reads; a
  scrollbar drag needs a probe of what ends it. Routed from triage
  2026-11-05.

- **A shrinking viewport can pull a landing to the bottom.** The
  surface's `ResizeObserver` (`components/reader/reader-surface.tsx`)
  writes `scrollTop` to the bottom when the viewport shrinks under a
  reader near the bottom, with no landing guard, so an Android keyboard
  opening during a landing that starts near the bottom pulls the reader
  there. Predates Slice 5.3. Read from the code, not reproduced. Raised
  2026-11-03 by 5.3's final review.
  Checked against the code on 2026-11-05, not run: the landing loop
  re-lands the row about two frames later, so the pull is a jolt, not a
  lost landing. The guard is the chapter break's, built with the rest
  rule above. Routed from triage 2026-11-05.

- **The reader's bottom geometry is still read only at a few moments.**
  `syncJumpButton` (`components/reader/reader-surface.tsx`) raises the
  jump-to-bottom button as a stream grows below the reader and through
  a landing, but other growth below still waits for a scroll event: the
  commit that replaces a streaming card, a reply's late layout, a
  classifier write that makes a row taller. Separately, the chapter
  break's re-pin reads the reader's distance against the last commit's
  height, and in one story setup late layout had shrunk the content
  14 px since that commit (4 of 4 runs), so a reader 10 px from the
  bottom read as 24 px and wasn't re-pinned; the cause isn't pinned
  down. Both from 5.3's slice review, 2026-11-03, in stories, not on a
  device. Routed from triage 2026-11-05.

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

- **Decay against the chapter-match boost.** The ×1.3
  [chapter-match boost](./memory/retrieval.md#chapter-match-boost-on-happenings)
  multiplies a score after decay, so it can't seat an old row: on the
  default ranker an unpinned happening alone in its pool seats through
  a matched chapter up to 9 chapters old at similarity 0.3, 13 at 0.4
  and 16 at 0.5 (5, 9 and 13 without the boost). Past that only the
  [high-similarity bypass](./memory/retrieval.md#high-similarity-bypass--revival-of-decayed-memories)
  at 0.85 revives it. That is canon working as written on guessed `λ`
  values; play tells whether a matched chapter should reach further, by
  boosting before decay or by a larger factor. Raised 2026-11-13 by
  Slice 5.9's planning, when `chapters_old` came live.

- **User threads never decay.** A thread the user created, or one the
  user resolved or failed, carries no `resolved_at_entry_id` and never
  decays: the [authorship contract](./data-model.md#authorship-contract)
  keeps entry refs AI-only. If real stories show such threads crowding
  retrieval, their age can come read-side from the delta log, from the
  entry at the user's status-change delta's `log_position` (a user's
  thread edit logs a null `entry_id` but a log position). That keeps
  the contract but costs a delta-log read per thread candidate per
  turn. The developer accepted the edge 2026-11-13.

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
  the task prompts on the dev model through `pnpm probe:close`, as the
  classifier's were through its probe. It also measures what the design
  left open:
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

  Play tunes the metadata prompt too, outside the agent. It has three data
  points. Two are in
  [Slice 5.2's Implementation notes](./implementation/milestones/05-chapters-chapter-close/slices/02-first-chapter.md#implementation-notes):
  one dev-model close told its summary in the second person against
  first-person narration, and one of fifteen ran away to 39,689 output
  tokens with no max output set and failed (the developer keeps the
  profile without one). The third is
  [Slice 5.5b's per-step measure](./implementation/milestones/05-chapters-chapter-close/slices/05b-identity-threads.md#per-step-count-measure)
  (2026-11-09): a dev-route close on Gemma4-26B-A4B-QAT-MTP ran away to
  39,655 output tokens in the metadata call and failed.

  Raised 2026-10-31 by the chapter-close agent design.

- **The dataset chapter's bare profiles.** The Treasure Island seed's
  characters, as the classifier wrote them and before Slice 5.5b's
  refresh, are nearly bare: of 25, the most traits on a live one is 4,
  no live one holds a drive, only the retired Pew holds a `voice`, and 8
  have no description, Captain Smollett among them. The periodic
  classifier created 24 of them, so whether that is the book's shape, a first
  chapter that shows little of most of its cast, or the classifier
  writing thin first profiles is open. Play testing tells, on a played
  story's passes. Meanwhile a close is measured on the seed with
  [its test overlay](./testing.md#the-dataset-seed). Raised 2026-11-09
  by Slice 5.5b's planning.

- **World's "stale active" surface.**
  [`chapter-close.md → Phase 4`](./memory/chapter-close.md#phase-4--lifecycle-review)
  puts a character far past `lastSeenAt` in the World panel as "stale
  active", derived with no schema column. `world.md` has no such surface,
  "far back" needs played stories to define, and a close doesn't produce
  it. Moved out of M5 at its promotion, 2026-11-01.

- **A list joined with commas into one entry.** The close's Identity
  tools read a list leaked into one entry as the entries it holds: an
  entry that parses as a JSON string list (the shape the dev model leaked
  in 5.5b's measure, plus its backslash-escaped, bracketed,
  pretty-printed and trailing-comma variants) and a line-separated list.
  A list joined with plain commas or semicolons ("brave, honest, loyal,
  ...") still lands as one entry, as sent, so it passes the soft cap. It
  isn't split, because that would break legitimate entries like
  "quick-witted, if rash"
  ([the slice's note](./implementation/milestones/05-chapters-chapter-close/slices/05b-identity-threads.md#implementation-notes)).
  Watch for it in play testing, and decide on a rule (refusing an entry
  that reads as a list, for example) only if it shows up. Developer
  ruling, 2026-11-09. Review probes found one more shape the read
  misses: a single-quoted list (`['brave', 'wary']`) lands as one entry,
  as sent, so it passes the soft cap; split over lines, it lands each
  item with its quotes (`'brave'`, `'wary'`), counted right but quoted.
  Converting its quotes would break an apostrophe like "won't back
  down", so it's handled the same way: watched in play testing, with a
  rule only if it shows up.

- **The close's writes at the capability floor: invented facts, malformed
  batches, and sampling.** 5.5b's measure on the dev model (Gemma 4
  26B-A4B, ten closes of the Treasure Island chapter) held the bar, but
  its transcripts show work for prompt tuning, not a code fix:
  - Facts the cited turns don't show landed: Pew called "one-legged",
    Supervisor Dance given Dr. Livesey's "a gentleman and a
    magistrate", Billy Bones' drives replaced by one no turn shows, and
    "The August deadline" resolved or failed early in runs 3, 5 and 10.
  - Every Identity first step that skipped its thinking and sent a
    batch of calls had malformed arguments (6 of 6): lists sent as
    strings, `turns` padded with `true`, an escaped array landing as
    one entry.
  - The close's tool steps send no temperature, so the dev server
    samples at its 1.0 with no repeat penalty; all four replies cut
    off at the 8,000-token bound were loops or over-long deliberation.

  The record and the saved conversations are the inputs; see 5.5b's
  measure record in its slice doc. Raised in 5.5b's measure.

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

- **A close's later part can't undo an earlier part's one-way
  write.** On a chapter longer than half the window, each part's
  prose tasks read only that part's turns
  ([`chapter-close.md → Parts`](./memory/chapter-close.md#parts)),
  and nothing tells a task that later parts follow. A thread
  resolved, an entity retired or threads merged in an earlier part
  stay so for the rest of the close: no later part's task is shown
  the row again with a way back, though the review window lists the
  write and the user can undo it. Two candidate fixes, to judge on
  real long chapters: a part notice in the per-part system half
  ("these are turns t6–t12, part 2 of 3; later parts follow"), which
  stays stable across a part's tasks; or a reopen path, later parts
  seeing what this close resolved or retired with leave to set it
  back. The same long chapters should judge the starts' size: on the
  dataset chapter cut at a 40,000 window, part 1's Upkeep start held
  39 rows and 29 happenings and its Lifecycle start 29 rows (part 2:
  20 and 22), with no bound on either, and the close still ran without
  a window stop. The metadata merge grows with the part count too (about
  75 tokens a part summary over a 420-token base) with no size check or
  staged merge, so on a small window a very long chapter could fail the
  close at the merge after every part call ran; only near an 8k window
  and a chapter past about 420k tokens. Raised 2026-11-10 by 5.8's
  review; the merge size by its slice review.
