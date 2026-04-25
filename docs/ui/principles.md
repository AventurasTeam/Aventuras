# UI principles

Cross-cutting design decisions — things that apply across multiple
surfaces. Each per-screen doc references these. Adding to this file
should happen when a decision has (or will have) impact on more than
one screen. Single-surface design lives in the per-screen doc, not
here.

---

## Wireframe format and interactivity

Wireframes live as **standalone interactive HTML** at
`docs/ui/screens/<screen>/<screen>.html`, colocated with the
per-screen `.md` doc. Each is a committed artifact, no framework, no
build, no external deps. Styling is low-fi monochrome; state
transitions use minimal inline vanilla JS.

- **Review controls bar** at the top of each interactive wireframe
  lets reviewers flip states directly (like tiny Storybook controls).
- Natural interactions also work (click a row, press Esc, etc.).
- No fake data, no real logic — purely visual state-swapping.
- Stylings stay monochrome intentionally; pixel-fidelity decisions
  (palette, typography) land in the visual identity session.

Iteration uses the Superpowers brainstorming companion (ephemeral
`.superpowers/brainstorm/`, gitignored). When a wireframe stabilizes,
its final form lives in `docs/ui/screens/<screen>/`.

---

## Naming convention — World / Plot and their "panel" descriptor

The dedicated screens for world-state management are called **World**
(entities + lore) and **Plot** (threads + happenings). These are
**proper-noun names** — capitalized, standalone in UI chrome (screen
labels, breadcrumbs, inventory).

In **prose and UI action text** where standalone "World" or "Plot"
reads grammatically awkward, add the common-noun descriptor
**"panel"** (lowercase): `Open in World panel →`, "the Plot panel
handles…". The descriptor never gets capitalized; the name always
does.

---

## World / Plot split — unified panels by purpose

World-state data is split across two panels, clustered by interaction
pattern:

- **World** — entities (character / location / item / faction) +
  lore. World-building material — things that _exist_. Master-detail
  workshop pattern: filterable list on the left, single-row detail
  with tabs on the right, explicit save session, peek drawer for
  summary access in the reader. Per-kind tab composition (characters
  get Overview/Relationships/Assets/Involvements/History; lore gets a
  simpler composition keyed on its schema).
- **Plot** — threads + happenings. Narrative progression — things
  that _happen_. Different pattern (dashboard / monitor / audit
  rather than workshop), reflecting that these rows are predominantly
  classifier-written and user-audited, not user-authored. Not yet
  wireframed.

The reader's right-rail Browse dropdown lists all 7 categories grouped
by panel:

```
── World ──
Characters
Places
Items
Factions
Lore
── Plot ──
Threads
Happenings
```

Clicking any category in Browse lists rows in the rail. Clicking a row
opens a peek drawer. The peek's `Open in [World|Plot] panel →` link
routes to the appropriate surface with the row pre-selected.

---

## Top-bar design rule — essentials vs discretionary

**Essentials** (always present, do not count against any budget):

- Generation status pill (hides when idle, shows during active
  pipeline phases: `reasoning…` / `generating narrative…` /
  `classifying…` / `closing chapter…`). Driven by pipeline event
  stream (per [`architecture.md`](../architecture.md)).
- Actions entry point (icon button, opens the Actions menu — see
  below)
- ⚙ Settings (story settings on reader screens, app settings on
  app-level screens)
- ← Return (back to the previous level). **Absent on root-level
  screens** (story list, which is the root).

**Discretionary** (0–1 items per screen, context-dependent):

- Reader: branch icon with count badge, **shown only when > 1 branch
  exists** (single-branch stories omit it). Tooltip reveals branch
  name; click opens Branch Navigator.

Any action beyond these lives in the Actions menu or the
screen-specific chrome. The top bar must never grow unbounded.

---

## Actions — platform-agnostic action directory

What a "command palette" normally does, reframed to work on both
desktop and mobile:

- **Desktop:** `Cmd/Ctrl-K` opens an overlay. Also reachable via the
  Actions icon in the top bar.
