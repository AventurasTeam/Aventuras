# Slice 3.6 — Wizard steps 3 (World) + 4 (Cast), opening refine / regenerate

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** none (day-one; M1.5 lore / entity layer + M2.3
  wizard shell are merged prerequisites). Pairs with
  [Slice 3.1a](./01a-embedder-core.md) via the C5 wizard-commit
  seam — doc-as-contract, not a gate.
- **Blocks:** none

## Goal

The wizard's two deferred steps become real: step 3 (World —
genre / tone preset-plus-prose hybrid, setting, initial lore list
with inline editor) and step 4 (Cast — all four per-kind bespoke
editors with disclosures, status / lead / staged logic,
pick-from-cast pickers, AI-suggest with structured identity), plus
the refine / regenerate affordances on the step-5 opening preview.
Opening generation now consumes the seeded world + cast context,
and the step indicator's disabled World / Cast pills go live.

## Background

M2.3 shipped steps 1, 2, and 5 with a minimal lead input; genre /
tone / setting commit as empty strings and the cast is at most one
bare lead row. This slice replaces that floor with the full
authoring surface. The wizard editors are bespoke — their tier
shapes exclude classifier-managed fields per the authorship
contract, and they are not a precursor to the M4 world panel.
Wizard-authored identity seeds `CharacterState` at first write;
staged entities are pre-introduced actors the narrative can promote
later. Everything commits through the existing atomic Finish; the
rows flow through 3.1a's embed step without this slice knowing its
internals (C5).

## Required reading

- [`wizard.md → Step 3 — World`](../../../../ui/screens/wizard/wizard.md#step-3--world)
  — genre / tone three input paths, replace-on-existing confirm,
  setting, initial-lore list + inline editor, validation gates.
- [`wizard.md → Step 4 — Cast`](../../../../ui/screens/wizard/wizard.md#step-4--cast)
  — add affordances, compact rows, all four editors,
  status field cascades, AI-suggest structured identity,
  lead-required gating, validation gates.
- [`wizard.md → AI-assist pattern`](../../../../ui/screens/wizard/wizard.md#ai-assist-pattern)
  — incl. [`Refine`](../../../../ui/screens/wizard/wizard.md#refine--prose-result-only)
  (prose-result only) and pagination on list results.
- [`wizard.md → Step 5`](../../../../ui/screens/wizard/wizard.md#step-5--opening--finish)
  — the opening preview states refine / regenerate slot into.
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
- [`calendar-systems/spec.md → Rendering pipeline`](../../../../calendar-systems/spec.md#rendering-pipeline)
  — the renderer the step-2 calendar summary preview samples
  (cross-cutting roadmap item landing here).

## Scope: in

- **Step 3 — World:** genre / tone label + promptBody with manual /
  preset-browse / AI-suggest paths and the replace-on-existing
  confirm; the bundled preset catalog (code-authored JSON, same
  pattern as suggestion-category defaults); setting textarea with
  AI-suggest; initial-lore list (compact rows, inline editor with
  `▼ More options` — tags / injection mode / priority), long-scroll;
  validation (lore rows need title + body; genre / setting
  encouraged, not gated).
- **Step 4 — Cast:** mixed insertion-ordered entity list; `+ Add ▾`
  per kind; `✨ Suggest cast` (structured per-kind output, guidance
  steering, cross-batch name resolution, pagination); the four
  editors with `▼ Visual` / `▼ More options` disclosures and
  pick-from-cast pickers (faction, parent location); status
  `active` / `staged` with the lead cascades (auto-unmark toast,
  gate tightening, opening enum-list filtering); `⭐ Set as lead`
  visibility rules; validation gates.
- **Step indicator:** World / Cast pills enable; back-jump pill
  demotion for the lead rule stays correct across five live steps.
- **Opening refine / regenerate:** on the step-5 AI preview —
  regenerate re-rolls with the same guidance; refine opens the
  guidance popover seeded per the AI-assist pattern's
  prose-result refine contract.
- **Opening context:** the wizard-group opening template consumes
  authored genre / tone / setting / lore / cast; `sceneEntities`
  enum filters to `status='active'`; the minimal-lead path keeps
  working when the cast is empty (creative + third).
- **Step-2 calendar-summary preview** sampling the renderer (the
  roadmap's calendar-subsystem row for M3.6).
- Removal of the M2 "minimal lead input" in favor of the real cast
  editor, preserving draft-session compatibility (old drafts with a
  bare lead row open into step 4 cleanly).

## Scope: out

- Memory-cost (Matryoshka) disclosure on step 5 —
  [Slice 3.1b](./01b-embedder-lifecycle.md).
- The embed step in Finish — [Slice 3.1a](./01a-embedder-core.md)
  (C5).
- World-panel editors, collision review — M4.
- Wizard-time pack selection, prompt-pack editor — parked.
- Regenerate-opening from reader chrome post-commit — parked.

## Acceptance criteria

- A story is creatable with genre + tone (preset-picked and
  hand-edited), setting, ≥ 2 lore rows, and a mixed cast
  (character / location / item / faction, incl. one staged
  character); Finish commits every row in the one transaction and
  the opening call's context contains the authored world + cast
  (vitest on the commit + rendered-context assertion).
- Staged entities never appear in the opening's `sceneEntities`
  enum; marking the lead as staged auto-unmarks with the toast and
  re-blocks `Next` (vitest on the cascade rules).
- AI-suggest cast: a structured fixture with
  `parent_location_name` + faction cross-references resolves ids
  within the batch; unresolved names fall back to null (vitest).
- Lore inline editor round-trips all `More options` fields;
  an empty-body row blocks `Next` with an inline error.
- Refine on the opening preview: guidance popover pre-seeds,
  re-roll replaces the preview, `Use this` commits the refined
  prose; regenerate produces a new take without guidance edits
  (manual smoke + state-machine vitest).
- A pre-M3.6 draft session (bare lead, empty world) reopens
  without data loss and completes through the new steps.
- Every new chrome string routes through `t()`; new compounds have
  stories.

## Tests

- Vitest: cascade rules (lead / staged), suggest-cast resolution,
  draft-session migration, commit composition, validation gates.
- Storybook: step-3 / step-4 bodies, the per-kind editors, preset
  browser, refine popover states.
- Manual smoke: full five-step run on desktop + Android (keyboard
  avoidance on the editors per the wizard doc's mobile expression).

## Open questions

- **Preset catalog contents** — how many genre / tone presets ship
  and who authors the prose bodies; planning decision.
- **Suggest-cast batch size vs pagination** — canon default is 5
  mixed; confirm the pagination interaction with per-kind steering.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
