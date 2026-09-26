# Story Time

How in-story time is recorded, checked and corrected. The code is under
`src/lib/services/storyTime/`; the store side is the "Time anchors and reconciliation" section of
`stores/story.svelte.ts`, and the screens are `components/world/Timeline*.svelte`,
`TimeAnchorModal.svelte` and `EntryTimeModal.svelte`.

## The register and its copies

Story time is a relative clock, `TimeTracker { years, days, hours, minutes }`, counted from zero and
shown counted from one: `{0, 3, 14, 30}` reads `Y1 D4 14:30` (`formatStoryTime` / `parseStoryTime`).
There is no calendar. Arithmetic goes through total minutes (`toMinutes` / `fromMinutes`), and
`normalizeTime` carries overflow upward, so every value that is stored is normalized first.

`stories.time_tracker` is the register. Every other stored time is a copy of it, taken at some moment:

| Copy                                        | Taken when                                  |
| ------------------------------------------- | ------------------------------------------- |
| `metadata.timeStart` on an entry            | the entry is added (`addEntry`)             |
| `metadata.timeEnd` on a narration           | classification has advanced the clock       |
| `worldStateDelta.previousState.timeTracker` | the entry's delta is recorded, for rollback |
| `chapters.start_time` / `end_time`          | the chapter is written                      |
| `checkpoints.time_tracker_snapshot`         | the checkpoint is taken                     |

Classification advances the clock by one of four buckets — none, 15 minutes, 2 hours, 1 day — and a
failed classification counts as none. A player action is an instant: its start and end are the same
moment, and it never carries a duration or a weight anywhere below.

A zero clock and an absent one are written identically by `addEntry`, so a stored zero cannot be read
as either. Detection treats it as suspect, never as proof.

## Detection

`analyzeTimeline` is read-only and reports findings with a severity. The distinction matters more
than the list:

- **defect** — provable from the stored data: `missing-stamp`, `reversed` (an entry ends before it
  begins), `backwards` (ends before the entry before it), `overlap`, `chapter-span-disagreement`;
- **suspected** — worth a look, may well be fine: `suspect-zero`, `gap` (time between two entries
  that neither claims, as often a skip as a loss), `implausible-jump` (a day or more inside a short
  entry), `flatline` (a long run in which no time passes).

## Anchors

An anchor (`time_anchors`, one row per entry) is the reader asserting when an entry ended. It is the
only stored time that is not a copy of the register, and the only one a reconciliation never
changes. Anchors are passive: setting one writes nothing else. The dialog refuses a player action,
which has no ending of its own.

Anchors belong to the story, not to a branch. An anchor binds to an entry and the entry carries its
branch, so a branch that inherits an entry inherits the assertion made about it. The store loads the
story's anchors and filters to the entries in view where it counts them.

`ON DELETE CASCADE` on `entry_id` is safe only while no path deletes an entry and re-inserts it under
the same id: such a restore would silently drop every anchor on the re-inserted entries.

## Boundaries and ranges

A reconciliation fits the entries between two **boundaries**. One rule resolves every boundary: it
names an entry and stands for that entry's ending — the anchor's time when anchored, the recorded
`timeEnd` otherwise (`listBoundaries`). The kinds are:

- `story-start` and `story-end` — the first and last entries of the branch in view;
- `anchor` — an anchored entry between them, fork point or not;
- `fork` — an unanchored entry any branch in the story was forked from.

**Only a fork point walls the timeline.** The entries before a fork are shared by every branch
forked there; the entries after it belong to one branch. A range reaching across the fork would fit
the shared entries to a destination inside one branch, rewriting the history every other branch
stands on to suit that one. Stopping every range at the fork keeps shared entries reconciled only
between points they all share. It also keeps the fork's own ending still, since every branch forked
there opens on it. Forks are taken from every branch in the story, not just the one in view, and
kept where their entry is visible. Anchoring a fork point is the one deliberate way to move it. A checkpoint is not a
boundary: its clock is a copy, updated when its entry moves.

A **range** is the stretch between two adjacent boundaries (`selectableRanges`). Adjacent only: a
range spanning an anchor would have to either violate the assertion or promote it to a constraint.
The earlier boundary's entry is outside the range; the later one's is its last entry, and ends
exactly at the boundary. `refuseRange` refuses a range whose end has no time, or runs backwards.

