# Slice 2.6 — Pack-template / Liquid engine + bundled pack

## Metadata

- **Milestone:** [Milestone 2 — First user loop](../milestone.md)
- **Depends on:** none
- **Blocks:** [Slice 2.3](./03-wizard.md) (wizard-group
  templates), [Slice 2.5](./05-reader.md) (composer wrap macros),
  [Slice 2.7](./07-wiring.md) (per-turn narrative template)

## Goal

The prompt-template runtime: a minimal LiquidJS engine with macro
resolution, variable binding, and the include-compatibility
validator at pack load; the **bundled pack** covering every
template the M2 loop invokes; and the structural-floor
`active+in-scene` injection invariant test. This is the engine's
first landing — memory templates (M3.4), chapter-close templates
(M5.2), and the pack editor surface (M7.2) extend it.

## Background

Architecture pins the model: one unified context per group,
formatting lives in Liquid (not the context builder), macros are
group-tagged `.liquid` snippets included via
`{% include 'macro-id' %}`, and a pack is a full replacement
bundle — no fallback chain. The active pack's version of a
template IS what runs. M2 needs three template families: the
per-turn narrative template (`generationContext` group), the
wizard's step-5 call sites (`wizard` group), and the composer
wrap macros plus output-format directives (`staticContent`). The
variable registry (`templateContextMap.ts`) is day-one
infrastructure per the context-groups section, even though its
editor consumer is M7.2.

## Required reading

- [`architecture.md → Prompt templates and authoring`](../../../../architecture.md#prompt-templates-and-authoring)
  — the whole section: single-context principle, custom filters,
  [Macros](../../../../architecture.md#macros--reusable-liquid-snippets-not-code-side-formatters),
  [Empty retrieval buckets](../../../../architecture.md#empty-retrieval-buckets--author-contract),
  [The pack model](../../../../architecture.md#the-pack-model-full-replacement-not-override),
  [Context groups](../../../../architecture.md#context-groups),
  [Variable registry](../../../../architecture.md#variable-registry-for-the-prompt-editor).
- [`architecture.md → Structural floor — always inject`](../../../../architecture.md#structural-floor--always-inject)
  — the invariant + the bundled-pack test scope paragraph this
  slice implements.
- [`data-model.md → Injection modes — unified enum + structural invariant`](../../../../data-model.md#injection-modes--unified-enum--structural-invariant)
  — the canonical `always | auto | disabled` enum the filters and
  the invariant test operate on.
- [`principles.md → Composer mode`](../../../../ui/principles.md#composer-mode--send-time-transform-narration-aware)
  — what the wrap macros must produce.
- [`tech-stack.md`](../../../../tech-stack.md) — the prompt
  templates + editor entry: LiquidJS choice; the CodeMirror
  editor half is M7.2, not here.

## Scope: in

- **Engine module** (`lib/` module under the public-API rule):
  LiquidJS install; template registry mapping `templateId` →
  context group; macro resolver honoring group tags with the
  `staticContent` fallback; the include-compatibility validator
  running at pack load (template in group G may include only
  G-tagged or `staticContent` macros — load-time failure
  surfaces as a typed error; the full author-time validator
  contract stays parked); custom-filter registration scaffold
  with the M2-needed set only (selectors over the entity array
  for the structural floor — e.g. `by_kind`, `active` — plus
  `prose_join`, `json`; token-counting filters wait for
  `js-tiktoken` in M3.4).
- **Render surface** per C2 in
  [the milestone doc](../milestone.md#c2--pack-engine-render-surface):
  render entry point + exported template / macro id constants.
- **Bundled pack:** the per-turn narrative template (definition
  blocks with empty-guards — M2 stories carry empty genre /
  tone / setting until M3.6; entries buffer; structural-floor
  entity injection; no retrieval buckets yet), wizard-group
  templates for opening generation / title chips / description,
  and output-format macros (`staticContent`).
- **Structural-floor invariant test:** context fixture with an
  entity carrying `injection_mode: 'disabled'` AND present in
  `sceneEntities`; render the bundled per-turn template; assert
  the entity block appears.
- **`templateContextMap.ts` registry** minimal: variable
  definitions for the `generationContext` (M2 subset) and
  `wizard` groups, the template→group map, and the integrity
  validator function (unmapped ids, dangling display-group
  variables) — test-accessible, no editor consumer yet.
- **`activePackId` semantics** for M2 stories — resolve the
  milestone open question (literal bundled id vs null-means-
  bundled) and seed `default_story_settings` accordingly.

## Scope: out

- Pack CRUD, custom packs, the pack editor (CodeMirror), pack
  migration tooling — M7.2 and parked items.
- Memory / retrieval template extensions — M3.4.
- Chapter-close templates — M5.2.
- The author-time (editor) include-mismatch flagging and the
  full pack-validation contract — parked.
- `js-tiktoken`-backed filters — M3.4.
- Composer-mode wrap (`Do` / `Say` / `Think` × `first` / `third`) —
  implemented in-code (i18n-keyed) in
  [Slice 2.5](./05-reader.md), not as pack macros; the engine
  receives the already-wrapped action. Moved out in M2.6 planning.

## Acceptance criteria

- Rendering the bundled per-turn template against an M2-shaped
  fixture context (opening + a few entries, zero or one entity,
  empty genre / tone / setting) produces a prompt with no
  dangling section headers (empty-guard contract) — snapshot
  test.
- The structural-floor invariant test passes, and the suite
  carries a **permanent negative fixture** — a deliberately
  broken template variant whose entity iteration respects
  `injection_mode` — asserted to fail the same invariant check,
  so a regression in the check itself is caught.
- The include-compatibility validator rejects a fixture pack
  whose `generationContext` template includes a `wizard`-tagged
  macro, and accepts `staticContent` includes from any group.
- The registry integrity validator reports an unmapped template
  id fixture and passes on the shipped registry.
- Consumers reference template / macro ids via the exported
  constants only — enforced mechanically: a repo test greps the
  consuming modules for quoted id literals (or an equivalent
  lint rule bans them), and planting one fails it. Lands here;
  2.3 / 2.5 / 2.7 inherit the check.

## Tests

- Vitest: render snapshots (per-turn, wizard opening), validator
  accept / reject, wrap-macro matrix, filter units, registry
  integrity.
- No Storybook surface (library slice).

## Open questions

- `activePackId` seeding (milestone open question — owned here).
- Whether the bundled pack lives as repo `.liquid` files bundled
  via the asset pipeline or as code-embedded strings — pick at
  planning; affects how M7.2's editor later reads it.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
