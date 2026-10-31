# Chapter close's agent

How a close's lore-management agent runs: its loop, tools, failure rule
and review. Designed 2026-10-31; resolves the design followup
"Chapter-close agent design" and leaves its implementation as a new
followup. The writer map it builds on is
[AI writers](./2026-10-20-ai-writers.md).

## Why

The authorship contract fixed what a close writes, and
`memory/chapter-close.md` specs its phases and sub-jobs. The agent
itself couldn't be implemented: nothing said what its tools are, how
long it runs, what a model without tool calling does, how its writes
are anchored, or how the user sees what it changed. Canon's "one tool
loop for all six sub-jobs" had also never met a real model.

## Ground truth that shaped it

- **`lib/` has no tool loop.** Every structured call goes through
  `generateStructured`, which renders its schema into the prompt. A
  phase can't get a write's outcome: `handleEvent` throws on a rejected
  write and the run fails.
- **The no-gate write phase is gone.** The developer's 2026-10-04
  direction, that an agentic run collects its changes and applies them
  at the end, rested on writes that could interleave with user edits.
  The AI writers design gated every run, and the orchestrator's own
  comment says a run's writes take no hold because no user write meets
  them.
- **Failure policy never reached the close's spec.** The 2026-10-22
  decision, that a close that fails must succeed before the next turn,
  sat in the followup while the phase table kept a placeholder summary,
  a skipped lifecycle phase and a lore phase that could commit nothing.
- **A pass's window has no equivalent for a close.** A close reads all
  of a chapter and a chapter has no upper bound, so under the failure
  policy a chapter too big for the model would stop the story on every
  retry.
- **Where tools sit in the prompt varies.** Rendered from the official
  templates with marker strings (Kimi read from its Python encoder):
  Gemma 4, MiniMax M3.1 Flash and DeepSeek V4.1 Flash put the system
  text before the tools; GLM 5.3, Qwen 3.8, MiMo V2.6 and Kimi K3 put
  the tools first. Kimi and MiMo also accept tools declared mid-way,
  through a `tools` field on a message that the OpenAI-compatible
  request shape doesn't have.
- **A prefix survives to its first difference.** Measured on the dev
  model with about 6k tokens of text standing in for a chapter:

  | Second request                              | Tokens reused  |
  | ------------------------------------------- | -------------- |
  | Same tools, chapter in the user turn        | 6,169 of 6,185 |
  | Different tools, chapter in the user turn   | 0 of 6,176     |
  | Different tools, chapter in the system turn | 6,088 of 6,181 |
  | Same conversation, one more message         | 5,968 of 5,983 |

- **Reasoning goes back by itself.** All seven families' templates
  render reasoning in the history and none refuses a history without
  it. The installed `@ai-sdk/openai-compatible` sends `reasoning_content`
  and `@ai-sdk/anthropic` sends thinking with its signature, as long as
  the loop keeps the SDK's response messages.
