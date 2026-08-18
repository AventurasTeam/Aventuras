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

- **Optional user-side scene tagging on user-written openings.**
  User-written openings start with empty
  `metadata.sceneEntities` / `currentLocationId` / `worldTime: 0`
  per the locked
  [opening entry contract](./data-model.md#opening-entry).
  Turn-2 classifier picks up scene presence from there. Some users may
  want to pre-tag scene presence on the opening at wizard time — pick
  which cast members are in the opening's scene, which location is
  current — so first-turn generation context is grounded from entry 1.

  Wizard concern, not data-model. The
  [Wizard design pass](./explorations/2026-04-30-story-creation-wizard.md)
  landed without this affordance — AI-generated openings emit
  metadata refs via structured output, but user-written openings
  remain empty until turn-2 classifier picks up. Adding a manual
  scene-tagging surface on the wizard's step 5 was deliberately
  deferred. Lifted from parked to active during 3.6b slice planning
  (2026-08-13): with the Cast step landing, a starting-location
  marker for user-written openings is the remaining gap turn 1
  cannot recover on its own. The data shape already supports it
  (metadata fields exist and are user-editable per
  [Entry metadata shape](./data-model.md#entry-metadata-shape));
  only the wizard UX is missing.

- **Suggest-cast unresolved references should surface visually, not
  fall back to `null` silently.** Canon
  ([`wizard.md → AI-suggest — structured identity`](./ui/screens/wizard/wizard.md#ai-suggest--structured-identity))
  resolves a suggestion's `parent_location_name` / `faction_name`
  at import time against same-kind rows in the imported selection
  and the existing cast, and unresolved names fall back to `null`
  with no feedback — the user learns their suggested character's
  faction never attached only by opening the editor later. Wanted:
  resolve at runtime in the list surface and render an inline error
  or warning on rows whose references cannot be resolved (e.g. the
  named faction was left unchecked at import). Surfaced during 3.6b
  slice planning (2026-08-13); deliberately not in 3.6b scope.

- **World-state block: render from metadata, strip the XML out of
  persisted entry content.** Scheduled for the post-M3 reconciliation
  pass, before M4 opens. Today `EntryCard` detects the block by
  scanning persisted `content` for a literal `<state>` substring
  (`stripTrailingBlocks`, `lib/piggyback/parse.ts`) and renders the raw
  XML verbatim. Three things follow: the fallback per-turn classifier
  writes metadata and deltas but never touches `content`, so its block
  is structurally invisible; the icon means "the model emitted XML,"
  not "state was applied," so a parse failure still shows a block that
  had zero effect; and the edit textarea binds raw `content`, so
  editing an AI entry drops the user into the XML. Target shape is a
  formatted human-readable block sourced from entry metadata with ids
  resolved to entity names, the XML filtered before persist, and a
  bespoke edit surface for the block's fields.

  Scope is **both** trailing blocks, not only `<state>`: `<suggestions>`
  persists the same way and leaks the same way. Filtering before persist
  is also what retires the prompt-side mitigation — as of 2026-08-07 four
  consumers call `promptProse` (`lib/piggyback/parse.ts`) to strip on
  read, because `story_entries.content` is the raw reply: the per-turn
  template's story-so-far loop, Q3's prose extract, Layer-A same-name
  suppression, and the periodic classifier's turn window. All four become
  no-ops once rows are prose-only, so this task **supersedes** that
  mitigation rather than building on it. That widens the "echoed state
  block disappears on its own" consequence recorded below, which was
  written against the story-so-far loop alone: the other three consumers
  are M3.4-era and post-date it. The legacy-row question is already
  settled below in the tolerant-reader's favour, and it now covers
  `promptProse` as well as `stripTrailingBlocks`.

  Decided (2026-07-23):
  - **Edit scope splits by field class, not by position alone.**
    `content` stays as shipped — freely editable on any non-system
    entry, via the non-delta side-channel. `worldTime` likewise stays
    free on any entry and any kind: it is a no-cascade scalar, nothing
    materializes from it (happening times derive live from the
    referenced entry), and the monotonicity indicator already surfaces
    the only way to get it wrong. The **scene fields** —
    `sceneEntities`, `currentLocationId` — are the restricted class:
    **last story entry only**, and _applied_ to world state rather than
    merely recorded. They alone drive materialized derived state
    (per-character `current_location_id`, `lastSeenAt`, staged
    promotion), which is a fold over entries — editing the tail re-folds
    one step with nothing downstream to invalidate.
  - **The block's scene fields render read-only on non-tail entries.**
    Editable only where the edit can be applied. A control present
    everywhere but effective only at the tail repeats the failure mode
    this item exists to remove — an affordance whose result depends on
    something the user cannot see. The world-time footer is unaffected;
    it stays interactive everywhere per
    [Slice 3.8](./implementation/milestones/03-memory-floor/slices/08-worldtime-edit.md).
  - **`worldTime` on `user_action` entries keeps its edit hook.** It has
    no forward effect today — the reply that follows a user action is
    computed from the pre-edit base, and submit dispatches the pipeline
    in the same action, so there is no window in which an edit reaches
    the next generation. Restricting it would buy nothing, since the
    edit is inert either way; the hook stays as the seam the parked
    time-advance affordance builds on, see
    [`parked.md → Time-advance selection at user-entry submit`](./parked.md#time-advance-selection-at-user-entry-submit).
  - **The block never reaches the DB; metadata carries everything the
    classifiers emit.** `content` stores pure prose only — the block is
    extracted and parsed at write time, and `entryMetadataSchema` grows
    to hold the full parsed result rather than only the three scene
    fields. This settles what would otherwise have been a two-source
    render: `visualChanges` and `transfers` currently survive only as
    deltas, so a metadata-driven block would have been strictly less
    informative than the XML it replaced. Two consequences fall out —
    the echoed-state-block problem in the next turn's prompt disappears
    on its own (nothing to echo), and reverse-then-reapply becomes
    viable, since its blocker was having no persisted source to
    re-apply from.
  - **Save and regen.** The edit surface offers "Save and regen"
    alongside Save. Editing a `user_action` after its reply exists
    diverges the story silently — the reply answers text that no longer
    exists — and that divergence is legitimate user freedom, not a bug
    to detect. The second button makes it self-documenting and hints
    that a regen may be wanted.
  - **Construct the core generation context once per pipeline run.**
    Consumers select views over it rather than each assembling their
    own `entries` slice. `ctx.intermediates.idMap` is the existing
    precedent for shared per-run state. First concrete instance:
    `per-turn-piggyback.ts` builds a fresh `IdBiMap` instead of reusing
    `ctx.intermediates.idMap`, which is correct today only because both
    walk the same entity array in the same order — and the fallback
    fires exactly when a malformed block carrying the narrative map's
    placeholders is still sitting in the tail's content.

  Settle at planning:
  - **Metadata's shape mixes two kinds of thing.** `sceneEntities`,
    `currentLocationId` and `worldTime` are absolute state _at_ the
    entry; `visualChanges` and `transfers` are what the turn _changed_.
    Both now live on the same blob — design the schema for that split
    deliberately rather than letting it accrete, since the edit surface
    and any future diffing read them differently.
  - **`world_time_delta` needs a computed prompt variable, not static
    text.** The current wording ("seconds elapsed since the previous
    entry") is ambiguous about time consumed by the user's action.
    Resolve it at prompt-build time by comparing the user entry's
    `worldTime` against the preceding AI entry's: equal means the action
    carries no time of its own and the delta must include it; unequal
    means the action already advanced time and the delta measures from
    its end. Deterministic, and forward-compatible with both regenerate
    and the parked submit-with-time affordance.
  - **Which derivation strategy applies the edit.** Reverse-then-reapply
    (reverse the entry's original piggyback delta group, re-run the
    builder against the edited block) is correct by construction but
    needs the original parsed block persisted, since `visualChanges` and
    `transfers` exist nowhere else once the XML is stripped. Narrow
    forward-diff (emit only the corrective actions for what changed) has
    no such dependency and is tractable because the editable fields are
    set-valued, not arithmetic — but duplicates derivation logic already
    in `buildPiggybackActions`. Lean forward-diff with the derivation
    extracted into one function both paths call, which removes the drift
    risk; confirm at planning.
  - **Promotion is asymmetric.** Removing a character from
    `sceneEntities` does not demote them — no demote action exists and
    the handler rejects non-staged as a no-op. Reverse-then-reapply
    would demote via the undo payload; forward-diff would not. Lean
    "never demote" (promotion is a semantic event, the entity may have
    accumulated state, and retiring someone over a scene-list typo is
    the worse failure), but the two strategies differ here so it needs
    an explicit call. Persisting the parsed block reopens this in
    reverse-then-reapply's favor — re-check once the metadata shape is
    settled.
  - **Metadata means different things per entry kind.** An AI entry's
    metadata describes state _after_ that entry; a `user_action`'s
    inherited metadata describes state _before_ it. Same instant on the
    timeline, different relationship to the row — so one label over both
    kinds would be showing two different things.
  - **Metadata is inherited, so its presence stops being a signal.**
    `buildPiggybackActions` merges with `inheritedEntryMetadata`, and
    the three scene fields are non-optional on `entryMetadataSchema`,
    so every entry carries them. Metadata-keyed detection shows a block
    everywhere — a defensible reframing, but a deliberate one. Keeping
    the narrower "this turn reported state" meaning requires persisting
    `piggybackOutcome`, which currently lives only in
    `ctx.intermediates`. Persisting it, tagged with the producing
    layer, independently fixes the invisible-fallback complaint.
  - **Stripping removes the model's in-context format example.** Prior
    entries' blocks are currently echoed back through "Story so far,"
    which is both a correctness problem (their placeholders came from a
    different turn's `IdBiMap`) and, incidentally, the only worked
    example the model sees of the emission grammar. Removing them fixes
    the first and may cost the second; watch emission compliance when
    it lands.
  - **Persist the raw block on parse failure.** With the parsed result
    in metadata the raw text is redundant on the happy path, but a
    _failed_ parse leaves neither — no fields written and no prose
    remnant to inspect. Keep the raw text for that case; `reasoning` is
    the precedent for a large optional string on metadata.
  - **Legacy rows keep their inline block.** Prefer a tolerant reader
    (retain `stripTrailingBlocks` as a display-time fallback) over a
    migration.

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
  it outlived the slice because the trigger is the world-state-block edit
  surface above, not the classifier itself.

- **Entry content edits are irreversible, and that may read as a bug
  from the user's side.** `story_entries.content` is the delta log's
  single per-column side-channel exemption
  ([`data-model.md → Entry mutability & rollback`](./data-model.md#entry-mutability--rollback)):
  editing it mutates the row directly, writes no delta, and preserves
  no prior text, so CTRL-Z cannot reach it. The implementation goes
  further than the doc implies — `updateStoryEntryContent`
  (`lib/actions/story-entries/operational.ts`) also calls
  `undoRedoStore.clear()`, so a typo fix silently discards the redo
  stack for _unrelated_ actions. Meanwhile the metadata edits landing
  on the same card are fully delta-logged and reversible, so one entry
  will carry two adjacent edit affordances with opposite reversibility
  and no visible reason for the difference. The exemption is a
  deliberate storage-economy decision, not an oversight — the open
  question is whether the UX is defensible as-is, wants an editor-local
  undo stack, or wants the redo-clear narrowed. Not scoped to the
  world-state-block work; surfaced alongside it 2026-07-23.

- **A crash mid-burst re-classifies the window and duplicates its
  happenings.** The classifier phase yields its planned writes one at a
  time and the orchestrator commits each as its own delta; the watermark
  advances only after the last one
  (`lib/pipeline/definitions/periodic-classifier.ts`). A crash in between
  leaves the deltas on disk with `processedThrough` unmoved, so the next
  pass re-reads the same window. Boot's `resetStuckClassifierRunState`
  assumes that state is coherent ("the watermark never advanced"), but it
  is only coherent when _no_ delta landed. `createHappening` allocates a
  fresh id per call and nothing keys on content, so the replay writes a
  second copy of every happening, involvement and awareness row the
  interrupted burst had already committed. Options, roughly in order of
  cost: advance the watermark inside the same transaction as the burst;
  give the pass a run marker that recovery reverse-replays like any other
  orphan; or an idempotency key on classifier-sourced happenings. Not the
  same hole as the `state: 'running'` orphan the boot reset already
  covers. Surfaced 2026-07-31 reviewing
  [Slice 3.3](./implementation/milestones/03-memory-floor/slices/03-classifier.md).

- **Q3's Medium-weight signals are English-shaped and fail silently.**
  [`retrieval.md → Q3`](./memory/retrieval.md#q3-heuristic-prose-extract)
  scores five signals; the two High ones (entity-name, lore-keyword) are
  language-agnostic by construction — `matchTerms` uses `\p{L}\p{N}`
  lookarounds specifically so accented and Cyrillic names match. Both
  Medium ones are not, and neither degrades loudly.
  - **Action verbs.** `ACTION_VERBS` (`lib/retrieval/prose-extract.ts`)
    is 13 hardcoded English simple-past verbs matched by exact
    `Set.has`, no stemming. `stories.settings.definition.narration`
    offers `first | second | third` with **no tense axis**, so
    second-person present ("You draw the blade") — a first-class
    supported register — hits none of them: `drew` scores, `draws` /
    `draw` / `drawing` do not. There is also no narrative-language
    setting at all (`translation.targetLanguage` is the translation
    _target_; entries store the original), so a story written in
    Spanish or Russian scores zero on this signal permanently. And it
    false-positives on names: `words` is lowercased before lookup, so
    "**Drew** nodded." fires the verb weight, and if Drew is an entity
    the same token also fires the entity weight — one word, two
    signals, no action. `Said` has the same problem.
  - **Dialogue spans.** `DIALOGUE_SPAN` covers `"…"`, `“…”` and
    `‘…’` and misses `«…»` (French, Russian), `„…”` (German, Polish,
    Czech) and `「…」` (CJK). Same weight, same silent miss, but
    unlike the verb list this one is a three-alternative regex change
    with no linguistics in it — worth taking on its own if the wider
    redesign stalls.
  - **Brevity** is character-counted (`BREVITY_MAX_CHARS = 90`), so in
    CJK it fires on nearly every sentence and stops discriminating.
  - **CJK is never split into sentences at all**, which sits upstream
    of every signal above. `splitSentences` terminates on `[.!?…]`
    followed by whitespace; CJK uses ideographic terminators and no
    inter-sentence space, so a whole entry collapses to one
    "sentence". Q3 then embeds the full 400-1000 token entry — the
    cost the extract exists to avoid — and `scores` degenerates to a
    single meaningless number, emptying the probe's per-sentence
    capture. Verified against the shipped splitter (2026-08-06):
    a three-sentence Japanese passage returns one element.
    [`name-index.ts`](../lib/retrieval/name-index.ts) documents CJK as
    out of scope for word-boundary matching; nothing documents it for
    splitting, so this reads as an oversight rather than a deferral.
    Whatever replaces the scorer has to own this first.

  Failure is silent throughout: when every sentence scores 0,
  `extractProse` still returns top-K by source-order tie-break, so Q3
  quietly degrades to "the first 4 sentences" while carrying its full
  `w_prose = 0.30` share of the blend. One redesign direction worth
  arguing: drop the hardcoded list for a set derived from the branch's
  own happening titles, which the classifier writes in the story's
  language — self-localizing, no linguistics, reuses an index the pass
  already builds. Mildly circular, hence a discussion rather than a
  patch. Touches the canon signal table, so it is a spec change, not
  only a code change. Surfaced 2026-08-06 reviewing
  [Slice 3.4](./implementation/milestones/03-memory-floor/slices/04-retrieval.md).

## Post-M3 reconciliation

Items routed out of [`triage.md`](./implementation/triage.md) by the
M3.4 triage pass (2026-08-07/08). They share a landing window — the
reconciliation pass between M3 and M4 — rather than a topic, and they
are fewer pieces of work than entries: the token-measurement item is
the root the three token-progress-strip entries hang off, and the two
embedder items are one bridge. The world-state-block item under
[UX](#ux) belongs to this pass too, and stays listed there because it
predates the routing.

- **`metadata.tokens.completion` is the wrong measure for the chapter
  threshold, on four independent counts.** M5 needs
  `openRegionTokens(branchId)` as a DB read
  ([`generation-pipeline.md → chainsTo on predecessor`](./generation-pipeline.md#chainsto-on-predecessor)),
  and `story_entries.metadata.tokens` already looks like the answer.
  It is not. (1) **Stale on edit** — `updateStoryEntryContent`
  (`lib/actions/story-entries/operational.ts:45`) sets only `{ content }`,
  so the count survives a rewrite unchanged. (2) **Wrong text even when
  fresh** — it is provider `usage.outputTokens`
  (`lib/pipeline/definitions/per-turn.ts:256`), counting everything the
  model emitted, including the state block stripped before persist; the
  world-state-block work under [UX](#ux) widens that gap deliberately. (3) **Wrong tokenizer** — provider-side, whichever
  one that provider uses, while `chapterTokenThreshold` and the
  token-progress strip measure in o200k via `countTokens`. A story that
  switches providers mid-run would sum two incompatible token scales.
  (4) **AI entries only** — `usage` exists only on a generation call, so
  `user_action` rows carry no count at all, and they are part of the open
  region (`kind !== 'system'`). A SUM over `completion` undercounts by
  every user turn. The decision is therefore a **new field, not a
  rename**: `tokens.{prompt, completion, reasoning}` is a coherent
  provider-usage triple worth keeping for cost provenance, and
  repurposing one leg of it to mean "o200k count of the stored content"
  makes the other two incoherent. Open sub-questions: a real
  `story_entries` column (SUM-able and indexable, which a JSON field is
  not — and M5's trigger reads this per turn) versus another metadata
  key; which write paths must maintain it (generation, edit, prose
  reversal, system entries, import/seed); backfill for existing rows;
  whether a translated story counts the original or the translation
  (the original feeds the prompt buffer, so presumably that); and which
  number the entry card shows now that "reply tokens" and "content
  tokens" diverge
  ([`entry-card.md`](./ui/patterns/entry-card.md#reasoning-expansion)).
  Sits with the three token-progress-strip entries below, which the same
  change would resolve. Surfaced by review discussion (2026-08-06).
- **The token-progress strip reads a 50-entry window, so it cannot
  reach its own threshold.** `useOpenRegionTokens` sums the open region
  out of `entriesStore`, which holds a trailing `ENTRIES_WINDOW_SIZE`
  (50) slice rather than the branch. Measured: 50 entries at realistic
  length is **37.7%** of the default 24 000 `chapterTokenThreshold`, and
  reaching 100% would need ~132 entries. Once the open region exceeds 50
  — the normal state, since nothing closes a chapter before M5 — the
  strip reports a fraction of the truth and reads "plenty of room" while
  chapter-close is overdue. `generation-pipeline.md → Chapter close`
  sketches `openRegionTokens(branchId)` reading from the **DB**, so the
  two will diverge the moment M5 wires the real trigger. The strip is
  still better than the hardcoded `0` it replaced; the number is not
  trustworthy. Surfaced by M3.4 Task 19 (2026-08-02).
- **The same strip is non-monotonic across a reload.** `entriesStore`
  grows within a session (`patch` never evicts) but `reload()`
  re-hydrates to the trailing 50, discarding paged-in older rows.
  `reload()` fires on turn failure, on submit-with-system-tail, and on
  system-entry dismissal — so **dismissing a system entry visibly
  shrinks the progress strip**, as does restarting the app. Same story,
  same open region, different number. Follows from the entry above and
  is fixed by the same change. Surfaced by M3.4 Task 19 (2026-08-02).
- **`countEntryTokens` now runs on the reader's first render, adding a
  synchronous tiktoken encoder build before first paint.** It had zero
  production callers before M3.4 Task 19 — `countTokens` was reached
  only through the ranker, inside the async per-turn retrieval phase.
  The BPE map build measured **116ms** on desktop under Node
  (`lib/retrieval/tokens.ts` documents ~135ms) and will be worse on
  Android. If story-open shows a hitch, this is it, and the fix is to
  warm the encoder during story open rather than to change the hook.
  **Unmeasured on device.** Surfaced by M3.4 Task 19 (2026-08-02).
- **`countEntryTokens`' memo is never pruned.** `lib/retrieval/tokens.ts`
  keys an unbounded module-level `Map` on entry id and holds it for the
  process lifetime, across deletes, rollbacks, branch switches and story
  switches; `__resetTokenCache` has no production caller. Deleting an
  entry and later reinstating that id — reverse-replay of a delete
  re-inserts with the original id — resurrects a memo entry written
  before the deletion. The content check on read bounds the damage to a
  stale-content miss rather than a wrong count, so this is a leak rather
  than a defect today, but it is precisely the shape
  [lessons-learned → No "harmless" id leaks](./implementation/lessons-learned/no-harmless-id-leaks.md)
  records. Surfaced by the M3.4 whole-slice review (2026-08-03).
- **Nothing implements the window-level accounting that
  [`retrieval.md → Structural floor takes budget first`](./memory/retrieval.md#structural-floor-takes-budget-first)
  describes.** Canon reads "recent buffer + active+in-scene entities +
  their location + active threads consume tokens unconditionally. Then
  prompt-overhead reservation. Then the per-type retrieval budgets
  allocate the remainder", and the UI is meant to show allocations "of
  remaining ~X tokens after structural inject". Three pieces are absent:
  no context-window total is tracked anywhere, no prompt-overhead
  reservation exists, and the story-settings sliders show absolute
  numbers with no remaining-window figure beside them. `runRetrieval`
  passing `settings.retrievalBudgets` through to `rankAll` unmodified is
  **correct** under this reading — the floor is subtracted from the
  window, not from each type's partition, which is why the prompt
  buffer, a floor member with no retrieval type, appears in that list at
  all. Subtracting per type instead would silently redefine the user's
  sliders every turn and double-count against the UI figure canon asks
  for. What is missing is the window arithmetic and the surface that
  reports it, which spans retrieval, the prompt builder and
  story-settings and so has no single owning slice. Surfaced by M3.4
  Task 17 review (2026-08-02).
- **A local embed cannot be cancelled, so Cancel during
  `recalling-memory` works on provider backends only.** M3.4 made the
  blocking embed interruptible by threading a bounded signal from the
  retrieval phase down to `embedMany`, which closes the case where a
  provider accepts the connection and stalls. `embedLocal`
  (`lib/embedder/local/runtime.ts`) is one IPC call into the Electron
  main process with no cancellation channel, so the signal cannot
  reach it: a local pass runs to completion and the timeout fires only
  after it returns. Closing the gap needs a cancellation channel in
  `electron/` main plus preload plus the bridge, which is why M3.4
  scoped it out rather than shipping a Cancel that silently no-ops on
  one backend. Compounding it, the local backend does not chunk, so
  the whole dirty set is a single call. Surfaced by the M3.4 review
  (2026-08-06).
- **The blocking sync stage bounds neither request token size nor
  provider fan-out, and sends the whole dirty set in one call on the
  local backend.** M3.4 Task 12's `runSyncStage` calls `embedRows` once
  for every `embedding_stale = 1` row, unlike `lib/embedder/drain.ts`,
  which batches at 16 and isolates poison rows. The **row count** is not
  the exposure it first appears: `lib/ai/embedding.ts` embeds through
  the AI SDK's `embedMany`, which splits at `maxEmbeddingsPerCall`, and
  `@ai-sdk/openai-compatible` defaults that to 2048 — so a 5000-row
  dirty set becomes three requests, not one. Three real gaps remain.
  Per-request **token** size is still unbounded, so 2048 long rows can
  413 anyway; the SDK fires those chunks **in parallel** when the model
  reports `supportsParallelCalls`, with no concurrency ceiling; and the
  **local** backend has no equivalent split, so it really does hand the
  whole set over in one IPC call. Because this stage is **blocking** by
  design, any of those fails the turn outright rather than degrading.
  The drain worker mitigates in practice by pre-warming, but only for
  the open branch, while the sync stage's `branchIds` may be wider.
  [`retrieval.md → Compute lifecycle`](./memory/retrieval.md#compute-lifecycle)
  says the stage "embeds every dirty row … in one batch", but that
  sentence contrasts deferred sync against embedding-on-write — it is
  about collapsing repeated writes into a single pass, not about issuing
  a single HTTP request. **Chunking would not violate canon**, so this
  is a deferred robustness decision rather than a constraint. A remedy
  belongs in the embedder layer rather than in `sync.ts` — but note the
  provider path already chunks by row count, so the work is a token
  budget per request, a concurrency cap on the fan-out, and a split on
  the local backend. Surfaced by M3.4 Task 12 review (2026-08-02).

- **The `embedding_stale` flip belongs in the action layer, and the
  drain should revalidate before spending on a re-embed.** Two halves of
  one split, and they land together.
  [`retrieval.md → Storage`](./memory/retrieval.md#storage) makes the
  flag solely responsible for drift — no retrieval-time hash comparison,
  because hashing every candidate every turn re-derives what the flag
  already carries. That trade only holds if the flag cannot be
  forgotten, and today it can: `registerEntities`, `registerLore`,
  `registerThreads` and `registerHappenings` all default
  `embeddingStale` to `0` and leave the flip to the caller, and only
  `lib/classifier/plan.ts` opts in. The first M4 or M7 edit surface that
  writes a description without remembering produces a row ranking
  against its old text forever, with nothing to report it — which is why
  this has to precede M4 rather than follow it.

  Design settled 2026-08-07; what it needs is a slot, not a decision.
  It is two questions, not one polarity:
  - **On create — the actual polarity change.** `register.ts` reads
    `embeddingStale: entry.embeddingStale ?? 0`; a new row has no vector
    by definition, so default it to `1`. The empty-composite worry is
    not live: chapters exist only closed with `summary` / `theme` both
    `notNull`, and every kind's first embedded field is a required
    name / title, so a `compositeText(...).trim() !== ''` guard would be
    insurance rather than a fix.
  - **On update — derived, not defaulted.** Flip only when an embedded
    column's value actually changed:
    `KIND_FIELDS[kind].includes(col) && set[col] !== current[col]`.
    `KIND_FIELDS` (`lib/db/embeddings/stale.ts`) already declares the
    embedded columns per kind, and the update handler's existing loop
    holds both `set[col]` and `current[col]`, so the comparison is free.
    This is what dissolves the UI risk — a save-session form
    resubmitting an unchanged `name` compares equal and does not flip,
    so no "told clean" escape hatch is needed.
  - **Exactness belongs in the drain, not the handler.** Canon says an
    edit or rollback returning content to its embedded value
    "revalidates to 0 with no re-embed, since the existing vector is
    still correct". `recomputeStaleOps` implements exactly that hash
    comparison against the vector's stored `source_hash`, and the
    cross-model cancel already uses it — but the drain still loads
    `WHERE embedding_stale = 1` and hands every row to
    `embedAndBuildVecOps`, so a rollback to previously-embedded content
    re-embeds instead of revalidating. Wire the helper into the drain's
    row load. The split is deliberate: the write path asks "did content
    change?" cheaply, the embed path asks "is the vector stale?" exactly,
    before spending money. Pulling the exact check into the register
    handler would drag `resolveDrainConfig` and a vec-table read into a
    delta handler that touches only its own table. Not a canon conflict
    either — canon rejects hash comparison at _retrieval_ time, which is
    a different cost profile from once per drain batch.

  Two notes for the implementer. The flipping column set is narrower
  than readers expect — for entities only `name` / `description`;
  `status`, `injectionMode`, `tags`, `state` and `retiredReason` do not
  flip it. That is correct, since none are embedded, but it reads as a
  bug and wants a comment at the site. And `compositeText` maps null to
  `''` before joining, so `null` and `''` are identical content while
  `!==` flips anyway — erring toward dirty, at a cost of one wasted
  embed, which is not worth special-casing.

  Open: the seed and import paths, which write rows with precomputed
  vectors and a deliberately clean flag, need an audit — though seeded
  rows currently defaulting to `0` with no vector are already wrong, so
  the inversion fixes them rather than breaking them. Not reached
  either way: the raw `ctx.db.run(sql...)` writers in
  `lib/actions/classifier/deps.ts` bypass `defineAction`, and only
  SQLite triggers scoped `OF <embedded cols>` would catch those — held
  in reserve pending the `lib/actions/` extraction pass. Create-half
  surfaced by the M3.4 review (2026-08-07); drain half by M3.1b manual
  smoke (2026-07-27), its cancel half resolved in M3.1b review
  (2026-07-28).

## Tooling

- **`pnpm test:run` over the whole repo cannot be read as a gate.** A
  full run reports failed test _files_ with zero failed tests: a varying
  handful of Storybook browser-project files fail to _load_ under
  parallel contention (`Failed to fetch dynamically imported module`,
  `Cannot connect to the iframe …`). The same files pass in isolation,
  and the failing set differs run to run. Reproduced on `main`
  (`54528591`) from a clean install — 9 files, 0 failed tests — so it is
  not branch-specific. Until it is fixed, every slice's finish step has
  to run the `unit` project and the Storybook files separately and argue
  the residual by hand, which is exactly the shape that lets a real
  browser-project regression hide. Likely levers: concurrency limits on
  the browser project, or isolating it from the `unit` project's workers.
  Surfaced 2026-07-30 finishing
  [Slice 3.3](./implementation/milestones/03-memory-floor/slices/03-classifier.md).

- **Storybook vitest project applies no NativeWind classNames, so every
  style assertion in a story passes vacuously.** Components render with
  only react-native-web's own generated class — no `rounded-md`, no
  `hidden`, no theme tokens — so the repo has zero style-level test
  coverage in CI. The Storybook dev server is unaffected. Confirmed by
  probe (2026-08-18): a `<View className="hidden rounded-md">` renders
  `class="css-view-g5y9jx"`, `style="null"`, computed `display: flex`,
  `border-radius: 0px`.
  **The obvious fix is disproven.** Carrying
  `framework.options.pluginReactOptions.jsxImportSource: 'nativewind'`
  into the vitest project does not work: adding
  `rnw({ jsxRuntime: 'automatic', jsxImportSource: 'nativewind' })` to the
  storybook project's plugins changes nothing, in either plugin order, and
  `esbuild.jsxImportSource` changes nothing either. The plugin genuinely
  runs — pointing it at a nonexistent module fails the build on
  `<module>/jsx-runtime` — so the option is read but the transform that
  actually compiles the story is not the one it configures.
  **Root cause is the interop registration, not the JSX transform.** The
  stylesheets are fine (6 sheets, 861 rules, the `.hidden` rule present).
  What is missing is `cssInterop` registration for the RN core components:
  adding `cssInterop(View, { className: 'style' })` by hand makes the same
  probe render `class="css-view-g5y9jx hidden rounded-md"` with
  `display: none` and `border-radius: 6px`.
  `components/wizard/cast-row-layout.stories.tsx:16` already carries that
  hand-registration as a local workaround.
  **Importing NativeWind's own registration module does not work
  (2026-08-18).** `nativewind/jsx-runtime` reaches
  `react-native-css-interop`'s `runtime/components`, which owns the
  canonical list, but that prebuilt CJS resolves `react-native` to a
  different identity than the aliased stories do, so it decorates the
  wrong `View`. Adding the import leaves the probe unchanged while the
  full storybook project still reports 776 passing tests, so the suite
  cannot be used to tell whether registration took: verify with the probe.
  Registering in `.storybook/preview.tsx`, which the same aliasing
  applies to, does work. That leaves the setup-file route as the only
  path, and it must restate NativeWind's list (15 components plus 3
  special mappings) locally, where it can drift.
  **Cost is measured (2026-08-18).** With the full list registered, 17
  story tests across 7 files fail: `world-time-edit-form` (4),
  `lore-list` (4), `cast-editors` (3), `tier-tuple-input` (2),
  `embedding-models-panel` (2), `worldtime-edit-sheet` (1), `button` (1),
  heavily TextInput-adjacent. Payoff today is small — 6 style assertions
  exist repo-wide — so the value is unlocking style and visual-regression
  assertions going forward. Until it lands, treat any style assertion in
  a story as unproven. Surfaced by M3.11 Task 7 (2026-07-22), root-caused
  and priced 2026-08-18.