- **Mobile:** tap the Actions icon, opens as a bottom sheet.
- Same content on both: a searchable directory of every action the
  current context supports — settings, navigation, filters, tools.
- UI label: "Actions" (not "command palette").

---

## Settings architecture — split by location

Two independent settings areas with the same layout pattern (left
rail of categories, right pane for selected category):

- **App Settings** — global, persists across stories. Scope: provider
  keys, default models per feature, **Default story settings**
  (memory knobs, translation config, composer UX prefs, suggestions
  toggle — values copied into new stories on creation; see scope
  policy below), appearance, data (backup / import / export), UI
  language, about / diagnostics.
- **Story Settings** — per-story, owned by the story row. Scope:
  identity (genre, tags, cover, accent, etc.), definitional fields
  (mode, lead, narration, tone), operational knobs (memory,
  translation, pack, composer UX prefs as story-owned values),
  Models overrides.

**Entry points:**

- App Settings: reached from the story list chrome.
- Story Settings: reached from the gear icon in the reader top bar.

**Settings scope policy — two patterns:**

1. **Copy-at-creation** — App Settings · Default story settings holds
   the defaults for new stories. On creation, those values are
   copied into the new story's `settings`. After creation, the story
   owns its values; changing the App Settings default does NOT
   propagate to existing stories.
2. **Override-at-render** — `settings.models` only. Story values are
   optional; absent fields resolve to the current global pick at
   render time. Changing the global propagates to every un-overridden
   story.

Definitional fields (mode, lead, narration, tone) and identity fields
(genre, tags, cover, etc.) follow neither pattern — they're authored
in the wizard or per-story, with no global default.

Full schema and rationale in
[`data-model.md → Story settings shape`](../data-model.md).

Per-screen detail in
[`screens/story-settings/`](./screens/story-settings/story-settings.md).

---

## Models are override-only (per-story)

`stories.settings.models` fields are **all optional**. An absent field
means "use the global App Settings pick at render time." Presence of a
value pins an override for this story, insulating it from future
changes to the global default.

UI surface (Story Settings · Models tab):

- Dashed-italic `App default: <model>` sentinel (no override set)
- Solid dropdown with `<model> (override)` label (override pinned)

Applies to: `narrative` / `classifier` / `translation` / `imageGen` /
`suggestion`.

The global defaults live in App Settings · Models (pending wireframe).
App Settings uses the same left-rail settings pattern; its fields
there are primary (not override sentinels).

---

## Mode, lead, and narration — three orthogonal concepts

Previously "POV" was used as a catch-all. Retired from the vocabulary
because it conflated three distinct concepts.

### 1. Mode — user's relationship to the story

- **Adventure** — the user is a character. A lead entity is required
  (must be `kind=character`). Pipeline filters prompt context by the
  lead's awareness links.
- **Creative writing** — the user is a director. Lead is optional
  (ensemble stories). No awareness filtering applied.

### 2. Lead — which character the story is about

The story's main character. In adventure mode, the user plays this
character; in creative mode, they write about them. Same underlying
field, different UI label:

- **Adventure mode UI label: `You`** (because you _are_ them)
- **Creative mode UI label: `Protagonist`** (because you write about
  them as lead)

### 3. Narration — the prose person the AI writes in

Orthogonal to both mode and lead. Governs the AI's narrative prose
person. Three options:

- **First-person**: `"I reach for the blade. The tavern is warm."`
- **Second-person**: `"You reach for the blade. The tavern is warm."`
  (classic interactive fiction style; also used in literary fiction)
- **Third-person**: `"Aria reaches for the blade. The tavern is
warm."`

Narration governs **AI output only.** It does NOT affect how the
user's own input gets wrapped — see "Composer mode" below. Composer
wrap POV is a separate setting restricted to first/third
(second-person makes no sense for user-composed input).

Field: `stories.settings.narration: 'first' | 'second' | 'third'`.

