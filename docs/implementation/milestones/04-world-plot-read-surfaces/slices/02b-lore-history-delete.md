# Slice 4.2b — Lore detail, History tab module, delete arms

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** [Slice 4.2a](./02a-entity-detail.md) (C7
  save-session host, C11 overflow menu, the History placeholder this
  slice fills)
- **Blocks:** [Slice 4.2c](./02c-collision-review.md) (the merge's
  losing row deletes through C3), [Slice 4.6](./06-import-export.md)
  (lore export host — partial). This slice also replaces
  [Slice 4.3](./03-plot-panel.md)'s History placeholder with the real
  `HistoryTab` and flips its disabled thread and happening delete
  entries (C4, C3).

## Goal

Lore gets its detail pane (Body / Settings / History), the delta-log
History tab lands as a shared module (C4) that also fills 4.2a's
placeholder and mounts on Plot's thread and happening panes, and the
first delete surfaces ship — `Delete entity`, lore `Delete`, and
`Delete thread` / `Delete happening` — over hardened delete arms (C3):
the entity link cascade, inverse-ref rewrite, tail-metadata drop, lead
refusal, the happening cascade's critical section, and the vector
sweep on forward delete and redo for every embedded kind.

## Background

Lore is a separate, simpler kind: text-heavy, no lifecycle, no scene
presence, a required `body`, and — since the 2026-09-06 design — a
`keywords` editor that is load-bearing for the keyword retrieval
pathway (embedding models have no prior for invented terms). History
is the per-row delta log: read-only, searchable over field paths and
`undo_payload`, load-older chunked, rendered through the shipped
`DeltaLogRow` with host-side humanization. Delete is where M1.5's
"no production caller" arms meet reality: `deleteEntity` removes one
row and leaves `happening_awareness`, `happening_involvements`,
`character_relationships`, inverse `state` refs and `translations`
dangling (all FK-less by composite-PK necessity), and nothing on any
delete path reaches the vec0 tables — `deleteVecOps` exists with no
caller. Reverse-replay already restores rows stale; redo rebuilds a
delete from the registry's `cascadeDeleteOps` hook, never from the
handler, which is where the sweep must therefore live.

## Required reading

