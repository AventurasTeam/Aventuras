# Data-affordance patterns

Shared modals + import/export plumbing reused across surfaces.
Sister patterns to [`entity.md`](./entity.md),
[`lists.md`](./lists.md), and [`forms.md`](./forms.md).

Used by:

- [World panel · ⋯ → View raw JSON](../screens/world/world.md#detail-pane--raw-json-viewer)
  (raw JSON viewer)
- [World per-row import](../screens/world/world.md#per-row-import)
  (import counterparts: Blank / From JSON / From Vault)
- [Plot panel · ⋯ → View raw JSON](../screens/plot/plot.md#detail-pane--raw-json-viewer)
  (raw JSON viewer)
- [Plot per-row import](../screens/plot/plot.md#manual-creation--per-row-import)
  (import counterparts for threads / happenings)
- [Vault calendars · ⋯ → View raw JSON](../screens/vault/calendars/calendars.md#detail-head)
  (raw JSON viewer)
- [Vault calendars · + Add calendar ▾](../screens/vault/calendars/calendars.md)
  (import counterparts: Clone built-in / From JSON / From scratch)
- [Story list · Story import](../screens/story-list/story-list.md#story-import)
  (import counterparts for stories)
- [Diagnostics Hub · Per-turn inspector](../screens/diagnostics/diagnostics.md#tab-2--per-turn-inspector)
  (raw JSON viewer for classifier output)
- [Diagnostics Hub · Logs tab — row expansion](../screens/diagnostics/diagnostics.md#row-expansion--tablet)
  (JSONBlock inline-use on tablet+ for expanded row payloads;
  Raw JSON viewer Sheet on phone tap-to-open)

---

## Raw JSON viewer — shared modal pattern

Every "View raw JSON" affordance (World ⋯, Plot ⋯, story-list ⋯,
future surfaces) opens **the same right-anchored drawer**. One
component reused everywhere; no per-surface variants.

**Shape:**

- Tablet / desktop: right-anchored drawer, ~440 px wide (matches
  reader peek drawer dimensions for visual consistency).
- Phone: tall bottom sheet — 440 px right-anchored doesn't fit phone
  widths, so the drawer swaps to the bottom-sheet shape used
  elsewhere for phone-tier overlays (Select's phone swap, etc.).
- Header: `Raw JSON · <row name>` + close `×`.
- Body: pretty-printed JSON of the row + nested fields merged
  (e.g. entity row + `state` JSON; happening row + involvements +
  awareness summary). Monospace, indented, low-fi syntax tone in v1
  (real syntax highlighting with visual identity).
- Top-right: **Copy** button.
- Footer hint: `Edit raw — coming later` (disabled placeholder).

**Read-only in v1.** Edit-mode (raw-edit + zod-validate on save) is
deferred to a follow-up.

Esc / × closes the drawer.

### JSON content block — inline use

The drawer / Sheet body content (pretty-printed JSON + Copy
icon-action at top-right) is the reusable shape; the drawer chrome
(header, footer hint) wraps it. The same content block also lands
inline as the expanded body of accordion-style row expansion —
notably [Diagnostics Logs row-expand on tablet+](../screens/diagnostics/diagnostics.md#row-expansion--tablet)
— without the drawer wrapper.

Inline use renders the JSON content directly within the host row's
expanded area: no header (the host row supplies the identifier),
no footer hint, no close affordance (the accordion chevron handles
collapse). Copy button stays. Same monospace + indentation + low-fi
syntax styling as the drawer.

Implementation note: factor the JSON content into a `JSONBlock`
sub-component (its own file under `components/ui/`) that both the
inline use and the drawer / Sheet wrap. Single source of truth for
the formatting + Copy affordance.

---

## Import counterparts — file-based + Vault

Every export affordance has (or will have) a file-based import
counterpart. Two parallel paths into the app: **file imports**
(JSON / `.avts`) and **Vault** (in-app library, deferred). Both
target the same "add to story" actions; they're parallel, not
exclusive.

**Aventuras file format:** `.avts` is the canonical extension across
all import/export content (stories, calendars, entities, lore,
threads, happenings, future packs / scenarios / templates) — same
envelope, kind-tagged via the `format` field. Full convention spec
(envelope shape, version handling, per-UI gated rejection) lives at
[`data-model.md → Aventuras file format`](../../data-model.md#aventuras-file-format-avts).

**Legacy `.avt` import** (from the old app) is supported for
migration. The import flow needs its own design pass — see
[`parked.md → Legacy .avt migration import`](../../parked.md#legacy-avt-migration-import).

**Per-row import (entity / thread / happening / lore).** Each list
pane's `+ New X ▾` affordance is a menu offering:

- `Blank` — opens the form in create mode, empty.
- `From JSON file…` — opens the
  [`ImportDialog`](./import-dialog.md) configured for the row's
  kind. File pick or clipboard read, envelope meta-check, zod
  payload validation. Mismatch fails with a friendly error rather
  than a partial save.
- `From Vault…` — disabled placeholder until the Vault parent shell
  lands (per the
  [Vault parent shell followup](../../parked.md#vault-parent-shell)).
  The first Vault content type — calendars — has its editor at
  [vault/calendars](../screens/vault/calendars/calendars.md); the
  picker affordance hooks into the same content store once the
  shell catches up.

**Validation contract:** all imports (story-level or row-level) pass
through the same zod schema that protects writes. JSON that doesn't
parse cleanly fails — categorical meta-error for envelope-shape
problems, field-level summary + expandable details for payload-shape
problems. No "merge what works, ignore what doesn't" path. The
canonical pipeline + error UI lives in
[`import-dialog.md`](./import-dialog.md).

**Full backup restore** lives in App Settings · Data tab; pending
its wireframe.
