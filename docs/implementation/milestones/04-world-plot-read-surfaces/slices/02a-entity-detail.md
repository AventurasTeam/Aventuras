# Slice 4.2a — Entity detail: per-kind panes, save session, create mode

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** [Slice 4.1](./01-world-shell.md) (the shell hosts
  the pane; `[+] Blank` opens create mode). Doc-as-contract pair with
  [Slice 4.3](./03-plot-panel.md) over C7 (save-session host), C8
  (entity picker) and C11 (overflow menu); the Involvements tab's
  Plot links render inert until 4.3's route exists (C6).
- **Blocks:** [Slice 4.2b](./02b-lore-history-delete.md) (C7 host,
  C11 menu), [Slice 4.5b](./05b-peek-drawer.md) (Overview projection,
  C5), [Slice 4.6](./06-import-export.md) (export host — partial)

## Goal

The four entity kinds get their hand-written detail panes —
`CharacterDetailPane`, `LocationDetailPane`, `ItemDetailPane`,
`FactionDetailPane` — with the Overview / Identity / Carrying /
Connections / Settings tabs, the Relationships sub-section, the
per-row save session (C7), create mode from `[+] Blank`, the
overflow-menu compound (C11) with `Set as lead` (C5) and `View raw
JSON`, the kind-aware entity picker (C8), and the
`parent_location_id` cycle guard the wizard adopts. Involvements
renders read-only; Assets renders a placeholder; History renders a
placeholder 4.2b fills.

## Background

`entities.state` is a typed discriminated union, so the panes are
hand-written per kind rather than generated: schema is the validation
contract, UI owns layout, and tabs distribute fields by semantic
purpose. Overview is a read-mostly glance card whose regions route to
the edit tab; it doubles as the peek body at 440 px, which is why its
component must take its width and region handler as props. Every edit
rides the save-session pattern — one react-hook-form session per row,
explicit Save, one `action_id` — and disables while generation is in
flight. The authorship contract matters here: `lastSeenAt` is
classifier-only and renders read-only; everything else the user may
edit, knowing the classifier may overwrite it on contradicting prose.

## Required reading

