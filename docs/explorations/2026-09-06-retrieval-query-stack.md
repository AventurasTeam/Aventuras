# Retrieval query stack — Q3 removal and the classifier query pathway

Session record, 2026-09-06. Sibling to
[the keyword-retrieval record](./2026-09-06-keyword-retrieval.md) from
the same day, which settled Q3's fate but deliberately left the
replacement out of scope.

This file covers what replaces Q3: the query stack becomes
variable-length, the piggyback summary splits out of the structural
digest into a query of its own, and the per-turn classifiers gain an
optional emission that submits retrieval queries directly.

## What prompted it

[`followups.md`](../followups.md) carried the removal as settled and
named four debts the replacement owed: the blend weights for a
variable-length query set, cold start, threading context into the
classifier so it can answer what retrieval is missing, and the probe
capture shape. None had an answer. This session worked them.

## The replacement stack

| Slot      | Source                                    | Present when                     |
| --------- | ----------------------------------------- | -------------------------------- |
| Q1 action | The turn's user action                    | Always                           |
| Q2 digest | Structural template, summary line removed | The rendered digest is non-empty |
| Q summary | `metadata.summary` of the last AI entry   | The classifier emitted one       |
| Q direct  | 0-3 classifier-emitted query strings      | Per string emitted               |

Between **one and six queries**, each embedded and KNN-queried
individually. Only Q1 is structurally always-present, and only because
retrieval runs after the Pre phase commits the user-action delta.

## Why the summary splits out of Q2

Q2 renders a structural template whose last line is the piggyback
summary — a natural-language sentence averaged into one vector with a
comma-separated proper-noun list. The two have different shapes and
different reliability profiles, and the concatenation serves neither.

