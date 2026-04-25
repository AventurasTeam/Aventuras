# UI principles

Cross-cutting design decisions — the philosophy and
architecture-shaped rules that apply across multiple surfaces. Each
per-screen doc references these. Adding to this file should happen
when a decision has (or will have) impact on more than one screen
and is conceptual rather than visual-spec.

Component-shaped patterns — entity rows, large-list rendering, the
Select primitive, the raw JSON viewer, import affordances — live in
[`patterns/`](./patterns/README.md). The split keeps this file
focused on the "why" behind the decisions; patterns hold the "how"
of reusable primitives.

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

When a wireframe stabilizes, its final form lives in
`docs/ui/screens/<screen>/`. Iteration scratch lives wherever the
author keeps it (gitignored), not in the repo.

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
  classifier-written and user-audited, not user-authored.

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
[`data-model.md → Story settings shape`](../data-model.md#story-settings-shape).

Per-screen detail in
[`screens/story-settings/`](./screens/story-settings/story-settings.md).

---

## Models are override-only (per-story)

`stories.settings.models` is the override-at-render half of the
[settings scope policy](#settings-architecture--split-by-location).
All fields optional — an absent field resolves to the global App
Settings default at render time; a present field pins this story
against future changes to the global.

Applies to every agent in the assignments registry. The agent set
is the single source of truth (centralized; per
[`data-model.md → App settings storage`](../data-model.md#app-settings-storage));
the override pattern is identical regardless of which agents exist.
Image generation is deferred past v1; see
[followups.md → Image generation](../followups.md#image-generation).

UI surface lives in
[Story Settings · Models tab](./screens/story-settings/story-settings.md#models-tab--overrides-only)
(per-story pickers + dashed-italic `App default` sentinel + override
dropdown). App Settings · Profiles covers the source side.

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
[`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape).
UI consumes `metadata.sceneEntities` (characters + items) and
`metadata.currentLocationId` (singleton location) from the latest
entry on the current branch.

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
