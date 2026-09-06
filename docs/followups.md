# Follow-ups

Top-level ledger of **active** outstanding items — design questions
or work the current milestone (v1) needs answered, or that block
other v1 work. Resolved items are **removed** (not crossed out); the
commit that resolves an item carries the resolution narrative.

Items confirmed for a future milestone or parked indefinitely
pending signal live in [`parked.md`](./parked.md). Movement between
the two files is normal as scope clarifies; see
[`conventions.md → Followups vs parked`](./conventions.md#followups-vs-parked)
for the placement rule.

## UX

- **Q3 is removed; its replacement needs a design.**
  [`retrieval.md → Q3`](./memory/retrieval.md#q3-heuristic-prose-extract)
  specifies five per-sentence signals; three of them, plus the
  tokenizer underneath, assume a lexical, Latin-script, past-tense
  narrative, and the design has no way to report that the assumption
  failed. The two High signals (entity-name, lore-keyword) are the
  exception and are sound — `matchTerms` uses `\p{L}\p{N}` lookarounds
  specifically so accented and Cyrillic names match, and they reuse an
  index the hybrid pathway already builds. That shared index is worth
  keeping and outlives Q3 — the keyword pathway uses it directly; the
  per-sentence scorer built on top of it is what goes.

  Two structural findings drive the removal, ahead of any individual
  signal:
  - **Q3 can never report itself absent, so a degenerate extract still
    spends its full `w_prose` share.** `buildQueryStack`
    (`lib/retrieval/queries.ts`) derives presence from `nonEmpty(text)`,
    and `extractProse` returns top-K by source-order tie-break even when
    every sentence scores zero — so a no-signal extract is textually
    indistinguishable from a good one and reads present. Canon already
    reasoned this exact failure through for Q2, which renders to the
    empty string when every conditional line is empty and correctly
    drops out of the blend
    ([`retrieval.md → Q2`](./memory/retrieval.md#q2-structural-digest));
    Q3 shipped without the equivalent, which makes this an
    inconsistency inside the spec rather than a gap in the code. It is
    also the prerequisite for measuring anything else here: a silent
    degradation cannot be tuned against, so no empirical argument about
    `w_prose` is available until Q3 can say it found nothing.
  - **The score carries too little resolution to rank with.** Five
    booleans sum to at most 11, and an ordinary sentence lands in the
    0-4 band, so ties are the common case and every tie resolves to
    source order. Selection collapses toward "the earliest sentences
    that scored at all" well before any language mismatch enters the
    picture. The signals are also summed as though independent when
    they are not: `said` and `Drew` each fire the verb weight and the
    entity weight off a single token.

  The language-shape findings underneath, verified 2026-08-06 against
  the shipped code:
  - **Action verbs.** `ACTION_VERBS` (`lib/retrieval/prose-extract.ts`)
    is 13 hardcoded English simple-past verbs matched by exact
    `Set.has`, no stemming. `stories.settings.definition.narration`
    offers `first | second | third` with **no tense axis**, so
    second-person present ("You draw the blade") — a first-class
    supported register — hits none of them: `drew` scores, `draws` /
    `draw` / `drawing` do not. There is also no narrative-language
    setting at all (`translation.targetLanguage` is the translation
    _target_; entries store the original), so a story written in
    Spanish or Russian scores zero on this signal permanently.
  - **Dialogue spans.** `DIALOGUE_SPAN` covers `"…"`, `“…”` and `‘…’`
    and misses `«…»` (French, Russian), `„…”` (German, Polish, Czech)
    and `「…」` (CJK). Same weight, same silent miss.
  - **Brevity** is character-counted (`BREVITY_MAX_CHARS = 90`), so in
    CJK it fires on nearly every sentence and stops discriminating.
  - **CJK is never split into sentences at all**, which sits upstream
    of every signal above. `splitSentences` terminates on `[.!?…]`
    followed by whitespace; CJK uses ideographic terminators and no
    inter-sentence space, so a whole entry collapses to one "sentence".
    Q3 then embeds the full 400-1000 token entry — the cost the extract
    exists to avoid — and `scores` degenerates to a single meaningless
    number, emptying the probe's per-sentence capture. Verified against
    the shipped splitter (2026-08-06): a three-sentence Japanese
    passage returns one element.
    [`name-index.ts`](../lib/retrieval/name-index.ts) documents CJK as
    out of scope for word-boundary matching; nothing documents it for
    splitting, so this reads as an oversight rather than a deferral.
    Whatever replaces the scorer has to own this first.

  **Direction settled 2026-09-06: remove, do not re-spec.** The
  per-turn classifier already runs on every turn and writes in the
  story's own language and register, so it supplies retrieval queries
  directly instead of a heuristic reconstructing them from prose
  statistics. Q2's piggyback summary line splits out of the structural
  digest into a query of its own, so a natural-language sentence stops
  being averaged into a single vector with a comma-separated
  proper-noun list. That deletes the signal table, the scorer and the
  sentence tokenizer outright rather than repairing them, and the
  presence problem dissolves with them: a classifier that emits nothing
  yields no query, which the blend already re-normalizes around.

  What the replacement design still owes:
  - **The blend weights.** `w_action` / `w_digest` / `w_prose` assume
    exactly three queries. A variable-length query set needs a
    weighting scheme, and the split summary needs a share of its own.
  - **Cold start regresses without an answer.**
    [`retrieval.md → Cold start`](./memory/retrieval.md#cold-start)
    has turn 1 lean on "Q3: heuristic prose extract from the opening
    entry, which the wizard always commits." Delete Q3 and turn 1 is
    left with the user's first action and a thin digest — no
    classifier has run yet — so the opening entry, the only world
    content a fresh story has, reaches retrieval through nothing. The
    replacement has to seat it another way.
  - **The classifier cannot yet answer what retrieval is missing.** As
    prompted it receives only the entity roster and the raw turns, not
    the memory blocks the narrative call was given, so it has no view
    of what was already in context. It needs that context threaded in.
  - **Probe capture.** `CaptureQuery.source: 'prose_extract'` and the
    per-sentence `sentenceScores` capture go with Q3;
    [`probe.md`](./memory/probe.md) needs the replacement's shape.

  The keyword pathway is already decoupled from this: the scan surface
  no longer derives from the query stack, so Q3's removal cannot
  disturb keyword matching. Surfaced 2026-08-06 reviewing
  [Slice 3.4](./implementation/milestones/03-memory-floor/slices/04-retrieval.md).

- **M4.4 — "Upgrade to current default" story-open prompt deferred from 3.1b.**
  Canon ([`retrieval.md → Model swap UX`](./memory/retrieval.md#model-swap-ux))
  names a second dialog entry point: a prompt when opening a story whose
  embedding model differs from the current app default; accepting it fires
  the swap dialog. Slice 3.1b shipped only the Story Settings entry point
  (planning decision 2026-07-24) — the prompt needs its own "stops nagging
  until the next manual swap attempt" persistence decision. Owner: a future
  reader/settings slice. Surfaced by M3.1b Task 14 (2026-07-24).

- **M4.5 — Custody of a failed turn's text rests on one deletable system entry.**
  A failed or refused turn reverse-replays its own `user_action` with the
  rest of its action group (`abortRun` → `reverseReplayDeltas`, and
  `submitTurn`'s own rejected arm), so the text the user typed survives
  only as `metadata.systemFailure.submission` on the failure entry that
  replaces it — pinned by `submit-turn.test.ts`'s
  `expect(branchEntries('b1')).toHaveLength(0)`. Two paths then delete
  that entry with no restore: **Dismiss** (`dismissSystemEntry` is a bare
  `clearSystemEntry` plus `reload`, and dismissing an error is not a
  request to discard the draft behind it), and the pre-dispatch tail clear
  (fixed for regenerate's rejected arm in M3.10, still uncompensated when
  the dispatch throws). In-session `lastSubmission` masks both; after a
  restart the text is gone. The alternative shape to weigh: keep the
  `user_action` standing on failure and let Retry re-dispatch against it —
  which is exactly what regenerate already does — so only an explicit
  cancel reverses it, returning the text to the composer. That would make
  the failure entry a pure notice with no custody role and delete this
  class of bug rather than patching its instances. Wants a reader-composer
  design pass, not a local fix. Raised 2026-08-16.
