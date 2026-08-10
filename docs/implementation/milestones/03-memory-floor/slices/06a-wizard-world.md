# Slice 3.6a — Wizard step 3 (World), AI-assist list / refine / regenerate

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** none (day-one; M1.5 lore layer and M2.3 wizard
  shell are merged prerequisites). Pairs with
  [Slice 3.1a](./01a-embedder-core.md) via the C5 wizard-commit
  seam — doc-as-contract, not a gate.
- **Blocks:** [Slice 3.6b](./06b-wizard-cast.md) — the Cast step
  consumes this slice's AI-assist list result shape and extends the
  same Finish-commit and step-sequence seams.

## Goal

The wizard's step 3 (World) becomes real: the genre / tone
preset-plus-prose hybrid with its bundled catalog, the setting
textarea, and the initial-lore list with its inline editor. The
shared AI-assist primitive gains the two shapes canon defines but
M2.3 did not build — the **list** result (checkbox rows,
`Generate more` pagination, `Import selected`) and the prose row's
`Refine…` / `Regenerate` actions — which lights up refine and
regenerate on the step-5 opening preview at the same time. Finish
commits the authored lore rows inside the one atomic transaction,
and the step indicator's disabled World pill goes live.

## Background

M2.3 shipped steps 1, 2, and 5. Genre, tone, and setting commit as
empty strings, no lore exists, and the AI-assist component ships
only the `prose` and `chips` result shapes with a two-action
`Discard / Use this` row. This slice replaces that floor for the
World half of the deferred work and brings the assist primitive up
to the canonical pattern; the Cast half follows in
[Slice 3.6b](./06b-wizard-cast.md). The preset catalog is
code-authored bundled JSON copied by value into the story — no
preset id is stored, so catalog edits never propagate to existing
stories. Lore rows flow through 3.1a's embed step without this
slice knowing its internals (C5).

## Required reading

