# The per-branch lead

How a story's lead becomes per branch and delta-logged. Designed
2026-11-17 from the roadmap's M6 carried item "The lead must be
per-branch and delta-logged", raised by 4.2b's planning (2026-09-28).

## Why

The lead lives in `stories.definition.leadEntityId`, story-level, while
entities are per branch. It dangles on a branch without the character,
after a reversal of the lead's create or a `Set as lead` naming a
character another branch lacks, and `resolveLead` reads a dangling lead
as absent. `setStoryLead` writes the story row directly: no CTRL-Z, no
sweep by rollback or regenerate, and it clears redo by hand. Deleting
the lead, and a collision merge whose disappearing row is the lead, are
refused in every story (`lead-entity`), since nothing could clear the
pointer back. Two branches with different leads is a valid use case
(developer, 2026-09-28). And a creative third-person story that picked
a protagonist can't go back to none: no route unsets the lead.

## Decisions

- **A lead change follows the World-edit rule.** Rollback and
  regenerate sweep it, CTRL-Z undoes it newest-first. A switch made
  after a reply and followed by a regenerate of that reply is swept, so
  the regenerate runs under the old lead. That is the same silent loss
  every World edit made after a reply takes; if it bites, the fix
  belongs to regenerate, for every edit. Parked until signal.
- **A branch that needs a lead and has none can't take a turn.** Send,
  regenerate, Retry and Save & regenerate refuse, with the composer's
  reason line naming the fix.
- **"No lead" is a choice where the story allows one.** Story
  Settings' lead picker offers it in creative third person, as the
  wizard always intended.
- **The lead is a flag on the character row** (approach A below).
- **The build is M6 scope**, picked up by its planning as its own slice
  or folded into M6.1.

## Approaches

**A. A flag on the character row (`entities.is_lead`) — chosen.** The
lead rides machinery that exists: a switch is an ordinary entity
`update`, a delete's undo record already holds the whole row, redo
restores whole-row snapshots, a fork copies entity rows and an export
carries them, and every reader already holds the entity map. Reversal
code is where the repo's hard bugs have lived, and A changes almost
none of it. The costs: a switch writes two rows, so one lead per branch
is held by the writers rather than a database constraint, and the one
closure that removes the new lead's row splits the switch.

**B. A one-row-per-branch table (`branch_leads`).** A switch is one
delta and uniqueness holds by construction, as era flips hold theirs in
their own table. But the closure knows two kinds of reference today,
link rows deleted with their ends and `state` references cleared, and a
singleton lead row fits neither: deleting it is wrong and clearing it
leaves no lead where the previous one should come back. "Take the
switch with it" is a third behavior in `row-closure.ts`, and the lead's
clear inside an entity delete's group joins the write-back refusals.
New table, registry, manifest, cascade and export rows on top.

**C. A column on `branches`, with `branches` logged.** Rejected for the
reason era flips rejected it: `branches` is config-shaped, its
`classifier_status` is clamped imperatively, and a branch's own create
is unlogged, so the row would be half-logged.

## The design

**Storage.** `entities.is_lead`, an integer 0 or 1, default 0, with a
`CHECK` allowing 1 only on a `character` row. It doesn't check
`status`: setting a lead needs an active character, but a lead the
classifier retires stays the lead. `definition.leadEntityId` and the
`definition` rule requiring it go. A branch _needs a lead_ when the
story's mode is adventure or its narration first or second person.

**One lead per branch.** No unique index: redo replays a group
newest-first, so it would set the new flag while the old one is still
on. Four logged writes touch the flag: set, unset, an entity delete, a
collision merge; story creation and the migration write it unlogged. Set turns off every flagged row on the branch before
flagging the new one, so it repairs a double; a reader finding two logs
an error and reads the branch as having no lead.

**Writes.** Set as lead (World ⋯, peek, Actions menu, Story Settings)
is one user group, every flagged row `1→0` and the new lead `0→1`, with
today's refusals less `invalid-definition`. Unset is Story Settings'
"No lead", offered only in creative third person, one group `1→0`.
Deleting the lead is allowed; its undo record holds the flag, and the
World delete confirm says the branch loses its lead. A collision merge
whose disappearing row is the lead gives the survivor the flag in its
group. Undo names a group writing `is_lead` "making Aria the lead" or
"removing Aria as lead", both unseen targets that confirm.

**Reads.** `resolveLead` becomes the flagged character on the branch,
from the entity map readers already hold. Templates still receive
`lead`. On a branch that needs a lead and has none, every action that
starts a turn refuses and the reason line reads "This story needs a
lead on this branch before it can continue. Set one in World." Passes
and closes run as before. Story Settings' lead field sets the current
branch's lead; its save checks that branch; a mode or narration change
that makes the story need a lead lists the other branches without one
in the definitional-change confirm.

**Story creation, migration, fork, export.** The wizard writes the
flag on its lead's cast row in the root branch, unlogged like the rest
of the cast. Migration flags the id on every branch holding it as a
character and drops the key; there are no users before MVP. A fork
copies entity rows and its rewind restores the flag as of the fork
entry, so the manifest gains no row. A single-entity export builds its
payload field by field and leaves the flag out; a story export carries
it, and a story import refuses a branch with two.

## Adversarial pass

