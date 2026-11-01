# M5 promotion rulings

What promoting M5 changed in canon. The decisions came out of planning the milestone (2026-11-01), where research, three layouts and a contract audit tested the close's design against the code it extends. This record covers the rulings that change canon; the milestone doc holds the contracts and the slice work.

## Why

The chapter-close agent design (2026-10-31) was never walked through the code it lands on. Doing that for the milestone found one canon mistake, several rules that can't work as written, and a handful of cases canon doesn't cover. Each decision below was made by the developer at the layout gate or in audit triage.

## Decisions

**A chapter ends only on an `ai_reply`.** The modal listed every entry, Phase 1 said turns. A `system` entry hard-deletes with no delta, so its anchor reads as spared for good. The `opening` is the rollback floor. A `user_action` splits a turn, and a regenerate's follow-up sweep can then take the close with no consent. There is one close, auto or manual, and no chapter break without one: the roadmap's "insert break" named nothing canon has.

**A region with no reply owes no close.** Without this, a new story whose opening alone passes a low threshold owes a close with no valid end, which fails every Send, and no turn can land to supply a reply. The no-model fallback becomes the latest `ai_reply` in the open region before the head, else the head if it's one, which can't miss and can't land on an earlier chapter.

**Chapter delete is not a rollback.** Canon routed it through rollback at the chapter's start, which deletes its entries. The developer's intent was always that it deletes only what the close did: CTRL-Z of the close, still available after later turns, latest chapter only. Two modes: delete the chapter, or remove only the divider and keep the work.

**Later writes win a delete, from any source.** The shipped reversal yields only to `user_edit`, and canon assumes only passes sit above a reversed group. Here turns do, so undoing the close would write older values over newer facts. Replay isn't available and wouldn't differ: deltas hold only prior values, and later-write-wins per field is what a replay would produce.

**A delete can leave a value to come back.** A later write's undo payload holds the value it replaced, which may be the close's. Rolling that turn back after a delete writes it again, and the value before it isn't in the log. Accepted: the order is rare, the state stays valid, and the next pass or close corrects it. Rejected: splicing the later delta's payload, new reversal surface for a rare order.

**The next Send may close again, and that's the point.** With auto-close on and the region at the threshold, a close re-runs before the turn, which re-derives the memory the delete removed. No hold: canon persists no such thing, and holding it off would leave the story without that chapter's memory. A threshold changed first simply applies.

**Prose can't be fixed by a delete.** Turns written with the close's context stay as written, and can still reflect what it added. Full coherence is a rollback to the chapter's last entry, then a delete. The two tools answer different problems, and the confirm says so.

**The token measure is a real column.** `story_entries.content_tokens` holds an o200k count of stored `content`, maintained where content is written. Rejected: a metadata key, which adds a metadata write and undo partial to every content edit; and counting on read, which sends the region's prose across IPC on each read and tokenizes on the renderer. A translated story needs no separate rule, since `content` is the source language. No backfill: there are no users, and migrations can't tokenize.

**Tool results beyond canon's three.** A restated value is `ok` with nothing written, since `rejected` invites a retry and `skipped` would read as loss. A row that moved or went is `rejected`, saying where. A call with some fields protected, or one action landed and one refused, lands what it can and returns `ok` naming the rest: "lands whole" means all-or-nothing on failure, not on precedence. A merge touching a row a later turn touched is `skipped` whole. A `retrieval_count` bump doesn't count as touching a row, or most recent merges would be refused.

**`close_report` holds new values.** Deltas hold only prior values, so "old and new values come from the deltas" can't work, and the diff cache is M6.4. A landed write stores its new value, cut to the same bound as a Not applied value. A merge names its survivor, threads included. Stackable normalization stays out of the review with stamps and resets: it's code, with no `why`, and its keys are a spelling cleanup.

**The chapter sits in a close's system half.** The design measured 6,088 of 6,181 tokens reused across different tool lists that way, and 0 of 6,176 in the user turn. So the stable-system-half rule narrows for a close's task templates: stable across a part's tasks, not across the story. Boundary and metadata follow the normal rule. One `chapter` context group replaces the unbuilt `lore` group and the chapter templates listed under `generationContext`, whose budget-governed `entries` can't hold a chapter.

**`N of M` counts agent tasks.** Canon's `2 of 4` counted nothing defined. `close_task_start` replaces `close_task_complete`, since a completion event leaves the banner blank through Happenings and names a finished task where the label names a running one.

## Adversarial pass

