# Chapter-close pipeline

When the open region crosses the per-story
[`chapterTokenThreshold`](./cadence.md#user-tunable-knobs) (default
24k) AND `chapterAutoClose=true`, OR when the user manually triggers
chapter close at any time, the chapter-close pipeline fires.
[`data-model.md → Chapters / memory system`](../data-model.md#chapters--memory-system)
remains canonical for the trigger and atomic-commit shape; this
section details the phases.

Phases 1–4 commit under one chapter-close `action_id` for atomic
rollback; a single CTRL-Z reverses the entire close. Phase 0 is **not**
in that batch — the passes it chains hold their own `action_id`s with
`source = periodic_classifier` (see
[Phase 0](#phase-0--catch-up-passes)).

An auto close chains after the turn that crosses the threshold, behind
that turn's pass when one is due, and holds the user-edit gate. A head
reversal (regenerate, swipe, an edit of the head turn, CTRL-Z of the
turn, rollback) and Cancel interrupt it, as they interrupt a pass: the
close is cancelled, its writes reversed, and it runs before the next
turn instead, with a toast saying so
([`classifier.md → Pipeline framing`](./classifier.md#pipeline-framing)).

The lore-management agent runs phases 3 and 4 as ordered tasks, each a
native tool-calling conversation: it reads the world through tools and
emits its writes as tool calls, which land as they run. A write refused
is handed back to the agent, which corrects or drops it, rather than
failing the close ([The agent](#the-agent)). What it writes beyond
phases 2–4's columns is the
[authorship contract](../data-model.md#authorship-contract)'s
chapter-close rows; see [3f — world upkeep](#3f--world-upkeep).

| Phase                     | Mode      | Drives                                                                                                           |
| ------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| **0. Catch-up passes**    | Both      | Bring periodic classifier current to chapter boundary                                                            |
| **1. Boundary selection** | Auto only | LLM picks a natural ending entry within the open region                                                          |
| **2. Chapter metadata**   | Both      | LLM emits title / summary / theme / keywords for the `chapters` row                                              |
| **3. Lore management**    | Both      | Lore, identity compaction, stackable normalization, awareness pin tuning, happenings consolidation, world upkeep |
| **4. Lifecycle review**   | Both      | Demote `active → retired` on chapter-scope evidence                                                              |

## The agent

Code holds the plan and the model does one task at a time. A multi-step
loop uses the provider's native tool calling, which models' chat
templates render their own way and models are trained on; the boundary
and metadata calls stay single structured replies.

### Run order

1. The catch-up passes ([Phase 0](#phase-0--catch-up-passes)).
2. Boundary selection, on an auto close.
3. Metadata, which writes the `chapters` row and each entry's
   `chapter_id`.
4. Stackable normalization, in code.
5. The Happenings task, once the range embed and clustering, in code,
   have found its clusters ([3e](#3e--happenings-consolidation)).
6. For each [part](#parts) of the chapter, the Lore, Identity, Threads,
   Upkeep and Lifecycle tasks.
7. The Awareness task.
8. The `retrieval_count` reset, in code, then `close_report`
   ([Review](#review)).
9. Display translation of what the close changed.

Embedding isn't a close step: writes flag rows stale, and the sync stage
before the next turn's retrieval embeds them
([`retrieval.md → Compute lifecycle`](./retrieval.md#compute-lifecycle)).
The one exception is 3e's clustering, which embeds first.

| Task       | Sub-jobs                                  | Reads the prose | Starts with                                                                                                                                                                                                                                    | Tools                                                                                              |
| ---------- | ----------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Happenings | [3e](#3e--happenings-consolidation)       | No              | The clusters code found, each row with its cast and who knows it                                                                                                                                                                               | `read_row`, `read_turns`, `merge_happenings`                                                       |
| Lore       | [3a](#3a--lore-creation)                  | Yes             | Lore titles, and the writes so far                                                                                                                                                                                                             | `read_row`, `create_lore`, `update_lore`                                                           |
| Identity   | [3b](#3b--identity-compaction)            | Yes             | Slow fields of the entities the part touches                                                                                                                                                                                                   | `search_world`, `read_row`, `update_character`, `update_faction`                                   |
| Threads    | [3f](#3f--world-upkeep)                   | Yes             | Open threads                                                                                                                                                                                                                                   | `read_row`, `update_thread`, `merge_threads`                                                       |
| Upkeep     | [3f](#3f--world-upkeep)                   | Yes             | Rows the part names, by name or keyword, that aren't in its scene or retired; places and items in its scene, not retired, with no keywords or a blank description; its happenings not yet common knowledge                                     | `search_world`, `read_row`, `update_place`, `update_item`, `set_keywords`, `mark_common_knowledge` |
| Lifecycle  | [Phase 4](#phase-4--lifecycle-review), 3f | Yes             | Active characters and items in the part's scene; active characters, items and factions it names, by name or keyword, and the active factions of the characters it holds; less characters a reply past the part has in its scene. Never a place | `search_world`, `read_row`, `retire_entity`, `flag_duplicate`                                      |
| Awareness  | [3d](#3d--awareness-pin-tuning)           | No              | The chapter's rows, the high-frequency set and the chapter's summary                                                                                                                                                                           | `read_turns`, `set_pin`                                                                            |

Happenings runs first so later tasks read the merged rows, and Awareness
last, once the merges and the chapter's other judgment are done. A task
with nothing to start from makes no call. Tuning can move a job between
tasks; the bound to keep is six tools a task.

### Conversations

Each task is its own conversation. The system half holds the
instructions every task shares, including that this is an automated
system no one answers, and for a prose task the chapter or part (the
Happenings and Awareness tasks, which don't read the prose, hold the
instructions alone); the user half holds the
task's instructions, its starting rows and a code-built list of the
writes so far. Nothing task-specific goes in the system half: a prompt
is reused up to its first difference, so that would cost the chapter's
cache at every task. Holding the chapter there is the one exception to
the [stable system half](../architecture.md#system-and-user-halves): a
close's is stable across a part's tasks, not across the story. On a template that puts the tools first (GLM, Qwen,
MiMo and Kimi among those checked) a task's own tool list already costs
it, which the switches below trade against.

A task ends when a reply finishes normally with no tool call, and the
next task arrives as a user message. The model's own message goes back
as the provider SDK returned it, keeping its reasoning and calls, so the
reasoning goes back on every step with no per-model logic. A step's
answers, the SDK's and the loop's, go back as one tool message in the
order of the calls, since a provider's chat template may label a result
by its tool alone.

Two switches on the agent profile, under a "Chapter close" label, choose
the shape:

- **`closeConversation`**: `split` (default), a conversation per task,
  or `single`, one conversation holding every task. A single conversation
  needs a large window, and keeps only the model's memory of what it
  read: split sends fewer input tokens under any pricing. If it outgrows
  the window it carries on in a fresh one with the list of writes so
  far.
- **`closeTools`**: `separate` (default), each task's own tools, or
  `shared`, every tool on every task, which keeps the chapter cached on
  any template at some cost to a weak model. Disabled under `single`,
  where a list that changed would invalidate everything after it. Code
  refuses a tool outside the task and hands that back.

A story's model override names a model, not a profile, so it runs on the
defaults.

### Parts

A prose task reads at most half the model's window at a time, or 32k
tokens when the window is unknown. A longer chapter is cut into parts
between turns: a player's turn stays with the reply after it, since the
reply decides what the turn did, so no part ends on one. A turn over
the limit is a part alone, sent whole: a reply with the player's turn
before it, or an entry on its own such as the opening. Each part runs
the prose tasks in turn, which keeps its cache warm; under `single`,
each part is one conversation. Chapter-wide limits hold across parts,
and each part sees the writes so far. A part's writes cite only
its own turns: a turn of another part is refused as one outside the
chapter is, since the part never showed it. A part leaves alone what a
later part's turns wrote
([Tools and writes](#tools-and-writes)).

On a long chapter no single call sees the whole arc, and a rule refined
under another name in a later part can land as a second lore row, which
the review shows. Only chapters too big to send whole pay this.

### Tools and writes

- **`search_world`** matches names and keywords and returns ids with a
  line each, for what code can't pick out, such as "the capital". It
  answers at most 20 matches, best first (an exact name or keyword before
  a partial one), with a count of those omitted.
- **`read_row`** returns the fields the task may write. A row a task
  starts with counts as read when the start shows every field the
  task's tools write on it, and so does a row it creates. Lore's start
  shows titles alone, so a lore row takes a `read_row` before
  `update_lore`.
- **`read_turns`** is for the two tasks without the prose. It returns
  any turn of the branch up to the end entry, `system` rows aside, as
  the prompt shows it, at most ten a call, and names the rest as
  unread: a high-frequency awareness row can come from any chapter.
  Citations stay inside the chapter. A turn of an earlier chapter is
  readable once a listed row's learned-at turn names it, which gives
  it a handle.

Every write carries `turns`, the cited turn ids, and `why`, one sentence
the review shows. The latest cited turn anchors the write's
[user precedence](./cadence.md#user-edits-and-classifier-writes). Row ids
are the prompt's short ids, as in a pass; a placeholder in a text field
is named before it lands
([`classifier.md → ID handling in classifier output`](./classifier.md#id-handling-in-classifier-output)).
A turn id names no row, so a text field the close stores that holds one
of its turns is refused, and so is a `traits`, `drives` or `agenda` list
with an entry that does, and a keyword it adds holding any id it shows:
a stored `t3` would name another turn in a later prompt, a stored row
id another row. Turns are cited in `turns`; a `why` only the review shows keeps them as written.

A write returns one of three results:

- `ok`, with the new id on a create. A value already stored is `ok` too,
  with nothing written: the model isn't wrong, and nothing was lost.
- `rejected`, with the reason and what to do: the row wasn't read, it
  cites nothing or a turn outside the chapter or its [part](#parts),
  it's over the lore cap or over a soft cap and longer than the stored
  list ([3b](#3b--identity-compaction)), it removes a keyword the user
  added, it breaks a rule of its sub-job, or the row moved or went
  since the task read it, saying where it went.
- `skipped`, when the field stands and a retry won't help: the user wrote
  it after the cited prose, or a later turn did, or it is a pin the user
  ever set ([3d](#3d--awareness-pin-tuning),
  [3e](#3e--happenings-consolidation)).

**A close leaves alone what later turns wrote.** A close runs after the
turns past its chapter but anchors before them, so it skips a field one
of them wrote, whichever writer it was, and a merge touching a row they
touched is `skipped` whole. A rollback's undo would otherwise write over
the close, and older chapter evidence over a newer fact. Those turns
fall in the next chapter, whose close reviews the same rows. A
[part](#parts)'s task leaves alone what a later part's turns wrote on
the same grounds: they are newer evidence than any turn it read, and
the later part's tasks read them. It gives up an earlier part
correcting a wrong later write, which stays until the user or a later
close fixes it. A row a later part's turn created counts as written in
every field, so an earlier part writes nothing to it, and detail only
the earlier part's turns hold is lost to the close.

A write counts as a later turn's when it anchors past the task's last
turn, the end entry for the last part and a chapter-wide task, or has
no anchor and belongs to a turn past it. A `retrieval_count` bump
doesn't count, or most merges of recently retrieved rows would be
refused. The reset is exempt too: a count is a frequency signal, and
the edge a stale one leaves is recorded in
[3d](#3d--awareness-pin-tuning). A `chapter_close` delta doesn't count
either, so this close's earlier writes, which anchor on the end entry,
never read as a later part's, and work a divider-only removal kept
([Deleting a chapter](#deleting-a-chapter)) doesn't read as a later
turn's when the chapter closes again.

A step's calls run in order, and each lands all or nothing on failure.
Precedence doesn't fail a call: when some of its fields are protected,
or one of its writes is refused and another lands, what can land does,
and the result is `ok` naming the fields that didn't, each with its
reason. When nothing lands, the result is `rejected` with the first
refusal's reason, else `skipped` with the first protection's, and a
field lost for another reason is still named with its own. A merge is
the exception and skips whole ([3e](#3e--happenings-consolidation)).

### When a task stops

A task's budget is 24 steps per part, tuned in play. Each step's output
is bounded by the profile's max output, else 8k tokens, since a model
can reason through its whole limit and never reply. Each call is bounded
as a pass's is
([`classifier.md → Failure policy`](./classifier.md#failure-policy)),
and a step's one retry after a cut-off or a filter stop is bounded
afresh: the cut attempt is the one most likely to have spent the first
bound, and a second cut only stops the task where an expiry would fail
the close.

Three things stop a task early. It keeps what landed and the review says
so:

- It reaches its budget.
- Its conversation outgrows the window partway through. A task's first
  call not fitting is a failed call instead.
- A reply is cut off or stopped by a filter, and again on its one
  retry. Neither counts as a finished task, whatever it holds.

### Logs and anchors

Phases 1–4 share one `action_id` and `source = chapter_close`, and every
delta anchors on the chapter's end entry. A rollback past that entry
spares the close, and one into the chapter takes all of it, its
`chapter_id` stamps included
([`data-model.md → Survival anchor`](../data-model.md#survival-anchor)).
A close writes no story entries.

### Tool calling

`toolCalling` is a capability flag, detected where a catalog publishes
it and user-overridable
([`data-model.md → App settings storage`](../data-model.md#app-settings-storage)).
A close runs unless the flag is off, since many servers publish nothing
about tools. Off stops the close at pre-flight, which surfaces as any
close's pre-flight failure does: the system entry when it fails a Send
or the manual close's click, a toast otherwise
([`generation-pipeline.md → Config pre-flight validation`](../generation-pipeline.md#config-pre-flight-validation)).
App Settings warns on the `lore-mgmt` assignment long before that. A
close on a model that takes the tool list and answers in plain text
finishes every task with no writes; the review says no task called a
tool.

## What chapter-close no longer owns

Per the cadence stratification, two responsibilities moved out:

- **Staged-entity promotion** — moved to the periodic classifier.
  Mid-chapter introduction is normal narrative pacing; chapter
  boundaries are the wrong cadence.
- **Per-turn state mutations** — entirely piggyback's territory.
  Chapter-close never touches `visual.*`, `current_location_id`,
  inventory, `worldTime`, etc.

Awareness compaction also reshapes: was eager
"summarization-and-delete" of low-salience awareness rows; is now
**enforced at write time** via a `UNIQUE(branch_id, character_id, happening_id)`
constraint on `happening_awareness` plus upsert semantics in the
classifier and user-edit paths. Embedding-driven retrieval lets the
bench grow without performance pressure, and duplicates can't
accumulate in the first place. The
[Multi-axis salience parked entry](../parked.md#multi-axis-salience)
flagged the cost of eager summarization losing detail; upsert is the
cleaner shape than chapter-close sweeps.

## Phase 0 — catch-up passes

Before lore-mgmt and dedup phases run, the periodic classifier must
be current with the chapter boundary. Otherwise lore-mgmt operates
on a partial happening graph (recent turns un-classified) and dedup
can't find rows the classifier hasn't written yet.

**Phase 0 is a chain of ordinary passes.** Whatever starts a close —
a turn crossing the threshold, the user's manual close, a close owed
at the next Send, a close entry's `Retry` — starts a pass first when
entries are unprocessed, whether or not the cadence is due, with the
close still owed. A pass's `chainsTo` returns another pass while a
close is owed and entries remain unprocessed, and the close once none
do ([`classifier.md → Pipeline framing`](./classifier.md#pipeline-framing)).
A close the threshold owes keeps no record; only a manual close
records its end entry.
Each pass covers one window, up to
`classifierWindowMaxEntries` entries, so a backlog takes several, each
holding the gate. Nothing is ever in flight to drain: the passes and
the close run one after another under the gate.

**Phase-0 writes stay off the chapter-close batch.** Each pass carries
its own `periodic_classifier` `action_id` and per-fact provenance
(`deltas.entry_id`) like any pass — never the phases-1–4 chapter-close
`action_id`. So CTRL-Z of the close (an `action_id`-group reversal of
phases 1–4) leaves phase-0's facts about the surviving, now-un-chaptered
turns intact, and a later deep rollback into the chapter spares them by
the survival-anchor predicate (see
[`data-model.md → Entry mutability & rollback → Survival anchor`](../data-model.md#survival-anchor)).

**A failed pass stops the chain.** The close doesn't run over
unclassified prose: the pass runs before the next turn like any failed
pass
([`classifier.md → Failure policy`](./classifier.md#failure-policy)),
and the close, still owed, follows it.

## Phase 1 — boundary selection

**Auto mode only.** Manual user-triggered chapter close skips this
phase; the user-supplied entry is the boundary.

The boundary selection agent reads the open region's entries and
picks a natural ending — scene transition, time skip, arc-beat
resolution, or narrative pause.

**Candidates.** Code offers the turns where the chapter would hold
between half and one and a half thresholds, never the newest reply. The
lower limit stops an early pick making a tiny chapter that closes again
on the next turn; the upper limit closes a story that turns auto-close
on late in sensible sizes, one per turn. The newest reply stays out
because regenerating it, the commonest reversal, would reverse the
whole close.

A chapter ends only on an `ai_reply`, so a candidate is a reply. A
`system` entry deletes with no delta and would strand the anchor, the
`opening` is the rollback floor, and a `user_action` splits a turn. With
no candidate, the latest reply in the open region before the head is the
end, with no model call, else the head if it's a reply. A region with no
reply owes no close
([`generation-pipeline.md → chainsTo on predecessor`](../generation-pipeline.md#chainsto-on-predecessor)).

**Prompt context:**

- The candidates by position, each by its opening and closing sentences
  (compact representation; entries have no title, and full prose would
  blow context on long open regions).
- The chapter's accumulated token count and the threshold value.
- Active threads in the chapter's range.

**Output (structured):**

```
{
  end_entry_id: string,
  rationale: string  // one sentence explaining the choice
}
```

**Validation.** `end_entry_id` must be a candidate. Invalid output
triggers the standard `callWithRetry` same-prompt retry (per
[`generation-pipeline.md → Error, cancel, and retry`](../generation-pipeline.md#error-cancel-and-retry));
an unusable reply across the retry budget falls back as with no
candidate, which loses nothing. A provider failure is a failed
call. (Prompts aren't generated on the fly — the retry contract is
"same prompt, sampling variance catches transient malformed output.")

The chapter `start_entry_id` is automatically the entry after the
previous chapter's `end_entry_id` (or position 1 if first chapter).

## Phase 2 — chapter metadata

The metadata agent reads the closed range and emits structured
metadata for the `chapters` row. A chapter in several [parts](#parts)
takes one call per part for its summary and a last call that merges
them.

**Prompt context:**

- The closed range's entries (the chapter's content), or a part's
  (below).
- The previous chapter's summary, if any, for narrative continuity.
- The open threads: titles and statuses of threads that are pending or
  active. The status tells the model which one the story follows and
  which it knows of but doesn't pursue yet.
- The story's mode, since the user's turns are read by it
  ([`ui/principles.md → Mode`](../ui/principles.md#1-mode--users-relationship-to-the-story)).

A part's call reads its own part's entries, with the mode. The merge
reads no turns: only the part summaries in order, the previous chapter's
summary and the open threads, and no mode.

**Output (structured):**

```
{
  title: string,        // user-editable; LLM-suggested
  summary: string,      // 2-4 sentences distilling chapter content
  theme: string,        // short thematic tag — "betrayal" / "first contact" / etc.
  keywords: string[]    // 3-8 keywords for browse/navigation
}
```

The `keywords` here are **chapter-level browse keywords**, distinct
from `lore.keywords` retrieval keywords. Not load-bearing for v1
retrieval — embedding similarity over candidates is the retrieval
signal. They surface in the Chapter Timeline.

**Failure mode:** a call that still fails after its retries, parse
failures included, fails the close ([Failure modes](#failure-modes-and-atomic-rollback)).
The chapter's summary feeds retrieval, so a placeholder would be a quiet
loss. A create or stamp that doesn't land fails the close too: the
create and the stamps land as one group, and a chapter row must sit
over a fully stamped range.

## Phase 3 — lore management

The substantive phase: six sub-jobs, run as the [tasks](#the-agent)
above. Each task starts from its rows and reads the rest through tools,
seeing a field's current value before it writes it
([`data-model.md → Authorship contract`](../data-model.md#authorship-contract)):

- Closed range entries (the chapter's content), or a [part](#parts)'s
  for a task that runs per part.
- Existing lore rows — titles, bodies on request.
- The entities the part touches, with their state, and the rest of
  the world on request: places, items and factions off the scene.
- Happenings and awareness rows in the range, threads, and the
  high-frequency awareness set (3d).

### 3a — lore creation

**Conservative bias** — old apps erred proactive and produced lore
spam. The criterion for emitting a new lore row:

> The chapter explicitly **establishes** a definitional world-rule,
> magic system, religion, faction-charter, cosmology, or IP-specific
> terminology. "Establishes" means the prose explains how something
> _works_ or _is_, not just _mentions_ it.

| Prose                                                                                                                                                     | Lore? | Why                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| "Aria visited the temple of Vael."                                                                                                                        | No    | Visit is an event (happening), not a world-rule.  |
| "The temple of Vael is a relic of the Eldritch covenants, where blood-bound priests once communed with the Forgotten Hour through ritual exsanguination." | Yes   | Definitional explanation of a religious practice. |
| "The Aetherium was acting up again."                                                                                                                      | No    | Mention without explanation.                      |
| "The Aetherium runs on the kinetic resonance of crystalline lattices; without daily harmonic tuning by the keepers, the entire grid faults within hours." | Yes   | Definitional mechanism explanation.               |

**Output per lore creation:**

```
{
  title: string,
  body: string,        // classifier-authored; user can edit
  category: string,    // freeform: "magic-system" / "religion" / etc.
  keywords: string[],  // initial keyword set for retrieval (user can edit)
  priority: 0,         // the user's default too, so AI lore never outranks the user's
  injection_mode: 'auto'   // default; user can change
}
```

**Discipline at the prompt level:**

- **Hard cap of 3 lore creates per chapter** by default (tunable in
  app settings). Prevents runaway generation when a chapter happens
  to introduce many world details.
- **Cited evidence required.** Each lore create must include a
  one-sentence justification citing the prose passage that
  established the rule. If the agent can't cite, it shouldn't
  create. An uncited create is rejected and handed back.
- **A body, always.** A lore row without one exports a file its own
  import refuses.
- **A bounded body.** A body grows by at most 1,200 characters over the
  body as it stood before the close, across all the close's calls and
  parts, so a create's is at most 1,200 characters: the length a pass
  clamps a new row's description to
  ([`retrieval.md → What gets embedded per type`](./retrieval.md#what-gets-embedded-per-type)).
  A longer one is refused with its length, never cut, so a runaway
  loop can't land and a user's long body stays editable.
- **Existing rows too.** When the chapter establishes more about a
  rule a lore row already holds, the agent extends or corrects that
  row's body and keywords instead of creating a second, the user's
  rows included, under the precedence the citation anchors. A create
  whose title a lore row already holds, or a retitle to one, trimmed
  and case-folded, is refused, naming that row; an update's other
  fields still land.

### 3b — identity compaction

For each entity active in the chapter, the agent reviews their
identity arrays — `traits`, `drives`, `agenda` (faction-only) — the
periodic classifier first wrote when it created them,
against soft caps from
[`data-model.md → Soft caps`](../data-model.md#soft-caps--compaction-discipline)
(`traits ≤ 8`, `drives ≤ 6`, `agenda ≤ 4`).

**What the task starts with.** The characters the part's turns list in
their scene data, whatever their status, and the factions of a starting
character (`faction_id`) or named in the part's turns by name or keyword. A
character the prose only mentions is left to `search_world`.

**Operations the agent may make.** It sends each list whole
(`traits: [...]`) and code checks the soft caps, so it never plans these
one by one. A list over its soft cap is refused only when it is also
longer than the stored list, so a row already over its cap, from a user
edit or an import, can shrink, or swap entries at the same length:

| Op          | Trigger                                                                                              | Discipline                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Add**     | Chapter prose evidences a new trait/drive/agenda                                                     | Subject to soft cap; if at cap, must replace not append        |
| **Replace** | Adding past soft cap, OR new entry supersedes old (e.g. drive resolved)                              | Drop one to make room; cite which                              |
| **Dedup**   | Two entries are synonyms ("brave" + "courageous")                                                    | Merge to one; pick the more general or more evidenced spelling |
| **Prune**   | Chapter explicitly contradicts an existing entry (e.g. "former alcoholic" 10 chapters past sobriety) | Remove only when contradiction is unambiguous                  |

**Discipline:** don't churn stable identity. "Brave" doesn't get
removed because the chapter happened not to show bravery; it gets
removed only when the chapter explicitly contradicts it. An empty list
reads as left out, so the close can't prune a list's last entry.

**Beyond the arrays.** A character's `voice` and a faction's `standing`
are rewritten whole when the chapter shows them changed, and an
entity's `description` when the chapter materially changes who or what
it is (the stable boy who became the king's champion), never for
detail the state slots already carry. A blank `description`, `voice` or
`standing` may be filled when the cited turns show it, and from then on
follows the same rules.

**Cited evidence:** like lore creation, each write requires prose
citation, and the latest entry it cites anchors the write's user
precedence: a user edit made after that prose stands
([`cadence.md → User edits and classifier writes`](./cadence.md#user-edits-and-classifier-writes)).
An uncited write is rejected and handed back.

### 3c — stackable normalization

Across every character's `state.stackables` record on the branch, code
folds variant spellings of one fungible onto one key, per
[`data-model.md → Soft caps`](../data-model.md#soft-caps--compaction-discipline):

- Each key folds as the stackable writers fold one, by case and
  spacing, counts summed: `Gold` and `gold` become `gold`.
- A plural then folds onto a singular some record on the branch holds.
  The key's last word tries `-ies` to `-y`, then `-es`, then `-s` but
  never `-ss`, and the first form a record holds wins: `arrows` joins
  `arrow` when someone holds `arrow`, and `glass` alone stays. The
  `-es` ending folds onto its stem only when the stem ends in s, x, z,
  ch, sh or o, so `torches` joins `torch` and `capes` never reads as
  `cap`. One step only, and a key another key folds onto stays put:
  `{ buses, bus, bu }` becomes `{ bus, bu }`. A singular ending in
  `s` also folds onto a held key one `s` shorter, `{ bus, bu }`
  becoming `{ bu }`: a false fold, accepted as rare.
- A record the user wrote after the end entry, or a later turn wrote,
  is left whole: folding some of its keys would bring an old spelling
  back beside the user's. A record whose folded form would break the
  schema's bound on a stackables key, which lowercasing can lengthen
  past 40 characters, is left as stored, and so is one holding a
  `__proto__` key before or after folding, which an undo can't restore.

Every record that changes lands in one group anchored on the end entry,
and its undo yields whole to a later write of the record
([`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)).
Abbreviations and synonyms, such as `gp` or `coin` beside `gold`, are
beyond it: LLM-driven semantic merging is parked; if real usage shows
the algorithmic floor isn't enough, escalate.

### 3d — awareness pin tuning

The agent reviews awareness rows from two sources:

- **Closed-chapter rows** — awareness extracted during the just-
  closed range. Standard review.
- **High-frequency rows from across the story** — awareness rows
  from any chapter whose `retrieval_count`, the retrievals since the
  last close, puts them among the top N. Surfaces rows that the
  classifier originally severity-judged conservatively but that
  retrieval has been picking up consistently.

The agent does **not** see individual `retrieval_count` values —
just membership in the high-frequency set ("these rows have been
coming up a lot lately"). Removes the temptation to anchor on numeric
ranking; keeps the judgment narrative ("are these still load-bearing
for the current arc?") rather than data-analytical.

**Operations:**

- **Bump up** (toward 1) — for closed-chapter rows that turned out
  structurally load-bearing for chapter themes, OR for high-
  frequency rows the agent confirms are still load-bearing.
- **Bump down** (toward 0) — for closed-chapter rows that the
  classifier severity-judged high but turned out incidental.

`set_pin` writes `decay_resistance` alone, on a listed row by its
handle. Its bounds hold from the pin the Awareness start showed:

- A close raises a pin by at most 0.2 over that pin, and refuses a
  bigger raise as `pin-raise-too-large`. Within one close a pin moves
  freely between its floor and that ceiling, so a row can be tried
  again.
- A row listed only for its frequency has the shown pin as its floor,
  by the one-way rule below; this chapter's rows may go down to 0.
- A pin the user ever set is left as they set it: `skipped`, raise or
  lower, whatever turn the call cites, since a pin is the user's
  preference, not a fact about the prose. A row the user created counts
  as one whose pin they set. Other fields give way only to a user edit
  after the cited turn
  ([Tools and writes](#tools-and-writes)).

**One-way frequency signal.** The frequency-driven candidate set
only triggers consider-bump decisions, never demote-on-frequency.
Demoting "frequent but irrelevant" rows revives the feedback-loop
concern (rows that fall out of retrieval get demoted, fall out
more, eventually invisible). User-driven demotion is the explicit
path; frequency-driven auto-demotion is not a v1 feature.

**Selection mechanism for high-frequency set:** **per-chapter
counter, reset at chapter close after phase 3d commits**. Counts
accumulate during a chapter via ranker-side increments (each
injected row gets its `retrieval_count` bumped, delta-logged under
the turn's `action_id` for rollback correctness). At chapter close,
the top 20 by the chapter's accumulated counts form the set, a constant
tuning will move; the agent reviews them. After the Awareness task, the
last one, all counts reset to 0, whether or not the task stopped early:
the reset is a delta per row under the chapter-close `action_id`, all
landing as one group that
[History](../ui/screens/world/world.md#history-tab) doesn't show. Next
chapter starts fresh.

The log doesn't make the counter exact across a close, since a count
bump's undo restores the prior count by assignment. Rolling back turns
past the chapter's end that ran before the close (the close stands)
puts their pre-bump count back over the reset's 0, and CTRL-Z of the
close can give a merge's kept row ([3e](#3e--happenings-consolidation)'s
survivor) a count holding a later turn's bump. One chapter's frequency
signal is off, and no data is lost
([`triage.md`](../implementation/triage.md), "A count bump's undo can
bring back a pre-reset count.").

**Why per-chapter reset, not lifetime accumulation.** Lifetime
counts create a Matthew-effect feedback loop — early-popular rows
ossify in the top-N because their accumulated count can't be caught
by late-emerging rows, even when the late ones are more relevant
to the current arc. Per-chapter reset breaks this: each chapter's
top-N reflects that chapter's retrieval activity. A row that's
_genuinely_ load-bearing across many chapters keeps re-entering
top-N at each chapter close (accumulating bumps over time, drifting
toward dr=1.0); a transiently-hot row gets bumped once and then
falls out as the arc moves on.

The agent self-regulates within each chapter close — it sees the
row's current `decay_resistance`, so a row already at dr=0.9 with
high frequency doesn't get re-bumped unnecessarily.

Conservative bias on closed-chapter rows — don't touch most.
Only adjust when chapter context makes the original
`decay_resistance` clearly wrong.

**The start.** Rows list under their happening, each with its
character, `decay_resistance`, source, the turn it was learned at and
the list it came from; a row in both lists shows as a closed-chapter
row. The high-frequency set is every row with a count above 0, highest
first, ties by id, at most 20, read after the Happenings task so a
merge's summed counts count. It leaves out a row a later turn created,
learned after the chapter's end, and a row whose pin the user ever set
or that they created, since `set_pin` skips both; the next rows by count
take their places. It keeps the rows of retired characters. Both lists
leave out the rows of a common-knowledge happening, where a pin reaches
nothing. The chapter's summary comes with the lists. The chapter's rows
are not bounded; the size the start reaches on the dataset chapter is
measured in
[`followups.md → Tuning and play testing`](../followups.md#tuning-and-play-testing).

### 3e — happenings consolidation

Happenings can drift toward over-granularity at scale (3-6k
happenings over 60 chapters projected per
[`retrieval.md → Scale assumptions`](./retrieval.md#scale-assumptions)).
Sub-job 3e identifies clusters that should merge.

**Candidate identification (algorithmic, no LLM):**

The close first embeds the happenings in its range: the catch-up passes'
rows have no vectors until the next sync stage, and only a re-run of the
close revisits a closed range, so their duplicates would otherwise stay.
The embed takes the 300 s bound per-turn retrieval's embeds take, and an
embedder failure, the bound's expiry included, fails the close. It then
clusters happenings within the closed chapter range by:

- Embedding similarity ≥ 0.80 (cosine).
- `happening_involvements` overlap ≥ 50%: the characters two rows
  share, over the smaller cast.
- `occurred_at_entry_id` proximity: anchors at most 3 entries apart by
  position, counting the range's entries other than `system` rows.

All three criteria must hold between every two rows of a cluster, so
no chain drifts. A row with no character among its involvements, or no
`occurred_at_entry_id`, clusters with nothing. Clusters form by
strongest-pair-first complete linkage: every pair meeting all three
criteria is considered in descending cosine, ties by anchor then id,
and the clusters holding a pair's two rows merge only when every cross
pair meets all three too. Each row ends in at most one cluster, with no
size limit; a cluster of ≥ 2 rows is passed to the LLM for judgment.
The start shows each row with its cast and who knows it (a
common-knowledge row reads as known by every character), and the prompt
keeps apart happenings whose merge would tell someone something new.

**LLM judgment per cluster:**

| Decision                 | When                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Merge into composite** | Same cast + close time + complementary semantics (sequential phases, one builds on the other, parallel aspects of one event)      |
| **Keep distinct**        | Antonymous narrative meaning ("Aria swore the oath" + "Aria broke it"), different awareness implications, distinct material beats |
| **Delete redundant**     | Same event extracted twice with different framings; keep the more detailed, delete the duplicate                                  |

**Lean toward merge** on tight clusters. Cost asymmetry: under-
merging carries duplication that compounds at scale; over-merging
loses some temporal precision but composite descriptions preserve
the substantive facts. The aggressive-merge default is right at v1's
projected volumes.

`merge_happenings` covers the first and the last: a delete of a redundant
row is a merge that keeps the kept row's text. Keep distinct is no call.

**Mechanical merge:**

- `description` — composite, LLM-authored ("X happened, then Y").
- `title` — pick the more general, or LLM-authored composite. Both
  texts are cut to the bounds the app's writers keep, never refused.
- `occurred_at_entry_id` — earliest of the cluster by entry position (the
  later events' precise timing is lost; acceptable v1 trade). Of the time
  pair the merge sends only `occurred_at_entry_id`, and only when it
  moves: every clustered row has an anchor, so `temporal` stays null.
- `common_knowledge` — kept when any merged row has it: dropping it
  would hide a happening from everyone it reached.
- `category` and `icon` — the kept row's stand.
- Involvements carry over to the kept row, one per involved entity; one
  the user removed from the kept row after the cited prose stays removed.
- Awareness rows merge per-character via the
  `UNIQUE(branch_id, character_id, happening_id)` upsert: max
  `decay_resistance`, earliest `learned_at_entry_id` (by entry position,
  a missing anchor losing to any), summed `retrieval_count`, and the
  source strings joined with `; `, each once in the order first seen,
  the kept row's first. The first source stands whole and a later one
  joins only if the joined text stays within 120 characters, else it is
  skipped and the next is tried, so no stored source is ever cut. A
  user-written row's values stand when the user wrote them after the
  cited prose, and a pin the user ever set stands whatever turn is
  cited, as in [3d](#3d--awareness-pin-tuning): the kept row's isn't
  sent, and an absorbed row's protects the merge (below).
- Deleted rows are delta-logged for rollback.

**A merge lands whole, once per row.** Code checks user precedence on
every row of a merge before any of it lands, so a merge can't delete a
row while its composite is skipped: one protected row skips the whole
merge, as does a row a later turn touched. An absorbed row is protected
by a user edit of it or its link rows, a link row the user deleted
after the prose included, and by a pin the user ever set on one of its
awareness rows, whatever turn is cited: merged, the pin would move to a
row the close writes, which `set_pin` no longer reads as theirs, or give
way to the kept row's higher pin. The kept row is protected only by a
user edit of a field the merge writes, since its other fields lose
nothing to a merge. A merge can't absorb a row this close already
wrote, since redo refuses an update and a delete of one row in one
group, and CTRL-Z of the close would then be refused for good. The
agent merges everything in one call instead of in a chain.

**Conservative override:** when the LLM is uncertain about cluster
membership, default to keep-distinct.

### 3f — world upkeep

The rest of what the chapter shows about the world, which no faster
writer could see whole. Each write cites its evidence, under the same
conservative bias as the sub-jobs above:

- **Descriptions** rewritten on a material change (3b).
- **Off-scene conditions.** A place's or an item's `condition` when
  the chapter shows it changed while the scene was elsewhere ("news
  came that the capital burned"); the per-turn writer keeps the ones
  it showed.
- **Keywords.** New aliases the chapter used, including the first
  ones for places and items the per-turn writer created bare; removal
  of a keyword an AI added that no longer fits, never one the user
  added, and never one a live collision flag's pair rests on, since
  that would end a question the user hasn't answered.
- **Places.** A place's parent when the chapter places or moves it,
  and the top-level mark for an unplaced place nothing could contain
  ([`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)).
- **Threads**, as their own task. Duplicates merged, descriptions brought
  up to date, and a thread resolved or failed when the chapter settles it
  or leaves it plainly abandoned, through `setThreadStatus` with the
  latest cited turn. When the latest cited turn precedes the thread's
  opening, a status's `resolved_at_entry_id` takes the opening, as a
  pass's closing turn does
  ([`classifier.md → Threads`](./classifier.md#threads)); precedence still
  reads the cited turn. An active thread costs every turn's prompt
  until it closes ([`classifier.md → Threads`](./classifier.md#threads)).
  A merge follows 3e's rules: nothing links to a thread, so it is an
  update and a delete. The merge writes only the kept row's title and
  description; its status, entry refs, category, icon and injection mode
  stand. Absorbing an `active`
  thread is refused unless the kept row is `active` too, since the kept
  row would drop the thread from the narrator's prompt with no write
  saying so. The refusal says to keep an active one, then settle it with
  `update_thread` if the chapter resolved or failed it. Absorbing a
  thread whose injection mode is `always` or `disabled` is refused
  unless the kept row has the same mode, since the kept row's mode would
  undo the user's setting with no write saying so, and only the user
  writes it
  ([`data-model.md → Authorship contract`](../data-model.md#authorship-contract)).
  An `auto` thread may join a row of either mode. The refusal says to
  keep that thread instead, or to leave the threads apart. Every
  refusal's answer names each keep that would land; when none would, the
  refusal says to leave the threads apart. The Threads start shows a
  mode the user set beside each thread's status, as `read_row` shows it.
- **`common_knowledge`** on a happening the chapter shows has spread
  to everyone: news is a chapter-scale judgment. A wrong flag makes
  every character aware, so the bar is explicit spread in the prose.
- **Collision flags**, in the Lifecycle task. A flag on a row the agent
  judges a duplicate of another ("the hooded stranger" and Kael), for
  the user to merge. Its reason is `duplicate`, which holds while the
  partner exists, whatever the names, since the pair is usually no
  namesake pair
  ([`world.md → Surfacing`](../ui/screens/world/world.md#surfacing)).
  When either row already holds a live flag naming the other, the close
  re-marks that flag `duplicate` on the row that holds it, both rows'
  flags in one write when each names the other, so every resolve dialog
  gives the close's verdict. A flag already `duplicate` stays as it is,
  and each row's precedence guards its own flag. Otherwise the flag goes on whichever row of the pair
  is free: the row the call flags (its `id`), or, when that row's live flag names
  a third row, its partner. It is refused when both rows' live flags
  name other rows or the user already resolved the pair, or each close
  could ask the same question. The agent never merges.

## Phase 4 — lifecycle review

The agent reviews the characters, items and factions each part's
start holds ([Run order](#run-order)) and considers retirement on
chapter-scope evidence:

- **Auto-retire** when the chapter contains explicit hard-finality
  signal that the periodic classifier may have missed on single-line
  ambiguity (a death scene the classifier read as injury, the
  chapter-scope context confirms otherwise). Never a location: only
  the user retires a place
  ([`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)).
- **Surface for user review** when a character's `lastSeenAt` is
  far back AND prose doesn't explicitly justify keeping them
  active. Doesn't auto-mutate; surfaces in the World panel as
  "stale active" via derived `lastSeenAt + worldTime` arithmetic
  (no schema column needed in v1).

Conservative bias: prefer surfacing over auto-retire on weak signal.
The only auto-retire path is hard-finality signal that the periodic
classifier should have caught but didn't. A death the narration reports
as fact counts even off the scene, since the start reaches a
character the part's prose names; one a character only suspects or hears as rumour does not.
`retire_entity` is refused for a character a reply past the part has in
its scene, a later part's replies included: the evidence the part cites
is older
([Tools and writes](#tools-and-writes)). A user's turn carries the scene
it follows forward, so it doesn't count: reading it would refuse every
character who dies at a part's end.

## Failure modes and atomic rollback

The chapter-close transaction holds the gate per
[`generation-pipeline.md → Transaction lifecycle`](../generation-pipeline.md#transaction-lifecycle).
User edits are blocked.

**A close must succeed before the next turn.** A call that still fails
after its retries fails the whole close: everything reverses and the
close runs again before the next turn, as a failed pass does
([`classifier.md → Failure policy`](./classifier.md#failure-policy)).
Each close reads only its own chapter, so a skipped task would never
come back. Send owes a close whenever one is owed by the settings or a
pending manual close, read at Send, so a failure, an interrupt, a crash
and a restart end the same way, and every Send is a fresh attempt. A
manual close isn't persisted: a restart drops it, and so does a reversal
that removes its end entry.

| Phase                      | Failure mode                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **0** (catch-up passes)    | The failed pass stops the chain; it runs before the next turn, and the close follows it.                                                  |
| **1** (boundary selection) | `callWithRetry` same-prompt retry; an unusable reply falls back to the latest reply before the head.                                      |
| **2** (metadata)           | A failed call fails the close, and so does a create or stamp that doesn't land.                                                           |
| **3** (lore-mgmt)          | A refused write goes back to the task; a failed call, an embedder failure included, fails the close, as does a code step's refused group. |
| **4** (lifecycle review)   | As phase 3.                                                                                                                               |

These don't fail a close:

- A write refused or skipped, or a malformed tool call, which goes back
  to the task.
- A task with no writes.
- A task that [stops early](#when-a-task-stops).
- A display translation that fails, which stays per call
  ([`architecture.md → Graceful degradation contract`](../architecture.md#graceful-degradation-contract)).

**The cost.** A failure at the last task discards the earlier work, and
a cause that isn't transient stops the branch's turns until it's fixed.
Resuming from the failed task would keep a failed run's writes and split
the reversal group, so a close doesn't.

**User abort** at any phase, Cancel or a head reversal: the
orchestrator reverse-replays the `action_id`'s deltas and exits. UI
returns to pre-chapter-close state, and the close runs before the next
turn instead, with a toast. Same path as any in-flight pipeline
abort.

**Crash recovery** during chapter-close is the same as any
in-flight transaction — see
[`generation-pipeline.md → Crash recovery via pipeline_runs marker table`](../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table).
A reversal that can't commit holds nothing back: each of a close's writes
is cited and stands alone, so what's left is a partial close, not broken
state, and the next pass reading it is benign.

## Review

A close changes rows the user wrote or relies on, with no suggestion
queue, so the user reviews it after the fact. `chapters.close_report`
holds what the deltas don't: the close's `action_id`, each tool call's
task, rows, `why`, `turns` and result, each landed write's new value,
the writes that didn't land, and any task that stopped early. A merge
names the row that survived. It's written last, in the close's group.

A delta holds only the prior value, so old values come from the deltas
under that `action_id` and new ones from the report, cut to a bound; the
row itself has the full text. A restated value wrote nothing, so the
report holds no value for it and the review leaves it out. The review
also leaves out stamps, `retrieval_count` resets and stackable
normalization, which is code with no `why`, and a spelling cleanup. The
surface is
[`chapter-timeline.md → Review window`](../ui/screens/chapter-timeline/chapter-timeline.md#review-window).

A write counts as not applied when it was refused or skipped and the
same task didn't later land the same tool on the same row and field,
which would make it a slip the model corrected. It's judged per field,
so a partly landed call appears under both changes and not applied. The
report keeps the proposed value, cut to a bound, and its reason, so the
user can apply it by hand. A refusal that proposed no value, such as a
write to a row the task hadn't read, counts as corrected once that task
later lands the same tool on a row the two calls share, or lands that
tool at all if the refusal named no row. That can hide a slip the model
never retried behind a landing for something else, but such a slip held
nothing to apply. A field one call landed on one row and lost on another
counts as landed: it appears once, as a change, and only the model's
tool result names the loss.

## Manual user-triggered close

User can manually trigger chapter close at any time, regardless of
threshold. The user picks the end among the open region's replies
(Phase 1 skipped), the newest included: that's often where the user
means the chapter to stop, and regenerating it confirms first that the close
will re-run
([`reader-composer.md → Regenerate confirmation`](../ui/screens/reader-composer/reader-composer.md#regenerate-confirmation)).
Phases 0, 2-4 run normally, under the same gate and interrupt rule as an
auto close.

UX surface: a "Close chapter here" affordance on entries in the open
region. Clicking pre-flights the chapter-close pipeline with the
selected entry as boundary.

When `chapterAutoClose = false` AND the threshold is crossed, the
UI shows a "Ready to close" indicator near chapter management
controls, but doesn't auto-fire. User confirms the close manually.

## Deleting a chapter

Deleting a chapter undoes what its close did and leaves every entry in
place. It isn't a rollback. It's CTRL-Z of the close, still available
after later turns, and only for the latest chapter, since an earlier gap
would strand entries before a closed one. The surface is
[`chapter-timeline.md → Delete a chapter`](../ui/screens/chapter-timeline/chapter-timeline.md#delete-a-chapter).
Neither mode can be undone.

- **Delete the chapter.** The close's `action_id` group reverses: stamps
  clear, merged rows come back, and lore it created goes, even a row the
  user edited since, as any machine create does.
- **Remove the divider only.** The chapter row, its report and its stamps
  reverse, and everything else the close did stays. Those deltas stay in
  the log, anchored on the end entry, so a rollback into the range still
  takes them, and with no later turn the next CTRL-Z reverses them. The
  review goes with the row; each row's History keeps the writes.

**Later writes win.** A field keeps its value when anything logged after
the close wrote it, whichever writer, except a `retrieval_count` bump
([`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)).
A normalized stackable record a later write touched stays normalized,
since undoing it could double-count.

A later write's own undo holds the value it replaced, which may be the
close's, so rolling that turn back after a delete writes it again, and
the value before it isn't in the log. That's accepted: the order is rare,
the state stays valid, and the next pass or close corrects it.

**What follows.** The chapter's tokens return to the open region. With
auto-close on and the region at the threshold, the next Send closes
again, which re-derives the memory the delete removed. Under it, a close
waits for the region to grow. With auto-close off the chapter stays open,
and "Ready to close" shows once the threshold is met. A threshold changed
first simply applies. After a divider-only removal the same close runs
on top of the kept work, at full cost.

**Prose stays.** Turns since the chapter stay as written and can still
reflect what the close added. Full coherence is a rollback to the
chapter's last entry, then a delete.
