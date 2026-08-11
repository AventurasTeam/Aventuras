# Context Injection

What the narrator is given each turn, and who decides it.

## Selection: Entry Retrieval and World State Injection

Two independent services select what gets injected into the narrator prompt each turn — the split is crucial because they operate on completely distinct data domain boundaries:

- **Entry Retrieval** (`src/lib/services/ai/retrieval/EntryRetrievalService.ts`) — operates on static, authored **Lorebook** `Entry[]` records (characters, locations, items, factions, concepts, events).
- **World State Injection** (`src/lib/services/ai/generation/WorldStateInjector.ts`) — operates on **live-tracked** `Character[]`/`Location[]`/`Item[]`/`StoryBeat[]` entities that the classifier updates dynamically after every turn (present characters, current location, inventory, active quests/milestones). Runs on every narrator call regardless of retrieval mode.

The world-state block's sections split on **two different axes**, and conflating them is a live hazard.
`[PROTAGONIST]`, `[CURRENT LOCATION]`, `[INVENTORY]` and `[ACTIVE THREADS]` are claims about _current
state_; `[RELEVANT ...]` are claims about _relevance only_. Tier 1 once held nothing but the former, so
reading "tier 1" as "current state" was safe — until stickiness was added, at which point Tier 1 also
held entities carried forward _because_ their state condition stopped holding. Routing those through the
state sections told the narrator the player carries a dropped item and is pursuing a finished quest, and
left sticky locations rendered nowhere at all while `formatAlreadyInContext` still announced them.
The rule is now explicit: state sections take Tier 1 **minus** the sticky carry-over, and sticky entries
join Tier 2/3 in the relevance sections.

Anything in the result's `all` must be renderable somewhere in the block, because `all` is what the
retrieval agent is told the narrator already has. `WorldStateInjector.test.ts` pins that invariant.

Both services implement a three-tier injection architecture (Tier 1: sticky/always-on, Tier 2:
name/keyword fuzzy matching, Tier 3: the leftover) and are independently configurable in Advanced
Settings.

**Tier 3 is two branches, and the volume question is asked before the relevance one.** A leftover
small enough to send whole is sent whole, uncapped and with no LLM call; only one too big is worth
asking a model about, via `src/lib/services/ai/retrieval/tier3Selection.ts`. The boundary is a
**word budget on the candidate text** (`tier3WholesaleWordBudget`), the same unit on both sides —
but not the same number: a live world-state record runs ~16 words and a lorebook entry ~69, so the
budgets are 500 and 1000. A record count could not express that difference, which is why the
world state's old `llmThreshold` is gone rather than converted. Switching LLM selection off removes
the call, not the tier: a leftover under the budget still goes in.

**Only a leftover the model _chose_ counts as an activation.** Wholesale inclusion means "there was
little of it", which says nothing about relevance — and since the branch holds every uncovered
record, recording it would make the entire pool sticky on every turn of any story under the budget,
so Tier 1 would absorb it and stickiness would never expire. Both services exclude it; the world
state side once claimed to and did not.

**Tier 2 runs twice, and the second pass is where indirect relevance lives.** The first pass matches
what the scene _says_ — the player's action and the recent story. The second matches whatever is
left against _names_: those the first pass found (`retrieval/tier2SecondPass.ts`), plus what World
State Injection put in the scene. That second source is a **one-way handover**: `WorldStateInjector`
publishes its Tier 1 + Tier 2 via `onSceneEntities` before its own Tier 3 runs, so the lorebook pass
starts from what is present without waiting on an LLM call. It never travels back — lore names read
as scene state would have the narrator acting on characters who are not there. It is a second-pass
seed rather than a first-pass one because a lore entry that matched only because someone is standing
in the room is relevance at one remove, and ranking it with a word the player typed made it
indistinguishable from one. Governed by **Match Against What Is in the Scene** (on by default): the
seed set is every active character, item, quest and the current location, which on a mature story is
most of what a lorebook is about.

`tier3Selection.ts` caches the last selection per caller. The key is complete by content — caller,
candidate pool in order, player action, and the ids of the recent entries the prompt was built from
— because two situations sharing a repeated action and an unmoved pool are otherwise the same
question as far as a cache can see, which is reachable across consecutive turns and across a branch
switch. It is also cleared on story load and branch switch.