**Load-bearing: a switch's two writes reverse together.** Verified in
the code and canon. They share one group and one stretch of the log,
so every suffix sweep reaches both and CTRL-Z takes the group. An
entry-scoped reversal never reverses an entity create
(`classifier-facts.ts:192`, `isReversible`), so a prose edit's
invalidation can't remove a lead's row. A close re-run or a chapter
delete reverses only the close's groups, and a close creates no
character (its tools create lore, merge happenings and threads,
retire). No machine writer deletes or merges a character (canon,
`generation-pipeline.md → Reverse-replay`, not checked in code). What's
left is the closure that removes a row by its create at boot recovery
of a failed abort: it takes the new lead's flag write and leaves the
old lead's off-write, and the branch reads as having no lead, which the
refusal makes visible. Accepted, not guarded.

**Redo order.** Verified: `row-closure.ts:325` sorts the set by log
position, newest first, and `redo.ts:175` replays in that order. Hence
no partial unique index.

**The regenerate sweep.** Verified in `resolveSweep`
(`lib/actions/story-entries/operational.ts:299`): a delta with no entry
anchor at or after the regenerated reply's first log position is
reversed. A regenerate of the last reply with no close on it opens no
confirm (canon).

**Edge cases.** A lead staged or retired in World stays the lead. A
fork from a branch with no lead has none. A creative third-person
branch with no lead runs as today. Story Settings saving "No lead"
alongside a switch to first person refuses. A delete of the lead
followed by a set of another, then a rollback before both, reverses the
set first and restores the deleted row with its flag.

**Read sites.** Code: `lib/world/lead.ts`, the generation and
classifier contexts, per-turn retrieval, the periodic classifier, the
reader and World routes, `isStoryLead` in `lib/actions/entities/register.ts`,
`setStoryLead`, `createStoryWithBranch`, the merge's refusal in
`resolve-collision.ts`, the dataset seed and fixtures. The wizard's
draft `leadEntityId` and its template variable are the draft's and stay.
History's field labels are per column (`lib/history/field-labels.ts`),
so the build adds one for the flag.

**Costs.** A switch counts as two world-state changes in the rollback
confirmation. Drizzle needs the column and the `CHECK` generated in
separate runs, and a `CHECK` rebuild wedges a dev database that
violates it; delete and reseed.

**Missing perspectives checked.** Translation: new copy goes through
`t()`, and undo targets stay whole sentences per locale. Accessibility:
the reason line and the confirm line are text. Concurrency: a lead
change is gated during generation, as today. Performance: resolving
scans the branch's entity map, which every caller already holds.
Prompt history keeps prose written under a previous lead; that is true
of a switch today and outside this design.

## Integration plan

**Canonical files:**

- `docs/data-model.md`
  - Diagram: `entities` gains `is_lead`.
  - A new `### The lead` before `### Story identity fields`: the flag,
    the needs-a-lead rule, one per branch and why no index, the writes,
    sweeps, the split edge, creation and migration, fork.
  - `### Story settings shape`: the `definition` shape loses
    `leadEntityId`; the cross-field constraint and "The lead can
    dangle" paragraphs give way to a pointer to The lead.
  - The default story settings' definitional field list drops
    `leadEntityId`.
  - Per-row export's left-out columns gain `isLead`; the per-story
    export's import refuses a branch with two leads.
- `docs/ui/principles.md`
  - `Mode, lead, and narration`: the encoding and constraint summary
    become the branch's flag and the needs-a-lead rule; lead switching
    gains undo, the sweep and "No lead".
  - The storage-shape paragraph under Settings architecture: the lead
    leaves `stories.definition`'s list; the Generation tab shows the
    branch's lead.
  - The dangling-lead paragraph under Composer mode becomes the
    lead-less branch, with Send refused and the new copy.
- `docs/architecture.md`: the suggestion emission paragraph's
  `resolveLead` wording; the story-level definition list drops
  `leadEntityId`.
- `docs/memory/classifier.md`: the lead bullet's wording and link.
- `docs/ui/screens/story-settings/story-settings.md`: the lead bullet
  (per branch, "No lead", the save check); the not-flagged lead bullet;
  the definitional-change confirm's other-branches line.
- `docs/ui/screens/world/world.md`: Set as lead; Delete no longer
  disabled for the lead; "The lead can't be deleted" becomes the
  confirm's line; the merge takes the flag to the survivor.
- `docs/ui/screens/reader-composer/reader-composer.md`: the peek's
  `Set as lead`; the undo target table's lead row.
- `docs/ui/patterns/entity.md`: the lead badge is the branch's lead.
- `docs/implementation/roadmap.md`: the M6 carried item becomes build
  scope pointing at canon.
- `docs/parked.md → UX (parked)`: a new entry, a regenerate sweeping
  World edits made after the reply.

**Renames:** no heading renames. Inbound links to
`data-model.md#story-settings-shape` that mean the lead retarget to
`#the-lead`: `principles.md` (the zod-boundary and dangling-lead
links), `classifier.md`'s lead bullet, `story-settings.md`'s
cross-field-constraint link, `world.md`'s delete paragraph. The field
`leadEntityId` leaves canon outside the wizard's draft.

**Patterns adopted on a new surface:** none.

**Followups resolved:** none in `followups.md`; the roadmap's M6 item
changes from "needs a design session" to build scope.

**Followups introduced:** one parked-until-signal entry, under
`parked.md → UX (parked)`.

**Wireframes:** `docs/ui/screens/story-settings/story-settings.html`:
the lead field's hint (this branch, "No lead" in creative third) and
the definitional-change modal's other-branches line.

**Intentional repeated prose:** the needs-a-lead rule appears in
`data-model.md` (owner) and `principles.md` (the concept's home), as the
cross-field constraint does today.