- [`world.md → Lore — separate kind`](../../../../ui/screens/world/world.md#lore--separate-kind)
  through [`History tab — lore`](../../../../ui/screens/world/world.md#history-tab--lore)
  — the three-tab skeleton, detail head, Body and Settings fields,
  the required-body invariant.
- [`world.md → History tab`](../../../../ui/screens/world/world.md#history-tab),
  [`Detail head structure`](../../../../ui/screens/world/world.md#detail-head-structure)
  (the `Delete entity` entry) and
  [`Mobile expression`](../../../../ui/screens/world/world.md#mobile-expression)
  (lore's three-tab Select rule on phone; History controls reflow).
- [`patterns/tabs.md → Tab-strip overflow rule`](../../../../ui/patterns/tabs.md#tab-strip-overflow-rule).
- [`patterns/forms.md → Autocomplete-with-create primitive`](../../../../ui/patterns/forms.md#autocomplete-with-create-primitive)
  (the `category` suggestions), [`Select primitive`](../../../../ui/patterns/forms.md#select-primitive),
  [`Input primitive`](../../../../ui/patterns/forms.md#input-primitive),
  [`Textarea primitive`](../../../../ui/patterns/forms.md#textarea-primitive)
  (the body field's auto-grow), [`TagInput pattern`](../../../../ui/patterns/forms.md#taginput-pattern)
  and [`Form rows — stacked-on-narrow-container`](../../../../ui/patterns/forms.md#form-rows--stacked-on-narrow-container).
- [`patterns/delta-log-row.md → Compound API`](../../../../ui/patterns/delta-log-row.md#compound-api)
  through [`Click behavior`](../../../../ui/patterns/delta-log-row.md#click-behavior)
  — what the host pre-formats, and the cache-miss summary rule.
- [`patterns/lists.md → Load-older`](../../../../ui/patterns/lists.md#load-older--log-shaped-unbounded-lists)
  and [`Search bar scope`](../../../../ui/patterns/lists.md#search-bar-scope)
  (the History row of the table).
- [`patterns/alert-dialog.md → Destructive CTA`](../../../../ui/patterns/alert-dialog.md#destructive-cta-via-button-composition)
  — the delete confirmation shape.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  — delta encoding, `undo_payload` shapes, and what redo replays.
- [`world.md → Reversibility`](../../../../ui/screens/world/world.md#reversibility)
  — the merge write set C3 mirrors for delete.
- [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape)
  — the `needsLead` constraint behind the lead refusal.
- [`patterns/entry-card.md → World-state panel`](../../../../ui/patterns/entry-card.md#world-state-panel)
  — historical entries render an unresolvable id as an Unknown-entity
  chip, which is why the delete need not touch them; the tail drop is
  this milestone's default, not canon (C3).
- [`memory/retrieval.md → Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle)
  and [`Keywords schema`](../../../../memory/retrieval.md#keywords-schema)
  — the vec0 write and sweep obligations and lore `keywords`.
- [`architecture.md → Delta history diff resolution`](../../../../architecture.md#delta-history-diff-resolution)
  — the M6.4 cache the C4 summary later upgrades into; read for the
  contract boundary, not to build it.
- [Milestone contracts C3, C4, C7, C11, C12](../milestone.md#slice-contracts).

## Scope: in

- **Lore pane:** `LoreDetailPane` on the C7 host — detail head
  (kind icon and `Lore`, `InlineEditableName` on `title`, recently-
  classified badge, C11 menu with `Export lore as JSON` disabled until
  4.6, `View raw JSON`, `Delete`; no `Set as lead`); **Body** tab
  (`category` input with a branch-scoped suggestions popover, body
  textarea filling the pane; Save disabled while body is empty);
  **Settings** tab (`injection_mode` with explanation, `priority`
  `0..100` with the shipped-semantics tooltip, `keywords` normalized
  through C12, `tags`); create mode from `[+] Blank` on Lore; tabs via
  Tab strip on desktop and tablet, Select dropdown on phone.
- **C4 History module:** the load-older query, the humanizer with its
  field-path label vocabulary, and the `HistoryTab` component with
  search (field-path / op / summary), op-filter chips, newest / oldest
  sort, `Load older`, the read-only empty state, and controls that
  reflow on narrow widths; mounted on the lore pane and on 4.2a's four
  entity panes (replacing the placeholder), and renderable for the
  `threads` and `happenings` target tables — 4.2b itself mounts it on
  Plot's thread and happening panes too, replacing 4.3's History
  placeholder there. Rows show `entry #n` as meta text and are not
  pressable.
- **C3 delete arms**, per the milestone's pinned mechanism: the
  grouped entity delete — one merged `updateEntity` per referencing
  entity, one `updateStoryEntryMetadata` for the tail scene drop, then
  `deleteEntity` with `cascadeDeleteOps` covering the three link tables
  and translations; the `lead-entity` refusal when the target is the
  story's lead; the happening cascade's child read and delete moved
  into one critical section under the key lock; and `deleteVecOps`
  emitted from each embedded kind's `cascadeDeleteOps` so forward
  delete and redo both sweep. The 4.2b PR amends `world.md` to record
  the tail-scene drop, or records the deviation if review rejects it.
- **Delete surfaces:** `Delete entity` and lore `Delete` in the C11
  menus over an `AlertDialog` naming what goes with the row (link-row
  counts, the tail-scene drop); for the lead, `Delete entity` is
  disabled with a reason pointing at `Set as lead`; gated while
  generation is in flight; routed through the reader's CTRL-Z stack.
- **Plot surfaces** (4.3 merged with both disabled): `HistoryTab` on
  the thread and happening panes; `Delete thread` / `Delete happening`
  over the shared confirm dialog.
- **Completeness:** every delete arm cascades its row's translations;
  reverse-replay of a create sweeps the row's vectors; the embedder's
  vector insert is conditional on the source row; the runner patches
  cascaded children's stores after commit.
- **Lead interim:** `resolveLead` (a dangling lead reads as absent) in
  World and the composer; do / say / think disable with a reason when
  the wrap has no lead to name.
- **Storybook:** lore pane states (populated / empty body / create),
  History tab states (rows per op and source, empty, loading older),
  delete confirm and the lead-disabled `⋯` entry.

## Scope: out

- Entity panes and the save-session host — [Slice 4.2a](./02a-entity-detail.md).
- The merge driver that consumes the delete arm — [Slice 4.2c](./02c-collision-review.md).
- The diff cache and rich diff prose — M6.4.
- Lore Assets (parked), lore categories as dynamic chips (no
  followup until volume demands).
- Global delta-log browser — M7.3 Diagnostics Hub.
- Reader jump-to-entry from a History row — M7.3 (carried deferral).
- A per-branch, delta-logged lead — M6 (carried deferral).

## Acceptance criteria

- Deleting a character with two awareness rows, one involvement, one
  relationship, a translation row, and another character holding it in
  both `current_location_id` and `inventory[]` leaves none of those
  rows, rewrites both refs in one `updateEntity`, removes the id from
  the tail entry's `sceneEntities`, and leaves zero vec0 rows for the
  id in every dim family — all under one `action_id` (vitest against
  an in-memory DB with vec tables).
- CTRL-Z of that delete restores the entity, every cascaded row, the
  inverse refs and the tail scene, with the restored entity
  `embedding_stale = 1`; redo re-deletes and the vec tables are empty
  for the id again (vitest on reverse-replay and redo).
- Deleting the story's lead character is refused with `lead-entity`
  from the arm, and the `⋯` `Delete entity` entry is disabled for the
  lead with a reason pointing at `Set as lead` (vitest on the arm;
  component test on the menu entry).
- Deleting a lore, thread or happening row leaves zero vec0 rows for
  the id; two concurrent writers on a happening's involvements cannot
  interleave with its delete (vitest per kind; vitest on the key lock).
- Historical entries that referenced the deleted id still render it
  as an Unknown-entity chip (component test on the world-state panel
  with a deleted id in `sceneEntities`).
- The delete confirm for a character with two awareness rows, one
  involvement and one relationship names those counts and the
  tail-scene drop (component test plus Storybook).
- Saving lore with an empty body is impossible from the Body tab and
  from create mode (component test).
- History search for a field path (`state.traits`) returns only
  updates touching it; op filter `delete` returns only deletes;
  `Load older` appends the next chunk and never auto-loads on scroll
  (vitest on the query; component test on the tab).
- A `periodic_classifier` delta on the entity renders the
  `periodic classifier` source label and `entry #n` as meta text; the
  `HistoryTab` renders a `threads` and a `happenings` fixture delta
  with resolved names (component test).
- Every chrome string routes through `t()`; new compounds have stories.

## Tests

- Vitest: C3 cascade matrix (each link table, merged multi-field ref
  rewrite, tail scene, translations, lead refusal, happening critical
  section), sweep-on-delete and sweep-on-redo per kind, C4 query
  (search shapes, op filter, sort, cursor), humanizer per op, source
  and target table.
- Component tests: lore pane, required body, History tab controls,
  delete confirm and the lead-disabled `⋯` entry.
- Storybook: the matrix above.
- E2E (desktop): delete entity → undo → redo, asserting vec rows and
  link rows in the DB.

## Open questions

- **Critical-section shape for the happening cascade.**
  **Resolved at planning (2026-09-28):** a per-branch `happening_links`
  key — no per-happening key existed, and a read can't sit inside a
  proxy transaction.
- **Group ordering.** **Resolved at planning (2026-09-28):**
  order-independent — every handler in a group reads pre-group state,
  and the delete group's rows are disjoint. The builder still emits
  the delete last, by convention, pinned by a test.
- **Lead removed by a reversal.** **Resolved at planning
  (2026-09-28):** reversals are never refused; the interim
  `resolveLead` reads a dangling lead as absent, and a per-branch,
  delta-logged lead is filed to M6.
- **Deleting an entity while a classifier pass is in flight.**
  **Resolved at planning (2026-09-28):** live-row guards on the three
  link writers under the link keys — a create re-reads the rows it
  names, the entity and the happening, or both ends of a pair, and
  no-ops when one is gone.

## Implementation notes

- **A row created earlier in the same action group counts as present
  for the happening cascade's live-row guards** (developer decision,
  2026-09-28), on top of the per-branch lock and re-read-and-no-op
  shape the Critical-section-shape open question above resolved.
- **Reversals are never refused; the lead can dangle (developer
  decision, 2026-09-28).** `resolveLead` (`lib/world`) is the interim:
  World and the composer read the lead through it and treat a
  dangling id as absent, disabling do / say / think with a visible
  reason (not only a web tooltip) when there's no lead to name. A
  per-branch, delta-logged lead is filed to
  [M6](../../../roadmap.md#m6--branches--diff-cache);
  [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape)
  records the two readers that still see the raw id as harmless until
  then.
- **Plot's History tab and delete entries ship in 4.2b, not deferred
  (developer decision, 2026-09-28).** 4.3 merged both disabled
  ("Lands in Slice 4.2b"); shipped copy no longer points at a merged
  slice.
- **Lead delete UI (developer decision, 2026-09-28).** `Delete entity`
  disables for the resolved lead with a reason pointing at
  `Set as lead`; the arm still refuses `lead-entity` underneath, so a
  refusal that races past the UI toasts rather than silently no-oping.
- **Items at a deleted location, or held by a deleted character, stay
  unplaced (developer decision, 2026-09-28).** No position is
  invented; the confirm names the count
  ([`data-model.md → ItemState shape`](../../../../data-model.md#itemstate-shape)).
- **Piggyback visual-change text is truncated to the schema's 500-char
  cap (developer decision, 2026-09-28).** An over-long note
  previously blocked any later `updateEntity` of that entity,
  including a delete clearing a ref to it. Existing over-long rows
  aren't repaired — [`triage.md`](../../../triage.md).
- **Reader jump-to-entry from History is descoped (developer decision,
  2026-09-28).** Rows aren't pressable; `entry #n` is meta text.
  Carried to [M7.3](../../../roadmap.md#m7--app-settings--diagnostics--onboarding) —
  the Diagnostics Hub delta log wants the same link, and building one
  now would reach into the reader's scroll-compensation machinery.
- **Entity cascade rides the delete delta's undo payload**, the same
  shape as `deleteHappening`'s (`involvements` / `awareness` /
  `relationships` / `translations` keys, `restoreCascade`, and the
  forward handler registered as `cascadeDeleteOps` so redo replays
  it) — one delta per deleted row would have bloated History and the
  undo group.
- **`HandlerOutcome.cascadePatches` closes a latent bug.** The runner
  previously emitted only the parent's store patch; a forward cascade
  would have left dead link rows in the working-set stores, but the
  bug stayed latent because no production delete caller existed to
  exercise it.
- **A group mixing a delete with a write to a row the delete cascades
  is rejected up front as `group-conflict`.** Otherwise it would
  commit and then fail undo forever on a UNIQUE re-insert — the same
  rule that rejects a merge re-keying the loser's links inside the
  delete's group; see
  [`02c-collision-review.md → Open questions`](./02c-collision-review.md#open-questions).
- **History search matches `json_type`, not `json_extract`**, since
  the latter can't tell an absent path from a stored `null`; the
  field-path and free-text arms apply to `update` deltas only (a
  delete's payload is the full row). Known limitation: the free-text
  `LIKE` arm matches the undo payload's pre-change value, so it finds
  the edit that replaced a value, not the one that set it — until
  M6.4's diff cache.
- **Lore's update handler drops unchanged columns**, like the entity
  handler, so History never lists a field that didn't change.
- **The confirm's copy is built after the dirty-pane guard resolves**,
  from the row re-read by id, and its impact counts are a snapshot at
  that moment — a classifier write while the confirm is open isn't
  reflected; the arm re-reads the cascade at apply time regardless. A
  pending confirm is cancelled when the screen loses focus
  (`open={focused}`).
- **World and Plot share `destructiveEntry` and one
  `common:deleteUndoHint`** that interpolates the reader's own undo
  label, so the confirm's copy can't drift from the reader's menu.
- **Impact counts for awareness / involvements / relationships repeat
  the entity cascade's predicates against the stores** (only
  references / unplaced items / tail scene come straight from
  `entityDeleteActions`) — a future cascade table needs a matching
  count in `delete-impact.ts`.
- **Known limits.** Regenerate or rollback after a delete resurrects
  the row, as expected for any World edit; a creative third-person
  story whose lead is its only character can never delete it
  (`setStoryLead` can't clear the lead, and the arm refuses
  `lead-entity` — [`triage.md`](../../../triage.md)); `Set as lead` on
  one branch also dangles the lead on any other branch lacking the
  character, folded into the
  [M6 roadmap entry](../../../roadmap.md#m6--branches--diff-cache); a
  classifier candidate reconciled to a row deleted after the pass's
  re-read is dropped for that pass, recorded in
  [`cadence.md`'s Live-row guards bullet](../../../../memory/cadence.md#user-edits-and-classifier-writes).
- **Deferred to [`triage.md`](../../../triage.md)**, among them:
  HistoryTab's settle-count reload, the lore create session's
  whole-draft validation gap on Entity / Plot creates, the lore body
  textarea not filling the pane, `Autocomplete`'s uncommitted-casing
  gap, the AlertDialog impact list's missing accessible-description
  wiring, and the History `Deleted` chip's near-unreachability.
  Link-row edits in History stay
  [parked](../../../../parked.md#history-shows-link-row-edits).
