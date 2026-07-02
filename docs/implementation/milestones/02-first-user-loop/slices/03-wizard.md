# Slice 2.3 — Minimum-viable wizard + creation mutators + lib/calendar substrate

## Metadata

- **Milestone:** [Milestone 2 — First user loop](../milestone.md)
- **Depends on:** [Slice 2.1](./01-provider.md) (wizard-assist
  resolution), [Slice 2.6](./06-pack-engine.md) (wizard-group
  templates), [Slice 2.8](./08-id-substitution.md) (placeholder
  substitution on the opening call). Steps 1–2 and `lib/calendar`
  can start day-one.
- **Blocks:** [Slice 2.7](./07-wiring.md) (needs a creatable
  story); [Slice 2.5](./05-reader.md)'s time chrome (consumes
  `lib/calendar`). [Slice 2.4](./04-story-list.md) consumes the
  C5 session-prompt seam — doc-as-contract, not a gate.

## Goal

The canonical creation path, minimum-viable: wizard steps 1
(Frame), 2 (Calendar), and 5 (Opening & finish), with auto-save
session + draft persistence, the **stories / branches creation
mutators** (M1.5 excluded config-table writes), a **minimal
lead-character input** so adventure and first / second-person
stories are creatable before the M3.6 cast editor, and the
`lib/calendar` arithmetic substrate + registry + picker wiring.
The structured-output parse path and the `jsonrepair` +
`react-hook-form` installs land here with their first consumers.

## Background

The wizard is a screen flow, not a pipeline: per-click one-shot
LLM calls, one atomic delta-exempt SQLite commit at Finish. M2
ships three of five steps; steps 3 (World) and 4 (Cast) land in
M3.6. Because the frozen definition Zod requires a lead when
`mode='adventure'` or `narration ∈ {first, second}`, and the cast
editor is deferred, this slice adds a minimal lead input
(planning decision recorded in the milestone doc): a bare
character name that commits as one minimal `entities` row and
sets `definition.leadEntityId`. The wizard commit in M2 writes no
entity / lore embeds — the vec0 tables and the embedder gate are
M3.1; the commit transaction is stories + branch + opening
(+ lead entity when present).

## Required reading

