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