What each tier actually contributed is recorded on the narration entry as
`metadata.retrievalSnapshot` (`retrieval/retrievalSnapshot.ts`) and shown in the **Active Context**
panel. Diagnostic only: nothing reads it back into a prompt.

The panel also shows the three blocks themselves, verbatim, under **Injected Prompt Blocks**:
the world state, the lorebook, and **Injected Memory** — whichever memory mode ran, since
agentic returns a synthesis (`chapterContext`) and static returns the chapter Q&A that
`buildTimelineFillBlock` renders into the summaries block. The panel calls that same function
rather than formatting the responses again, so it cannot drift from the prompt it is showing.
Unlike the other two, memory contributes nothing to the tier sections: it selects no entries.

## Agentic Retrieval

**Agentic Retrieval** (`src/lib/services/ai/retrieval/AgenticRetrievalService.ts`) is an alternative
to the static chapter memory fill (`TimelineFillService`). Which one runs is decided by
`timelineFill.mode` (`'static' | 'agentic'`) via `aiService.shouldUseAgenticRetrieval` — the setting
is surfaced as the **Memory** mode in Advanced Settings, and the current default for a fresh install
is `'agentic'`.

It runs an agent loop (Vercel AI SDK) whose tools are built by
`src/lib/services/ai/sdk/tools/retrieval.ts`:

| Tool                  | Registered when                                           | Cost                            |
| --------------------- | --------------------------------------------------------- | ------------------------------- |
| `search_entries`      | always                                                    | free (string matching)          |
| `get_entry`           | always                                                    | free                            |
| `finish_retrieval`    | always (terminal tool)                                    | free                            |
| `grep_chapters`       | `canGrepChapters()` — chapters, flag, and an entry reader | free (literal text search)      |
| `query_chapter`       | `chapters.length > 0`                                     | one full chapter read by an LLM |
| `inspect_world_state` | a non-empty live `WorldState`                             | free                            |

On the last step `finish_retrieval` becomes the only callable tool and is required
(`finishOnlyOnLastStep`, via `prepareStep`). A run that hit the ceiling without calling it used to
produce nothing at all — its findings live in the agent's own message history and nowhere else — so
the step that was going to happen anyway is spent on the summary instead, at no extra call. A run
that _dies_ is a different case: there is nobody left to ask, and it falls through to the salvage
below. Lore management uses the same policy for `finish_lore_management`: its changes are already
written when the ceiling is reached, but the summary is the only account the user is shown.

The loop stops on `finish_retrieval` or at `maxIterations` (`AGENTIC_RETRIEVAL_DEFAULTS`, default
10 — measured runs finish in 3-5, so the ceiling only bounds the worst case). A run that dies
part-way is salvaged rather than discarded — chapter answers cost an LLM call each, and throwing
would leave the turn with no retrieval at all. The salvage is read back off the run's own event
log, which is the only record of what was paid for.

**The whole-chapter read is governed in one place for both agents**
(`sdk/tools/chapterQueries.ts`), because `maxIterations` counts steps and a run could otherwise
spend every one of them on a ~17,000-token read. `ChapterQueryBudget` holds three things: a
per-run allowance, a cache so a repeated question is replayed instead of re-read, and failures
cached like answers so a question the provider cannot answer is not re-asked until the step
ceiling is gone. Two numbers, not one — retrieval spends `MAX_CHAPTER_QUERIES_RETRIEVAL` (3) per
turn with `grep_chapters` as the free fallback; lore management spends
`MAX_CHAPTER_QUERIES_LORE` (6) per session, a pass that runs once per chapter and has no cheaper
tool. The refusal names that fallback **only where it is registered**, from the same
`canGrepChapters` the tool list reads: sending the model to a tool its instructions deny is the
failure that predicate exists to prevent. What is deliberately not shared is the tool itself —
the two agents have different contexts and different result shapes, and merging them would drag
`onEvent`/`describeProgress` into the lorebook.

`finish_retrieval`'s `synthesis` and `chapterSummary` both reach the narrator, and the prompt says
so — `chapterSummary` is optional in the schema, and a run that put its findings in `synthesis`
instead used to be discarded wholesale. What is suppressed is narrower: a run that _did not_ reach
`finish_retrieval` and salvaged nothing, whose only output would be a note about the retrieval
agent's own troubles. Grep excerpts are never carried out of the run.