- [`wizard.md`](../../../../ui/screens/wizard/wizard.md) — the
  whole surface; M2 implements
  [Step 1 — Frame](../../../../ui/screens/wizard/wizard.md#step-1--frame),
  [Step 2 — Calendar](../../../../ui/screens/wizard/wizard.md#step-2--calendar),
  [Step 5 — Opening & finish](../../../../ui/screens/wizard/wizard.md#step-5--opening--finish),
  [Save / cancel / draft semantics](../../../../ui/screens/wizard/wizard.md#save--cancel--draft-semantics),
  and the
  [AI-assist pattern](../../../../ui/screens/wizard/wizard.md#ai-assist-pattern).
- [`wizard.md → What Finish does`](../../../../ui/screens/wizard/wizard.md#what-finish-does--atomic-commit)
  — the commit transaction; steps 3–4 of its list (entity / lore
  embeds) do not apply in M2.
- [`data-model.md → Opening entry`](../../../../data-model.md#opening-entry)
  — opening kind, `metadata.model` discriminator, the
  structured-output shape, malformed-output fallback.
- [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape)
  — `definition` / `settings` split, the cross-field lead
  constraint, copy-at-creation.
- [`data-model.md → Story identity fields`](../../../../data-model.md#story-identity-fields)
  — `status='draft'` lifecycle, identity columns the commit
  writes.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  — the wizard delta-log exemption.
- [`generation-pipeline.md → Wizard exemption`](../../../../generation-pipeline.md#wizard-exemption)
  and [`Pipelines, unified`](../../../../generation-pipeline.md#pipelines-unified)
  — why none of this routes through the orchestrator.
- [`calendar-systems/spec.md → Calendar definition`](../../../../calendar-systems/spec.md#calendar-definition),
  [`Rendering pipeline`](../../../../calendar-systems/spec.md#rendering-pipeline),
  and
  [`Where calendar definitions live`](../../../../calendar-systems/spec.md#where-calendar-definitions-live)
  — the `CalendarSystem` shape, `worldTimeToTuple`, registry
  merge model (built-ins only in M2).
- [`ui/patterns/calendar-picker.md → Wizard — calendar selection slot`](../../../../ui/patterns/calendar-picker.md#wizard--calendar-selection-slot)
  — host adaptation of the shipped `CalendarPicker`.
- [`tech-stack.md`](../../../../tech-stack.md) — the `jsonrepair`
  and `react-hook-form` entries; install-with-first-consumer
  rationale.

## Scope: in

- **Wizard route + chrome:** full-page replacement, `← Cancel` /
  step indicator / footer per the wizard doc; step indicator
  reflects the M2 three-step flow (presentation per the
  milestone open question, resolved at planning).
- **Step 1 — Frame:** mode + narration segment pickers, the
  cross-field forward-pointer chip, and the **minimal lead
  input** — a character-name field surfaced when the lead
  requirement triggers; commits as one `entities` row
  (`kind='character'`, `status='active'`, empty state) with
  `definition.leadEntityId` pointing at it. `react-hook-form`
  install lands with this first form.
- **Step 2 — Calendar:** shipped `CalendarPicker` hosted per the
  wizard adaptation (no Vault tail), tier-derived
  `worldTimeOrigin` inputs with rollover validation, calendar
  swap tuple-preservation rules, era picker when `eras !== null`.
- **Step 5 — Opening & finish:** the three opening states
  (empty / AI-preview / committed), AI-assist for opening
  (structured output: prose + `sceneEntities` +
  `currentLocationId` + `worldTime: 0`, refs constrained to the
  active cast — in M2, at most the minimal lead entity, with ids
  substituted through [Slice 2.8](./08-id-substitution.md)),
  title chips + description assist, Finish validation, atomic
  commit, route to reader.
- **AI-assist pattern primitives** for the three step-5 call
  sites (guidance popover, loading, prose / chips results,
  failure + not-configured states). `Discard` / `Use this` only —
  refine / regenerate defer to M3.
- **Structured-output parse path:** strict parse → `jsonrepair`
  → Zod, per tech-stack; malformed opening output falls back to
  user-written semantics (empty metadata refs).
- **Creation mutators:** `createStoryWithBranch` (wizard commit —
  stories row, initial branch, opening entry, optional lead
  entity, settings copied from `default_story_settings`,
  **no deltas**), `saveStoryDraft` (status `draft`, re-enterable),
  draft update on resume. Store refresh through the C1 surface
  pinned in [the milestone doc](../milestone.md#c1--stories-store-api).
- **Auto-save session:** persist-on-meaningful-change, survive
  restart, session-exists selector + the concurrent-state prompt
  component (C5; [Slice 2.4](./04-story-list.md) wires the
  triggers).
- **`lib/calendar` substrate:** `CalendarSystem` Zod +
  `worldTimeToTuple` + era arithmetic + per-year cumulative-day
  cache + `displayFormat` rendering via a plain LiquidJS engine
  instance (no dependency on the pack engine's registry);
  registry init from code built-ins (`earth-gregorian`; no
  `vault_calendars` merge until M8.3).

## Scope: out

- Steps 3 (World: genre / tone / setting / lore) and 4 (Cast) —
  M3.6. M2 stories commit with empty genre / tone / setting; the
  bundled pack's templates guard empty blocks
  ([Slice 2.6](./06-pack-engine.md)).
- Refine / regenerate affordances on the opening — M3.6.
- Memory-cost (Matryoshka) disclosure, entity / lore embeds in
  the commit, the embedder-unavailable surface, and the
  story-creation embedder gate — M3.1.
- Wizard-time pack selection — parked. Likewise **no in-wizard
  narrative-model picker**: the roadmap entry's "model + pack
  picks" phrase is stale against canonical
  [`wizard.md`](../../../../ui/screens/wizard/wizard.md) — model
  assignment happens via the
  [Slice 2.1](./01-provider.md) interim form; in-story overrides
  arrive with M4.4.
- `vault_calendars` CRUD and registry merge — M8.3.

## Acceptance criteria

- Creative + third: wizard completes with only a title and
  opening prose; commit writes stories + branch + opening in one
  transaction with **zero** delta rows (asserted by test) and
  routes to the reader with the story open.
- Adventure + first: step 1 demands the lead name; Finish writes
  the lead `entities` row and `leadEntityId`; the frozen Zod
  cross-field constraint passes; omitting the name blocks `Next`.
- AI-generated opening: structured output parses (including a
  jsonrepair-recovered fixture); `metadata.model` set; refs
  resolve to the lead entity's real UUID through the idMap;
  malformed output falls back to user-written semantics without
  blocking Finish.
- Draft + session semantics match the wizard doc's table row by
  row: Next / Back update the session; Save-as-draft creates the
  `draft` row and clears the session; Cancel preserves the
  session; Finish clears it; reopening a draft pre-populates
  every previously entered field value across all three steps.
- Origin-tuple validation rejects an invalid Gregorian date
  (e.g. Feb 30) inline and blocks `Next`.
- `worldTimeToTuple` unit suite passes: origin anchoring, month
  table rollover, Gregorian leap rule (the 4 / 100 / 400 cases),
  era resolution, per-year cache hit equivalence.

## Tests

- Vitest: commit transaction (all-or-nothing, delta-exempt),
  draft / session state machine, definition Zod gate, structured
  output parse path (strict / repaired / malformed), calendar
  arithmetic suite.
- Storybook: wizard step bodies and the AI-assist popover states
  (per-compound stories for whatever new compounds this slice
  extracts).
- Manual smoke: full wizard run against a real provider on
  desktop + Android (keyboard avoidance per the wizard doc's
  mobile expression).

## Open questions

- Step-indicator presentation for the three-step M2 flow
  (milestone open question; resolve here).
- Where the minimal lead input renders — inside step 1 beneath
  the pickers (recommended; the forward-pointer chip already
  sits there) or as a step-5 pre-Finish field.
- Whether `definition.genre` / `tone` / `setting` commit as empty
  strings or the Zod gains explicit empty defaults — must not
  violate the M1.5 "no fabricated frozen-spec values" rule;
  check the shipped schema's posture at planning.
- **Rewrite the bundled wizard templates** that
  [Slice 2.6](./06-pack-engine.md) shipped as provisional
  placeholders (`lib/prompts/bundled/wizard.ts`). Replace them
  against this slice's own opening contract: `tmpl_wizard_opening`
  must emit the structured-output JSON (prose, `sceneEntities`,
  `currentLocationId`, `worldTime`) through the JSON output macro,
  not plain narrative prose; the lead reference must be guarded for
  lead-less paths (creative third-person), with the `wizard`-group
  `lead` variable in `templateContextMap.ts` reconciled against
  which paths actually pass it; and `tmpl_wizard_description` needs
  a description-appropriate output directive rather than the
  next-beat narrative macro. (Surfaced by Codex review of 2.6.)

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
