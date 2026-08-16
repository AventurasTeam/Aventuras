# Lore Management and Duplicates

The one agent that writes to the Lorebook on its own, and the worklist it shares with the user.

## Duplicate Entities

Two pools accumulate duplicates, and until recently only one of them was looked at.
`src/lib/services/duplicates/` now owns both: `names.ts` is the comparison itself (exact
name, shared alias, token containment, length-scaled edit distance, grouped transitively),
`index.ts` applies it per pool and filters what the user has already ruled on. Its own
service and not a corner of the lorebook's, because `ai/lorebook`'s barrel pulls in the SDK
and through it a rune store, which no plain module can be imported alongside.

**Every form is compared against every form** — a name and an alias are the same kind of
evidence, and comparing only the two primary names missed an alias that had drifted or grown
a title. The comparison is by whole tokens, which is what makes it boundary-aware without a
length floor: `Ren` is a word of `Ren Wald` and is not a word of `Renwald`, so a short name
is a candidate in the first case and not in the second.

**The world state is the pool that actually grows.** The classifier mints a new `Character`
whenever the story calls someone by a different title, so one measured save held
`Baron Kaelen` and `Forge-Master Kaelen`, `Captain Vor'koth`, `General Vor'koth` and
`The Captain` — thirty-eight rows for about thirty-one people. The **Duplicates** window in
the Active Context panel is where those are resolved: one group at a time, with the members
side by side and a radio for which name survives. A group, not a pair — grouping is
transitive, and those four Vor'koth rows are one decision.

**A merge is shown before it is written**, because it deletes rows and `deleteCharacter` is
not undoable. `generation/mergeEntities.ts` builds a _plan_ rather than a result: every
field carries where its value came from — `only` (one row had it), `agreed`, `union`, or
`conflict` — and the conflicts are settled in the preview, with a third option for prose
("keep both, one after the other").

Only the defaults a machine can justify survive: a field one row has is that row's, lists
(traits, aliases, keywords) are unioned, and everything else defaults to the row the user
chose to keep. There is deliberately **no "the newer row wins"** — `characters`, `locations`
and `items` have no creation timestamp, so which of two conflicting values is more recent is
a question the data cannot answer.

The first version returned a finished object and preferred the primary field by field. It
dropped a description silently whenever both rows had one, and it put `status` outside the
user's reach entirely — any non-`active` value from any row won, so merging a character the
story had brought back marked them dead again whichever row was kept. For the lorebook the
absorbed names still become **aliases** on the survivor, which is what stops the same
duplicate being re-created.

**A dismissal is remembered, in `kept_separate`** (migration 037), keyed by normalized
**name pair** and scoped to a branch. Names rather than ids, so a later rename cannot
resurrect a settled decision; per pair rather than per group, because a group of three can
reappear as a group of two once one member is merged away. The lore agent reads the same
table — groups the user has closed never reach it — and its own `keep_separate` writes to
it, so a decision made once is not re-argued by either side.

## Lore Management

`src/lib/services/ai/lorebook/LoreManagementService.ts` is the one agent that _writes_ to the
Lorebook on its own. It runs after a chapter is created — automatically at the token threshold,
manually from the Memory view, and once per batch during `chapterizeFromBeginning` (the
SillyTavern import path) — and on demand from the **Tidy lorebook** button in the Active Context
panel (`runManualLoreManagement`, shared by both manual callers).

**Its failure mode is growth.** A model that cannot see its own past sessions re-creates what it
already wrote, so a lorebook accumulates "Kaelen", "Kaelen the Bold" and "Kaelan" and never loses
one. Several things hold that down, and only the last is optional:

- **Deletes and merges are applied.** They used to be approved by the tool, logged, and then
  dropped — the session's change loop handled `create` and `update` only — so every run
  re-proposed the same consolidation it had already "done". `merges` and `deletedEntries` now
  come back with the result and reach the caller's existing `onMergeEntries` / `onDeleteEntry`.
- **Changes land in the snapshot as they are made.** The array the tools read is the array the
  session mutates, so an entry created on step 2 is addressable on step 3, at the index its tool
  result reported. It is never spliced: the model holds indices from the prompt and from every
  result it has read, so a delete keeps its slot and joins `removedIndices` — refused by
  everything that takes an index.
- **`create_entry` refuses a name that already exists**, matching on names and aliases through
  `foldName`. The refusal says to update that index instead. The vault assistant does not
  get this guard: there a human reads the change before it lands.
