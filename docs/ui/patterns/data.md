# Data-affordance patterns

Shared modals + import/export plumbing reused across surfaces.
Sister patterns to [`entity.md`](./entity.md),
[`lists.md`](./lists.md), and [`forms.md`](./forms.md).

---

## Raw JSON viewer — shared modal pattern

Every "View raw JSON" affordance (World ⋯, Plot ⋯, story-list ⋯,
future surfaces) opens **the same right-anchored drawer**. One
component reused everywhere; no per-surface variants.

**Shape:**

- Right-anchored drawer, ~440px wide (matches reader peek drawer
  dimensions for visual consistency).
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

---

## Import counterparts — file-based + Vault

Every export affordance has (or will have) a file-based import
counterpart. Two parallel paths into the app: **file imports**
(JSON / `.avts`) and **Vault** (in-app library, deferred). Both
target the same "add to story" actions; they're parallel, not
exclusive.

**Aventuras file format:** `.avts` is the canonical extension across
all import/export content (stories, calendars, future packs /
scenarios / templates) — same envelope, kind-tagged via the
`format` field. Full convention spec lives at
[`data-model.md → Aventuras file format`](../../data-model.md#aventuras-file-format-avts).
This pattern doc covers the UX side (file picker affordance, paste
support, validation behavior); the envelope shape and version
handling are canonical there.

**Legacy `.avt` import** (from the old app) is supported for
migration. The import flow needs its own design pass — see
[`followups.md`](../../parked.md#legacy-avt-migration-import).

**Per-row import (entity / thread / happening / lore).** Each list
pane's `+ New X` affordance becomes a small menu offering:

- `Blank` — opens the form in create mode, empty.
- `From JSON file…` — file picker, paste-supported. Validates against
  the kind's zod schema before creating; mismatch fails with a
  friendly error rather than a partial save.
- `From Vault…` — disabled placeholder until the Vault parent shell
  lands (per the
  [Vault parent shell followup](../../parked.md#vault-parent-shell)).
  The first Vault content type — calendars — has its editor at
  [vault/calendars](../screens/vault/calendars/calendars.md); the
  picker affordance hooks into the same content store once the
  shell catches up.

**Validation contract:** all imports (story-level or row-level) pass
through the same zod schema that protects writes. JSON that doesn't
parse cleanly fails with field-level errors; no "merge what works,
ignore what doesn't" path.

**Full backup restore** lives in App Settings · Data tab; pending
its wireframe.
