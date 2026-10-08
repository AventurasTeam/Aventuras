# Slice 4.6 — Per-row `.avts` import and export

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** the build-independent half (envelope kinds, payload
  schemas, import actions, export serializers — C9) is day-one; the
  import wiring needs [Slice 4.1](./01-world-shell.md) and
  [Slice 4.3](./03-plot-panel.md) (the `[+]` menus); the export wiring
  needs [Slice 4.2a](./02a-entity-detail.md),
  [Slice 4.2b](./02b-lore-history-delete.md) and
  [Slice 4.3](./03-plot-panel.md) (the C11 menus)
- **Blocks:** none in M4 (M8.3 vault calendars and M9.4 story import
  reuse the wiring pattern)

## Goal

The shipped `ImportDialog` gets its first consumers: World and Plot
`[+] From JSON file…` for entities (kind-narrowed), lore, threads and
happenings, over the four per-row envelope kinds with Zod payload
schemas (C9) and import actions that create rows through the existing
arms. The matching export lands in the same slice: `⋯ → Export … as
JSON` on every detail head writes the envelope to a file on desktop
and hands it to the share sheet on native. Decided at promotion: one
owner for both directions so the envelope has one writer and one
reader.

## Background

`.avts` is one envelope for every kind — `format`, `formatVersion`,
`exportedAt`, and a payload under the kind's key. Per-UI gating means
each slot accepts only its kind; for entities the slot is per
entity-kind, so the schema passed to the dialog is narrowed with a
`.refine` on `kind` and a wrong-kind file surfaces as a payload error
rather than a wrong-kind row. The dialog is pure View — read,
meta-check, validate, emit — and self-closes; hosts own the trigger
and run the success effect in `onValidated`. The roadmap's
install-and-rebuild prerequisite is already satisfied:
`expo-document-picker` and `expo-file-system` are installed and
imported by the dialog. What native lacks is a way to hand an
exported file to the user.

## Required reading

