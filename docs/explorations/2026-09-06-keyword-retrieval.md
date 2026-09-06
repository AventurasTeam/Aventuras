# Keyword retrieval — entity keywords, keyword mode, scan surface

Session record, 2026-09-06. Covers the keyword half of a retrieval
discussion that also settled Q3's fate; the Q3 replacement is **not**
in scope here and its open items live on
[`followups.md`](../followups.md).

The spec landed in canon — see
[`retrieval.md → Keyword injection`](../memory/retrieval.md#keyword-injection),
[`→ Keyword scan surface`](../memory/retrieval.md#keyword-scan-surface),
[`→ Keyword injection budget`](../memory/retrieval.md#keyword-injection-budget)
and
[`data-model.md → Injection modes`](../data-model.md#injection-modes--unified-enum--structural-invariant).
This file keeps what those cannot: why the shape is what it is, and
what was rejected on the way.

## What prompted it

Two things. A feature gap — entities could only be matched by their
canonical name, and there was no way to make a keyword hit inject
rather than boost. And, found while surveying for the first, a
conformance defect.

## The finding: the scan surface had drifted from canon

[`retrieval.md → Hybrid retrieval per type`](../memory/retrieval.md#hybrid-retrieval-per-type)
specifies the keyword pathway as a lexical complement over narrative
prose — entities as "Keyword on `name` — direct prose reference", and
lore's pathway called load-bearing because embedding models "have no
semantic prior on user-authored proper nouns".

The shipped code scans something else: `run.ts` builds
`queryText: queries.embedTexts.join('\n')`, so the surface is the
assembled query stack — the user action, the rendered digest, and the
three-to-five sentences Q3 selected. A lore keyword occurring anywhere
else in the last entry never fired.

That made the load-bearing pathway for the type canon singles out as
most dependent on it conditional on the weakest component in the
system. Partial rather than total, since Q3's scorer weights
entity-name hits highest and so preferentially selects name-bearing
sentences — but top-K is three to five, and an entry naming eight
entities across fifteen sentences drops most of them.

Nothing in canon supported it; it reads as reuse of an array that
happened to be in scope. **So the change is conformance work, not new
behaviour** — the spec was right and the implementation had narrowed
it. Recorded here because that framing is invisible from the diff.

Defining the surface independently also decouples this from Q3's
removal. Had it stayed derived from the query stack, deleting Q3 would
have silently changed keyword matching, and the replacement's
LLM-emitted queries would have become the lexical surface — model
guesses about missing context are strictly worse to keyword-match
against than the prose the user and model actually wrote.

## Decisions and what they beat

**A second axis, not a fourth `injection_mode` value.**
`injection_mode` answers whether a row injects; what a keyword hit
_does_ is a different question. Folding them together yields
`always | auto | auto_plus_keyword | disabled`, whose third value is a
hybrid of two unrelated decisions. Cost of the split is one
precedence rule — `disabled` beats `inject` — which canon states.

**A story-wide setting, not per-row.** Per-row keyword sets already
give per-row activation: every row fires on its own terms, so the
global switch only decides what firing _means_. What it cannot express
is mixed policy — boost most rows, hard-inject a few — and
`injection_mode='always'` already covers the rows that matter there.

**`inject` is budgeted; `always` is not.** `always` is a per-row
explicit intent on a small set of rows, and it is already a
[structural floor](../memory/retrieval.md#structural-floor--always-inject)
member seated before budgets exist. `inject` is a story-wide policy
that can match arbitrarily many rows in one turn, which is the classic
lorebook failure — one scene naming ten keyworded rows consumes the
window. The cap is what makes badly-authored keywords a bounded
problem, so it is load-bearing rather than a nicety.

**`priority` orders overflow; similarity was rejected.**
Keyword-direct rows do not all carry a similarity score — the match is
lexical and sits outside the embedder pools — so ordering by
similarity would mean either pulling matches through a retrieval pool
they had no reason to enter, or leaving part of the set unordered.
`priority` is also the user-facing answer, which matters for a
mechanism users debug by adjusting it.

The counter-case, accepted rather than solved: a user may set a niche
lore row's priority _low_ deliberately, yet its rare keyword firing is
the strongest possible relevance signal, and under contention it loses
to broad high-priority lore that also matched. If that bites, the
answer is a separate `keyword_priority` — a second dial on every row,
not worth adding before evidence.

**`entities.priority` stays out of the ranker.** Canon sets
`pin_signal = 0` for entities, and honouring that keeps the scoring
function untouched. `lore.priority` does feed `pin_signal`, so on lore
the column carries a second effect. The two never apply to the same
row on the same turn — a keyword-matched row is seated without
reaching the ranker — and both readings run the same direction.

**`inject` restricted to lore and entities.** It needs a user-curated
keyword set and an ordering key, and only those two have both. For
chapters that is a deliberate narrowing against a schema comment
reading "for retrieval / injection". For happenings the reason is
harder: their hits are derived from entity names inside freeform
awareness descriptors, and direct seating would bypass
[POV-awareness scope](../memory/retrieval.md#pov-awareness-scope),
seating happenings no in-scene character is aware of. That is an
information leak, not a tuning preference, and it decided the rule.

**Per-keyword script detection for CJK, not a segmenter.** Chinese and
Japanese do not delimit words with spaces and Korean attaches
particles directly to nouns, so word-boundary anchoring silently
misses in all three. Proper segmentation needs a dictionary or
morphological analyzer — a dependency and a model download not worth
taking for a matching rule. Substring matching is safe for these
scripts specifically because their characters are morphemes.

**Same-name suppression wins over keyword injection.** Layer A's
trigger is a staged entity's name appearing in recent prose; under the
new scan scope that is nearly identical to `inject`'s fire condition —
the same signal driving opposite actions. Canon justifies the `always`
exemption as per-row user intent, which a story-wide mode is not, and
exempting keyword hits would resurrect every suppressed staged entity
for any story running the mode. See
[`edge-cases.md → Layer A`](../memory/edge-cases.md#layer-a--retrieval-time-same-name-suppression).

## Also fixed here

`lore.keywords` had **no documented edit surface anywhere in the UI
docs** — a shipped, user-authored column canon calls load-bearing,
with nowhere specified for a user to author it. Folded in because the
feature is inert without it.

## Out of scope

- **Q3's replacement.** Direction settled — Q3 is removed rather than
  re-specced, with the per-turn classifier supplying queries directly
  and Q2's summary splitting into a query of its own — but it is its
  own design session. Open items, including the cold-start regression,
  are on [`followups.md`](../followups.md).
- **Per-row keyword mode.** Covered by per-row keyword sets plus
  `injection_mode='always'`.
- **Cross-type budget spillover.** Unchanged, and parked.