It **selects nothing**. The agent reads lore to reason about the past and returns a prose summary; which
Lorebook entries reach the narrator is decided by Entry Retrieval, in every mode. Both selection services
above therefore run on every narrator turn regardless of retrieval mode — Agentic Retrieval never sees
live `WorldState` at all, so it cannot stand in for either of them.

**A tool's registration condition and the prompt text describing it must be the same expression.** Two
tools are conditional — `grep_chapters` on `agenticRetrieval.grepEnabled` (on by default) and
`inspect_world_state` on there being any live state — and both once had the condition written twice, so
the flag reached the template while the tool list ignored it. The model was handed a callable tool its
instructions denied existed. Both conditions are now single exported predicates, `canGrepChapters` and
`hasLiveWorldState`, read by the tool registration, the prompt template, and the tail split alike.

Each tool is built by its own factory (`createSearchEntriesTool`, `createGrepChaptersTool`, …); what they
share is a small `RunState` holding the grep result cache and the `query_chapter` counter.

`grep_chapters` is a **literal substring** search over the raw story text, not a keyword search: a
multi-word query only matches where those words appear consecutively. It reports per-chapter match counts
alongside a sampled spread of excerpts, so the agent can narrow rather than page. Excerpts are labelled
`ACTION` or `NARRATIVE`, because the corpus includes what the player typed and handing that back to the
narrator as established fact is a real failure mode.

**A substring search on a short name is mostly noise, and the tool handles that itself.** A character
called "Ren" matched 1,000+ paragraphs — "rendered", "surrender", "children" — and the answer was 40
excerpts of unrelated prose plus a per-chapter table saying only that the letters occur throughout. Two
guards, both in `createGrepChaptersTool`:

- **Auto-narrowing.** When the agent leaves `wholeWord` unset and the search exceeds
  `GREP_NOISE_RATIO` (5) matches per excerpt slot, the search is re-run on word boundaries. The
  whole-word result replaces the substring one only if it removes at least half the matches
  (`AUTO_NARROW_MAX_SHARE`) without falling to zero — so a short name collapses to its real mentions
  while a stem the agent meant loosely, `"rune"` finding `"runes"` and `"runic"`, barely moves and is
  left alone. That threshold is the whole reason there is no rule on query _length_: `"rune"` is four
  characters and is exactly the search a length rule would break. An explicit `wholeWord: false` is a
  decision and is always honoured; the result reports the flag it actually ran under, plus an
  `autoNarrowed` note, since every count in it is the narrowed search's.
- **A noise signal.** A search still past the threshold quotes `NOISY_EXCERPT_LIMIT` (8) excerpts
  instead of the full allowance and carries a `tooManyMatches` note naming the narrowings that would
  help. Spending 40 excerpts on prose that matched by accident is the expensive half of the failure,
  and it is paid into a prompt on every turn. The per-chapter counts stay complete either way — they
  are what tells the agent where to narrow _to_. This is a separate note from the ordinary
  "more matched than fit" one, because it needs a different fix: narrowing the query rather than the
  chapter range.

`truncateAroundMatch` takes the same `wholeWord` flag, so a whole-word search cannot position its
excerpt on a substring occurrence it never counted — otherwise a passage returned for "Ren" opens on
"surrender".

Density is what the budget follows, in three places at once. `sampleMatches` shares excerpt _slots_
by hit count rather than by passage count — `findTextMatches` merges neighbouring matching
paragraphs, so counting passages penalises exactly the chapters where a term concentrates. Each
passage's _word_ allowance is then proportional to the hits it holds, and `truncateAroundMatch` keeps
the whole span of occurrences when it fits rather than re-cutting around the first — otherwise the
truncation undoes the merge that made the passage worth showing, and the agent gets a fragment where
it had a scene. Each excerpt reports its own `hits`, so a quote covering five mentions is
distinguishable from one covering a passing reference.

Sampling (`grepSampling.ts`) switches strategy on whether covering every matching chapter is _achievable_.
Up to `groups <= limit` it covers them all, one excerpt each, then spends the rest on the densest. Past
that it shares the budget in proportion to hit counts instead — because coverage is unreachable either
way, and paying full price for it produced one fragment per chapter from 28 chapters, which the agent
could not answer from. It then fell back to `query_chapter` twice, at 51% of the turn's total cost.