- **An index outlives the array it came from.** `create_entry` and `merge_entries` append, so
  the agent legitimately holds indices past the end of the list the session started with, and a
  delete leaves its slot in place rather than shifting everything under it.
  `lorebook/sessionChanges.ts` owns that mapping: one slot per index, each knowing whether
  writing it back means an insert, an update, a merge or nothing at all. That is what makes a
  create-then-update land as one create, an update-then-delete land as one delete, and a second
  update to the same entry keep the first — all of which were silently dropped when the write
  side looked the index up in the original list, after the tool had already answered
  `success: true`. A merge also carries `hiddenInfo` from every source, since the agent is never
  shown the field and cannot carry it itself.
- **The entry tools do not take a `lorebookId`.** A story's lorebook is not an entity with an
  id — it is the `entries` rows for a story and a branch, and the branch-resolved view of them
  is what the service passes in. The id belongs to the Vault, where there really are several
  lorebooks to choose between. Left in the schema it was not merely unused: a parameter that
  exists asks to be filled, and a measured run invented `"lorebook_1"` on every call.
  `resolveTargetEntries` answers an unknown id with an error, so every read and edit tool
  failed while `create_entry` — the one that does not validate it — went through. An agent
  that can only create is an agent that only grows the lorebook. It is stripped by
  `withoutFields`, the same mechanism that removes `injectionMode`.
- **Duplicate candidates are found in code, before the call**
  (`src/lib/services/duplicates/`: `names.ts` is the comparison, `index.ts` runs it over a
  pool and drops what has already been dismissed), by exact name, shared alias, token
  containment and a length-scaled edit distance, grouped transitively. The list goes into
  the prompt as a worklist. Under **Require duplicate
  consolidation** (Advanced → Lore Management, off by default) `finish_lore_management` also
  refuses to complete while a group is unresolved — which is why the loop stops on
  `stopOnCompletedTerminalTool`, reading the tool's answer rather than its call. The refusal is
  capped at two: the agent may be right that the groups are distinct, and a run that cannot end
  returns nothing. `keep_separate` is how it says so, and it must name **every** index of a
  group: closing on one shared index dismissed neighbours the agent had never read. An index a
  merge or a delete has already consumed counts as named — the worklist stops printing those,
  so demanding them back would leave any group that survived a consolidation impossible to
  close. `groupIsSettledBy` and `formatDuplicateGroup` sit together in `duplicates/names.ts`
  for that reason: they are the two halves of one rule, and drifting apart is what deadlocked
  the run.

  **Resolved means the group collapsed**, not that a member was touched. An update is what the
  agent does anyway on its next task, so counting it opened the gate without consolidating
  anything — a group is open until deletes and merges have left it one surviving member.

The setting gates only the obligation. The worklist and the create guard cost nothing and are
always on.

**One session per branch at a time**, enforced in `LoreManagementCoordinator` and not in the UI.
Three callers can start one and none of them sees the others; two agents on one lorebook write
over each other, because each takes an index snapshot at the start and edits by index. The lock
is at the funnel they all pass through — `ui.loreManagementActive` could not be it, since it
lingers two seconds after a run so the summary can be read. Keyed by branch rather than story,
because a branch has its own resolved view of the entries. The same reasoning covers chapters:
a turn's background tasks create one, so `ui.backgroundTasksActiveFor(storyId, branchId)`
disables **Create Chapter Now** and `createManualChapter` refuses outright, or two chapters get
built over overlapping ranges of the same entries.

**The session's inputs are read when it starts, not when the turn did.** Everything in them
moves during a turn: the classifier writes lorebook entries, and the chapter check that decides
whether lore management runs at all creates the chapter. A snapshot taken up front handed the
agent a lorebook missing what was just classified, a chapter list missing the chapter that
triggered the run, and a "recent story" still holding the entries that chapter had absorbed. Both
the background path and the batch importer now pass a thunk.

`query_chapter` here shares `ChapterQueryBudget` with the retrieval agent — see
[Agentic Retrieval](context-injection.md) — at its own allowance of six per session, and with no
`grep_chapters` to name in the refusal. It does **not** echo the chapter summary back: every
summary is already in the instructions untruncated, so returning one is the same text twice in one
prompt, which is the reason there is no `list_chapters` either.

**There is no `list_chapters` tool.** The prompt carries the complete chapter list with
untruncated summaries, so the same material never exists in two places for the agent to
reconcile — the rule `AgenticRetrievalService` already follows. A measured run spent two of its
five steps calling the tool and injecting 47,000 characters of summaries it had already been
given, because the prompt's copy was cut to 200 characters and the tool's was not. Removing the
cut is what costs: on a 41-chapter story the block goes from ~9k characters to ~47k. It is worth
it because those summaries are this task's input (the median summary is 1,223 characters, so the
cut showed 16% of one), because the block is the cacheable head of the prompt, and because the
only other way to recover the missing text is `query_chapter` — a whole chapter read by a second
model. **`list_entries` went the same way, and for the same reason.** The prompt already carries every
entry with the index the tools take, so the only thing the tool could add was the list _after_
the session had changed it — and capped at twenty rows it answered that with a fifth of a large
lorebook and no way to page, which a model reads as "the rest is gone". What it was really being
asked was "where did my own work land", and `create_entry` and `merge_entries` now answer that
directly: both report the index their result was appended at, and a merge also names the indices
it consumed. The agent follows the index space from its own results. The tool stays on the vault
assistant, which browses several lorebooks and has no list in its prompt — where it is
deliberately **not** `search_entries`: that tool addresses entries by id, and every write here
goes by index, so mixing the two addressing schemes is how the `lorebookId` bug happens again.