A first- or second-person story still has a lead (whose "I" / "you"
the narrator inhabits). A third-person story can have a lead too (the
camera's anchor) — or none (creative mode with omniscient narration).

Encoding:

- `stories.settings.mode = 'adventure' | 'creative'`
- `stories.settings.leadEntityId` (required when mode=adventure,
  optional in creative). Must be `kind=character` — enforced at the
  zod schema boundary.
- `stories.settings.narration = 'first' | 'second' | 'third'`

**Lead is a generation-level concept, not a UI gate.** The UI never
restricts what the user can see regardless of mode. The "view through
character's eyes" filter is a separate, opt-in UI concept that can
target any character, not just the lead.

**Lead switching is a first-class feature.** Changing `leadEntityId`
is allowed at any point in the narrative. Previous leads revert to
plain characters. Entry points:

- **World Panel · Overview** — "Set as lead" action on any character
  entity, alongside status.
- **Reader peek drawer** — quick switch without navigating out.
  Pending — return pass on the reader wireframe.
- **Actions menu** — "Set lead character → pick" searchable command.
- **Story Settings · About** — alongside the mode selector.

All four are redundant entry points for the same mutation. Lead is
important enough that over-reachability beats one-true-place purity.

---

## Scene presence is runtime-derived, not status

Scene presence ("is this entity in the scene right now?") is
**distinct from lifecycle status** (staged / active / retired). An
entity can be active-not-in-scene, active-in-scene,
retired-in-a-flashback-scene, etc. — these are orthogonal axes the UI
must render independently.

**Kind-dependent:**

- **character** — boolean in-scene flag
- **item** — boolean in-scene flag
- **location** — degenerate: exactly one location is "the current
  scene location" per branch
- **faction** — not applicable

Storage and derivation live in
[`data-model.md → Entry metadata shape`](../data-model.md). UI
consumes `metadata.sceneEntities` (characters + items) and
`metadata.currentLocationId` (singleton location) from the latest
entry on the current branch.

---

## Entity row indicators — three distinct channels

An entity row carries three orthogonal signals that don't compete for
one slot — each has a dedicated channel so any combination renders
correctly, and every row has identical structure (no value-dependent
absence that makes "nothing shown" ambiguous):

- **Lead badge** (gold pill, text mode-dependent): inline immediately
  after the name. Only present for the story's lead character. Label
  is `You` in adventure mode, `Protagonist` in creative mode.
- **Scene presence** (row-level accent): an in-scene row gets a
  left-edge 3px green accent stripe plus a faint green background
  tint. NOT a right-side indicator — scene presence is about "which
  rows matter right now" which fits row-level chrome.
- **Status pill** (always shown, muted when active): on the far
  right. Every row carries one of `active` / `staged` / `retired`.
  Active renders with muted styling (faint gray); staged = soft
  green; retired = soft amber.

Applies to the reader's Browse rail AND the World panel's list pane.
CSS class convention: `.lead-badge`.

---

## Entity kind indicators — icons, not text

Entity kind renders as a **square glyph icon** (22×22 box), not text.
Saves horizontal room in narrow rails; still categorical at a glance.

Wireframe placeholder glyphs (real icons land with visual identity):

| Kind      | Glyph |
| --------- | ----- |
| character | ☺     |
| location  | ⌂     |
| item      | ◆     |
| faction   | ⚑     |

---

## Entity list sort order — static, four-layer

No user sort controls — list sort is rule-driven and stable:

1. **Layer 0 (lead pin, chars only):** when the current category is
   `characters`, the lead (if set) is pinned to the very top.
   Absolute override of all subsequent layers. Applies only to
   characters — other kinds have no lead concept.
2. **Layer 1 (status tier):** Active → Staged → Retired
   _(current → future → past, by narrative relevance)_
3. **Layer 2 (within Active only):** in-scene first, then
   not-in-scene
4. **Layer 3 (within each tier):** alphabetical by name

Applies to Browse rail and World panel list pane. Filter chips narrow
the set but sort still applies within the filtered subset. The lead
stays pinned unless the filter excludes them entirely.

---

## Browse filter chips

Mutually exclusive (single-select):
`All` / `In scene` / `Active` / `Staged` / `Retired`.

- `All` is the default and shows the full list with accordion
  grouping (see below).
- `In scene` is orthogonal to status.
- `Active` / `Staged` / `Retired` filter to one status tier.

Combining filters (e.g. "in-scene AND staged") is not supported in
v1; single-select keeps the UI simple.

### Accordion grouping on "All" view

When `All` is active, rows group under status-tier accordion headers
(`Active` / `Staged` / `Retired`) with click-to-collapse. Each header
shows name + count + chevron.

**Default expansion:**

- `Active` — expanded (the working set)
- `Staged` — collapsed (reference)
- `Retired` — collapsed (reference)

Session-scoped (not persisted). When a non-All filter is active, the
list renders flat (single implicit group, no accordion chrome).

---

## Entity surfacing — three levels, same data

Same entity, three depths of UI:

1. **Browse rail** (reader right rail, ~300px) — list only, filter
   chips, scene indicator. Fast glance + row click.
2. **Peek drawer** (reader overlay, ~440px) — summary + quick edits
   (pencil icons on text fields). Opens on row click; Esc or × closes.
3. **World panel** (dedicated full-screen surface) — master-detail
   workshop. Left pane = filterable list. Right pane = single-entity
   detail with **five tabs**: Overview / Relationships / Assets /
   Involvements / History.

Peek drawer's footer link "Open in World panel →" routes to the panel.

---

## Entity form UI is generated from the typed schema

`entities.state` is a typed discriminated union (CharacterState /
LocationState / ItemState / FactionState) — not a dynamic bag. This
has a direct UI consequence:

- **No generic key/value editor.** Form fields are generated from the
  Zod schema (already in the stack). One schema drives form controls,
  validation, types — all from the same source.
- **No "+ add field" UI.** You can't add fields to a typed shape.
- **Fields distribute deterministically by shape:**
  - **Scalar / enum / primitive fields** → **Overview tab** as typed
    controls (dropdown, text, chips, etc.).
  - **Entity-to-entity ID fields** → **Relationships tab** as
    picker-backed inputs. Grouped by semantic label (Positional /
    Possession / Affiliation for character; different groups for
    other kinds).
- **Overview composition is per-kind.** Character / Location / Item /
  Faction each define their own Overview section driven by their
  typed state. Some shared fields (description, tags, retired_reason,
  portrait) anchor the pattern.
- **`retired_reason` is conditional** — disabled when
  `status !== 'retired'`, enabled when it is.
- **Raw JSON view** remains as a small power-user/debug affordance
  (overflow menu next to entity name), for export and troubleshooting.

---

## Entity editing — explicit save, session-based

Pattern used by the World panel and reused by Story Settings.
Autosave-on-blur was rejected: it would (a) let a single careless
keystroke write a destructive change without friction, and (b)
produce delta noise (one `action_id` per field) that makes CTRL-Z too
granular.

Session semantics:

- **Session starts** on the first field edit (form becomes dirty).
- **Form-local state** is held by react-hook-form (already in stack);
  nothing writes to the Zustand store or SQLite until Save.
- **Tab switching is within session** — editing across multiple tabs
  is one session.
- **Save commits** all session changes as deltas under a single
  shared `action_id`. CTRL-Z reverses the entire session as one step.
- **Discard** throws the session away without any writes.
- **Navigate-away guard** — clicking another list row, switching
  branch, navigating out of the panel, closing the window — all
  trigger a confirmation modal while dirty: "Unsaved changes: Save /
  Discard / Cancel navigation."

UI surface:

- **Save bar** appears as a footer on the detail pane ONLY when the
  session is dirty. Shows unsaved-change count + summary of which
  fields are dirty. Action buttons: Discard + Save (keyboard shortcut:
  `Cmd/Ctrl-S`).
- **Clean state** has no save bar — no chrome when reading.
- **Peek drawer** (reader) keeps its direct-manipulation pencil edits
  for single-field quick tweaks; these commit immediately as
  one-field sessions. Deep edits route to World panel where the
  explicit-save pattern applies.

---

## Bulk operations — deferred

Bulk ops (multi-select, batch status change, batch tag, batch retire,
batch export) are deferred pending their own design pass. Open
sub-questions:

- How do batch ops group under `action_id` for single-press undo?
- Confirmation patterns — when, how loud, what counts shown?
- Cross-kind selection — does "retire all" make sense across mixed
  kinds?
- Selection persistence across tab switches, filter changes,
  navigation?
- Visual design of the selection bar — persistent vs contextual?

World panel does NOT include checkboxes or a bulk action bar
currently.

---

## Injection / retrieval rules for prompt context

`lore`, `entities`, and `threads` carry an `injection_mode` field
that the UI exposes as a dropdown:

| Mode          | Meaning                                                 |
| ------------- | ------------------------------------------------------- |
| `always`      | Unconditional injection (the explicit override)         |
| `keyword_llm` | Keyword match + LLM relevance check (the smart default) |
| `disabled`    | Exists in data, never reaches the prompt                |

**Default: `keyword_llm`.** `happenings` deliberately don't expose
this — the `happening_awareness` graph IS their structural injection
rule.

**Where the dropdown surfaces:**

- World panel · Overview tab — for entities and lore
- Plot panel · Overview tab — for threads (not happenings)

**Structural invariant** (UI implication): active + in-scene entities
are ALWAYS injected regardless of the mode dropdown. The dropdown
only governs off-scene/inactive rows. The UI may surface a
"structurally pinned" indicator for active+in-scene entities so users
know the mode is moot for those rows — TBD with World panel · Overview
detail design.

Mechanics (how `keyword_llm` retrieval works, token budgets, the
in-scene-bypass) live in
[`architecture.md → Retrieval / injection phase`](../architecture.md).

---

## Composer mode — send-time transform, narration-aware

Composer mode is a **send-time text wrapping** driven by pack
templates — prepend and append around the user's typed text.

**Wrapping POV is its own setting**, distinct from narration.
Narration governs AI prose; wrap POV governs how the user's lazy-mode
input is rendered. Field:
`stories.settings.composerWrapPov: 'first' | 'third'`. Default
`first` (most natural for adventure-style play where the user types
as the character). Second-person isn't offered — "you reach for the
blade" makes no sense as user-composed input (the user isn't the
narrator addressing themselves).

