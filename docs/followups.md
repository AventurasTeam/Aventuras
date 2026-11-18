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

## UX

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

- **The wheel hold can start a frame late.** The jump landing loop
  (`createLandingMachine` in `lib/reader-scroll/landing.ts`, driven by
  `startLanding` in `components/reader/reader-surface.tsx`) holds a
  trackpad's momentum off while wheel events still arrive. Whether the
  chain is still arriving is judged by handling time
  (`performance.now()` against the last wheel handled), so when the
  commit that brings a pending target's row outlasts the 100 ms chain
  gap, the first landing frame reads the chain as ended and writes no
  hold, and momentum queued behind the commit scrolls the reader for a
  frame before the landing corrects it. Trigger: on desktop, a popover
  jump outside the slice during trackpad momentum, with a row commit
  over 100 ms. Extracting the loop alone didn't fix it, since the
  caller still computes "chain live" the same way: judge it by the
  wheel events' own times, as `handleWheel` already does for whether a
  wheel continues the chain. That remedy is doubtful, reasoned and not
  run: when the landing frame runs before the queued wheel handlers,
  neither time exists yet. Done when
  `JumpPendingHaltsWheelMomentumOnceItsRowArrives`
  (`components/reader/reader-surface.stories.tsx`) expects zero unheld
  frames again, with no allowance for `commitOutlastedChain`, under a
  commit forced past 100 ms. A slow CI runner showed it; raised
  2026-11-03 by PR #698's review.

- **A landing never settles while a reply streams.** In the jump
  landing loop (`createLandingMachine` in
  `lib/reader-scroll/landing.ts`), `settled` needs the scroller's height
  unchanged, and every chunk changes it, so the loop runs to its
  600-frame cap (about 10 s at 60 Hz, 5 s at 120 Hz), moving a target
  near the tail up as the reply makes room and keeping the break re-pin
  off meanwhile. Decide whether growth below the target counts against
  settling. Raised 2026-11-03 by 5.3's slice review. On the Fold the
  target held still, against that prediction: in 5.3's device session
  (release build, unfolded), a near-tail jump pressed about 3 s into a
  30 chars/s reply landed with its target as high as the content
  allowed, about 250 px below the top, and the reader's upper half
  didn't visibly move from the landing at 5.6 s to 30 s while the reply
  grew below. The fixture was modified to put a closed one-entry
  chapter on the tail. Why it held isn't known. Checked against the
  code on 2026-11-05: `settled` compares `scrollHeight`, which a chunk
  changes only when it wraps a line or opens a block, so a 30 chars/s
  reply leaves ten still frames between wraps and the loop settles
  there, which likely explains the Fold. The cap is reached only when
  wraps come faster than every ten frames. Not run.

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

