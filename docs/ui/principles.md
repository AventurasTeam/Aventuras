# UI principles

Cross-cutting design decisions — things that apply across multiple
surfaces. Each per-wireframe doc references these. Adding to this
file should happen when a decision has (or will have) impact on
more than one screen.

---

## Wireframe format and interactivity

Wireframes live as **standalone interactive HTML** at
`docs/ui/screens/<screen>/<screen>.html`, colocated with the
per-screen `.md` doc. Each is a committed artifact,
no framework, no build, no external deps. Styling is low-fi
monochrome; state transitions use minimal inline vanilla JS.

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

The dedicated screens for world-state management are called
**World** (entities + lore) and **Plot** (threads + happenings).
These are **proper-noun names** — capitalized, standalone in UI
chrome (screen labels, breadcrumbs, inventory).

In **prose and UI action text** where standalone "World" or "Plot"
reads grammatically awkward, add the common-noun descriptor
**"panel"** (lowercase): `Open in World panel →`, "the Plot panel
handles…". The descriptor never gets capitalized; the name always
does.

---

## World / Plot split — unified panels by purpose

World-state data is split across two panels, clustered by
interaction pattern:

- **World** — entities (character / location / item / faction) +
  lore. World-building material — things that _exist_. Master-
  detail workshop pattern: filterable list on the left, single-row
  detail with tabs on the right, explicit save session, peek
  drawer for summary access in the reader. Per-kind tab
  composition (characters get Overview/Relationships/Assets/
  Involvements/History; lore gets a simpler composition keyed on
  its schema).
- **Plot** — threads + happenings. Narrative progression — things
  that _happen_. Different pattern (dashboard / monitor / audit
  rather than workshop), reflecting that these rows are
  predominantly classifier-written and user-audited, not
  user-authored. Not yet wireframed.

The reader's right-rail Browse dropdown lists all 7 categories
grouped by panel:

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

Clicking any category in Browse lists rows in the rail. Clicking a
row opens a peek drawer. The peek's "Open in [World|Plot] panel →"
link routes to the appropriate surface with the row pre-selected.

---

## Top-bar design rule — essentials vs discretionary

**Essentials** (always present, do not count against any budget):

- Generation status pill (hides when idle, shows during active
  pipeline phases: `reasoning…` / `generating narrative…` /
  `classifying…` / `closing chapter…`). Driven by pipeline event
  stream (per `architecture.md`).
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

- **Desktop:** `Cmd/Ctrl-K` opens an overlay. Also reachable via
  the Actions icon in the top bar.
- **Mobile:** tap the Actions icon, opens as a bottom sheet.
- Same content on both: a searchable directory of every action the
  current context supports — settings, navigation, filters, tools.
- UI label: "Actions" (not "command palette").

---

## Settings architecture — split by location

Two independent settings areas with the same layout pattern (left
rail of categories, right pane for selected category):

- **App Settings** — global, persists across stories. Scope: provider
  keys, default models per feature, appearance, data (backup /
  import / export), UI language, about / diagnostics.
- **Story Settings** — per-story, owned by the story row in SQLite.
  Scope: POV, mode, tone, memory / chapter config overrides, pack
  selection, translation config, story identity metadata.

**Entry points:**

- App Settings: reached from the story list chrome.
- Story Settings: reached from the gear icon in the reader top bar.

### Story Settings — two sections under one roof

Story Settings is the single per-story configuration surface (reached
from the reader ⚙). The left rail splits into two sections reflecting
two conceptually distinct domains:

- **Story** section — wizard-editable fields. What the story IS.
  Tabs: About (identity), Generation (mode/lead/POV/tone).
- **Settings** section — post-creation tuning knobs. How it
  generates. Tabs: Models, Memory, Translation, Pack, Advanced.

Rationale for the seam: "wizard-editable" is a cleaner line than
"identity vs settings" because mode/lead/POV land unambiguously on
the wizard side — they're definitional, not tuning. Collapsing both
domains into one screen with a visual sectional split avoids
inflating the top-bar with a second entry point while keeping the
cognitive separation clear.

