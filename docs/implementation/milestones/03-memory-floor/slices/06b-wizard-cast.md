# Slice 3.6b — Wizard step 4 (Cast), opening world / cast context

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.6a](./06a-wizard-world.md) — the Cast
  step's `✨ Suggest cast` consumes 3.6a's AI-assist list result
  shape, and both slices extend the same Finish-commit, working
  state, and step-sequence seams. Pairs with
  [Slice 3.1a](./01a-embedder-core.md) via the C5 wizard-commit
  seam — doc-as-contract, not a gate.
- **Blocks:** none

## Goal

The wizard's step 4 (Cast) becomes real: all four per-kind bespoke
editors with their disclosures, the status / lead / staged logic,
pick-from-cast pickers, and `✨ Suggest cast` with structured
per-kind identity and cross-batch name resolution. Opening
generation now consumes the seeded world and cast, `sceneEntities`
constrains to the active cast, the M2 minimal lead input is
retired, and the step indicator's disabled Cast pill goes live.

## Background

M2.3 shipped a bare lead-name input on step 1 as the whole cast
surface; [Slice 3.6a](./06a-wizard-world.md) then landed step 3 and
the shared assist primitive. This slice replaces the lead input
with the real cast editor and moves the lead-required gate to where
canon puts it — step 4's `Next` and Finish. The wizard editors are
bespoke: their tier shapes exclude classifier-managed fields per
the authorship contract, and they are not a precursor to the M4
world panel. Wizard-authored identity seeds `CharacterState` at
first write; staged entities are pre-introduced actors the
narrative can promote later. Everything commits through the
existing atomic Finish; the rows flow through 3.1a's embed step
without this slice knowing its internals (C5).

## Required reading

- [`wizard.md → Step 4 — Cast`](../../../../ui/screens/wizard/wizard.md#step-4--cast)
  — add affordances, compact rows, all four editors, status field
  cascades, AI-suggest structured identity, lead-required gating,
  validation gates.
- [`wizard.md → Step 1 — Frame`](../../../../ui/screens/wizard/wizard.md#step-1--frame)
  — the cross-field forward-pointer chip that replaces the M2 lead
  input on step 1.
- [`wizard.md → Step 5`](../../../../ui/screens/wizard/wizard.md#step-5--opening--finish)
  — the opening's structured output and its scene-metadata block.
- [`data-model.md → World-state storage`](../../../../data-model.md#world-state-storage)
  — per-kind `state` shapes the editors map to
  ([`CharacterState`](../../../../data-model.md#characterstate-shape),
  [`LocationState`](../../../../data-model.md#locationstate-shape),
  [`ItemState`](../../../../data-model.md#itemstate-shape),
  [`FactionState`](../../../../data-model.md#factionstate-shape)).
- [`data-model.md → Authorship contract`](../../../../data-model.md#authorship-contract)
  — wizard-authored vs classifier-managed field split (the editors
  must not expose classifier-managed fields).
- [`data-model.md → Soft caps`](../../../../data-model.md#soft-caps--compaction-discipline)
  — traits / drives / agenda chip-input caps.
- [`data-model.md → Opening entry`](../../../../data-model.md#opening-entry)
  — the structured-output opening; `sceneEntities` constrained to
  active cast.

## Scope: in

- **Step 4 — Cast:** mixed insertion-ordered entity list;
  `+ Add ▾` per kind; `✨ Suggest cast` (structured per-kind
  output, guidance steering, cross-batch name resolution,
  pagination over 3.6a's list shape); the four editors with
  `▼ Visual` and `▼ More options` disclosures and pick-from-cast
  pickers (faction, parent location); status `active` / `staged`
  with the lead cascades (auto-unmark toast, gate tightening,
  opening enum-list filtering); `⭐ Set as lead` visibility rules;
  validation gates.
- **Lead relocation:** the M2 minimal lead input leaves step 1 in
  favor of the real cast editor; step 1 keeps only the
  forward-pointer chip, and the lead-required gate moves to step
  4's `Next` and to Finish. Draft-session compatibility preserved —
  an old draft's bare lead name opens into step 4 as a character
  row without data loss.
- **Step indicator:** the Cast pill enables and the active step
  sequence becomes 1-2-3-4-5; back-jump pill demotion for the lead
  rule stays correct across five live steps.
- **Opening context:** the wizard-group opening template consumes
  the authored cast alongside 3.6a's world; `sceneEntities`
  constrains to `status='active'`; the empty-cast path keeps
  working (creative plus third).
- **Working state and commit:** cast drafts in the wizard working
  state with ids minted at add time; Finish inserts the entity rows
  and embeds `name` and `description` into `entities_vec` inside
  the one transaction via 3.1a's embed helper (C5).

## Scope: out

- Step 3 (World), the preset catalog, the lore list, the AI-assist
  list / refine / regenerate primitive work —
  [Slice 3.6a](./06a-wizard-world.md).
- Memory-cost (Matryoshka) disclosure on step 5 —
  [Slice 3.1b](./01b-embedder-lifecycle.md).
- The embed step in Finish — [Slice 3.1a](./01a-embedder-core.md)
  (C5).
- World-panel editors, collision review — M4.
- Wizard-time pack selection, prompt-pack editor — parked.
- Regenerate-opening from reader chrome post-commit — parked.

## Acceptance criteria

- A story is creatable with a mixed cast (character, location,
  item, faction, including one staged character); Finish commits
  every row in the one transaction and the opening call's context
  contains the authored world and cast (vitest on the commit plus a
  rendered-context assertion).
- Staged entities never appear in the opening's `sceneEntities`;
  marking the lead as staged auto-unmarks it with the toast and
  re-blocks `Next` (vitest on the cascade rules).
- AI-suggest cast: a structured fixture carrying
  `parent_location_name` and faction cross-references resolves ids
  within the batch; unresolved names fall back to null (vitest).
- A pre-3.6b draft session (bare lead name, no cast array) reopens
  without data loss and completes through the new step.
- Every new chrome string routes through `t()`; new compounds have
  stories.

## Tests

- Vitest: cascade rules (lead / staged), suggest-cast resolution,
  draft-session migration, commit composition, validation gates.
- Storybook: step-4 body, the per-kind editors, pick-from-cast
  pickers, the lead-required notice.
- E2E (`pnpm test:e2e`): create-story flows updated for the lead
  input's relocation, plus a spec authoring a mixed cast that
  asserts the entity rows and their `entities_vec_384` vectors on
  the branch.
- Manual smoke: full five-step run on desktop and Android (keyboard
  avoidance on the editors per the wizard doc's mobile expression).

## Open questions

- **Suggest-cast batch size vs pagination** — canon default is 5
  mixed; confirm the pagination interaction with per-kind steering.
- **Should the wizard commit a starting location?** `finish.ts`
  hardcodes `currentLocationId: null`, and the only writer is the
  piggyback block, which runs _after_ narrative — so turn 1 can never
  carry a location, and
  [`retrieval.md → Cold start`](../../../../memory/retrieval.md#cold-start)
  records Q2 as correspondingly thin. This slice is where locations get
  authored, so it is the natural place to decide whether one of them is
  marked as where the story opens. Not a blocker for retrieval, which
  re-normalizes an absent Q2 away; it is a question about how much
  structure turn 1 deserves. Routed here by the M3.4 triage pass
  (2026-08-08).

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
