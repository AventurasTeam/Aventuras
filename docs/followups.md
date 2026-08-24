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
  - **Serialize the entry-metadata writers before this pass adds a
    second ungated one.** Routed here from the Slice 3.12 split
    (2026-08-19): `updateStoryEntryMetadata`'s handler is a
    whole-column replace, `updateEntryWorldTime` reads
    `current.metadata` outside the transaction, and its `withKeyLock`
    key is per-action — the interleave is unreachable today only
    because both pipeline writers run `hard-gate` (verified at both
    gate checks, 2026-08-19). This pass's scene-field editor is the
    first ungated second writer, so it inherits the fix and should
    design it with both writers in hand: field-merge inside the
    handler plus a shared per-row lock key (sharing a key with the
    current outer lock deadlocks — `withKeyLock` is not reentrant),
    or the payload built inside the transaction, which needs a
    callback-shaped bridge transaction and is much larger. Raised
    2026-08-16 by the Slice 3.8 review.
  - **Legacy rows keep their inline block.** Prefer a tolerant reader
    (retain `stripTrailingBlocks` as a display-time fallback) over a
    migration.

  Ownership settled during the Slice 3.12 split (2026-08-19): this
  is its own pass, run outside the slice-shaped workflow rather than
  under Slice 3.12.

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
  question below (re-verified 2026-08-24). Meanwhile the metadata
  edits landing on the same card are fully delta-logged and
  reversible, so one entry will carry two adjacent edit affordances
  with opposite reversibility and no visible reason for the
  difference. The exemption is a
  deliberate storage-economy decision, not an oversight — the open
  question is whether the UX is defensible as-is, wants an editor-local
  undo stack, or wants the redo-clear narrowed. Not scoped to the
  world-state-block work; surfaced alongside it 2026-07-23.

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

## Code structure

Near-future refactors routed out of the Slice 3.12 split
(2026-08-19); both were re-verified against the code that day.

- **`buildGenerationContext` should own the store reads — the
  unified data-source refactor.** The planned shape is a data
  source: call sites hand the builder identity and it reads
  `entriesStore` / `entitiesStore` itself, with templates doing the
  shaping in Liquid per
  [`architecture.md → Formatting lives in Liquid`](./architecture.md#formatting-lives-in-liquid-not-in-the-context-builder).
  Today the builder flattens entries to `{ content }`, so a template
  can reach neither `entry.position` nor `entry.metadata`. Verified
  state: two of the three phases already share
  `loadPerTurnWorkingSet`; only `suggestion-refresh` duplicates the
  branch-filter-and-sort and both store guards inline. Four things
  the implementer must handle: (a) `sceneEntities` derives from
  `.at(-1)` of the caller's array, so template-side truncation
  silently retargets the scene block — it must become
  template-derived in the same change; (b) `entry` is absent from
  `SUBSTITUTABLE_PREFIXES`, so raw entries would expose real UUIDs
  against
  [`data-model.md → ID shape`](./data-model.md#id-shape--kind-prefixed-uuids-throughout);
  (c) — the load-bearing question an earlier record got wrong — **no
  bundled template uses the `recent` filter**: per-turn's windowing
  is `composePromptBuffer` inside the builder, and the pack contract
  says "render it whole", so "templates do the shaping" cannot be
  taken literally for the narrative phase. Decide first whether the
  two-mode window stays in the builder, becomes a Liquid-reachable
  filter, or the context exposes both windowed and raw collections —
  a canonical-spec decision for a design session, not an
  implementation choice; (d) the mechanical cost is 45 direct test
  call sites (not the 17 once recorded) in
  `generation-context.test.ts`, and the builder is currently pure —
  consider an injectable store port so tests stay pure. Also needs
  the clause edit to
  [`architecture.md → The single-context principle`](./architecture.md#the-single-context-principle),
  whose "a phase reads the domain stores directly" no longer holds.
  Zero user-visible impact until a custom pack or a fourth consumer
  exists. Surfaced by M3.7a post-merge review (2026-07-30);
  re-verified and re-sized during the Slice 3.12 split (2026-08-19).

- **`lib/actions/` extraction pass — pipeline triggers, classifier
  deps, and the embedder-swap module move.** The layer's bar
  ([`code-conventions.md → Action layer`](./code-conventions.md#action-layer))
  is writes that persist to SQLite or cross stores; three resident
  groups miss it. Verified state, correcting the original framing:
  **(a) triggers** — `suggestions/refresh-suggestions.ts` writes
  nothing, but `classifier/run-now.ts` is _not_ a pure trigger (it
  records the classifier preflight failure, a real write, which must
  split out before any move). The stated payoff "extracting the
  triggers lets the eslint exception go" is dead: four action files
  runtime-import `@/lib/pipeline`, and two of them
  (`turns/submit-turn.ts`, `turns/regenerate-turn.ts`) are genuine
  delta-logged writes that stay — either alone keeps the import
  alive; the eslint `boundaries/dependencies` exception covers
  **type-only** imports that never produced a runtime cycle (the
  actual cycle workaround is the `configureDeltaActionPort` runtime
  port wired in bootstrap). Argue the trigger move on taxonomy alone
  or drop it. **(b) `classifier/deps.ts`** — three of five exports
  are not writes; the two genuine writes bypass `defineAction` with
  raw `ctx.db.run(sql...)`. Splits three ways: a lib read module, a
  `defineAction`-conformant writer pair, and
  `embedClassifierDescriptions` following `resolveDrainConfig`
  wherever it lands. **(c) `embedder-swap/`** — 1,267 non-test lines
  plus 1,953 test lines and eight exported error classes; the feared
  cycle with `lib/embedder` checks clean (the dependency is
  one-directional), so the `lib/embedder-swap` move is decidable
  now. The barrel's uncurated re-export of the raw engine primitives
  is being fixed in
  [Slice 3.12a](./implementation/milestones/03-memory-floor/slices/12a-runtime-integrity.md);
  this pass is the remaining structure half. What stays put: the
  `register.ts` versus `operational.ts` split is the layer's real
  organizing rule, and reads deliberately colocated to pin a shared
  invariant (`story-entries/recent-window.ts`) are correct where
  they are. Surfaced by a 2026-08-01 read of the folder; re-verified
  during the Slice 3.12 split (2026-08-19).
