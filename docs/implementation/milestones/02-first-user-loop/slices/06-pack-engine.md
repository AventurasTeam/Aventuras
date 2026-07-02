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

_Both resolved during planning — see Implementation notes
(`activePackId` seeding; bundled-pack storage)._

## Implementation notes

**Resolved decisions.**

- **`activePackId` seeding.** M2 stories carry the bundled pack's
  literal id `BUNDLED_PACK_ID` (`pack_bundled_default`) in
  `settings.activePackId`, seeded via `default_story_settings`; the
  engine resolves that id to the embedded bundled pack. Chosen over
  null-means-bundled for forward-compatibility with the M7.2 packs
  table (bundled becomes a real row with that id; nothing migrates).
- **Bundled-pack storage.** Code-embedded TypeScript string exports
  composed into the in-memory `Pack`, not `.liquid` asset files —
  zero bundler config across Metro, Electron, and Vitest.
- **Composer-wrap macros descoped.** Moved out of the pack to
  in-code i18n in [Slice 2.5](./05-reader.md): the wrapped string is
  target-language user content, but a pack is English-source. The
  per-turn template receives the already-wrapped action. The
  canonical reframe (principles, architecture, C2) is queued in
  [triage.md](../../../triage.md).
- **Synchronous render.** `renderTemplate(templateId, context)`
  renders via LiquidJS `renderFileSync`; every M2 filter and
  in-memory include is synchronous. The `lib/prompts` barrel
  therefore statically pulls `liquidjs` (a sync render path cannot
  lazy-import it); consumers import the barrel, never deep paths.
- **Variable-name contract.** `templateContextMap.ts` pins the M2
  `generationContext` names (`entries`, `entities`, `sceneEntities`,
  `definition`, `userSettings`, `intermediates`) that
  [Slice 2.7](./07-wiring.md)'s context builder must match — a
  mismatch only fails at integration. The filter set is the M2
  minimum (`by_kind`, `active`, `prose_join`, `json`); `upcase_first`
  left with the wraps.

**Known limitation.** The load-time include validator is a regex; it
also flags includes inside `{% comment %}` blocks (a harmless
false-positive, inert for the bundled pack). Folds into the parked
M7.2 author-time validator.

**Forward note for 2.7.** Its context builder should normalize empty
or whitespace-only definitional fields and guard array contents
passed to the filters — tracked in [Slice 2.7](./07-wiring.md) Open
questions.

**Forward note (M7.2 pack system).** Template ids are a closed static
union (`renderTemplate` takes `TemplateId`): users edit content
within a fixed template set, not pipelines, so no arbitrary template
ids exist. Pack selection is therefore a separate argument to be
added with the pack system, not encoded in the template id. Macro
ids are forced to a `macro_` prefix so the engine's flat template-and-macro
lookup map (which merges both id spaces) stays collision-free.
