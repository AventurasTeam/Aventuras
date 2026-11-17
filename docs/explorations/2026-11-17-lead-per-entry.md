# The lead each entry was written under

How readers of past turns tell whose "I" and "you" a turn narrates once
the lead has changed, and how a chapter close learns the lead at all.
Designed 2026-11-17, following the per-branch lead
([`2026-11-17-per-branch-lead.md`](./2026-11-17-per-branch-lead.md)),
from the developer's question of how the periodic classifier and a
close know the lead when they read past entries.

## Why

The periodic classifier resolves the branch's current lead once per
pass and tells the model "'I' and 'you' in the turns are the lead" for
the whole window. Entries don't record the lead they were written
under, so after a switch a lagging pass reads the old lead's turns as
the new lead's and writes their facts there: Alice takes a sword at
entry 48, the lead becomes Bob at 50, and a pass over 46–52 gives Bob
the sword. The chapter close is worse off: its context carries `mode`
but no `lead` and no `narration`, so its tasks and its summary call
read "I" with no name for it even when no switch happened. Chapter
summaries are told in the narration's person and recalled in later
prompts, so a first-person summary recalled after a switch misreads
too. The narrator's own history has the same ambiguity.

## Decisions

- **Each entry records its lead** (option 1 of three: stamp entries,
  run a catch-up pass before a switch, or split a window at a switch).
  Only a stamp serves the close, which reads a whole chapter, and the
  narrator's history.
- **Marks only where the lead changes** (M1), relative to the lead the
  prompt names, over labelling every turn (M2). A story that never
  switches renders byte-identical prompts.
- **The close names its lead.** First raised as a triage gap, folded in
  because a relative mark needs a named lead to be relative to.
- **Chapter summaries are told in the third person**, as happening
  descriptions already are in practice, over stamping a chapter's lead
  and marking recalled summaries. A summary then reads the same under
  any later lead.
- **No reader mark.** The stamp is for the models; World's History
  already shows the switch.

## The design

**The stamp.** `metadata.leadId?: string` on every `user_action`,
`ai_reply` and `opening`: the branch's lead when the entry was created,
absent when it had none. Authored, never inherited. A turn's entries
take the lead as the run starts, under the gate; regenerate, Retry and
Save & regenerate stamp the new reply with the current lead and leave
the user's action as stamped; the wizard stamps the opening. Edits keep
it, a fork copies it, undo and rollback remove it with the entry. A
stamp naming a deleted character stays; no name is snapshotted, so a
rename shows the new name. The M6 lead migration stamps existing
entries with their branch's lead.

**The marks.** One helper walks a prompt's rendered turns from the lead
the prompt names; a turn whose stamp differs from the previous turn's
(the first from the named lead) gets `leadMark`: `{ id, name }` in the
prompt's id scheme, `{ gone: true }` for a deleted character, or
`{ none: true }` for a run with no lead. `macro_story_entry` prints a
self-explaining line before a marked turn, with ids when its `ids` flag
is on (the fallback classifier and the close) and names only otherwise
(the narrator, the suggestion refresh). The periodic classifier puts it
in its turn header. The classifiers' and the close's line naming the
lead gains "except where a turn names another" only when a turn is
marked. Wording is the bundled default; prompt tuning owns it.

**The close's lead.** The chapter context gains `lead` (the id as the
close's handle) and `narration`. Each task's user half names the lead
by handle and name, as the classifiers do. It was first placed in
`close-instructions`, the shared system half; the drift pass caught
that a system half never brackets an id and that the Happenings and
Awareness tasks' system half is those instructions alone, held stable
across the story, so the naming moved to the user half. Marks in a
prose task's turns carry handles, stable across a part's tasks since a
close has one id map, and `read_turns` results carry marks too. The
metadata call and each part's call name the lead by name in their user
half; the merge reads no turns and takes none.

**Third person.** The chapter summary rule names every character as the
prose does, the lead included, and never "I" or "you" outside quoted
speech; the merge follows it. Happening descriptions get the same
sentence in the periodic classifier and the close's Happenings merge
(the fallback classifier writes no happenings): all 37 in the dataset chapter, narrated in first
person by Jim, are third person already, but no prompt says so.

## Adversarial pass

**Load-bearing: every reader of past turns names a lead and marks
against it.** The readers are the narrator's history, the periodic and
fallback classifiers, the close's prose tasks, the metadata and part
calls, and the suggestion refresh, all through the shared helper; the
context map documents `leadMark`, so a pack template or a later reader
gets the same data. The close's Happenings and Awareness tasks read
prose only through `read_turns`, whose results carry marks.

**Byte-identical without a switch.** Verified by construction: migrated
entries carry their branch's current lead, and a story that never had
one carries no stamps against a prompt naming none, so the helper marks
nothing. The token breakdown's history guard compares the rendered
history against a blank-entries render; marks come from stamps, not
content, so they render in both and cancel.

**Edge cases.** A named lead of none (a creative story after "No
lead") leaves the lead line out; the marks explain themselves. A mark
naming a lead the classifier lists nowhere else allocates its
placeholder, so facts about the old lead's turns land on the old lead.
A `{ gone }` run gives "I" no row, so its facts about the narrator are
lost, which beats crediting them to whoever leads now. After a switch,
the narrator's history gains a mark at its first turn, which moves as
the window slides; the slide already changes the history's start.

**Missing perspectives checked.** A narration switch keeps "I" the lead
whatever the person, so it needs no stamp; a mode switch changes only
whether a user's turn is an attempt or a direction, and facts come from
the narration either way. Translation: prompts are English source, and
marks are prompt text. Undo: the stamp is part of the entry's create.
Other AI-written text (entity descriptions, traits, lore, threads) isn't
narration and hasn't been seen in "I"; the third-person sentence
extends to it if play shows otherwise. The per-turn `metadata.summary`
is a retrieval query, embedded rather than read, and stays as it is.

## Integration plan

**Canonical files:**

- `docs/data-model.md`
  - `### Entry metadata shape`: `leadId?` in the shape.
  - `### The lead`: a paragraph on the stamp and what writes it.
- `docs/architecture.md → System and user halves`: after "Every
  history marks the user's turns", a paragraph on lead marks: the rule,
  the three shapes, the `ids` flag, the conditional clause.
- `docs/memory/classifier.md → What the classifier reads`: the lead
  bullet gains the marks and the clause; the happening description
  rule gains the third-person sentence.
- `docs/memory/chapter-close.md`
  - `### Conversations`: each task's user half names the lead.
  - `## Phase 2 — chapter metadata`: the prompt context gains the lead
    and narration; the summary is told in the third person.
  - `### 3e — happenings consolidation`: a merged description in the
    third person.
- `docs/implementation/roadmap.md`: the M6 lead item gains the stamp,
  the marks, the close's lead and the third-person rules.

**Renames:** none.

**Patterns adopted on a new surface:** none.

**Followups resolved:** none in a ledger; the triage entry for the
close's lead was filed and withdrawn in this session.

**Followups introduced:** none.

**Wireframes:** none (no reader mark).

**Intentional repeated prose:** the third-person sentence appears in
`classifier.md` and `chapter-close.md`, each owning its own prompt.
