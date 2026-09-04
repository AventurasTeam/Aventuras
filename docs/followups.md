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

- **Happening involvements drift when scene membership is edited after
  the fact.** Involvements record who was present at an entry, so a later
  edit to that entry's `sceneEntities` can contradict them. Rolling back
  and re-running the classifier pass is disproportionate: it
  over-reverses (facts anchored to surviving entries must be spared per
  the survival anchor), costs a full LLM pass for a small correction, and
  can silently rewrite happenings the user never touched. Prefer flagging
  affected involvements for review over recomputing, which also matches
  the established posture that user edits stick only until the classifier
  reads contradicting prose
  ([`data-model.md → Authorship contract`](./data-model.md#authorship-contract)
  parks the manual-edit-vs-overwrite policy as its own question). Raised
  as an open question on
  [Slice 3.3](./implementation/milestones/03-memory-floor/slices/03-classifier.md);
  it outlived the slice because the trigger is the edit surface, not the
  classifier itself — and that surface shipped 2026-09-03 as the
  [scene editor](./ui/patterns/entry-card.md#scene-editor), so the drift is
  reachable today rather than anticipated.

- **Entry content edits are irreversible, and that may read as a bug
  from the user's side.** `story_entries.content` is the delta log's
  single per-column side-channel exemption
  ([`data-model.md → Entry mutability & rollback`](./data-model.md#entry-mutability--rollback)):
  editing it mutates the row directly, writes no delta, and preserves
  no prior text, so CTRL-Z cannot reach it. `updateStoryEntryContent`
  (`lib/actions/story-entries/operational.ts`) additionally calls
  `undoRedoStore.clear()`, so a typo fix discards the redo stack for
  unrelated actions — but that matches canon rather than exceeding it
  ("the stack clears on any new action", same section), and mirrors by
  hand what `apply-delta-action.ts` does for every delta-logged write.
  The genuine asymmetry is narrower: writing no delta, a content edit
  is the only action that clears the forward path while contributing
  nothing to the backward one, so it is pure loss where every other
  action trades redo for undo. Narrowing it is therefore a canon
  change, not a blast-radius fix, and cannot be split off from the
  question below (re-verified 2026-08-24). The metadata edits on the
  same card are fully delta-logged and reversible, so an entry now
  carries two adjacent edit affordances with opposite reversibility and
  no visible reason for the difference — the world-time footer and the
  scene editor both reverse, the content edit does not. The exemption is a
  deliberate storage-economy decision, not an oversight — the open
  question is whether the UX is defensible as-is, wants an editor-local
  undo stack, or wants the redo-clear narrowed. Surfaced 2026-07-23
  alongside the world-state-block design but never scoped into it; that
  pass shipped 2026-09-03 and left this untouched.

- **Q3 needs an overhaul and a re-spec, not signal-by-signal patches.**
  [`retrieval.md → Q3`](./memory/retrieval.md#q3-heuristic-prose-extract)
  specifies five per-sentence signals; three of them, plus the
  tokenizer underneath, assume a lexical, Latin-script, past-tense
  narrative, and the design has no way to report that the assumption
  failed. The two High signals (entity-name, lore-keyword) are the
  exception and are sound — `matchTerms` uses `\p{L}\p{N}` lookarounds
  specifically so accented and Cyrillic names match, and they reuse an
  index the hybrid pathway already builds. That layer is worth keeping;
  what sits around it is what wants redesigning.

  Two structural findings drive the re-spec, ahead of any individual
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

  One redesign direction worth arguing: drop the hardcoded verb list
  for a term set derived from the branch's own happening titles, which
  the classifier writes in the story's language — self-localizing, no
  linguistics, reuses an index the pass already builds. The
  circularity is sharper than it first reads, and settling it is part
  of the re-spec: happening titles summarize what the memory layer has
  already absorbed, so scoring sentences by resemblance to them biases
  Q3 toward recorded material and away from the novel prose a
  retrieval pass most needs to surface.

  Scope is the canon signal table, the sentence tokenizer, the
  presence contract and the scorer — a spec change before it is a code
  change. The dialogue-span regex was previously carved out here as
  separately shippable; folded back in 2026-08-24, because landing it
  alone tunes one Medium signal inside a scoring model that is being
  replaced. Surfaced 2026-08-06 reviewing
  [Slice 3.4](./implementation/milestones/03-memory-floor/slices/04-retrieval.md).