- [`wizard.md → Step 3 — World`](../../../../ui/screens/wizard/wizard.md#step-3--world)
  — genre / tone three input paths, replace-on-existing confirm,
  setting, initial-lore list with inline editor, validation gates.
- [`wizard.md → AI-assist pattern`](../../../../ui/screens/wizard/wizard.md#ai-assist-pattern)
  — trigger, guidance popover, loading, failure, cost,
  context-shaping.
- [`wizard.md → Result presentation`](../../../../ui/screens/wizard/wizard.md#result-presentation--three-shapes)
  — the three result shapes and their action rows.
- [`wizard.md → Refine`](../../../../ui/screens/wizard/wizard.md#refine--prose-result-only)
  and [`wizard.md → Pagination on list results`](../../../../ui/screens/wizard/wizard.md#pagination-on-list-results)
  — cumulative refine, `Generate more` dedupe behavior.
- [`wizard.md → Step 5`](../../../../ui/screens/wizard/wizard.md#step-5--opening--finish)
  — the opening preview states refine / regenerate slot into.
- [`wizard.md → What Finish does`](../../../../ui/screens/wizard/wizard.md#what-finish-does--atomic-commit)
  — the atomic commit's lore step and its in-transaction embed.
- [`data-model.md → Genre / tone preset hybrid`](../../../../data-model.md#genre--tone-presetprose-hybrid)
  — the label / promptBody shape, snapshot copy, fire-and-forget
  catalog, no-preset path.
- [`data-model.md → Injection modes`](../../../../data-model.md#injection-modes--unified-enum--structural-invariant)
  — the `always` / `auto` / `disabled` enum the lore editor exposes.
- [`calendar-systems/spec.md → Rendering pipeline`](../../../../calendar-systems/spec.md#rendering-pipeline)
  — the renderer the step-2 calendar summary preview samples
  (cross-cutting roadmap item; verify only, see Scope: in).

## Scope: in

- **Step 3 — World:** genre / tone label and promptBody with
  manual, preset-browse, and AI-suggest paths plus the
  replace-on-existing confirm; the bundled preset catalog
  (code-authored JSON, same pattern as the suggestion-category
  defaults) with ~10 genre and ~10 tone entries, LLM-drafted and
  reviewed in-slice; setting textarea with AI-suggest; initial-lore list
  (compact rows, inline editor with `▼ More options` — tags,
  injection mode, priority), long-scroll; `✨ Suggest lore`;
  validation (lore rows need title and body; genre and setting are
  encouraged, not gated).
- **AI-assist primitive:** the **list** result shape (per-row
  checkboxes on condensed cards, `Generate more` pagination,
  `Import selected`, case-insensitive name dedupe rendering
  `(already exists)` with the checkbox disabled); `Refine…` as the
  fourth action on every prose result, cumulative across repeats;
  `Regenerate` on the prose and chips action rows. Built in the
  shared component, so all five prose call sites gain the canonical
  four-action row at once.
- **Opening refine / regenerate** on the step-5 AI preview, which
  falls out of the primitive work above.
- **Working state and commit:** lore drafts in the wizard working
  state with ids minted at add time; Finish inserts them and embeds
  `title` and `body` into `lore_vec` inside the one transaction via
  3.1a's embed helper (C5); an empty-bodied row is rejected at
  Finish rather than silently dropped.
- **Step indicator:** the World pill enables and the active step
  sequence becomes 1-2-3-5; back-jump pill demotion stays correct
  across the new step.
- **Step-2 calendar-summary preview** — verify only. The renderer
  sampling the roadmap attributes to this milestone already landed
  in M2.3 (`computeSampleRender` in
  `components/wizard/step-calendar-logic.ts`); confirm it still
  holds and record the finding in Implementation notes.

## Scope: out

- Step 4 (Cast), the four per-kind editors, `✨ Suggest cast`,
  status / lead / staged cascades, pick-from-cast pickers —
  [Slice 3.6b](./06b-wizard-cast.md).
- Opening context consuming the authored cast, `sceneEntities` enum
  filtering, removal of the M2 minimal lead input —
  [Slice 3.6b](./06b-wizard-cast.md).
- Memory-cost (Matryoshka) disclosure on step 5 —
  [Slice 3.1b](./01b-embedder-lifecycle.md).
- The embed step in Finish — [Slice 3.1a](./01a-embedder-core.md)
  (C5).
- World-panel editors, collision review — M4.
- User-authored genre / tone / setting templates in Vault — parked.
- Wizard-time pack selection, prompt-pack editor — parked.

## Acceptance criteria

- A story is creatable with genre and tone (one preset-picked and
  hand-edited, one authored from scratch), a setting, and ≥ 2 lore
  rows; Finish commits every lore row in the one transaction with
  its `lore_vec` vector, and the opening call's rendered context
  contains the authored genre, tone, setting, and lore (vitest on
  the commit composition plus a rendered-context assertion).
- Lore inline editor round-trips every `More options` field; an
  empty-body row blocks `Next` with an inline error and is rejected
  at Finish.
- Replace-on-existing fires when a preset pick or an AI-suggest
  accept would overwrite a non-empty genre or tone; `Cancel` leaves
  the field untouched (vitest on the state machine, Storybook on
  the modal).
- `✨ Suggest lore`: `Generate more` preserves already-imported
  rows and a case-insensitive name collision renders
  `(already exists)` with its checkbox disabled (vitest).
- Refine on a prose preview: the guidance popover pre-seeds,
  the re-roll replaces the preview, repeated refines accumulate,
  and `Use this` commits the refined prose; regenerate produces a
  new take without guidance edits (state-machine vitest plus manual
  smoke on the opening).
- A pre-3.6a draft session (empty world) reopens without data loss
  and completes through the new step.
- Every new chrome string routes through `t()`; new compounds have
  stories.

## Tests

- Vitest: preset-catalog shape, replace-confirm state machine, lore
  validation gates, working-state migration, commit composition
  (lore rows and vec-op ordering), the AI-assist state machine
  across list / refine / regenerate, suggest-lore dedupe.
- Storybook: step-3 body, lore inline editor, preset browser, the
  list result shape, refine popover states.
- E2E (`pnpm test:e2e`): both create-story flows updated for the
  new step, plus a spec authoring ≥ 2 lore rows that asserts the
  `lore` rows and their `lore_vec_384` vectors on the branch —
  the direct parallel to the existing lead-embedding assertion.
- Manual smoke: full run on desktop and Android (keyboard avoidance
  on the lore editor per the wizard doc's mobile expression).

## Open questions

- **Opening-prompt volume.** The wizard renders every authored lore
  row into the opening call with no cap, per the AI-assist
  pattern's context-shaping rule. A large authored world can
  overflow the model's context, and the failure lands at the last
  step of story creation. Monitor during implementation; a
  mitigation is a followup, not slice work.
- **Replace-confirm asymmetry.** Canon names the confirm modal for
  genre, tone, and the committed opening prose, and is silent for
  setting, description, and title. This slice follows canon
  literally rather than generalizing the confirm alongside the
  primitive-wide refine work; revisit if the inconsistency reads as
  a bug in use.
- **Nothing in the pipeline bounds a model-authored lore string.**
  `loreSuggestionsSchema` caps neither `title` nor `body`, and
  neither does the write-path `loreWriteSchema`; the `lore` table's
  columns are unbounded text. A runaway model reply therefore reaches
  the store, the embedder, and the uncapped opening prompt at
  whatever length it arrives. Deliberately not fixed here: a Zod
  `.max()` rejects the **whole batch**, not the one bad row, and the
  cost lands on a legitimate long entry while the failure it guards
  is rare — the user also reviews every row before importing. If it
  ever bites, the fix belongs at the write path where it can drop or
  truncate one row, not at the parse boundary where it fails five.
  Surfaced by the Task 7 review (2026-08-10).

## Implementation notes

**Commit rows are inserted `embedding_stale = 1` and cleared by the
same batch.** Recovery for an un-embedded row keys entirely on that
flag — the pre-retrieval sync stage and the drain worker both select
only stale rows, and nothing re-derives it outside an embedder swap.
Inserting at the column default of `0` therefore made a row with no
vector permanently invisible to retrieval, a state reachable today by
calling `createStoryWithBranch` with rows but no `embed`. Inverting
the default makes the invariant self-healing: any future reorder or
omission of the embed splice leaves the row dirty for the drain
instead of silently dropping it from the index. The lead-entity
insert carried the same latent gap since 3.1a and was fixed with it.
**Slice 3.6b's cast rows must follow this.**

**`LoreList` deliberately separates pruning from auto-expand.** The
effect watching rows only prunes ids that vanished; the `Add lore`
handler is the sole owner of expanding a new row. A generic "new id
⇒ expand" effect — the pattern `suggestion-categories-editor.tsx`
uses — would pop the editor open on draft resume and behave
arbitrarily on an AI import, because `hydrate` and `importLore` are
non-Add insertion paths. 3.6b's `Suggest cast` import inherits this:
imported rows must land collapsed.

**Refine and Regenerate landed primitive-wide, not opening-only.**
Canon makes the four-action row the contract for every prose result,
so building it into `AiAssist` gave genre, tone, setting,
description, and the opening all of it at once — less code than
special-casing one site. Refine sits on the prose props variant
specifically, so a chips or list caller passing it is a compile
error rather than a silent no-op.

**Every authored lore row reaches the opening prompt uncapped**, per
the AI-assist pattern's context-shaping rule; the wizard runs no
budget machinery. `Import selected` closes the overlay rather than
staying open to paginate — canon's "Generate more after import"
sentence admits both readings, and closing matches how `Use this`
and chip-pick already terminate.

**The genre / tone preset count left canon rather than shrinking.**
`~20-30 entries each` was an unsourced sizing intuition carried from
an exploration record into two canonical docs; the catalog is
additive fire-and-forget data with no contract surface, so the count
is no longer pinned anywhere and no top-up is owed against the ~10
each shipped here.

**The step-2 calendar-summary preview needed no work** — the
renderer sampling the roadmap attributes to this milestone already
landed in M2.3 (`computeSampleRender`).