## Static Memory Fill

**Static mode** (`TimelineFillService`) is the other half of the same setting. It asks a model for
up to `timelineFill.maxQueries` (default 5) questions, resolves each one to the chapters it names,
groups questions that resolved to the same chapter set, and answers each group in one batched call —
falling back to per-question calls when the batch comes back incomplete, because a provider with
weak JSON-schema support would otherwise lose every answer in the group instead of one.

Two properties of that path are worth knowing before tuning it:

- **A chapter's full text is expensive, and the read is bounded in code, not by the prompt.** A
  chapter measures ~17,000 tokens of verbatim entry text on a real save, so a query naming three
  chapters built a 50,000-token prompt and one naming four built 68,000 — both rejected outright by
  a 49,152-token server. The query generator was already told to name few chapters and asked for
  four anyway. `chapterContentBudget.ts` is where the bound holds: entries are taken in order until
  the budget is spent, and a leading `[TRUNCATED: ...]` marker names the chapters that got no text,
  because an answering model that is not told will report on chapters it never saw. Still exactly
  one call — `query_chapter` is never multiplied.

  **The cut is a single stop point.** Once a chapter cannot be finished the read ends rather than
  filling later chapters from whatever tokens are left: spending the remainder produced a text that
  opened three chapters and finished none, which answers nothing and multiplies the risk that the
  model reports on a chapter it saw only the first entry of. At most one chapter is ever partial,
  which is what makes the marker's wording true.

  The budget is `CHAPTER_READ_BUDGET_RATIO` (2.5) × the story's own `memoryConfig.tokenThreshold`,
  not a number chosen here: a chapter _is_ roughly `tokenThreshold` tokens by construction, since
  `ChapterBatchPlanner` accumulates entries until it crosses it. So it reads as "about 2.5 chapters"
  and scales with the user's setting. Token counts come from `metadata.tokenCount`, stored per entry
  when it was written, so the bound costs a sum of integers rather than a tokenizer pass.

- **A question whose chapters are a subset of another's is answered from that group.**
  `groupByChapterCoverage` folds them together, so a question about chapter 18 and one about 17-19
  assemble and send chapter 18's text once instead of twice. Strictly subsets — unioning merely
  overlapping sets would widen both and make every member pay for a chapter it did not ask about.

  **Only while the wider group fits the budget.** "A subset is answerable from the superset's
  content" holds only if that content is sent whole, and the read above is cut from its highest
  chapter down — so a question about chapter 19 folded into {17,18,19} could be answered from a
  text that stops inside chapter 18, where alone it would have had the entire budget for chapter 19. `runTimelineFill` therefore passes a predicate: a candidate host whose own chapters exceed
  `maxChapterTokens` stops absorbing narrower questions. Identical sets still fold either way —
  they get the same truncation whether they share a call or not, and two open-ended questions
  both resolve to every chapter.

- **An unanswered question does not reach the narrator.** `answerQuestionWithContent` returns
  `confidence: 0` for both give-up paths (a failed call, and no chapters resolved), and
  `runTimelineFill` drops those responses — otherwise `buildChapterSummariesBlock` writes them into
  the prompt as `A: Unable to answer the question.` under a heading claiming the material is
  relevant to the current scene.

## Activation Tracking and Stickiness

Both selection services carry an entity forward for a few story positions after it was last
activated, so context does not vanish the instant its "always include" condition stops holding.
The fading priority band is shared (`retrieval/stickiness.ts`); the durations per type are not.

The unit is **story positions, not turns** — positions come from `story.entries.length`, and a
turn appends both an action and a narration, so a duration of N covers roughly N/2 turns. The UI
converts for display; the services stay in positions because that is what they measure.
Activations are persisted per story under `lorebook_activation_<storyId>` and restored on load.

What creates an activation is Tier 2 and a _chosen_ Tier 3 — see the Tier 3 note above for why the
wholesale branch does not. The timer is **not** refreshed while an entry is sticky, and cannot be: a
sticky entry sits in Tier 1, Tier 1 is excluded from the candidate pool, and only Tier 2/3 record.
So an entry named every single turn still drops out when its window expires and is re-matched the
turn after. That is deliberate — it is what stops a once-relevant entry pinning itself in the prompt
forever — but it makes the duration a hard ceiling on continuous presence, not a sliding one.