**Load-bearing: any-source yielding.** It assumes a handler's undo payload names only the fields it changed. `updateThread` and `updateHappening` log unchanged columns today, so a restated value would read as a later write. Slice 5.5b drops them. Field-level yielding through `state` sub-fields, the constraint groups, held copies and `refClearsOf` was walked in the code and holds, with the yield mode carried on the reversal set. Read, not run.

**Rulings against each other.**

- Partial results against Not applied: "the same task later landed the same tool on the same row" would hide a skipped field when a later call landed a different field. Not applied is judged per field. Found here; the integration plan carries it.
- Divider-only removal against regenerate: the chapter is gone, so a count of chapters reads no close, and regenerating the end reply would reverse the kept work with no confirm. The confirm counts close writes in the sweep.
- Divider-only removal against the later-turn rule: a re-close would read the kept work as a later turn's and skip it. `chapter_close` deltas don't count as later.
- Divider-only removal against CTRL-Z: the kept deltas are an ordinary undo target, so with no later turn the next CTRL-Z reverses them. Stated, not prevented.
- Delete against an open confirm: a close committing under it would make the chapter no longer the latest, stranding its entries before a closed one. The action re-reads the latest chapter inside the reversal bracket.

**Edge cases.** A short manual chapter leaves the region under the threshold after a delete, so the confirm picks among three outcomes rather than promising a re-close. A close-created lore row the user edited later goes with the create, as any machine create does, so the confirm counts what goes. A normalized stackable record a later write touched stays normalized, since undoing it can double-count.

**Missing perspectives.** Undo: delete and divider-only removal aren't undoable, and both clear redo. Export: `content_tokens` travels with `story_entries`, and `close_report` with `chapters`. Fork: the column copies with the row. Translation: `content` is already the source language. Mobile: no new surface shape; the confirm is an AlertDialog at every tier.

**Assumed, not verified.** All of this is from reading code and canon. Nothing ran. The reversal's cost at a close's size is unmeasured, and the size of a real `close_report` is a guess until a real close runs.

## Integration plan

**Canonical files.**

- `memory/chapter-close.md`: Tools and writes (results, later-turn rule); `## Phase 1` (ends, fallback); Phase 2 (drop "and browse rail"); 3e (a later-touched merge is `skipped`); `## Review` (new values, per-field Not applied, what stays out); `## Manual user-triggered close` (ends on a reply); new `## Deleting a chapter`.
- `generation-pipeline.md`: the event at `:144` and `:506`; `closeOwed` in `chainsTo` on predecessor and its prose; Reverse-replay gains the delete paragraph, and "Only periodic-classifier groups sit above the group CTRL-Z undoes" stays true for CTRL-Z; Writes (`delta_group_emitted` carries each action's reason).
- `data-model.md`: diagram (`content_tokens`, `chapter_id`'s no FK, `close_report`); Chapters / memory system (ends, measure, delete).
- `architecture.md`: The system half is stable; Context groups table and the "V1 ships" line.
- `ui/principles.md`: the banner's example, and chapter delete under What's gated.
- `ui/patterns/generation-status-pill.md`: a close's before-turn label.
- `ui/screens/chapter-timeline/chapter-timeline.md`: head line, Layout, Per-card actions, new `### Delete a chapter`, End-entry picker, Review window, Mobile expression, the bulk open question.
- `ui/screens/reader-composer/reader-composer.md`: Regenerate confirmation (a divider-only removal's kept work), During a memory update (the close's before-turn label).

**Renames.** `close_task_complete` → `close_task_start`, with `done` → `index`. No heading renames.

**Patterns adopted on a new surface.** The Timeline cites `alert-dialog.md` for the delete confirm, so its Used by gains the Timeline if it isn't there.

**Followups resolved.** None. **Introduced.** None here: "stale active" moves to followups with the milestone's own commit.

**Wireframes.** `chapter-timeline.html`: `Delete…` on the latest card only and disabled in flight, the two-mode confirm, the picker offering replies only. `reader-composer.html`: the banner's `N of M`, a close's before-turn state.

**Intentional repeats.** `## Deleting a chapter` and `### Delete a chapter` state the same rule at two altitudes: the first is the behaviour, the second the surface. The second links to the first.

**Left for the slices.** `Close chapter here`'s canon rows wait on 5.10's answer to whether it opens the modal. The chain and Send contradictions the research found rest on 5.6 alone and go through its planning. `chaptersOld` goes through 5.9's.