Splitting is not only about embedding them apart. The summary gets its
**own weight**, rather than sharing the digest's, because the digest is
deterministic and free while the summary is LLM-emitted and optional. A
shared weight means that on every turn the model fails to emit a
summary, the digest silently inherits its share and gains influence
nobody tuned for. Canon already treats that reliability split as
load-bearing — the
[reliability split canon already drew for Q2](../memory/retrieval.md#q2-structural-digest)
— and separate shares are what keep it honest.

## The direct query emission

The classifiers gain an optional emission carrying **up to three query
strings**, each embedded and queried individually rather than
concatenated.

**Capped at three, and the cap is a cost decision.** KNN is the pass's
second-largest term and scales linearly in query count:
[Per-turn cost budget](../memory/retrieval.md#per-turn-cost-budget)
prices three vectors across five types at roughly 35ms (dim 384) and
75ms (dim 768). Six queries doubles the pass count to thirty. Six is
where the projected worst case stops fitting the stated budget.

**Emission contract.** Absent-tolerant and malformed-tolerant, matching
`metadata.summary` exactly: absence is not a parse failure, and a
free-text field's parser cannot throw. This matters more than it looks
— `piggybackParseSucceeded` is `blockFound && parseFailures.length === 0`,
so any field-level failure fires a full extra structured call. An
optional retrieval hint must never be able to trigger that.

Three degenerate emissions the contract closes: identical strings are
deduplicated before embedding (three copies would split the pooled
share evenly and cost triple the KNN for one signal), empty strings are
filtered as Q2's presence derivation already filters, and an oversized
emission is capped rather than left to the
[truncation contract](../memory/retrieval.md#truncation-contract).

**Emission grammar.** Both implementations gain the field: a
`<retrieval_queries>` tag inside piggyback's `<state>` block, and the
matching optional array on the fallback classifier's structured-output
schema.

**Persistence** follows `metadata.summary`: a top-level optional field
on entry metadata, capped at three, excluded from `stateReport`, and
**not inherited**. Non-inheritance is the load-bearing half — only
`sceneEntities`, `currentLocationId` and `worldTime` carry forward, and
a query carried forward from three turns ago is precisely the staleness
this redesign removes.

**Read site.** Both new queries read the same row: the last AI-authored
entry's metadata, which is where `metadata.summary` is already read
from. One entry's worth, never a union across the window.

## The blend

Four weight slots, renormalized across whichever are present:

```
w_action  = 0.30   Q1
w_digest  = 0.25   structural, presence-derived from the render
w_summary = 0.20   LLM-emitted, optional
w_direct  = 0.25   pooled, split evenly among present direct queries
```

Placeholders in the same sense the current three are.

**The direct pathway gets one pooled share rather than per-query
shares.** Under per-query equal weighting, a model emitting three
queries hands the direct pathway half the blend and one emitting none
hands it nothing — emission volume becomes influence, and the blend's
composition swings turn to turn on how much the model felt like
writing. Pooling means emitting three sharpens the pathway's aim
without buying it weight.

At N=1 the scheme must behave correctly: Q1 renormalizes to 1.0, pure
action similarity. That is the accepted cold-start behaviour, not a
bug.

**N=0 is not retrieval.** With no query vectors every pool is empty and
the ranker ranks nothing. Two things still seat: the structural floor,
and — if `keywordRetrieval.mode` is `inject` — the
[keyword injection](../memory/retrieval.md#keyword-injection) pre-pass,
which needs no vectors. `boost` cannot survive a zero-query pass, since
it modifies scores on candidates that do not exist. Inject is the only
retrieval pathway in the system that produces output without a single
vector.

## One contract, two implementations

Piggyback's tagged block and the per-turn fallback classifier are not
two designs. They are one contract with two implementations, and they
are required to produce the same output — the property `metadata.summary`
already demonstrates, since both write it.

That has a consequence the new field forces into the open. Every field
currently in the block can be extracted from the same prose by either
path. This one cannot: it asks the model what context it is **missing**,
and the two paths do not see the same context. Piggyback is the
narrative call and already holds the assembled memory blocks. The
fallback is an isolated structured call that receives only the entity
roster and `lastTurns`.

**Resolution: the fallback receives most of what the narrative gets.**
Equal output cannot come from strictly poorer input, so the fallback's
prompt gains the memory blocks, the in-scene and current-location
sections with descriptions, and the calendar vocabulary.

It deliberately does **not** receive Setting, Genre or Tone — those
steer prose style, and feeding them to an extraction call biases it
toward narrating rather than reporting — nor either output-format
macro, since the fallback carries its own structured-output schema.

It keeps one thing the narrative call never has: the flat referenceable
entity roster with bracketed IDs. The narrative sees only in-scene plus
retrieved entities, while the fallback must be able to name an entity
in `sceneEntities` that neither set contains. The contexts are not
symmetric in both directions.

**This costs a second input pass, and that is accepted.**
[`cadence.md`](../memory/cadence.md) names duplicate input cost as one
of the two architectural drivers behind piggyback existing — "potentially
~60k tokens, which dominates per-turn cost even on cheap models". The
cost is accepted because the fallback is the exception path: with
capability detection shipped, piggyback is the default and the fallback
fires only on parse failure. Paying full input on an exception buys a
stand-in that can actually stand in.

One consequence to record rather than solve: a model that permanently
fails the tagged-block capability gate never gets piggyback, so those
stories pay the doubled path every turn — and they skew toward small,
cheap and local models whose users are the most token-sensitive.
Empirically the gate looks survivable at that size; piggyback was
tested working on Gemma 4 E4B. Whether that reliability degrades as
context fills belongs to capability detection, not here.

## Marking the extraction turn

`lastTurns` is not a window — it is a **fixed pair**, the last two
non-system entries, deliberately bounded so that neither the buffer
knobs nor a template can narrow them. The reason is in the code: the
user's action can itself carry state changes ("I put the sword away"),
not just the AI's reply. Extraction targets the last of the pair.

The current template renders `Extract scene state from this turn:` over
a loop of both entries, with nothing distinguishing them. That is
tolerable at two, because action-then-reply reads in order. It stops
being tolerable the moment the classifier sees more.

Two constraints follow. A knob controlling how much the classifier sees
**must not be able to narrow the fixed pair**, and every entry beyond
the extraction target must be explicitly marked as background.

**The larger half is the memory blocks.** The bundle we are adding is
full of past-turn prose — retrieved happenings, chapter summaries, lore
bodies — older and bulkier than any tail of entries, arriving with no
framing that says "reference material, not this turn". Marking
discipline has to cover the blocks, or the context expansion becomes
the main source of the contamination the marking exists to prevent.

### The knob

```
classifierContextEntries: number   // trailing entries the fallback sees
                                   // min 2 (the fixed pair), default 4
```

Counting the pair rather than sitting above it, so the user-facing
control reads "how many recent entries does the classifier see" and the
floor is a schema-enforced minimum rather than a documented promise.

Its read follows the precedent
[`readScanEntries`](../../lib/retrieval/scan-surface.ts) set: its own
query, not a slice of the prompt buffer, so the buffer knobs cannot
silently narrow it.

## Cold start

Turn 1 loses Q3 and gains nothing, and that is correct.

The current canon paragraph says the opening entry "reaches retrieval
through nothing" once Q3 is removed. That is wrong on its own terms.
The
[opening-entry classifier exception](../architecture.md#opening-entry-classifier-exception)
states the first AI reply's prompt includes the opening prose
**verbatim**, because chapter 1 holds only the opening entry and the
protected buffer floor pulls it in. Q3 was embedding a copy of text the
buffer was already injecting whole.

So turn 1 ranks on Q1 alone, and retrieval at turn 1 is only choosing
_additional_ lore, entities and happenings — of which a fresh story has
approximately none. Cold start is a canon rewrite with a stated reason,
not a mechanism to design.

## Degeneracy has to be measurable

Q3 was not killed for being lexical. Its first structural finding was
that it **could never report itself absent**, so a degenerate extract
still spent its full share, textually indistinguishable from a good
one.

The replacement handles absence correctly and would handle degeneracy
not at all. A model emitting "the tavern" every turn produces a
present, well-formed, useless query that spends its share retrieving a
row the floor already seated. That is Q3's failure mode with a new
author, and shipping it would make this design fail its own reason for
existing.

**The mechanism.**
[`buildStructuralFloor`](../../lib/retrieval/run.ts) runs before the
query stack is built, so by KNN time both halves exist: `seatedIds`,
and the per-query hit lists. Per direct query, over its own top-K
_before_ pool filtering:

```
redundancy = |topK ∩ floor.seatedIds| / |topK|
```

Near 1.0 means the query retrieved rows already in the prompt. Near 0
means it surfaced something the floor did not have.

This computes nothing new. Pool assembly already discards exactly that
intersection every turn — the floor filters run after KNN, not inside
it, so floor rows come back from the vector search and are dropped
during assembly. We record what is currently thrown away.

**Observability only in v1.** No auto-dropping of a degenerate query:
setting that threshold needs data nobody has yet, which is the repo's
existing stance on the classifier's own `τ_high` / `τ_low`. Capture
first.

**What it does not catch:** a query retrieving novel but irrelevant
rows. A random noun scores low redundancy while being useless. This
detects "asked for what it already had", which is the predicted failure
mode, not uselessness in general.

## Cost

Extrapolated from the measured table, not measured — nobody has run
thirty KNN passes.

|                | now    | 6-query worst case |
| -------------- | ------ | ------------------ |
| KNN, dim 384   | ~35ms  | ~70ms              |
| KNN, dim 768   | ~75ms  | ~150ms             |
| Total, dim 384 | ~108ms | ~143ms             |
| Total, dim 768 | ~175ms | ~250ms             |

Desktop lands on the stated ceiling at dim 768. That is less alarming
than it reads: the budget section frames its obligations as **scaling**
constraints — no term proportional to awareness rows or branch entries
— and query count is a fixed small constant, not a scaling term.
Retrieval remains under 1% of a turn that takes tens of seconds.

The doubling bites in the two places the table does not cover, and both
become obligations on the implementing slice rather than assumptions
this design gets to make:

- **The embedder is excluded from every figure** — it goes from three
  embedding calls per turn to six, and on a local ONNX embedder it is
  plausibly the largest single term in the pass. Unmeasured.
- **Mobile is unmeasured and now doubled.** Canon already flags that
  nothing has run the ranker on-device against fifteen passes. Thirty
  makes an open risk twice as open.

## Probe capture

Arity three is baked into three places, all of which become
variable-length:

- `ProbeCapturePayload.queries`, typed as a fixed three-tuple.
- `CaptureCandidate.sim_q1` / `sim_q2` / `sim_q3`, three separate
  fields.
- The ranker's own `simsFor`, which returns a three-element tuple.

`CaptureQuery.source` loses `prose_extract` and gains the new values;
`sentence_scores` is deleted with the scorer that produced it;
`CAPTURE_VERSION` goes to 6. The redundancy ratio is captured per
direct query alongside its text.

## Rejected

- **A single free-text query line.** Structurally the cheapest option:
  a total parser, no failure path, fixed four-slot arity, and the
  variable-length weighting debt would have dissolved into the presence
  mechanism Q2 already ships. Rejected for retrieval quality — three
  individually-embedded queries aim better than one sentence.
- **Typed queries bound to a retrieval type.** Sharpest targeting,
  rejected on two counts: it multiplies KNN passes per type, and it
  needs the most throw-prone parser in the set, which reintroduces the
  full-fallback-on-malformed problem.
- **Per-query equal weight shares.** Lets emission volume buy
  influence.
- **Sending the fallback only a digest of seated row identities**
  rather than the rendered blocks. Cheaper, and it would have answered
  the queries field alone — but it does not serve the equal-input
  requirement that makes the fallback a real stand-in.
- **The periodic classifier as an emitter.** Out entirely. It runs on a
  cadence over a multi-turn window; a query it emitted three turns ago
  is stale in exactly the way this redesign exists to remove.

## Carried forward

**Out of scope, needs a followup.** The keyword injection pathway is
gated behind the thing it does not need. `run.ts` returns on an
embedder failure roughly fifty lines before `buildKeywordInjections`
runs, so when the embedder actually fails — model not loaded, ONNX
error, provider down — the one vector-independent pathway never
executes, and a story in `inject` mode gets nothing where it could have
had its keyword hits. Zero queries is handled correctly; a broken
embedder is not, though the reason inject works in the first case
applies identically to the second. Touches the failure arm of
`RetrievalPartial` and the probe's failure lane, so it is a second
subsystem rather than a fold-in.

**Tuning surface.** The parked Tier-2 ranker-knob surface names three
query weights and inherits four.

**Story Settings.** `classifierContextEntries` is a user-facing knob and
needs its control on the Story Settings surface.
