# Decision model

Ideas for where an optional decision model could help the memory
pipeline. Nothing here is designed or built. This doc tracks the
candidates and what is known about each; a candidate that becomes a
design moves into the canonical doc that owns its stage, and leaves
here.

A decision model scores options it is given. Asked one yes/no
question per candidate against a stated situation, it returns a
probability of yes for each. It writes no prose and can't author a
new row. Elephant-1, a 9B decision model, is the one measured so far
and one of several; which model and server a user runs is theirs to
choose. Elephant-1 itself runs as trained only through qev: llama.cpp
and vLLM lose its attention mask.

## Ground rules

- **Optional.** A story works the same without one. The feature talks
  to a general `/v1/systemone` endpoint the user points it at, never
  to one bundled model.
- **An add-on, never a replacement.** It answers questions about rows
  that already exist. New characters, happenings and threads still
  need an LLM, so the [periodic classifier](./classifier.md),
  [piggyback](./piggyback.md) and the
  [fallback classifier](./piggyback.md#fallback-classifier-context)
  all stay. It can take a responsibility off one of them; it can't
  stand in for one.
- **Measured before moved.** No layer drops a field until that
  field's closed-set version has been measured against the layer's
  own output on real story data.

## Candidates

### Reranking retrieval

**Status:** measured on a proxy; direction only.

The easiest slot. Embedder similarity picks a pool deep enough to
hold what matters, and the decision model reorders it by asking of
each candidate whether it bears on the situation.

On the proxy, reranking EmbeddingGemma's top 30 happenings beat
EmbeddingGemma alone, though by less than the first count showed once
citations stopped being trusted: the decision model's top 3 held about
the answer content EmbeddingGemma's top 5 did. That reads as a smaller
narrator budget for the same recall, not as better recall. Choosing
among session summaries gave the largest gain measured, and session
summaries are the nearest match to
[chapter summaries](./retrieval.md#chapter-summaries-pool).

Questions a design would have to answer:

- **Where it sits.** The proxy reranked plain similarity. The app's
  [scoring function](./retrieval.md#scoring-function) also carries
  recency decay, pins, the keyword boost and the high-similarity
  bypass, then MMR and budget fill. Putting the decision model's
  probability in place of `sim_blend`, and reranking what the ranker
  already chose, are different designs.
- **What it's asked.** The app has no single question: its query is
  a weighted blend of up to four vectors
  ([the query stack](./retrieval.md#query-construction--the-query-stack)).
  A decision model needs text, so the situation it reads has to be
  composed from the user action, the structural digest, the
  piggyback summary and the classifier-emitted queries. The proxy
  asked explicit factual questions, unlike any of these.
- **Top-k or a threshold.** Taking every candidate at a probability
  of 0.5 or more under-selected badly; a fixed top-k beat it
  everywhere. A recalibrated threshold wasn't tried.
- **The probe.** The [memory probe](./probe.md) replays captured
  ranker scores; a decision-model stage would need its probabilities
  captured too, or a replay can't reproduce it.

### Closed-set state questions

**Status:** untested.

A responsibility split off the LLM layers: questions over listed rows
whose answer is one of a known set.

- Awareness: does this listed character know of this listed
  happening?
- A character's faction membership.
- Status transitions.
- Who is in the scene and where it is: piggyback's `sceneEntities`
  and `currentLocationId`, asked every turn.
- Thread status.
- A place's parent.

Each one answered here is one thing fewer the layer writes in its
pass. For a new row the decision model can only check what the LLM
proposed. No state-extraction experiment has been run, including
through `scripts/classifier-eval/`.

The question count grows with the cross product: awareness over a
window asks of every listed character against every happening, and
each question carries the format's fixed per-candidate cost (see
[Open questions](#open-questions)).

### Summaries, then entries

**Status:** measured on a proxy; no better.

An alternative memory mode, never a change to the default: choose the
chapters that matter by their summaries, then retrieve inside them.
On the proxy (the decision model chose 3 sessions, then their turns
were ranked), it did no better than plain EmbeddingGemma at about
twice the cost, because the first step throws away evidence the
second needs. Chapters run 16 to 32 times the size of those sessions,
so the loss is expected to grow. That is an inference, not a
measurement.

### Pairing with a small local model

**Status:** not evaluated.

Most interesting beside a small local model, which does better with
less to carry in one pass: the closed-set questions above come off
its prompt. More so if a small decision model, around 3B, does a
decent job; one has been seen, none evaluated. On a single GPU the
two compete for memory: the 9B model in FP8 peaked at about 10.5 GiB
on a 16 GB card.

### Conflict detection

**Status:** idea; needs validation.

Where vector similarity now decides whether two rows clash, ask the
decision model instead. Cosine between two descriptions measures how
alike they read, which only stands in for whether they name one
being; a direct yes/no on that question may judge better.

- [Disambiguation on new-character mentions](./classifier.md#disambiguation-on-new-character-mentions)
  compares a candidate's description with each namesake's, and the
  `τ_high` and `τ_low` cosine bands decide absorb, flag or plain
  create, and the flag's reason. The per-turn writer bands an item's
  exact namesake the same way.
- [Happenings consolidation](./chapter-close.md#3e--happenings-consolidation)
  gates which happenings reach the LLM's merge judgment on cosine
  of 0.80 or more, beside shared cast and nearness in time. A decision
  model there would only change which clusters the LLM sees.

Without a decision model the cosine bands stay, so they still need
their own tuning. Real stories label part of this for free: in
[collision review](../ui/screens/world/world.md#collision-review-and-entity-merge)
a merge says a flagged pair was one row, and a rename or keep as
distinct says it was two. Only flagged pairs reach review, though, so
those labels miss a wrong absorb and a duplicate created unflagged.

### Not yet weighed

[Chapter boundary selection](./chapter-close.md#phase-1--boundary-selection)
already makes a closed-set choice, noted and not yet discussed. Code
offers the candidate turns and the model picks one, with a fallback
that loses nothing when the reply is unusable. One yes/no per
candidate ("is this a natural chapter ending?") fits the format,
though the candidates are then scored apart, not against each other.

## Evidence so far

One proxy test, 2026-10-30. Elephant-1 in FP8 reranked the app's own
embedders, run through the app's transformers.js packages and model
files with its prefixes and pooling, over LoCoMo: 10 conversations,
1,535 scorable questions, each searched within its own conversation.
Paired intervals held whether questions or whole conversations were
resampled. The harness and results live outside this repo.

Why it is direction only:

- LoCoMo is conversation, not narrative.
- Its happenings were extracted by a hosted model given the
  classifier's rules and an added citation field, not by the app's
  classifier on the local model its prompts are tuned to.
- The queries are explicit factual questions, not the app's retrieval
  queries.
- Catch-up happenings, one happening folding a long conversation,
  inflated the citation-based scores. Scoring the gold answer's words
  in the retrieved text ignores citations and gave the smaller
  margin described above.

## Open questions

- **Per-candidate cost.** About 88 tokens of Elephant-1's trained
  question format are fixed per candidate, more than half of a short
  one. Shorter wording is untested, and it would leave the format the
  model was trained on. Other models' formats are unmeasured.

## Revisit signal

Real story data. No more proxy experiments: the next measurement
waits for stories the app wrote, with happenings from the app's own
classifier, the app's real retrieval queries, and relevance judged
per query, scored on answer content as well as citations. Those
queries and judgments have to be authored; a story supplies only the
documents.