## Reconciling a range

`reconcileRange` (`reconcile.ts`) is pure — entries and boundaries in, new times out — so the
preview and the apply path share one calculation: the preview _is_ the result.

The range is weighed as alternating entry durations and the intervals between them,
`[d0, g0, d1, g1, … dN-1]`:

- an entry weighs its own recorded length, `timeEnd − timeStart`, measured inside the entry rather
  than against a neighbour or the baseline, so a second run gives the same answer;
- an interval weighs the recorded time between two entries, zero where they overlap;
- a player action weighs zero;
- the reader may state any weight. It is a **share** of the range, not a duration.

The span between the boundaries is then shared by weight, each offset taken against the running
total so rounding cannot accumulate and the last entry lands exactly on the later boundary. When
every weight is zero, the span is shared evenly between the narrations. An entry whose length cannot
be read (no stamps, or reversed) is returned as a request; nothing is reconciled until every request
has a weight. Reconciling again with unchanged boundaries changes nothing.

## Applying

`planReconciliation` (`reconciliation.ts`) turns the new times into every write that must accompany
them: chapter spans covering the range, the clock inside each rewritten delta, a checkpoint whose
last entry moved, the world-state keyframes of the rewritten entries, and the story clock — **only**
when the range reaches the branch's last entry. An interior range makes no claim about where the
story now stands, and writing the clock anyway would discard a clock adjustment the reader had not
yet committed by continuing.

`applyReconciliation` commits the plan as one transaction and publishes it to memory only after the
commit. The store refuses while a generation holds the story (`assertNotBusy`), re-resolves the
range from the current boundaries, recomputes the preview with the reader's weights, and applies
only when its fingerprint matches the one the reader saw; otherwise the screen refreshes. The
fingerprint covers the endpoints and their times, the entries in the range and their endings, and
any boundary that appeared inside the range.

## Editing one entry

`setEntryTimes` writes one entry's own beginning and ending as a one-entry plan, so it carries the
same guarantees. The player action before a narration moves with it, to the narration's new
beginning. Beyond the generation guard it is never refused: on a fork point it also updates the
checkpoint the branches open on, and the dialog tells the reader how many intervals the edit reaches. No other entry moves, so an edit
can open a gap or an overlap that detection then reports.

Editing an entry from before a fork has a wider, pre-existing consequence, described in
[overview.md](overview.md) under the branches' data model.

## A new story's starting time

The story begins where its opening ends, so the **starting time is the opening's ending**. The story
is created with it on the clock (`createStoryFromWizard`'s `startingTime`), and the opening entry is
stamped zero-length at it. It is a reading, not an anchor. The wizard's opening step cannot finish
without one.

Each opening the step offers carries its own start, and the one belonging to the opening used seeds
the story, in the order `createStory` picks an opening: generated, written, imported
(`NarrativeStore.startingTime`).

- **Imported** — a Scenario Vault entry may state one (`scenario_vault.starting_time`), and it
  applies only to the scenario's first message (`scenarioOpeningStart`, `greetingStart`).
- **Guidance** — what generation is told, through `TIME: opening ends at {{ storyStartingTime }}` in
  the four opening templates, or `(suggest one)` when empty.
- **Result** — what generation returned, or the guidance when it returned nothing readable
  (`returnedStart`). A refinement that returns nothing readable keeps the start the result already
  has, and falls back to the guidance only when that start is empty or unreadable. The result cannot
  be edited while a run is in flight. Its source is shown to the reader.

A pack whose opening template predates the variable cannot pass the guidance on.
`templateReceivesStartingTime` resolves the template that will actually run, before generation and
before refinement, and the guidance is then disabled and not used as a fallback. It matches a
`{{ startingTime` output tag; the narrator settings' checks use the parser instead
(`templateReferences.ts`), which also sees the variable inside `{% if %}` and ignores comments.

## Persistence and transport

- Migration `038_time_anchors.sql` adds `time_anchors`; `039_scenario_starting_time.sql` adds
  `scenario_vault.starting_time`. The schema guarantees are tested in `src-tauri/src/time_anchors.rs`.
- `.avt` export (v1.10.0) and the sync payload both carry `timeAnchors`, omitted when empty. Import
  maps each anchor through the entry id map, drops one whose entry did not survive, and skips one
  whose time cannot be read rather than failing the import.