Examples (adventure mode, lead = Aria):

- `Do` · first-person wrap: user types "reach for the blade" →
  `I reach for the blade.`
- `Do` · third-person wrap: user types "reach for the blade" →
  `Aria reaches for the blade.`
- `Say` · first-person: user types "who's asking?" →
  `"Who's asking?" I said.`
- `Say` · third-person: user types "who's asking?" →
  `"Who's asking?" Aria said.`
- `Think` · first-person: `*this smells like a trap* I thought.`
- `Think` · third-person: `*this smells like a trap* Aria thought.`
- `Free`: verbatim regardless.

**Narration mismatch is fine.** The AI's narration voice and the
user's wrap POV are independent; mixed voices ("You step inside the
tavern… Aria reaches for her blade.") are narratively coherent when
the narrator and the actor have different perspectives. Users who
want voice-matched entries can pick a wrap POV that aligns or use
`Free` mode and write it themselves.

**Modes are opt-in, adventure-only.** Two settings gate them:

- `stories.settings.composerModesEnabled: boolean` (default `true`)
  — per-story toggle. When off, the composer has no mode picker;
  user text is sent verbatim.
- In creative mode, modes are **always hidden** regardless of the
  toggle. User is a director writing prose directly — no shorthand
  to expand.

If either condition hides the picker, the composer reduces to
textarea + regen + send.