**No standalone "Edit Story" surface.** Editing story identity
happens on the `About` tab. Title is additionally click-to-edit
inline in the reader top bar for the fast case. The story list's
card `⋯ → Edit info` routes to `About` directly.

### Translation — display-only, opt-in, single target

**Translations are display-only.** They render alongside the source
in the UI; they never feed back into prompts or LLM context. The
source content is canonical. This isolates cost (translation runs
only when enabled) from prompt integrity (generation uses source
always).

**Opt-in, single target language.**

- Master `enable translation` toggle, off by default. Feature is
  niche enough to not justify being on for everyone.
- When enabled, one target language at a time (per-story). Multi-
  target was considered and rejected — cost + ambiguity outweigh
  benefit. Multiple-language conversion of an existing story is
  handled by the Translation Wizard (a separate flow that batches
  conversions).
- When disabled, target + granular toggles grey out; no translation
  writes happen.

**Granular per-content-type toggles** — not everything needs to
render in the target language. Authors can pick:

- Narrative content (the AI's reply text)
- User action text
- Entity fields (names, descriptions, kind-specific state)
- Lore bodies
- Threads + happenings (titles, descriptions)
- Chapter summaries

Each is an independent toggle. Default set (enabled on first turn
on): narrative + user actions + entity fields + lore bodies. Others
off. User can flip.

**Data model** (for reference; lives in `data-model.md`): the
`translations` table already supports multi-language via its
`language` column. The UI's single-target limitation is a v1 scope
decision, not a schema limitation. Data-model is forward-compatible.

## Prompt context — recent buffer + retrieval

Only the most-recent N entries go **verbatim** into the prompt.
Earlier entries reach the prompt through a **retrieval agent**
that queries the delta log and relevant world state for the
current context, not a direct insertion.

Per-story setting: `stories.settings.recentBuffer: number`
(entries). Default 10. User-configurable on Story Settings ·
Memory. Architecture covers the retrieval agent's mechanics in
`architecture.md` (separate from UI spec).

This interacts with chapter closure: closed chapters' content is
the primary fodder for retrieval. Active / open-region entries
are always in the buffer (or reachable from it).

## Pack variables — pack-declared, story-scoped

Packs declare a **variable schema** (names, types, defaults,
descriptions). The Story Settings · Pack tab renders form controls
dynamically based on the active pack's schema. Values are stored
per-story.

Variable types the schema supports:

- Enum (rendered as dropdown or radio group)
- Number (rendered as input; range constraints optional)
- Boolean (rendered as toggle)
- String (rendered as input or textarea)

**Data model:**

```ts
stories.settings.packVariables: Record<string, unknown>
```

Keyed by variable name. Values typed per the active pack's schema
(zod-validated on load against the pack's declared shape).

**Pack-switch behavior** (deferred UX): changing the active pack
invalidates the current variable values. Options: reset to new
pack's defaults / map by name where types match / keep unmapped
values orphaned but accessible. Decide before pack switching ships.

## Models are override-only (per-story)

`stories.settings.models` fields are **all optional**. An absent
field means "use the global App Settings pick at render time."
Presence of a value pins an override for this story, insulating it
from future changes to the global default.

UI surface: each model field on the Story Settings · Models tab
renders either as:

- Dashed-italic `App default: <model>` sentinel (no override set)
- Solid dropdown with `<model> (override)` label (override pinned)

Applies to: `narrative` / `classifier` / `translation` / `imageGen`
/ `suggestion`.

The global defaults live in App Settings · Models (pending
wireframe). App Settings uses the same left-rail settings pattern;
its fields there are primary (not override sentinels).

### Some story settings become effectively immutable

Some per-story knobs (lead/POV most obviously) can't meaningfully
change once narrative has started without breaking coherence.
Wireframes surface a warning or confirm pattern on
dangerous-to-change fields. Specifics (which fields, soft-warn vs
hard-lock, confirmation copy) are a follow-up.

---

## Mode, lead, and narration — three orthogonal concepts

Previously I used "POV" as a catch-all. It's overloaded and
retired from the vocabulary. Three distinct concepts:

### 1. Mode — user's relationship to the story

- **Adventure** — the user is a character. A lead entity is required
  (must be `kind=character`). Pipeline filters prompt context by the
  lead's awareness links.
- **Creative writing** — the user is a director. Lead is optional
  (ensemble stories). No awareness filtering applied to prompt
  context.

### 2. Lead — which character the story is about

The story's main character. In adventure mode, the user plays this
character; in creative mode, they write about them. Same underlying
field, different UI label:

- **Adventure mode UI label: `You`** (because you _are_ them)
- **Creative mode UI label: `Protagonist`** (because you write about
  them as lead)

### 3. Narration — the prose person the AI writes in

Orthogonal to both mode and lead. Governs the AI's narrative
prose person. Three options:

- **First-person**: `"I reach for the blade. The tavern is warm."`
- **Second-person**: `"You reach for the blade. The tavern is
warm."` (classic interactive fiction style; also used in literary
  fiction)
- **Third-person**: `"Aria reaches for the blade. The tavern is
warm."`

Narration governs **AI output only.** It does NOT affect how the
user's own input gets wrapped — see "Composer mode" below. The user
is an actor in the story (supplying the lead's actions / dialogue
/ thoughts), not the narrator; their entries always wrap as third-
person descriptive with the lead as subject regardless of narration
setting. The AI then narrates around those entries in whatever
person the story uses.

Field: `stories.settings.narration: 'first' | 'second' | 'third'`.

A first- or second-person story still has a lead (whose "I" /
"you" the narrator inhabits). A third-person story can have a
lead too (the camera's anchor) — or none (in creative mode with
omniscient narration).

Encoding:

- `stories.settings.mode = 'adventure' | 'creative'`
- `stories.settings.leadEntityId` (required when mode=adventure,
  optional in creative). Must be `kind=character` — enforced at the
  zod schema boundary.
- `stories.settings.narration = 'first' | 'third'`

**Lead is a generation-level concept, not a UI gate.** The UI never
restricts what the user can see regardless of mode. The "view
through character's eyes" filter is a separate, opt-in UI concept
(see scope filter below) that can target any character, not just
the lead.

**Lead switching is a first-class feature.** Changing
`leadEntityId` is allowed at any point in the narrative. Previous
leads revert to plain characters. Entry points:

- **World Panel · Overview** — "Set as lead" action on any
  character entity, alongside status.
- **Reader peek drawer** — quick switch without navigating out.
  Pending — return pass on the reader wireframe.
- **Actions menu** — "Set lead character → pick" searchable command.
- **Story Settings · About** — alongside the mode selector.

All four are redundant entry points for the same mutation. Lead is
important enough that over-reachability beats one-true-place purity.

---

## Scene presence is runtime-derived, not status

Scene presence (is this entity in the scene right now?) is
**distinct from lifecycle status** (staged / active / retired).
An entity can be active-not-in-scene, active-in-scene,
retired-in-a-flashback-scene, etc.

**Kind-dependent:**

- **character** — boolean in-scene flag
- **item** — boolean in-scene flag
- **location** — degenerate: exactly one location is "the current
  scene location" per branch
- **faction** — not applicable

**Storage — derived runtime from `story_entries.metadata`.** The
classifier tags each AI reply's metadata with scene information;
scene presence is read from the latest entry's metadata on the
current branch. Survives restart, rollback, and branching by
construction. No new schema columns; Zustand hydrates scene state
from the latest entry's metadata on story load.

Denormalize into a bool on `entities` only if query hot-path
pressure shows up — unlikely.

---

## Entity row indicators — three distinct channels

An entity row carries three orthogonal signals that don't compete
for one slot — each has a dedicated channel so any combination
renders correctly, and every row has identical structure (no
value-dependent absence that makes "nothing shown" ambiguous):

- **Lead badge** (gold pill, text mode-dependent): inline
  immediately after the name. Only present for the story's lead
  character. Label is `You` in adventure mode, `Protagonist` in
  creative mode.
- **Scene presence** (row-level accent): an in-scene row gets a
  left-edge 3px green accent stripe plus a faint green background
  tint. NOT a right-side indicator — scene presence is about
  "which rows matter right now" which fits row-level chrome.
- **Status pill** (always shown, muted when active): on the far
  right. Every row carries one of `active` / `staged` / `retired`.
  Active renders with muted styling (faint gray); staged = soft
  green; retired = soft amber.

Applies to the reader's Browse rail AND the World panel's list
pane. CSS class convention: `.lead-badge`.

---

## Entity kind indicators — icons, not text

Entity kind renders as a **square glyph icon** (22×22 box), not
text. Saves horizontal room in narrow rails; still categorical at
a glance.

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

1. **Layer 0 (lead pin, chars only):** when the current category
   is `characters`, the lead (if set) is pinned to the very top.
   Absolute override of all subsequent layers. Applies only to
   characters — other kinds have no lead concept.
2. **Layer 1 (status tier):** Active → Staged → Retired
   _(current → future → past, by narrative relevance)_
3. **Layer 2 (within Active only):** in-scene first, then
   not-in-scene
4. **Layer 3 (within each tier):** alphabetical by name

Applies to Browse rail and World panel list pane. Filter chips
narrow the set but sort still applies within the filtered subset.
The lead stays pinned unless the filter excludes them entirely.

---

## Browse filter chips

Mutually exclusive (single-select):
`All` / `In scene` / `Active` / `Staged` / `Retired`.

- `All` is the default and shows the full list with accordion
  grouping (see below).
- `In scene` is orthogonal to status.
- `Active` / `Staged` / `Retired` filter to one status tier.

Combining filters (e.g. "in-scene AND staged") is not supported
in v1; single-select keeps the UI simple.

### Accordion grouping on "All" view

When `All` is active, rows group under status-tier accordion
headers (`Active` / `Staged` / `Retired`) with click-to-collapse.
Each header shows name + count + chevron.

**Default expansion:**

- `Active` — expanded (the working set)
- `Staged` — collapsed (reference)
- `Retired` — collapsed (reference)

Session-scoped (not persisted). When a non-All filter is active,
the list renders flat (single implicit group, no accordion chrome).

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

Peek drawer's footer link "Open in World panel →" routes to the
panel.

---

## Entity form UI is generated from the typed schema

`entities.state` is a typed discriminated union (CharacterState /
LocationState / ItemState / FactionState) — not a dynamic bag.
This has a direct UI consequence:

- **No generic key/value editor.** Form fields are generated from
  the Zod schema (already in the stack). One schema drives form
  controls, validation, types — all from the same source.
- **No "+ add field" UI.** You can't add fields to a typed shape.
- **Fields distribute deterministically by shape:**
  - **Scalar / enum / primitive fields** → **Overview tab** as
    typed controls (dropdown, text, chips, etc.).
  - **Entity-to-entity ID fields** → **Relationships tab** as
    picker-backed inputs. Grouped by semantic label (Positional /
    Possession / Affiliation for character; different groups for
    other kinds).
- **Overview composition is per-kind.** Character / Location /
  Item / Faction each define their own Overview section driven
  by their typed state. Some shared fields (description, tags,
  retired_reason, portrait) anchor the pattern.
- **`retired_reason` is conditional** — disabled when
  `status !== 'retired'`, enabled when it is.
- **Raw JSON view** remains as a small power-user/debug
  affordance (overflow menu next to entity name), for export and
  troubleshooting.

---

## Entity editing — explicit save, session-based

World panel uses an **explicit Save model**, not autosave-on-blur.
Rationale: autosave would (a) let a single careless keystroke write
a destructive change without friction, and (b) produce delta noise
(one `action_id` per field) that makes CTRL-Z too granular.

Session semantics:

- **Session starts** on the first field edit (form becomes dirty).
- **Form-local state** is held by react-hook-form (already in
  stack); nothing writes to the Zustand store or SQLite until Save.
- **Tab switching is within session** — editing across Overview +
  Relationships is one session.
- **Save commits** all session changes as deltas under a single
  shared `action_id`. CTRL-Z reverses the entire session as one
  step.
- **Discard** throws the session away without any writes.
- **Navigate-away guard** — clicking another list row, switching
  branch, navigating out of the panel, closing the window — all
  trigger a confirmation modal while dirty: "Unsaved changes:
  Save / Discard / Cancel navigation."

UI surface:

- **Save bar** appears as a footer on the detail pane ONLY when
  the session is dirty. Shows unsaved-change count + summary of
  which fields are dirty. Action buttons: Discard + Save
  (keyboard shortcut: `Cmd/Ctrl-S`).
- **Clean state** has no save bar — no chrome when reading.
- **Peek drawer** (reader) keeps its direct-manipulation pencil
  edits for single-field quick tweaks; these commit immediately
  as one-field sessions. Deep edits route to World panel where
  the explicit-save pattern applies.

---

## World panel — detail head structure

Status selector is NOT chrome on the detail head; it's a typed
form field inside the Overview tab. The detail head carries only:

- A small breadcrumb strip: kind-icon + kind-name
- The entity name (inline-editable with pencil)
- An overflow menu (⋯) anchored to the name row

The overflow menu holds rare-but-important actions:

- **Set as lead** (sets `stories.settings.leadEntityId`)
- **Export entity as JSON** (single-entity export)
- **View raw JSON** (debug/dev affordance)
- **Delete entity** (destructive; needs confirmation pass)

Raw JSON lives here (not as a prominent link) because it's power-
user/debug territory. One consistent pattern: ⋯ menus are where
"extra / rare" item-scoped actions live on any per-item surface.

---

## World panel — History tab

History is the delta log filtered to this entity: every change
(`op=create / update / delete`) that touched this entity_id.
Never editable — rollback happens in the reader.

- **Search** — against field names or change descriptions
- **Op filter** — all / create / update / delete
- **Sort** — newest-first (default) or oldest-first
- **Load-older chunking** — no page numbers, log-shaped data

Involvements table gets the same load-older pattern eventually;
list pane is fine unpaginated for normal stories (filter chips +
search handle it).

---

## Bulk operations — deferred

Bulk ops (multi-select, batch status change, batch tag, batch
retire, batch export) are deferred pending their own design pass.
Open sub-questions:

- How do batch ops group under `action_id` for single-press undo?
- Confirmation patterns — when, how loud, what counts shown?
- Cross-kind selection — does "retire all" make sense across
  mixed kinds?
- Selection persistence across tab switches, filter changes,
  navigation?
- Visual design of the selection bar — persistent vs contextual?

World panel does NOT include checkboxes or a bulk action bar
currently.

---

## Injection / retrieval rules for prompt context

Every world-state row that might appear in the prompt carries an
`injection_mode` field. **Three modes, unified across types:**

| Mode          | Meaning                                                 |
| ------------- | ------------------------------------------------------- |
| `always`      | Unconditional injection (the explicit override)         |
| `keyword_llm` | Keyword match + LLM relevance check (the smart default) |
| `disabled`    | Exists in data, never reaches the prompt                |

**Default: `keyword_llm`.**

**Applies to:**

- **Lore** — existing `lore.injection_mode` enum updates from
  `always | keyword | manual` → `always | keyword_llm | disabled`.
- **Entities** — new column `entities.injection_mode`, default
  `keyword_llm`.
- **Threads** — new column `threads.injection_mode`, default
  `keyword_llm`.
- **Happenings** — **not this field.** The `happening_awareness`
  graph IS the structural injection rule; a `injection_mode`
  column would fight it.

### Structural invariant (orthogonal to user-set mode)

> **Active + in-scene entities are always injected,** regardless
> of `injection_mode`. If the lead is standing in the scene, they're
> in the prompt — even if mode is `disabled`. This mirrors the
> `happenings.common_knowledge = 1` invariant: some things are
> load-bearing for coherence and can't be turned off.

The mode only governs off-scene / inactive rows. In-scene-active
bypasses it.

**UI:**

- World panel · Overview: `injection_mode` dropdown field (new for
  entities; existing for lore).
- Plot panel · Overview: `injection_mode` dropdown for threads
  (new). Not exposed for happenings.

Retrieval mechanics (how `keyword_llm` actually works, token
budgets, priority ceilings) are architecture territory — this
section documents only the surface.

---

## Error surface — system entries, not chrome indicators

Pipeline errors do **not** live in the top-bar status pill. They
render as **system-kind entries in the main chat** — orange/warn-
tinted bubbles with the failure description and action buttons
(Retry / View details / Dismiss). Rationale: errors need to be
visible, actionable, and part of the narrative log as context, not
a silent chrome blip.

---

## Per-entry actions — icons, permanent, cross-platform

Actions on an individual entry (edit, regenerate, branch, delete)
render as **icon buttons** (not text labels), **always visible**
(not hover-to-reveal), with a muted default opacity that brightens
on hover/focus. Same affordance on desktop and mobile.

Icon set (placeholder glyphs; finalize with visual identity):

| Action | Glyph | Meaning                                |
| ------ | ----- | -------------------------------------- |
| edit   | ✎     | Edit entry content                     |
| regen  | ↻     | Regenerate this AI reply               |
| branch | ⎇     | Branch from this entry                 |
| delete | ×     | Delete this entry (rollback semantics) |

Per-entry action sets:

- **User entry:** edit, delete
- **AI entry:** edit, regen, branch, delete
- **System entry:** content-level buttons (Retry / Details / Dismiss)
- **Streaming entry:** no per-entry actions; cancel happens via
  the composer's Send→Cancel transform

---

## Reasoning expansion + token metadata on AI entries

Meta line is intentionally minimal. No model name — users don't
care per-entry. Format:

`AI reply  [🧠]  <reply-tok> / <reasoning-tok>`

- **Brain icon** (🧠 placeholder). Clickable — toggles an italic,
  muted, left-bordered reasoning body expansion **above** the
  content (chronological order: think, then speak). Absent when
  the provider doesn't expose reasoning tokens.
- **Unified token display** as `<reply> / <reasoning>` in muted
  monospace. Tooltip explains the slash.
- **Pulses** while the model is streaming reasoning (same animation
  as the gen-status pill dot). Static + clickable when done.
- **Collapsed by default**, including during the reasoning phase —
  click the pulsing brain to expand and watch reasoning stream.

---

## Composer mode — send-time transform, narration-aware

Composer mode is a **send-time text wrapping** driven by pack
templates — prepend and append around the user's typed text.

**Wrapping POV is its own setting**, distinct from narration.
Narration governs AI prose; wrap POV governs how the user's lazy-
mode input is rendered. Field:
`stories.settings.composerWrapPov: 'first' | 'third'`. Default
`first` (most natural for adventure-style play where the user
types as the character). Second-person isn't offered — "you reach
for the blade" makes no sense as user-composed input (the user
isn't the narrator addressing themselves).

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
user's wrap POV are independent; mixed voices ("You step inside
the tavern… Aria reaches for her blade.") are narratively coherent
when the narrator and the actor have different perspectives. Users
who want voice-matched entries can pick a wrap POV that aligns or
use `Free` mode and write it themselves.

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

The wrapped text IS the saved `story_entries.content`. Mode is
**not stored** on the entry — the final wrapped content is
canonical.

- Reader rendering of user entries shows just the final text; no
  mode chip, no meta.
- Editing an entry edits the final wrapped text directly.
- Rewrapping with a different mode post-send is not a v1 feature.

---

## Next-turn suggestions

After an AI reply completes, a **suggestions panel** appears
between the entries and the composer, offering 3-4 possible next
turns. **UI shape is unified** across modes; **category sets are
mode-specific** because adventure and creative frame the user
differently.

**Categories per story mode:**

| Mode      | Categories                                  |
| --------- | ------------------------------------------- |
| Adventure | `Action`, `Dialogue`, `Examine`, `Move`     |
| Creative  | `Action`, `Dialogue`, `Revelation`, `Twist` |

**Colors** (wireframe placeholders):

| Category     | Color  |
| ------------ | ------ |
| `Action`     | Blue   |
| `Dialogue`   | Green  |
| `Examine`    | Purple |
| `Move`       | Amber  |
| `Revelation` | Orange |
| `Twist`      | Red    |

**Suggestions are complete prose.** Click → composer text fills
with the suggestion, composer mode is set to **`Free`** (suggestion
is already finished prose; no further wrapping needed). User can
edit text and/or override mode before sending.

**NOT coupled to composer mode categories.** Composer mode =
prefix/suffix wrapping intent. Suggestion category = narrative-
beat type. Different axes.

**Mix is classifier-driven**, not strict one-of-each.

**States:**

- `visible` — normal
- `loading` — suggestion LLM is regenerating (rows dim, regen icon
  pulses)
- `error` — generation failed (inline error with Retry)
- `collapsed` — user hid the list via chevron; chrome remains
- `hidden` — user disabled suggestions in Story Settings
  (`stories.settings.suggestionsEnabled = false`); panel never
  appears

---

## Chapter navigation in the reader

The reader top-bar breadcrumb is lean:

`<story-title ✎>  ·  <chapter-chip ▾>  ·  <time chip>`

**Progress strip** — thin 3px full-width bar along the bottom edge
of the top-bar. Fill width = current chapter's tokens / threshold.
Tooltip on hover shows exact numbers. Click opens chapter popover.

**Color thresholds** (apply to both the top-strip AND the popover
progress bar):

- **< 80%**: green (safe)
- **80–90%**: yellow (approaching — heads-up for manual-mode users)
- **≥ 90%**: red / warn (at limit — close imminent)

Why coloring matters: auto-chapter-close is a story setting; some
users wrap chapters manually. For them, the color is the primary
signal to close.

**Chapter popover contents:**

- **Chapter list** — closed chapters + the current one (labeled
  `in progress`, highlighted). Closed chapters click to jump.
- **Progress bar + label** — `chapter progress · 8,420 / 24,000 tok`
- **Close chapter manually** — primary action; triggers chapter-
  close sub-pipeline.
- **Manage chapters →** — link to the dedicated Chapter Timeline
  screen (inventory #9) for deeper chapter management.

Chapter closing is reachable from both the popover AND the Actions
menu.

---

## In-world time display

In-world time is classifier-stamped on each entry's metadata.

**Surfaces:**

- **Top-bar time chip** — small clock icon + label, after the
  chapter chip. Always visible. Rendered as **opaque text** from
  metadata — no parsing, no segmentation. `max-width: 260px` with
  ellipsis on overflow; full label in tooltip.
- **Chapter break (inline)** — each closed chapter's break in the
  entries list shows time at close.
- **Chapter popover rows** — each row shows a time range.

**Format-agnostic rendering** is the principle. The classifier may
stamp "Day 3, dusk" for an Earth-calendar story, or "Year of the
Phoenix, New Moon" / "Tolfday 12th of Harvest" for fantasy. UI
renders whatever string is present.

---

## Streaming entry — same structure, live state

The streaming AI entry uses the same structure as a completed AI
entry.

- **Reasoning phase:** brain icon pulses, token display
  `— / N →` (dash for reply-not-started, N = reasoning tokens so
  far). Reasoning body stays **collapsed by default**; pulsing
  brain is the signal. Content placeholder "reply hasn't started
  yet".
- **Reply phase:** brain icon static (reasoning complete), token
  display `M / N →` (M = reply streamed, N = final reasoning),
  content streams token-by-token.
- **Complete:** entry commits; trailing `→` disappears, brain
  clickable for reasoning expansion.

Non-reasoning providers: no brain, token display collapses to just
reply tokens.
