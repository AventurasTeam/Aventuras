# Bounding the classifier's Known happenings

The periodic classifier's Known happenings list stops being every
happening on the branch. It lists the happenings the window's turns
were given, as each AI entry now records them, and the happenings that
occurred in the open region, reaching back as far as the prompt
buffer's spillover. Designed 2026-10-27; resolves the happenings half of
the followup "Periodic classifier context grows with the story" and
parks the rest.

## Why

A pass lists every happening on the branch by id and title, from every
chapter. At the projected 3-6k happenings over 60 chapters
([`retrieval.md → Scale assumptions`](../memory/retrieval.md#scale-assumptions))
that is roughly 40-90k tokens, the largest list in the prompt, and a
pass whose prompt outgrows its model's window stops the story's turns.
Chapter close doesn't bound it: its consolidation (3e) clusters only
within the chapter it closes, so the total still grows with the number
of chapters. Happenings grow steadily in every story; the entity, place
and relationship lists grow with a story's breadth, which depends on the
story.

## Ground truth that shaped it

- **The list does two jobs.** Canon names one, a character learning of
  an older happening (`knownAwareness`). The prompt also tells the model
  "Never add again a happening Known happenings lists", so the list is
  what stops a pass creating a retold event a second time.
- **A duplicate across chapters is permanent.** 3e clusters within the
  closed range and within about three entries of each other
  ([`chapter-close.md → 3e`](../memory/chapter-close.md#3e--happenings-consolidation)),
  and Plot has no happening merge.
- **The ranker is the only way a happening reaches the narrator.**
  Keyword injection seats entities and lore only, and the structural
  floor seats no happenings (`lib/retrieval/types.ts`, the
  `rank_all` pseudocode).
- **Nothing records what a turn was given.** Turn capture does, behind
  the diagnostics gate; `retrieval_count` is a per-chapter counter on
  awareness rows.
- **The story history crosses chapter boundaries.** `promptBufferTake`
  takes a tail of the whole branch at least `protectedBuffer` entries
  long, so a turn early in a chapter has the previous chapter's last
  entries as prose.
- **The open region is every non-system entry with no `chapterId`**
  (`readPromptBuffer`). No chapter has closed yet, so today it is the
  whole branch.
- **Branch-scoped ids survive a fork**: primary keys are
  `(branch_id, id)`.

## Decisions

**Bound happenings only.** The roster lists stay whole. Bounding them
costs the rules that need the whole roster: matching a mention to an
existing character, deduplicating mentioned places, the `name-taken`
check, the relationship no-op. Parked until a played story shows the
shape.

**List what the narrator was given.** A deliberate reference to an
older happening, a retelling or a character learning of one, comes
from a happening the narrator saw, so that set covers both jobs.
Coincidental mentions go unlisted, accepted.

**Add the open region's happenings, with the buffer's reach-back.** The
narrator also sees recent happenings as prose in its story history,
not as rows: a fight that spans the previous pass's window continues
from the prose, and its row is seated only if it ranks into the
budget. Rejected: _the records alone_, which leaves continuations to
chapter close's merge; _the last N entries_, bounded today but short
of the history in full-chapter mode.

**Record the seated ids on the entry.** Rejected: _a link table_, a new
branch-scoped table with its manifest, fork, delta and reversal rules
for one reader; _the pass running its own retrieval over the window's
prose_, which guesses relevance instead of knowing it, needs the
embedder, and adds embeds to a pass the user waits on. It is the one
option that catches coincidental mentions, which the dedup entry in
`parked.md` takes up.

**Retellings from summaries, lore and descriptions count as
coincidental.** Old events reach the narrator through retrieved chapter
summaries, lore bodies and entity descriptions too. Rejected: _a seated
summary bringing its chapter's happenings_, up to 100 rows a summary
and roughly 5k tokens at the default budget.

## The design

Canonical in
[`classifier.md → What the classifier reads`](../memory/classifier.md#what-the-classifier-reads)
(the list, its two jobs, what goes unlisted) and
[`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape)
(`injectedHappenings`). The residual roster growth and happening
dedup at create are in
[`parked.md → Memory pipeline`](../parked.md#memory-pipeline-parked).

## Adversarial pass

- **Load-bearing**: that deliberate references come from seated rows.
  Summaries, lore and descriptions break it, accepted as coincidental
  (above). Summaries and close-written lore arrive with M5, so the
  effect today is near zero.
- **Holds**: `protectedBuffer` 0 stops the recent set at the chapter
  start, as it stops the history; a rollback into the window takes its
  entries' records; a regenerate after a pass reverses the pass's
  facts and the next pass reads the new entry's record; a close's
  phase-0 passes classify inside the chapter being closed, still the
  open region; a user-written or edited entry is coincidental by
  definition.
- **Not inherited**: `inheritedEntryMetadata` carries only the scene
  triple, so a user action entry never copies the previous record.
- **Today's change**: with no chapter closed, the recent set is every
  positioned happening, so only out-of-narrative happenings change,
  listed now only when a record names one.
- **Size once chapters close**: a chapter's 50-100 happenings plus
  30-60 recorded ids, about 1.5-2.5k tokens.
- **Dedup cost** (for the parked entry), from the Fold 7 PoC: a vec0
  query at about 11 ms on 1k vectors and 43 ms on 10k, a single-shot
  embed at about 30 ms; 20-30 ms at 3-6k happenings is interpolated.
- **Read sites**: the template's snapshot tests, the classifier
  probe, which builds the same context, and any test whose old
  happening is out-of-narrative. The fallback classifier lists no
  happenings.
- **Outside it**: translation (the record is ids), the recent set's
  cost (one read over positions).

## Integration plan

- `memory/classifier.md → What the classifier reads`: the Known
  happenings bullet rewritten: the records and the recent set, the two
  jobs, what goes unlisted.
- `data-model.md → Entry metadata shape`: `injectedHappenings` in the
  generation provenance group, authored and never inherited.
- `followups.md`: "Periodic classifier context grows with the story"
  removed; "Bound the pass's Known happenings" added under Data-model;
  the prompt content pass's line-break nit loses the happening title,
  flattened since #659.
- `parked.md → Memory pipeline (parked)`: a new entry for the roster's
  growth, threads included; "Cross-chapter semantic dedup of
  happenings" rewritten to take dedup at create, the bounded list as a
  new source of duplicates, the cost and the decision problem. The
  JSON-ids entry under Data-model names `injectedHappenings`.
- `architecture.md → Context groups`: the `classifierContext` row's
  happenings list is bounded.