- [`data-model.md → Aventuras file format`](../../../../data-model.md#aventuras-file-format-avts)
  — envelope, kinds table, version handling, per-UI gating, extension
  policy.
- [`patterns/import-dialog.md`](../../../../ui/patterns/import-dialog.md)
  in full — props, validation pipeline, and especially
  [`World per-row entity import`](../../../../ui/patterns/import-dialog.md#world-per-row-entity-import),
  [`Plot per-row import`](../../../../ui/patterns/import-dialog.md#plot-per-row-import),
  [`Host gating during in-flight generation`](../../../../ui/patterns/import-dialog.md#host-gating-during-in-flight-generation)
  and [`Implementation prerequisites`](../../../../ui/patterns/import-dialog.md#implementation-prerequisites).
- [`patterns/data.md → Import counterparts`](../../../../ui/patterns/data.md#import-counterparts--file-based--vault).
- [`world.md → Per-row import`](../../../../ui/screens/world/world.md#per-row-import),
  [`Detail head structure`](../../../../ui/screens/world/world.md#detail-head-structure)
  (the export entry) and
  [`Required body`](../../../../ui/screens/world/world.md#required-body--creation--edit-invariant)
  (the import half of the invariant).
- [`plot.md → Manual creation + per-row import`](../../../../ui/screens/plot/plot.md#manual-creation--per-row-import).
- [`data-model.md → Happenings & character knowledge`](../../../../data-model.md#happenings--character-knowledge)
  — the time-anchor exclusivity the happening schema refines, and why
  entry refs cannot travel between stories.
- [`data-model.md → Backup & export format`](../../../../data-model.md#backup--export-format)
  — what the story-level export strips (the per-row export strips the
  same server-owned fields).
- [`memory/retrieval.md → Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle)
  — imported rows are `embedding_stale` until the drain embeds them.
- [Milestone contracts C9, C11, C12](../milestone.md#slice-contracts).

## Scope: in

- **C9 module:** `EntityImportSchema` (discriminated union over the
  four kinds, `state` per kind, server-owned columns excluded),
  `LoreImportSchema` (body required), `ThreadImportSchema` (status
  required; entry refs stripped), `HappeningImportSchema` (time-anchor
  exclusivity; `occurred_at_entry_id` stripped since entry ids do not
  travel; `temporal` kept; involvements and awareness **not**
  imported — their ids are branch-local, and any such keys in a
  hand-authored file are dropped); per-kind import actions creating
  the row through the existing create arm with `source = 'user_edit'`,
  `embedding_stale = 1`, keywords normalized through C12, a fresh
  kind-prefixed id, returning it; per-kind export serializers
  producing the envelope (`formatVersion` `1.0`, `exportedAt`,
  server-owned fields and `app_settings` references stripped;
  happening export carries the row alone — the raw JSON viewer, not
  the file, is where links show).
- **Import wiring:** the four hosts' `From JSON file…` entries enabled
  and mounting `ImportDialog` with `format`, `supportedMajor`,
  `payloadKey`, the schema (entity slot narrowed to the active kind),
  `title`, and an `onValidated` that runs the import action and
  selects the new row; the entry disabled while generation is in
  flight per the host-gating rule.
- **Export wiring:** the four C11 entries — one shared by the four
  entity kinds in 4.2a's panes, one each on 4.2b's lore pane and 4.3's
  thread and happening panes — enabled; desktop / web writes a
  download named `<kind>-<slug>.avts`; native hands the file to the OS
  share sheet.
- **Native share path:** `expo-sharing` added (a native module — the
  slice needs a dev-client rebuild before native runtime, per
  [`lessons-learned/native-dep-expo-link.md`](../../../lessons-learned/native-dep-expo-link.md));
  the file written under the app's cache directory via
  `expo-file-system`.
- **Storybook:** the dialog already has its matrix; add one story per
  host title. **i18n:** the host copy in `world` / `plot`.

## Scope: out

- Story-level `.avts` export / import — M9.4.
- Vault calendars import — M8.3.
- Universal import dispatcher, legacy `.avt` migration, pre-import
  preview, drag-and-drop, forward-compat field-loss advisory — parked.
- Importing link rows (involvements, awareness, relationships) with a
  happening or entity — not in v1; the payloads are single rows.

## Acceptance criteria

- Exporting a character produces an `aventuras-entity` envelope with
  `entity.kind = 'character'`, no `id` / `branch_id` /
  `embedding_stale` / `name_collision_flag`, and `formatVersion`
  `1.0` (vitest on the serializer).
- Importing that file on another story through the Characters slot
  creates a row with a fresh id, `embedding_stale = 1`, one
  `createEntity` delta, and selects it (vitest on the import action
  against the in-memory test DB; component test on host selection);
  through the Locations slot the dialog surfaces the payload-error
  state with exactly one issue whose path is `kind` (vitest on the
  narrowed schema; component test on the dialog's issue list).
- A happening file with both `occurred_at_entry_id` and `temporal`
  fails at Stage 3 naming the refine; a valid one imports with
  `occurred_at_entry_id = null` and `temporal` intact; one
  hand-authored with `involvements` / `awareness` keys imports the row
  alone and drops them (vitest on schema and action).
- A lore file with an empty `body` fails at Stage 3 (vitest).
- A `formatVersion: "2.0"` file fails at Stage 2 with the newer-version
  banner in every host (a story per host pastes the file through a
  stubbed clipboard into the dialog with that host's shipped config).
- `From JSON file…` is disabled with the in-flight tooltip during a
  turn (component test).
- The clipboard import path creates the row on desktop (E2E asserting
  the new row in the DB — the one E2E, and only once the clipboard
  permission seam is proven at planning; otherwise manual smoke).
- On Android the export opens the share sheet with an `.avts` file
  (manual smoke; dev client rebuilt).
- `pnpm typecheck` passes with the new dependency, and if the desktop
  export takes the IPC route, `tsc -p electron/tsconfig.json` passes
  too; every chrome string routes through `t()`.

## Tests

- Vitest: four schemas (happy, wrong kind, stripped fields, refines,
  dropped link keys), four import actions, four serializers,
  round-trip equality on the portable fields.
- Component tests: host wiring and gating, dialog issue list.
- E2E (desktop): clipboard import round trip, if the permission seam
  allows; export covered by vitest plus manual smoke.

## Open questions

- **Clipboard permission under Playwright plus Electron.** No existing
  spec drives `navigator.clipboard.readText()`; prove the seam at
  planning before committing to the E2E, else the import happy path is
  manual smoke. Resolved in 4.6 planning (2026-10-07): proven under the
  harness; the E2E drives the clipboard, the file chooser and the
  download.
- **Web download mechanics under Electron.** A data-URL anchor click
  works in the renderer; confirm the Electron main process does not
  intercept downloads, or route through a `dialog.showSaveDialog` IPC
  if it does (nothing in the E2E harness can observe a download
  either way). Resolved in 4.6 planning (2026-10-07): Electron main
  installs no download handler, `will-navigate` doesn't block an
  anchor download, and Electron shows its own Save dialog; no IPC
  route.
- **Export filename slug.** Name-derived, ASCII-folded, kind-prefixed
  (`character-kael.avts`) is the default; the story export in M9.4
  should match. Resolved in 4.6 planning (2026-10-07):
  `<kind>-<slug>.avts`, ASCII-folded, helper in `lib/avts` for M9.4.
- **Import of a `staged` entity.** Status travels; confirm a staged
  import is what the user expects versus forcing `active`. Resolved in
  4.6 planning (2026-10-07): status travels verbatim.
- **Four hand-copied detail-pane heads.** (2026-09-28, routed from
  triage 2026-10-04) `LoreDetailPane` duplicates `EntityDetailFrame`:
  the head, tab list, menu and JSON viewer wiring are a near-copy of
  the frame, and so are the thread and happening panes' heads, so it is
  four copies, not two. The Plot copies have already drifted — a
  missing tab reset and a blocked name with no reason, both fixed on
  2026-10-04 — and still don't close the JSON viewer on a row switch.
  This slice's export wiring is the next change that lands in all four
  heads, which makes it the cheapest place to generalize the frame; the
  tab reset already lives in `hooks/use-create-reset-tab.ts`. Resolved
  in 4.6: one `RowDetailFrame` compound behind all four heads.

## Implementation notes

Decisions settled at planning (developer, 2026-10-07) and routes that
bind a later slice. Canon carries the detail; each line points to it.

- **Per-row payloads carry no branch-local id.** Export leaves out
  every entity and entry reference in an entity's `state`, a thread's
  or happening's entry references, and every link row; import drops
  those keys rather than rejecting them. On another story the refs
  would dangle, and on the same story a re-imported copy would run
  World's one-position-per-item rule and strip the original's items;
  see
  [`data-model.md → Aventuras file format`](../../../../data-model.md#aventuras-file-format-avts).
- **Payload keys are camelCase**, the Drizzle row keys the raw JSON
  viewer and every delta `undoPayload` already use, so M9.4's story
  export, which carries the delta log verbatim, stays consistent. The
  brief's snake_case names were column references; an entity's
  `state` keeps its stored keys.
- **An imported entity keeps its status** (`staged`, `active` or
  `retired`, with `retiredReason`).
- **Import and `[+] Blank` share one create path:** the import actions
  build the pane's draft and call the existing save action with no
  row, so the fresh id, the single create delta, `user_edit` and C12's
  keyword clean-up come from the arms that already exist.
- **One `RowDetailFrame` behind the four detail heads** (World entity
  and lore, Plot thread and happening), so export is wired once. It
  fixed the Plot panes' JSON viewer staying open across a row switch;
  see
  [`data.md → Raw JSON viewer`](../../../../ui/patterns/data.md#raw-json-viewer--shared-modal-pattern).
  Export always reads the committed row, never the draft: exporting a
  row with unsaved edits exports the saved version.
- **The host flow M8.3 and M9.4 copy:** one `useRowImport` per import
  slot, opened through the leave guard, refused and closed while
  generation is in flight, and closed when the screen loses focus or
  the category switches. The dialog closes itself before the commit
  resolves, so the host toasts the outcome with import copy and
  selects the new row through the leave guard; see
  [`import-dialog.md → World per-row entity import`](../../../../ui/patterns/import-dialog.md#world-per-row-entity-import)
  and
  [`→ Host gating during in-flight generation`](../../../../ui/patterns/import-dialog.md#host-gating-during-in-flight-generation).
- **`ImportDialog` changed under its first consumers:** its copy
  routes through `t()` (`common:importDialog.*`), it never resets on
  mount (forced story states had been rendering idle), and closing it
  discards an in-flight read, as canon already said.
- **Export file names** are `<prefix>-<slug>.avts` (prefix the entity
  kind, else `lore`, `thread` or `happening`) from `avtsFileName` in
  `lib/avts`, which M9.4 reuses. The fold transliterates letters NFKD
  can't split (`ß`, `æ`, `ø`, `ł`, `þ` and kin) instead of dropping
  them.
- **Native export** writes to the cache directory and opens the share
  sheet through `expo-sharing`, imported lazily so a dev client built
  before it fails only on export. The Android share sheet and the
  desktop native Save dialog are still manual checks.
- **Zod's own issue messages stay English;** only this slice's custom
  messages go through `t()`. When a second locale lands, switch Zod's
  locale in `lib/i18n` with the app language, not schema by schema.

Decided at the slice review (developer, 2026-10-08):

- **Per-row export stays live during generation.** It reads one
  committed row, like `View raw JSON`; the gate's backup / export
  entry is the story-level one (the Actions menu, Story Settings). A
  file exported mid-turn can hold a state a cancel then reverses,
  which is accepted; see
  [`principles.md → What's not gated`](../../../../ui/principles.md#whats-not-gated).
- **A failed desktop save stays unreported until M9.4.**
  `saveAvtsFile` resolves at the download hand-off, and `electron/`
  has no `will-download` listener. The main-process watcher is an M9.4
  entry in the
  [roadmap's M9 carried deferrals](../../../roadmap.md#m9--storybook--per-surface-visual-polish--ship-gate).
- **An export with unsaved edits says so.** While the draft is dirty,
  `RowDetailFrame` toasts that the file holds the saved row once the
  file is handed off, so all four panes share it. Provisional: the
  toast; the alternative is the `⋯` entry while the draft is dirty.
- **The clipboard-import E2E runs on its own:** its own app, seed and
  hand-authored file, so a failure in the export or file-import legs
  can't skip it.