- **TalkBack can't reach the reader document on Android.** On the
  Fold's release build with Samsung TalkBack, swiping skips from the
  reader's top bar to the composer, and touching the story text plays
  only TalkBack's "nothing here" sound, so a screen-reader user can't
  read the story. The rows are in the accessibility tree: a compressed
  `uiautomator dump`, which keeps only nodes important for
  accessibility, holds all 138 text nodes of a 50-row slice. The
  document is `react-native-webview` 13.16.0 under expo-dom, mounted
  with `scrollEnabled: false` and scrolling in its own DOM scroller; the
  jump veil renders nothing while idle, so it doesn't cover it. It
  worked on this device on 2026-07-19
  ([`reader-document.md → Validation record`](./ui/patterns/reader-document.md#validation-record),
  item 9: traversal walked from the chrome into the surface, and
  explore-by-touch worked), so this is a regression since. The mount's
  props, `expo`, `react-native` and `react-native-webview` are the same
  as then. Cause not found. Last seen working at `ae316a2e9` (#371);
  seen failing on a release build of `bc1785a78`, on the sliding reader
  window's branch (#752). Check `f5366181b`, that branch's base on main,
  first: if it fails there too, #752 isn't the cause. #752 doesn't
  change the mount or the WebView's props (read from its diff). Not
  tried with Google's TalkBack or on an emulator. Once TalkBack reaches the
  document, check that its linear navigation extends the slice at the
  bottom shimmer, which that PR's acceptance asked for and couldn't run.
  Raised 2026-11-16 by its Fold session (developer decision).

## Tuning and play testing

v1 work held for the end of the cycle, once every base system is
online and real stories exist to measure against: the polish era of
the roadmap's
[sequencing thesis](./implementation/roadmap.md#sequencing-thesis).
Unlike [parked-until-signal](./parked.md#parked-until-signal) items,
these will be done; they wait because tuning earlier tunes against
systems still changing. Their instruments land first: the
[memory probe](./memory/probe.md) (M7.5) and the per-turn token
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

- **A close's pin raise step.** The Awareness task raises a pin by at
  most 0.2 a close, never straight to 1
  ([3d](./memory/chapter-close.md#3d--awareness-pin-tuning)): the
  prompt asks for it and `set_pin` refuses a bigger raise. No later close
  can lower a frequent row's pin, so play tells whether 0.2 lets a
  load-bearing row climb fast enough while a one-chapter spike fades.
  Developer decision 2026-11-14, from 5.9's Awareness review.

- **3e's thresholds don't fit every embedder.** On the dataset chapter
  with `Xenova/all-MiniLM-L6-v2`, which
  [`retrieval.md`](./memory/retrieval.md) names the mobile default, 3e
  found 0 clusters: 36 happenings, 630 pairs, and a highest cosine of
  0.732, short of the 0.80 bar canon sets. The best pair inside the
  distance and cast gates reads 0.701. The Spy-glass (0.709) and
  Dr. Livesey (0.697) near-duplicates sit 6 entries apart, so the
  distance gate drops them too, and the next in-gate pair, 0.590, is
  likely distinct. So 3e doesn't fire on MiniLM today. One global cosine
  can't fit every embedder; a per-embedder threshold, for instance one
  the embedder's registry entry carries, is the likely shape. Play
  measures EmbeddingGemma on the same chapter and re-tunes both gates
  (cosine and distance) on real stories. One scratch probe with the
  cosine bar lowered to 0.55 found a single cluster, the two halves of
  Captain Smollett's cabin meeting (same cast and knowers, neither common
  knowledge); the dev model read both turns and merged them with a
  composite description, and the merge landed. So `merge_happenings` and
  the Happenings prompt work on the dev model, but the keep-apart rule
  for differing knowers has met no real case yet. Developer decision
  2026-11-14, from Slice 5.9's probes.

- **Which embedders are the floor and the standard.** The dev
  embedder, `Xenova/all-MiniLM-L6-v2`, is today's mobile default
  ([`model-management.md`](./memory/model-management.md)), and on it 3e
  finds no clusters (the entry above). The developer is considering
  treating that tier as the absolute floor, the way the dev model is
  the classifier's floor, with EmbeddingGemma as the standard, and
  possibly replacing MiniLM with another small embedder. Thresholds stay
  per embedder whichever way it goes, since each model spreads cosines
  differently, and the floor has to separate clear duplicates at some
  threshold or 3e stays off there. A first measure costs little: the
  dataset chapter's three near-duplicate pairs (the two halves of
  Captain Smollett's cabin meeting, the Spy-glass pair, Dr. Livesey) and
  the distinct pairs near them, embedded by EmbeddingGemma and two or
  three small candidates, show how cleanly each model separates them. A
  swap also re-embeds every story on the new model, and a larger model
  costs Android download size and memory. Raised 2026-11-14 by the
  developer, after Slice 5.9's 3e probes.

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
  pass. The lead marks' wording and the third-person rule for chapter
  summaries and happening descriptions are bundled defaults too
  ([`architecture.md → System and user halves`](./architecture.md#system-and-user-halves)):
  play checks the narrator never copies a mark into its prose, and
  whether other AI-written text (entity descriptions, traits, lore,
  threads) ever turns up in "I" and needs the same rule (added
  2026-11-17 by the lead-per-entry design).

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

- **Which way piggyback defaults.** Piggyback is the user's switch and
  ships off
  ([`piggyback.md → When piggyback fires`](./memory/piggyback.md#when-piggyback-fires)),
  because nothing has measured it: the one data point, Gemma 4 E4B in
  April 2026, predates the block's transfers, drops, conditions, visual
  changes and creates, and the classifier probe's parse rates measure the
  fallback's JSON, not a tagged block at narrative temperature. Play
  turns piggyback on in played stories, on the dev model and a sample of
  hosted ones, and reads the
  [piggyback record](./memory/classifier.md#piggyback-record) for the
  parse rate, and whether it falls as a story's context fills. It also
  reads the prose under the fold, the
  [narrative-quality risk](./parked.md#narrative-quality-empirical-risk-under-suggestion-fold)
  parked until this signal. Then it sets the shipped default, and tunes
  the record's window of 20 turns. Raised 2026-11-17 by the
  piggyback-switch design.

- **How many keywords a row may hold.** A model's keyword lists have
  no count bound, only a term-length one
  ([`retrieval.md → Keywords schema`](./memory/retrieval.md#keywords-schema)):
  the classifier's creates and appends, and the close's `set_keywords`,
  `create_lore` and `update_lore`, land every term they send. Retrieval
  already bounds what keywords cost injection
  ([`Keyword injection budget`](./memory/retrieval.md#keyword-injection-budget)),
  but every entity's keywords render in each periodic pass's Known
  entities and in the close's upkeep rows, so a list that only grows
  grows those prompts. Chapter metadata caps its browse keywords at 8
  (`CHAPTER_KEYWORDS_MAX`). A starting guess to test is 50 terms a row,
  the classifier dropping the overflow and a close refusing a longer
  list only when it is longer than the stored one, as the soft caps do
  ([`data-model.md → Soft caps + compaction discipline`](./data-model.md#soft-caps--compaction-discipline)).
  Play on long stories shows whether lists grow that far. Split
  2026-11-15 from a triage entry raised in 5.8's reviews, whose length
  half landed; developer decision.

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
    steps a task takes against its budget of 64;
  - reasoning spirals: one prompt shape sent the dev model through its
    whole output limit in 7 of 14 runs, with no known cause, so the 16k
    bound and the prompts both need a measure;
  - a rule refined in a later part, which landed as a second lore row in
    3 of 10 runs that dropped reasoning, and needs repeating with it;
  - the profile switches on a few models: whether a list of 17 tools
    costs a weak model what fewer tools are said to save, and whether a
    single conversation does better anywhere;
  - part size, half the window, and how a chapter cut in parts reads;
  - servers that take the tool list and ignore it;
  - the ledger's "Writes so far" lines, which name delta paths
    (`state.traits`, `state.parent_location_id`, in
    `close-agent/ledger.ts`) where the task templates name the tool's
    arguments (`traits`, `parent`), leaving the model to join the two;
    naming each by its argument is a per-tool map in `ledger.ts`
    (routed from triage 2026-11-14).

  Play tunes the metadata prompt too, outside the agent. It has three data
  points. Two are in
  [Slice 5.2's Implementation notes](./implementation/milestones/05-chapters-chapter-close/slices/02-first-chapter.md#implementation-notes):
  one dev-model close told its summary in the second person against
  first-person narration, and one of fifteen ran away to 39,689 output
  tokens with no max output set and failed (the developer keeps the
  profile without one). The second-person summary was judged against
  a rule that told the summary in the narration's person, with no lead
  or narration in the close's context; summaries are now told in the
  third person with both in context
  ([`chapter-close.md → Phase 2`](./memory/chapter-close.md#phase-2--chapter-metadata)),
  so play checks that rule holds instead. The third is
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
    Whether sampling feeds these slips is measured under
    the invalid-call entry below, third part.

  The record and the saved conversations are the inputs; see 5.5b's
  measure record in its slice doc. Raised in 5.5b's measure.

- **The close's invalid tool calls: a bounded answer, a list repair, and
  sampling.** Code bounds and a measure, not prompt tuning. The
  developer, on Slice 5.10's run 2: "Let's keep it as A and fix this in a
  followup. The model was also called with temperature 1.0 so that is
  potentially a contributing factor to both." Three parts:
  - **Bound the answer past a size: a verbosity-versus-context
    trade-off.** The SDK answers an invalid tool call itself, and
    `stepMessages` in `close-agent/run-task.ts` hands that answer back
    to the model unchanged: the whole value and one schema issue per bad
    entry. The developer: "the error as it stands today is fine for most
    cases, except when goes wrong like this. So i guess it's a question
    between verbosity and context usage." Run 2 is the case that goes
    wrong: an Identity retry padded `turns` with 1,324 `true` entries,
    its answer came back as a 238,990-character tool result, the next
    step's prompt reached 116,118 tokens, llama.cpp refused it against a
    65,536 window, and the task stopped as `window`. Keep the answer as
    it is when it is small, and bound it only past a size: collapse
    identical issues into one line with their path range (for example
    `turns[6]` to `turns[1329]`: expected string, received boolean) and
    truncate the echoed value. `tool-step.ts` carries the same unbounded
    message in `invalidCalls[].detail`, logged as
    `memory.close_tool_call_invalid`.
  - **Repair string-encoded lists before validation.** The dev model
    sends lists as JSON strings (a traits list arriving as one quoted
    string of an array) and has looped on it: the first probe's run 7
    Identity resent it seven times. The SDK doesn't reject such a call
    outright. `ai` 6.0.193's `parseToolCall` (`node_modules/ai/dist/index.mjs`,
    from about line 3717) calls `generateText`'s `experimental_repairToolCall`
    on an invalid input and re-validates what it returns; `null` keeps
    today's invalid call. `tool-step.ts` passes none. A deterministic
    repair, JSON-parsing a string where the schema expects an array,
    needs no model call. Write the hook against the SDK's exported
    `ToolCallRepairFunction` type and read only `toolCall.input`, not
    `system`, so it ports to AI SDK v7 unchanged but for the option
    name: v7 (7.0.176) makes it stable as `repairToolCall`, keeps
    `experimental_repairToolCall` as a deprecated alias, renames
    `system` to `instructions`, and types the call as
    `LanguageModelV4ToolCall` (v6: `LanguageModelV3ToolCall`). That is
    checked from both versions' type definitions, not their runtime. The
    option is experimental in v6. A v6 to v7 upgrade is wanted at some
    point, outside this item.
  - **Sampling: a question to measure, not a fix.** The close's
    tool-step request sends no sampling parameters (run 2's Identity
    retry request carries only `model`, `max_tokens` 16,384 and
    `tool_choice` `auto`), so the router's server defaults applied. For
    `Gemma4-26B-A4B-QAT-MTP` those are `--temperature 1.0`, `--top-k 20`,
    `--top-p 0.95`, `--min-p 0` and `--repeat-penalty 1.0`; a repeat
    penalty of 1.0 multiplies by one in llama.cpp, so no repetition
    penalty was in effect. The developer names temperature 1.0 a
    possible contributor to both slips: the `true`-padded `turns` (run
    2's Pew call sent six handles, then `true` 1,324 times, and no
    `why`) and the string-encoded lists. A penalty above 1.0 would also
    weigh on the punctuation and handles a tool call repeats
    legitimately, so measure before changing anything. It refines
    the capability-floor entry's third bullet above.

  The record is
  [Slice 5.10's seven-task rerun](./implementation/milestones/05-chapters-chapter-close/slices/10-two-starts.md#seven-task-rerun-on-the-raised-budgets).
  Raised by Slice 5.10's measure, 2026-11-18.

- **Boundary mis-picks at scene breaks.** Boundary shows each candidate
  by its first and last sentences only, and Slice 5.10's runs on the
  dev model missed a scene break two ways. On the shipped prompt, two of
  ten picks took a turn that opens on a new scene (t16, a dated letter),
  one turn late, which puts the scene's first turn in the closing
  chapter. With a one-sentence guard against scene-opening turns (tried,
  then reverted), six of ten took a turn that holds the break inside it
  (t15, which crosses Part Two's opening time skip mid-turn and ends on
  the letter's lead-in colon), and the real break, t14, fell from three
  picks to two. A guard keyed on a turn's opening can't see a break
  inside a turn. The lever to try is candidate display: more of each
  turn, or a marked mid-turn break. The evidence so far is one chapter
  of one novel. The record is
  [Slice 5.10's boundary measure](./implementation/milestones/05-chapters-chapter-close/slices/10-two-starts.md#boundary-measure),
  and the guard's run is in its
  [Implementation notes](./implementation/milestones/05-chapters-chapter-close/slices/10-two-starts.md#implementation-notes).
  Raised by Slice 5.10's measure, 2026-11-18 (developer, "Q12: C").

- **Parked items play gives a signal for.** Each waits on evidence
  only play produces, so play checks them rather than letting the
  signal pass unseen:
  - [Narrative quality empirical risk under suggestion fold](./parked.md#narrative-quality-empirical-risk-under-suggestion-fold)
  - [Split the piggyback switch for `<suggestions>`](./parked.md#split-the-piggyback-switch-for-suggestions)
  - [Recency-bias diversity mitigation for suggestion category mix](./parked.md#recency-bias-diversity-mitigation-for-suggestion-category-mix)
  - [Multi-axis salience](./parked.md#multi-axis-salience)
  - [Prompt-cache optimization](./parked.md#prompt-cache-optimization)
  - [Calibrating the token estimate per model](./parked.md#calibrating-the-token-estimate-per-model)
  - [A limited narrator in second and third person](./parked.md#a-limited-narrator-in-second-and-third-person)
  - [A twin across a placement](./parked.md#a-twin-across-a-placement)
  - [Resuming a failed close](./parked.md#resuming-a-failed-close)
  - [A staged row has no retirement](./parked.md#a-staged-row-has-no-retirement)
  - [A term a surviving turn re-sent can be lost to a reversal](./parked.md#a-term-a-surviving-turn-re-sent-can-be-lost-to-a-reversal)

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
  a window stop. The Awareness start, which has no parts, listed 72 rows
  in a 3334-token user half on the dataset chapter (Slice 5.9), with no
  bound either. The metadata merge grows with the part count too (about
  75 tokens a part summary over a 420-token base) with no size check or
  staged merge, so on a small window a very long chapter could fail the
  close at the merge after every part call ran; only near an 8k window
  and a chapter past about 420k tokens. Raised 2026-11-10 by 5.8's
  review; the merge size by its slice review.

  The same long chapters should judge a later part's create closing the
  row to an earlier part. A close's per-part task reads C12 past its
  part's last turn, and a create counts as writing every field, blank
  ones included (`wrotePath` in `lib/actions/delta/user-precedence.ts`,
  through `wroteField`). Upkeep shows a part every live row its prose
  names off the scene (`startUpkeep`), so an earlier part can name a row
  a later part's turn first created and write nothing to it: detail only
  the earlier part's turns hold is lost. Candidate fix: inside the
  later-turn check only, a later part's create counts only for the
  fields it set non-blank; `wroteField`'s create rule stays as it is for
  user precedence. It costs more than it reads: a create delta stores no
  undo payload, so "the fields it set" has to be rebuilt from later
  deltas or the current row. 5.8 records the limit
  ([`chapter-close.md → Tools and writes`](./memory/chapter-close.md#tools-and-writes)).
  Raised in 5.8's slice review, developer decision 2026-11-10; routed
  from triage 2026-11-14.