- **Many servers publish no usable window**
  ([`architecture.md → Detection`](../architecture.md#detection)), so a
  split decided from the window fails where it matters.

## Decisions

**Native tool calling.** A multi-step loop uses the provider's tool
calls, not a loop of prompt-rendered JSON replies. Models' chat
templates render tools their own way and models are trained on that; a
single JSON reply stays right for the boundary and metadata calls.
Rejected: _a loop of structured calls_, which reuses the retry, window
and cut-off handling and needs no capability flag, but asks a model to
do by hand what its template was built for.

**Code holds the plan; the model does one task at a time.** Tasks run
in a fixed order. A task ends on a reply that finished normally with no
tool call, and the next task arrives as a user message, with a line in
the shared instructions saying this is an automated system. Rejected:
_one conversation with every job at once_, canon's reading, which
leaves the planning to the model; and _a done tool_, since stopping is
the signal models already give.

**Two switches on the agent profile.** Split or single conversation,
and separate or shared tools, the tool switch disabled in a single
conversation, where a list that changed would invalidate everything
after it. The defaults are split and separate. The trade is capability
against cache: separate lists cost nothing on a system-first template
with the chapter in the system turn, or on a router without caching,
and cost a reprocessed chapter per prose task on a tools-first template
with a cache. Split sends fewer input tokens than single under every
pricing, cached or not, so what a single conversation keeps is the
model's memory of what it read. Only the default is tuned; the others
share its prompts. They sit under a "Chapter close" label, the profile
being the only home for a setting that depends on the model.

**Writes land as each tool runs.** The tool result is the action
handler's verdict, and later reads show the model its own writes.
Rejected: _collect, then apply_, which makes a cancel free but needs a
planned view of the rows for later checks and reads, as the pass's
planner has, and leaves a final-burst rejection with nowhere to go.

**A failed call fails the close.** A call that still fails after its
retries reverses the whole close, which runs again before the next
turn, as a pass does. Each close reads only its own chapter, so a
skipped task never comes back. Rejected: _skip the task and keep
going_, a quiet loss of the kind ruled out for passes; and _resume from
the failed task_, which would keep a failed run's writes and split the
reversal group. Not failures: a rejected write, a task with no writes,
a task that reaches its step limit, one whose conversation outgrows the
window, and a reply cut off twice. A task stopped by the last three
keeps what landed and the review says so. Retrying a close for those
would hit the same wall, or stop the story over one reasoning spiral.

**Prose tasks read the chapter in parts.** A part holds at most half
the model's window, or 32k tokens when the window is unknown, cut
between entries. Rejected: _a chapter length cap_, which overrides a
threshold the user set; and _summaries with a read tool_, which asks a
weak model to work out what to fetch. The cost is real and accepted: on
a chapter too big to send whole, no call sees the whole arc.

**A rule refined across parts keeps the plain prompt.** With part 1
creating a rule and part 2 refining it under another name, the plain
prompt on the dev model extended the row in 7 of 10 runs and wrote a
second row in 3, losing no fact. Showing the earlier row's full text
did worse (3 extended, 4 second rows, 7 nothing, of 14). A final task
comparing the close's rows merged in 2 of 10. The review shows a second
row, and this happens only on multi-part chapters. Those runs dropped
reasoning, so evaluation repeats them.

**A cut-off reply isn't a finished one.** The empty runs above were the
model reasoning through its whole output limit, 16,000 tokens in the
logged runs, and a loop that read "no tool call" as done would have
called them finished. A step's output is bounded by the profile's max
output, else 8k tokens; normal steps stayed under 3.7k.

**The tool list is per task and specific.** Seventeen typed tools, no
task listing more than six. Upkeep split into Threads and Upkeep, and
duplicate flags moved to Lifecycle, to keep that bound. Identity sends a
whole list rather than canon's add, replace, dedup and prune
operations, which a model would have to plan one by one. Rejected:
_an exact quote check on citations_, each failed match costing a step
when the review already carries trust.

**The budget is 24 steps per task per part.** It scales in a single
conversation by itself. Small tests took 2 to 4 steps, which is why it
stays a tuning constant.

**Reasoning stays in the conversation.** The loop keeps the SDK's
messages, so it goes back on every step with no per-model logic. With
it handed back the three-task test finished all three runs and the
model read before writing every time, where the runs without it had
two refused writes. The last prompt grew from about 1,000 tokens to
2,100 to 2,700, which resets at each task when conversations split.

**The flag gates only a known no.** `toolCalling` off stops a close at
pre-flight; unknown runs, since the dev server publishes nothing about
tools. Rejected: _a metadata-only close on such a model_, a loss that
lasts as long as the assignment when the fix is one dropdown.

**A close anchors on its end entry.** A rollback past the end spares
it, one into the chapter takes it all. Resolves the roadmap's M5.1 and
M5.2 deferral.

**No review flag on a happening cluster.** An unsure cluster stays
distinct. It saves a column and a surface for a case the conservative
rule already answers.

**A `duplicate` collision reason.** It stays live while the partner
exists, whatever the names, so a rename doesn't clear a pair that was
never a namesake pair.

**Boot doesn't hold a close's orphan.** Each write is cited and stands
alone, so what a failed reversal leaves is a partial close, not broken
state. A hold would stop a branch's turns over a rare fault.

**Review reads the deltas; one JSON column holds the reasons.**
`chapters.close_report` keeps the action id, each write's `why` and
`turns`, and what stopped early. `deltas` stays as it is, since every
writer uses that table. No per-change revert: reverting a merge or a
delete isn't simple, and the old value is on screen.

The review also shows what didn't land: each refused or skipped write
with its proposed value and reason, in a collapsed "Not applied" block.
A write the same task later landed on the same row with the same tool
drops out, since that was a slip the model corrected. The block is what
a lore cap or a protected field cost, which the user can apply by hand.

**An auto boundary never ends on the newest reply.** Regenerating that
reply would reverse the whole close, and it is the commonest reversal
there is. A manual close may end there: the newest reply is often where
the user means the chapter to stop, and the regenerate confirm already
says the close will re-run. Candidates are the turns where the chapter
would hold between half and one and a half thresholds. Canon had no
lower limit, so an early pick made a tiny chapter and closed again on
the next turn; the upper limit closes a late-enabled story in sensible
sizes, one a turn. With no candidate, or an unusable reply, the latest
turn before the head is the end, with no model call.

**A close leaves alone what later turns wrote.** It runs after the
turns past its chapter but anchors before them. So it skips a field one
of them wrote, and a merge refuses a row they touched. Those turns fall
in the next chapter, whose close reviews the same rows, so nothing is
lost. This one rule replaces three failures: a rollback's undo writing
over a close, which it yields to only for user edits; older chapter
evidence replacing a newer fact, a death in the chapter over a return
after it; and a merge keeping a row or carrying knowledge a rollback
then strands. The `retrieval_count` reset is exempt: a stale counter
does no harm.

**A merge lands whole, once per row.** User precedence is checked on
every row of a merge first, and any protected row skips all of it. A
merge can't absorb a row this close already wrote, since redo refuses
an update and a delete of one row in one group, and CTRL-Z of the close
would then be refused for good.

**A close embeds its happenings before clustering.** The sync stage
runs only before retrieval, so the catch-up passes' rows would have no
vectors, and 3e never revisits a closed range. An embedder failure
fails the close, as it already stops a turn.

**A pair the user resolved isn't flagged again.** Otherwise each close
could ask the same question.

**A story's model override uses the defaults.** An override names a
model, not a profile, so it has no switches or max output: split,
separate tools, 8k. Its missing settings are a new followup.

**A manual close isn't persisted.** A restart drops it, and so does a
reversal that removes its end entry.

## The design

Canonical in:

- [`memory/chapter-close.md`](../memory/chapter-close.md): the agent,
  its tasks, parts, tools and stopping rules, the failure rule and the
  review;
- [`data-model.md → Authorship contract`](../data-model.md#authorship-contract)
  and [`Survival anchor`](../data-model.md#survival-anchor): the
  anchor, the flag and `close_report`;
- [`generation-pipeline.md`](../generation-pipeline.md): the write path
  that returns a verdict, pre-flight, and what Send owes;
- [`ui/screens/chapter-timeline/chapter-timeline.md`](../ui/screens/chapter-timeline/chapter-timeline.md):
  the review window.

## Adversarial pass

- **Load-bearing: the loop at full size.** Every measurement here used
  a chapter of about 100 words, five tools and three tasks. A real
  close has 24k tokens, seven tasks and up to six tools a task. The repo
  has no realistic 24k chapter to test on, so the first real measure is
  the implementation's. Tuning carries it.
- **Reasoning spirals.** The dev model reasoned to its limit on one
  prompt shape and not on another, and nothing here explains why. The
  8k bound limits the cost; it doesn't prevent the loss of that task.
- **A failed close is expensive.** A failure at the last task discards
  the earlier work, and every Send retries from the top with no
  counter. Accepted, as for a pass, with resuming left out until play
  shows failures are common.
- **A model that ignores tools** finishes every task with no writes.
  The close commits, and the review names the likely cause. Which
  servers do this is unverified.
- **An unknown window can stop a story.** A part larger than a server's
  real window fails the task's first call on every Send until the user
  enters a figure. Growth past the window partway through only stops
  that task.
- **Reversal and anchors, checked.** The rollback predicate spares and
  takes a close as designed; abort and boot reversal handle its deletes
  and link rows; `chapter_id` stamps aren't read as content edits; a
  prose edit sweeps only `periodic_classifier` deltas inside the head
  turn, so it can't reach a close.
- **Read sites, by a fresh agent reading canon and `lib/`**, with no
  tests run. The gaps it found are in the integration plan's roadmap
  entry.

## Integration plan

- `memory/chapter-close.md`: the intro and phase table; a new section
  on the agent; Phase 1's candidates, fallback and validation; Phase
  2's parts, the placeholder removed; 3b's whole lists; 3d's reset
  order; 3e's embedding, merge rules, and "review needed" removed; 3f's
  split and `duplicate` reason; Phase 4's later-turn rule; the failure
  table; a new `## Review`; a manual close may end on the head.
- `data-model.md`: the diagram (`chapters.close_report`, the
  `duplicate` reason, `deltas.entry_id`); Survival anchor's `null` text;
  the authorship rows for flags, involvements and
  `resolved_at_entry_id`; capabilities and profile fields; fork step 2
  carries a close's deltas like a pass's.
- `generation-pipeline.md`: phase rules for a write that returns its
  verdict, `lore_mgmt_subjob_complete`, pre-flight's `toolCalling`
  gate, what Send owes, the stackables guard, the reversal passage on
  a close's merges, cut-off replies in a loop, the capabilities a
  request carries, partial failure.
- `architecture.md`: the cadence table and pipeline paragraph; the
  pre-send check counts tool messages; display translation covers what
  a close changed.
- `memory/cadence.md`, `memory/README.md`, `memory/edge-cases.md`,
  `memory/classifier.md`: the layers row, the index line, the reason
  list and the live-flag rule; a later turn's write stands against a
  close.
- `ui/principles.md`, `ui/patterns/toast.md`,
  `ui/patterns/delta-log-row.md` (its Used by gains the Chapter
  Timeline), `ui/patterns/collision-resolve.md`.
- `ui/screens/world/world.md` and `.html`: the `duplicate` reason, its
  pairing and copy.
- `ui/screens/chapter-timeline/chapter-timeline.md` and `.html`:
  `Review changes` and the review window, phone included.
- `ui/screens/reader-composer/reader-composer.md` and `.html`: the
  review toasts, a failed close and its table rows;
  `reader-composer/rollback-confirm/rollback-confirm.md`: a chapter that
  ends past the target. `ui/foundations/mobile/layout.md`: the review
  window's binding.
- `ui/screens/app-settings/app-settings.md` and `.html`: the tool
  badge, the `lore-mgmt` warning, the two switches, and a note by the
  context window setting that a small window splits chapters, which can
  lower a close's quality. `ui/screens/diagnostics/diagnostics.md`: a
  close's run length.
- `parked.md`: the chapter-close cascade passage; "The classifier can
  read a window holding un-reversed writes" loses its open case; the
  keyword-undo entry's signal; the "delete redundant" and live-signal
  passages.
- `followups.md`: "Chapter-close agent design" removed; "Tune the
  close's agent" added under Tuning and play testing; "Story model
  overrides carry no settings" added under UX.
- `implementation/roadmap.md → M5`: the M5.2 notes gain the
  implementation list: a phase write that returns its verdict and
  reports skipped writes per action; the window check counting tools,
  tool calls, results and reasoning; the loop dispatching a step's
  calls itself, in order; CTRL-Z skipping the running close's deltas so
  it interrupts; `stillPaired` for `duplicate`; merges and their
  awareness counts; a close's failure surfaces, written today for a
  pass; a stale deferred close clearing when none is owed; tool calls
  in the stub provider and the mock LLM; the capture cap and progress
  events. Its two `createStoryEntry` notes go, since a close emits none,
  and the anchor deferral resolves.