- [`world.md → Detail head structure`](../../../../ui/screens/world/world.md#detail-head-structure),
  [`Tabs — per-kind composition`](../../../../ui/screens/world/world.md#tabs--per-kind-composition)
  through
  [`Settings — entity-management chrome`](../../../../ui/screens/world/world.md#settings--entity-management-chrome),
  [`Assets, Involvements, History`](../../../../ui/screens/world/world.md#assets-involvements-history),
  [`Detail pane — raw JSON viewer`](../../../../ui/screens/world/world.md#detail-pane--raw-json-viewer)
  and [`Mobile expression`](../../../../ui/screens/world/world.md#mobile-expression)
  — every field, every tab, every tier rule.
- [`world.md → Relationships — character-to-character`](../../../../ui/screens/world/world.md#relationships--character-to-character)
  — row composition, the three perspective states, the edit sheet,
  the CHECK gate.
- [`patterns/entity.md → Entity detail-pane composition`](../../../../ui/patterns/entity.md#entity-detail-pane-composition)
  and [`Entity editing — uses the save-session pattern`](../../../../ui/patterns/entity.md#entity-editing--uses-the-save-session-pattern).
- [`patterns/save-sessions.md`](../../../../ui/patterns/save-sessions.md)
  in full — session semantics, save bar, invalid draft, navigate-away
  guard.
- [`patterns/tabs.md → Tab-strip overflow rule`](../../../../ui/patterns/tabs.md#tab-strip-overflow-rule)
  and [`patterns/forms.md → Select primitive`](../../../../ui/patterns/forms.md#select-primitive),
  [`Form rows — stacked-on-narrow-container`](../../../../ui/patterns/forms.md#form-rows--stacked-on-narrow-container),
  [`TagInput pattern`](../../../../ui/patterns/forms.md#taginput-pattern),
  [`Autocomplete-with-create primitive`](../../../../ui/patterns/forms.md#autocomplete-with-create-primitive).
- [`patterns/data.md → Raw JSON viewer`](../../../../ui/patterns/data.md#raw-json-viewer--shared-modal-pattern).
- [`touch.md → Save bar on phone`](../../../../ui/foundations/mobile/touch.md#save-bar-on-phone)
  — the keyboard-hide rule C7 adds to `SaveBar`.
- [`principles.md → Edit restrictions during in-flight generation`](../../../../ui/principles.md#edit-restrictions-during-in-flight-generation)
  and [`Mode, lead, and narration`](../../../../ui/principles.md#mode-lead-and-narration--three-orthogonal-concepts).
- [`data-model.md → World-state storage`](../../../../data-model.md#world-state-storage)
  through [`Authorship contract`](../../../../data-model.md#authorship-contract)
  — the four `*State` shapes, stackables, containers, the cycle guard
  owner and its rejection shape, relationships and `normalizeForWrite`.
- [`data-model.md → Injection modes`](../../../../data-model.md#injection-modes--unified-enum--structural-invariant)
  and [`memory/retrieval.md → Keywords schema`](../../../../memory/retrieval.md#keywords-schema)
  — what the Settings tab's `injection_mode`, `keywords` and
  `priority` mean.
- [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape)
  — `definition.leadEntityId` and its cross-field constraint (C5).
- [`generation-pipeline.md → Action rejection`](../../../../generation-pipeline.md#action-rejection--defense-in-depth)
  — the `{ status: 'rejected', reason }` shape the guard returns.
- [Milestone contracts C5, C6, C7, C8, C11, C12](../milestone.md#slice-contracts).

## Scope: in

- **Per-kind panes:** the four components with the shared tab
  skeleton (Carrying character-only), rendered through `DetailPane`
  inside one `Tabs` root; the tab strip on desktop and the Select
  primitive on tablet (count > 3) and phone per the overflow rule.
- **Overview** per kind, as one width-agnostic component taking a
  `variant` (`panel` / `peek`) and an `onRegionPress(tab)` handler so
  4.5b can project it: status pill with `retired_reason` inline, the
  non-default `injection_mode` chip, description, visual line,
  `TRAITS` / `DRIVES` chips with `+ N`, `IN <location>` with
  `last seen N days ago` from `lastSeenAt`, `WITH <faction>` — links
  resolved from the entities store — carrying summary, tags read-only,
  portrait **placeholder** slot; location parent-chain breadcrumb,
  `condition`, "Characters here" / "Items here" inverse counts; item
  position (`at_location_id` or "Held by" inverse); faction `standing`,
  agenda chips, member count. Every region press routes to its edit
  tab; empty regions render the `— not yet described —` placeholder
  with an `add →` link.
- **Identity** per kind (description; character `visual.*` and
  personality sub-sections; location / item `condition`; faction
  `standing` and `agenda[]`).
- **Carrying** (character): `stackables` chip row with `<key> × <n>`
  and `+ add`, `equipped_items[]` and `inventory[]` entity-ref lists
  through the C8 entity picker (kind `item`).
- **Connections** per kind: positional / compositional / affiliation
  pickers (C8, kind-filtered, self-excluded), inverse-derived read-only
  lists, `lastSeenAt` read-only; the **Relationships** sub-section —
  `ListRow` rows with both perspectives, `+ Add relationship`, an edit
  sheet (Autocomplete over characters minus self, `kind` and
  `inverse_kind` inputs, at-least-one gate, Delete inside the sheet).
  The sheet's save is **one** action: this slice extends the M1.5
  `upsertCharacterRelationship` payload to carry both perspective
  columns, since the group runner rejects two writes to one row's
  column (C7).
- **Settings:** `status`, `injection_mode` with its explanation,
  `retired_reason` (enabled only when retired), `keywords` and `tags`
  as `TagInput` — keywords normalized through C12 at commit — and
  `priority` integer `0..100`. These are the entity keyword editors the
  2026-09-06 keyword-retrieval design left without a surface.
- **C7 save-session host:** the shared per-row hook — react-hook-form
  session, `SaveBar` in the pane slot with dirty-field labels,
  `Cmd/Ctrl-S`, a `requestLeave` the surface routes row switch, kind
  switch, `useMasterDetailBack` and the Actions menu's
  `beforeNavigate` through, `useUnsavedChangesGuard` for navigator
  removal, window close and reload, one `applyDeltaActionGroup`
  commit per Save under one `action_id`, toast, invalid-draft reason
  in the bar's `notice`, `isUserEditBlocked` gating with the
  principle-owned tooltip, and the `SaveBar` phone change — hide while
  the keyboard is open, return on blur.
- **Cycle guard:** the action-layer pre-commit walk for
  `parent_location_id` (depth-cap 100, `reason: 'parent-cycle'`),
  living in the entity update handler so every writer gets it; the
  wizard's Finish and `cast-import.ts` adopt it in this slice (the
  roadmap's carried deferral); the World form maps the rejection to a
  field error.
- **Create mode:** `[+] Blank` opens the active kind's pane in create
  state with the schema defaults; Save runs the create arm and selects
  the new row.
- **C11 overflow menu:** the compound (entries with `disabled` and
  `disabledReason`, Popover on desktop and tablet, Sheet (short) on
  phone) and World's entries — `Set as lead` (characters only, via
  C5), `Export entity as JSON` (disabled until 4.6), `View raw JSON`
  (`JSONViewer` with row and `state` merged), `Delete entity`
  (disabled until 4.2b).
- **C5:** the new story-definition write arm that sets
  `leadEntityId` under the `needsLead` refine and the in-flight gate,
  with its store refresh.
- **C8 entity picker:** the kind-aware `Autocomplete`-based picker
  with `excludeIds`.
- **Detail head:** `InlineEditableName` (edits dirty the session),
  kind breadcrumb, the C1 `Recently classified` badge, the
  injection-mode chip.
- **Involvements tab:** read-only `happening_involvements` rows for
  this entity with role, each linking to Plot via C6 — inert with a
  "lands in Slice 4.3" reason until that route exists; empty state.
- **Assets tab and History tab:** placeholder bodies (`lands with
the asset gallery pass` / `lands in Slice 4.2b`).
- **Storybook:** each pane per kind (populated / sparse / retired /
  staged), Overview in both variants, relationships states, create
  mode, phone Select-mode tabs.

## Scope: out

- Lore detail, History module, delete —
  [Slice 4.2b](./02b-lore-history-delete.md).
- Collision resolution — [Slice 4.2c](./02c-collision-review.md).
- Export — [Slice 4.6](./06-import-export.md).
- Portrait upload, Assets tab body, image preview — the asset gallery
  pass (parked; see the milestone's open questions).
- Character-side Awareness tab (parked), inter-faction relationships
  (deferred by canon), bulk operations (parked).
- Per-field provenance / classifier lock — parked.

## Acceptance criteria

- Editing `description` and a `visual.hair` on Identity, then a tag on
  Settings, and saving writes one `updateEntity` delta whose
  `undo_payload` carries exactly the three pre-change paths, under one
  `action_id`; CTRL-Z from the reader reverses all three (vitest on
  the session commit plus E2E).
- Switching rows with a dirty session raises Save / Discard / Cancel;
  Cancel keeps the row and the draft; Discard drops the draft; a
  window-close attempt with a dirty session raises the same dialog
  (E2E).
- Setting `A.parent_location_id = B` when `B.parent_location_id = A`
  is rejected with `reason: 'parent-cycle'` from the handler and
  surfaces as a field error on Connections; the same pair authored in
  the wizard's location editor is rejected at Finish (vitest on the
  guard; component test on the form).
- Saving a relationship with both perspectives filled writes one
  action and one row with `a_id < b_id`; with only `inverse_kind`
  filled it saves; with neither filled Save is disabled; the row
  renders `your view: not recorded · they see you: rival` (vitest on
  the extended arm and the sheet's write mapping).
- `Set as lead` on a character updates `definition.leadEntityId`,
  the reader's `You` badge moves on return, the entry is absent on
  non-character kinds, and the action is refused while a turn is in
  flight (vitest on C5 plus manual).
- `[+] Blank` on Locations creates a location with empty state on
  Save and selects it; the create form respects `isUserEditBlocked`
  (component test).
- Pressing the visual line lands Identity, the carrying summary lands
  Carrying, the location link lands Connections, per kind (component
  test on `onRegionPress`).
- Every control disables during an in-flight turn with the
  `Generation is in flight. Cancel to edit.` tooltip (component test
  with a mocked `txState`).
- The Overview `peek` variant at 440 px renders every region with
  `scrollWidth <= clientWidth` on the pane root (Storybook story with
  a `play` assertion).
- Two keyword entries differing only in case collapse to one on
  commit (vitest on the Settings editor's C12 normalization).
- Every chrome string routes through `t()`; new compounds have stories.

## Tests

- Vitest: cycle guard (self, two-cycle, deep chain, cap hit), C5
  validation and gate, relationship both-pov arm and write mapping,
  session commit grouping, Overview derivations (parent chain,
  held-by inverse, member count, `lastSeenAt` relative days), C12
  normalization at commit.
- Component tests: per-kind pane field routing, conditional
  `retired_reason`, injection chip visibility, region routing, create
  mode, edit gating, overflow menu disabled entries.
- Storybook: the matrix above.
- E2E (desktop): edit, save, undo round trip; dirty-switch and
  window-close guards.

## Open questions

- **Portrait placeholder shape.** Whether the slot renders an
  `Avatar` initial or nothing until the asset link exists — pick the
  one that survives the gallery pass without a re-layout; the
  thumbnail tap per
  [`patterns/image-preview.md`](../../../../ui/patterns/image-preview.md)
  stays inert until then.
- **Relationship delete inside the sheet.** Whether the sheet's Delete
  commits immediately (one-field session, like the peek exception) or
  joins the pane's session as a `deleteCharacterRelationship` in the
  group. Default: joins, so one Save reverses everything.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