**What each field is for is a contract, and it is split between the code and the prompt.**
`EntryRetrievalService` matches an entry's name, its aliases _and_ its keywords against the
scene, all three, on word boundaries — so those three fields are one budget, and two mistakes in
them are decidable rather than debatable: an alias identical to the entry's name, and a keyword
that repeats the name or an alias. Neither can ever add a match. `lorebook/entryFields.ts` drops
them on the way through `create_entry`/`update_entry` and reports what it dropped in the tool
result, so the model reads the rule applied to its own output; nothing is rejected, because
losing a whole call over one redundant keyword is the failure this file exists to avoid. The
comparison is `foldName`, which folds case and punctuation but keeps articles — `"The Citadel"`
and `"Citadel"` are the same subject but not the same trigger, which is `normalizeName`'s
distinction to make, not this one's. `foldName` is also what `create_entry`'s duplicate refusal
matches on, deliberately and not `normalizeName`: the detector is lenient because being wrong
there costs one question, while being wrong in a hard refusal costs an entry.

Both fold on `\p{L}\p{N}`, not `a-z0-9`. An ASCII class folds every Cyrillic, Greek and CJK
name to the empty string, and empty compares equal to every other one — which made two
unrelated characters read as duplicates, and, through `sameEntityName`, collapsed the whole
world-state cast of a non-Latin story into its first member.

Everything requiring judgement stays in the prompt, where the field contract is written out: a
name is the form the story actually uses (never `Name / Title`), other forms are aliases, and a
keyword must be a term written in the story — never a common word like `guard` or `loyalty` that
matches ordinary prose and puts the entry in every prompt, never a phrase the model composed
(matching is literal), never another entry's name. Descriptions describe their own subject in the
present, without parenthetical glosses or chapter recaps that the chapter summaries already
carry.

**The prompt is ordered for prefix caching** like the narrator's: chapter summaries first (they
change only when a chapter is written), then the entry list, then the duplicate worklist and the
recent story. Entries are listed oldest-first for the same reason — a new entry appends instead
of shifting every line under it — and that order is also what makes the indices stable within a
session. Blacklisted entries (`loreManagementBlacklisted`) are filtered out of the pool
entirely; showing them was worse than useless, since the agent cannot act on one but can
re-create it.

**An agent with no story text must not create.** Chapters are the usual material, but a manual
run can happen before any chapter exists, so every caller passes `recentEntries` — the
un-chapterized tail, bounded by `runLoreManagement` to
`recentStoryBudgetChars(tokenThreshold)` — the same `CHAPTER_READ_BUDGET_RATIO` (2.5) a chapter
read uses, converted to characters at ~4 per token, so it reads as "about 2.5 chapters" on both
sides and scales with the user's own setting rather than sitting at a fixed 16,384. It was
hardcoded to `[]` on all three paths. With
neither chapters nor a tail, the prompt says so and restricts the run to consolidating what is
already written; anything it "identified as missing" would be invented.

**Characters, not entries, and through the same helper the retrieval tail uses**
(`splitRecentTail`). An entry count is not a budget: ten entries is 1,000 characters of terse
exchanges or 27,000 of long prose, and what is being bounded is the prompt. The floor of
`MIN_RECENT_ENTRIES_FOR_LORE` (5) is not belt and braces — measured entries averaged 2,688
characters, so a character budget alone can collapse to the player's last action.

All three callers go through `LoreManagementCoordinator` with the same
`buildLoreManagementCallbacks(scope)`, which is the only place that says what a lore change does
to the story. Each used to write those five callbacks out itself, and they had drifted — one
merged by passing the entry whole, another by copying fourteen fields by hand.

**The callbacks are bound to a story branch, and refuse to write outside it.** They go through
the `story` store, which always means _the story that is open now_, while a session is long and
unattended — started by a turn or a batch import, still running when the user opens something
else. So the caller passes the branch it started for, every store-touching callback checks it,
and a mismatch throws: the coordinator reports the session failed and it stops at the first
stale write, rather than landing one lorebook's decisions in another's. `getKeptSeparate` and
`onKeepSeparate` need no check — they address the database with that same scope directly.
A merge writes the survivor before deleting what it absorbed, like the duplicates window, so a
failed insert cannot leave the sources gone.