**Four modes** (adventure only):

| Mode    | Purpose                      |
| ------- | ---------------------------- |
| `Do`    | Action wrapper               |
| `Say`   | Dialogue wrapper             |
| `Think` | Internal monologue wrapper   |
| `Free`  | No wrapping; user text as-is |

The wrapped text IS the saved `story_entries.content`. Mode is **not
stored** on the entry — the final wrapped content is canonical.

- Reader rendering of user entries shows just the final text; no
  mode chip, no meta.
- Editing an entry edits the final wrapped text directly.
- Rewrapping with a different mode post-send is not a v1 feature.

---

## Search bar scope

Every search input in the app **must declare what it searches**.
"Search…" with no scope is ambiguous and quietly inconsistent across
surfaces. Per-screen docs name the scope inline; this section is the
cross-cutting summary plus the UX rule.

**UX rule:**

- **Placeholder text shows 1-2 most obvious fields**, truncation-safe
  under ~25 characters: `Search title, description…`. The full scope
  is rarely visible in placeholder real estate.
- **Tooltip on focus / hover** lists the full set of searched fields.
- **A small ⓘ help icon next to the input** opens the same scope
  list as a popover — discoverable on touch where hover doesn't fire.
  Belt + suspenders for cross-platform.

**SQLite mechanics.** SQLite ships JSON1 (built into expo-sqlite).
Search queries combine `LIKE` against typed text columns with
`json_extract` / `json_each` for JSON-stored fields (`tags`,
`entities.state` per-kind, `metadata`, `undo_payload`). For larger
stories, **FTS5** is the upgrade path (mirror searchable text into
an FTS virtual table, triggers keep it in sync). v1 stays on
LIKE + JSON-extract; revisit when a real story hits the wall.

