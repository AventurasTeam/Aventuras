# AI writers

Reframes "Chapter-close agent design" in `followups.md → Data-model`.
Chapter close's agent couldn't be designed while canon didn't say which
writer owns which piece of story state, and while the periodic
classifier's place in the pipeline kept costing compromises. This
record maps every AI writer, gates the periodic classifier, and adds
unplaced places. The commit that lands it adds implementation entries;
the chapter-close agent design stays open, with its write set now
fixed.

The spec lives in
[`data-model.md → Authorship contract`](../data-model.md#authorship-contract)
(the map),
[`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)
(unplaced places),
[`memory/cadence.md → Concurrency`](../memory/cadence.md#concurrency)
(the order of writers), the layer docs
([`classifier.md`](../memory/classifier.md),
[`piggyback.md`](../memory/piggyback.md),
[`chapter-close.md`](../memory/chapter-close.md)) and
[`generation-pipeline.md → Concurrency model`](../generation-pipeline.md#concurrency-model).
What follows is why.

## What this closes vs. defers

Closes:

- **State with no writer.** `voice`, a place's or an item's
  `condition`, putting an item down, a faction's `standing`, threads,
  a happening's category and icon, awareness of an existing happening,
  and the first profile of everything a pass creates.
- **"Classifier" as four writers.** The contract named piggyback, its
  fallback, the periodic classifier and chapter close alike; it now
  names a layer per field.
- **The background classifier's concurrency layer**, in canon. The
  classifier blocks, so the disjoint write sets, the no-gate write
  phase and the wait for turns in flight go. World's three-way merges
  stay unless no pane can stay dirty across a pass, which the
  implementation checks.
- **"Placing a mentioned place later"** in `parked.md`.
- **Contradictions** the inventory found: when `lastSeenAt` is written;
  a `decay_resistance` on happenings, which have none; lore at priority
  50; threads "M3's classifier wrote sparsely", when nothing writes
  them; phase 0 inside the close's action group.

Defers:

- **Implementation**, to two followups: the gated classifier, and the
  new writes.
- **Chapter close's agent**: tool set, loop budget, boundary and
  metadata calls, how the close logs and anchors its writes, failure
  policy, review flags. The followup is rewritten around the write set
  fixed here.
- **The periodic classifier's context growth**, a new followup.
- **Era flips' user writer**, which canon has and the code doesn't
  wire: triage.

## Ground truth that shaped it

- **No AI writes most of the profile.** The periodic classifier
  creates characters, places and factions with an empty state
  (`lib/classifier/plan.ts`), and piggyback writes visuals, location,
  holdings and stackables. Nothing writes `traits`, `drives`, `voice`,
  `standing`, `agenda` or `condition`, any lore or any thread; since
  [entity state in prompts](./2026-10-19-entity-state-in-prompts.md),
  every prompt shows them.
- **Piggyback can only clear an item's `at_location_id`.** Its
  transfer grammar moves items between holders, and a put-down item
  stays prose.
- **A chained run inherits its predecessor's `actionId`**
  (`lib/pipeline/runtime/orchestrator.ts`, `newRunState` from the
  predecessor's context; `submit-turn.ts` starts the turn with one).
  Canon gives it a fresh one. Latent while nothing declares `chainsTo`.
- **Phase 0 had no entry point.** Starting a pass during a close is
  refused by the pass's own `blockedBy`, and calling its phase inline
  writes under the close's `actionId` and takes a write lock a
  hard-gate run never releases.
- **The cost of running in the background**, from a survey of canon
  and code: about 750 lines of code, 4,800 of tests and 480 of spec
  exist only because a pass overlaps turns and edits, and one known
  bug (a pass started during a streaming turn keeps that turn's
  user_action). About 800 lines answer the classifier's lag and stay
  under any gate: the survival anchor, user precedence, the watermark
  clamp, the prose-edit sweep, closure and recovery.
- **The 300-second cap bounds a whole pass**, retries included
  (`lib/pipeline/definitions/periodic-classifier.ts`).
- **A pass sees the whole branch**: every character, item and faction
  of any status, every place, every relationship view, every happening
  title.

## Decisions

**Map the writers before designing chapter close's agent.** Half of
what chapter close was specced to compact had no first writer, and
`condition`, an event of one turn, was headed for chapter cadence.

**Chapter close is a tool loop; the periodic classifier stays one
structured call.** Chapter close judges a chapter against the whole
world, where looking state up on demand and getting rejections back pay.
A pass extracts from a bounded window on the Fast profile, where tool
calling is least reliable. The model a tool loop runs on needs a
tool-calling capability flag, detected and user-overridable like the
others; the chapter-close design adds it.

**The periodic classifier blocks, chained after the turn.** The
developer's hybrid: a due pass chains from the turn's commit, so it
runs while the user reads. A head reversal or Cancel interrupts it and
defers it to the next Send, with a toast; chapter close follows the
same rule. Blocking for minutes every few turns is acceptable; the
concurrency layer has cost more than that wait.

- Rejected: always running a due pass before the next turn. No
  regenerate ever meets a pass, but every pass's wait lands after Send
  instead of during reading, for the rare reversal's sake.
- Rejected: staying in the background, keeping the concurrency layer
  and write sets that can't overlap.

Details that follow from it:

- Every head reversal behaves alike, Cancel included, so the barrier
  reduces to cancel-and-wait.
- A deferred pass commits as its own undo group before the turn's
  first write; sharing the turn's group would let a regenerate sweep
  facts about settled turns.
- Retries move from timers to the next turn's commit: a timer would
  raise the gate at a random moment.
- Suggestion refresh runs alongside a pass or a close: it writes only
  the head entry's chips, and a pass never moves the tail, which is
  the hazard refresh's own gate answers. Translation retry waits, since
  a close deletes the happenings it merges.

**Phase 0 is a chain of ordinary passes.** A pass chains another while
a close is pending and entries are unprocessed, then the close. No
special entry point, no drain, each pass its own undo group.

**Four rules across layers.** Writers run in order and never overlap,
so a field may have two AI writers and the later wins. A user edit
made after the prose a write rests on stands; a close's write rests on
the latest entry it cites. A layer updates a field only if its prompt
showed it the current value. The contract names a layer, never
"Classifier".

**The fastest layer with the evidence writes first; slower layers
correct and consolidate.** A pass writes a profile when it creates an
entity, from the window that introduced it; piggyback writes what a
turn changes; chapter close revises the slow fields over the arc.

- Rejected: one owner per field. `condition` is per turn in the scene
  and upkept off it; a profile is written at create and revised over
  the arc. Both are two layers by nature.
- Rejected: canon as it stood, chapter close authoring all identity.
  Profiles stay empty for up to a chapter.

**Piggyback owns physical state, the periodic classifier social and
structural facts.** Piggyback: where things are, what's held, worn or
broken, which the next turn's prose must not contradict. The
classifier: memberships, a faction's standing, where a place sits, a
name. A pass would catch a burned tavern turns late; piggyback
wouldn't see a faction's standing shift.

**Opened user-only rules, and the ones kept.**

| Rule                                    | Now                                                               | Why                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Description user-only after create      | Chapter close rewrites on a material change                       | The description is the "who" line in every prompt; the stable boy who became the champion needs it current |
| Re-parenting a place user-only          | The periodic classifier and chapter close, cycle-checked first    | Root-level mentioned places duplicated when the story later placed them                                    |
| Retiring a place user-only              | Kept                                                              | Destruction is a `condition`; ruins can be visited                                                         |
| Retired → active user-only              | The periodic classifier, on a return in the scene now             | Otherwise a returning character becomes a duplicate; flashbacks and visions are the risk                   |
| Collision flags and merge user-only     | Merge kept; chapter close may raise a flag                        | A merge deletes a row and re-points everything                                                             |
| No AI rename                            | The periodic classifier on an explicit reveal, old name a keyword | "The hooded stranger is Kael"                                                                              |
| `common_knowledge` user-only            | Chapter close                                                     | News spreading is a chapter-scale judgment; a wrong flag makes everyone aware                              |
| Keyword removal append-only             | Chapter close removes keywords an AI added                        | Stale epithets; the user's aliases still survive                                                           |
| Tags, `injection_mode`, `priority`, era | Kept                                                              | Labels, retrieval controls, calendar configuration                                                         |

**Threads go to the periodic classifier; chapter close consolidates.**
A quest given early in a chapter should be tracked before the chapter
ends, and an active thread is injected every turn. That cost is why
creation is biased against, like lore, and why chapter close resolves
stale threads.

**Lore stays at chapter close.** With the partial buffer, a rule the
prose set up early in a chapter can drop out of the narrator's history
before the close records it. A wrong lore row lives in every prompt,
so the chapter's cadence is worth that gap.

**Unplaced places, decided by containment.** A place known to exist but
not where sits outside the tree, flagged in its `state`. The test is
whether anything on the map could contain it: nothing could, it's
top-level; something could and the turns don't say which, it's
unplaced. When unsure, unplaced: a wrongly unplaced place heals when a
mention places it, and a wrongly top-level one never meets the place
a later turn creates under its real parent. A place whose parent is
deleted, by World or by a reversal, becomes unplaced: its container is
gone, so where it is is unknown.

- Rejected: "no parent named means unplaced". The developer's
  counterexample: a story whose map holds one city travels to another,
  naming no country; the second city is a peer, not lost.
- Rejected: a column for the flag. Inside `state` it gets the
  per-field user precedence and reversal handling `state` already has.

## Adversarial pass

- **Load-bearing: a pass's prompt grows with the story.** It lists
  every entity, place, relationship view and happening; this design
  adds happening ids, threads, standing and the unplaced group. A pass
  now blocks, so its call is the user's wait, and at the projected
  thousands of happenings the list alone may outgrow a Fast model's
  window. Pre-existing, made visible by the gate: a new followup.
- **One structured call with a larger schema.** Profiles, threads,
  standing, renames, returns, placements and awareness of old
  happenings may raise parse failures on Fast models. The 300-second
  cap bounds the wait. If failures rise, the pass splits into two
  calls, a change of call shape inside the layer, not of the map. The
  implementation measures it.
- **A close's write with several citations** rests on the latest cited
  entry: prose after a user's edit outranks it, prose before doesn't.
- **An interrupt needs a gate exception.** Reversal entry points refuse
  while the edit gate is closed, and a pass now closes it. A head
  reversal interrupts a pass or a close only; while a refresh runs,
  reversals still wait for it.
- **A rename can mistake an alias for a reveal.** The rule asks for the
  prose to establish the name as the character's own; an alias stays a
  keyword. A wrong rename keeps the old name as a keyword, so retrieval
  still finds the character, and a user's rename back stands.
- **A return can be a flashback, a vision or a memory.** The bar is the
  character being in the scene now.
- **An unplaced place can reuse the wrong namesake** when exactly one
  placed place shares its name. The mention rule already excludes
  generic places, and several namesakes raise a flag instead.
- **Piggyback could restate conditions every turn.** The emission rule
  keeps condition to changes, as for visuals.
- **A lost deferred mark** after a restart: the next commit finds the
  pass due and chains it after the turn instead. No work is lost.
- **A failing provider** blocks up to 300 seconds per pass, for at most
  three turns before `failed-persistent` suspends the cadence.
- **A close flagging an already flagged row**: a row holds one partner,
  so the close flags only unflagged rows. Left to the chapter-close
  design.
- **Translation.** A rename or a rewritten description is a modified
  translatable field; its writer queues the translation as the other
  writers do. An implementation check.
- **Undo is unchanged.** A pass, deferred or not, is never an undo
  target; a close is one undo group.

## Integration plan

- `data-model.md`: the Authorship contract becomes the map, per layer,
  for every story-state table; Soft caps; LocationState shape gains
  `unplaced`, and its cycle-guard and retired-place paragraphs lose
  "re-parenting stays user-only" and "goes to the root"; the
  description and `lastSeenAt` passages; Chapters / memory system's
  phase 0; the `entities.keywords` diagram comment.
- `memory/cadence.md`: the layers table; Concurrency rewritten as the
  order of writers; "Single-writer-per-write-set in v1" removed; "User
  edits and classifier writes" keeps precedence and reversals, loses
  the overlap cases.
- `memory/classifier.md`: what it reads and writes; Mentioned places'
  parent and matching; Factions; "Background-task framing" becomes
  "Pipeline framing"; auto-retry, status copy, manual override.
- `memory/piggyback.md`: what it writes; the trailing block's condition
  write and drop verb; creating a place (top-level or unplaced,
  matching against unplaced places).
- `memory/chapter-close.md`: the intro and the tool loop; "Phase 0 —
  catch-up classifier pass" becomes "Phase 0 — catch-up passes"; 3a
  priority and bodies; 3b voice, standing and descriptions; 3e's
  `decay_resistance`; a new 3f, world upkeep; the failure table.
- `memory/edge-cases.md`: "Retired → active is user-only in v1"
  becomes "Returning from retirement"; v1 limitations.
- `memory/retrieval.md`: `common_knowledge` and keyword removal.
- `generation-pipeline.md`: gate derivation; V1 declarations;
  resolution table; the barrier becomes the interrupt; "No-gate write
  phase" becomes "Branch write lock", for the reversal against a
  rollback preview; `chainsTo` and the chained start; the background
  scheduler becomes the cadence chain; Invariants; recovery's no-gate
  passage.
- `architecture.md`: the cadence table, the chapter-close pipeline
  paragraph, the location view's `unplaced`.
- UI: `generation-status-pill.md` ("Non-blocking phases" becomes
  "Memory phases"), `principles.md` ("Two pipelines covered" becomes
  "Pipelines covered"; the banner and the interrupt),
  `reader-composer.md` (a new "During a memory update"),
  `world.md` (an unplaced place's Overview and parent picker,
  keywords, World during a pass), `plot.md` (threads),
  `story-settings.md` (status copy), `toast.md`, `diagnostics.md`.
- `followups.md`: the chapter-close entry rewritten; "Implement the
  gated periodic classifier", "Implement the AI writer map" and
  "Periodic classifier context grows with the story" added.
- `parked.md`: "Placing a mentioned place later" becomes "Merging any
  two rows of one kind"; "Auto-promotion `retired → active`" removed;
  the no-gate passages of "Background-pipeline declarations",
  "Multi-background-pipeline concurrency", the links-array entry and
  the recovery entries updated.
- `implementation/roadmap.md`: M5's threads claim and "no orchestrator
  change"; `implementation/triage.md`: the era-flip writer.
- Inbound links to the renamed headings, in M3's slice docs, triage
  and older explorations.