**Per-surface scope** — each surface's per-screen doc carries the
authoritative version; this is the cross-cutting summary:

| Surface                 | Searches                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Story list              | `title`, `description`, `genre`, `tags`, `author_notes`                                                                           |
| Reader Browse rail      | category-aware (entity: `name`/`description`/`tags`; lore: `title`/`body`/`tags`; thread/happening: `title`/`description`/`tags`) |
| World panel list        | category-aware (same as Browse rail equivalents)                                                                                  |
| Plot panel — threads    | `title`, `description`, `category`, `tags`                                                                                        |
| Plot panel — happenings | `title`, `description`, `category`, `tags`                                                                                        |
| History tab (any panel) | structurally different — field-path strings, op (`create`/`update`/`delete`), rendered change-summary text                        |

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

**Story file format:** `.avts` extension (Aventuras-fresh; chosen
distinct from the old app's `.avt` because the v2 schema is a hard
break, not a migration). Contents are JSON with a mandatory version
header so future migrations have a clean signal:

```json
{
  "format": "aventuras-story",
  "formatVersion": "1.0",
  "exportedAt": "2026-04-25T...",
  "story": { ... },
  "branches": [...],
  "entities": [...],
  ...
}
```

Import validates `formatVersion` and either accepts or rejects with
a clear "this file is from a newer/older version" message. Format
specifics deferred; versioning is the load-bearing decision.

**Legacy `.avt` import** (from the old app) is supported for
migration. The import flow needs its own design pass — see
[`followups.md`](../followups.md#legacy-avt-migration-import).

**Per-row import (entity / thread / happening / lore).** Each list
pane's `+ New X` affordance becomes a small menu offering:

- `Blank` — opens the form in create mode, empty.
- `From JSON file…` — file picker, paste-supported. Validates against
  the kind's zod schema before creating; mismatch fails with a
  friendly error rather than a partial save.
- `From Vault…` — disabled placeholder until Vault lands. Belongs
  here so future-Vault has its slot.

**Validation contract:** all imports (story-level or row-level) pass
through the same zod schema that protects writes. JSON that doesn't
parse cleanly fails with field-level errors; no "merge what works,
ignore what doesn't" path.

**Full backup restore** lives in App Settings · Data tab; pending
its wireframe.
