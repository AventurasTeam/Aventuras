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
  get Overview/Identity/Carrying/Connections/Settings/Assets/Involvements/History;
  Carrying is character-only, Settings applies to every kind; lore
  gets a simpler composition keyed on its schema).
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

## Top-bar design rule

Three tiers of chrome, plus a screen-class scope rule for the
Settings icon. The top bar must never grow unbounded; every element
earns its slot via one of the tiers below.

### Universal essentials

Render on every screen with chrome (in-story and app-level alike):

- **Left slot** — Logo on the root surface (story list);
  ← Return ([stack-aware](#stack-aware-return)) on every other
  surface. The two are mutually exclusive: the root has no
  back-target, non-root surfaces don't need the app logo for
  identity (story title / breadcrumb carries it). Both occupy
  the leftmost slot of the top bar; same rule across desktop,
  tablet, phone.
- Breadcrumb (screen-level path; see
  [Master-detail sub-header](#master-detail-sub-header) for the
  in-pane navigation case)
- Actions entry point (icon button, opens the Actions menu — see
  below)
- Settings icon (scope-determined — see
  [Settings icon scope](#settings-icon-scope))

Onboarding (first-launch, transient, empty stack) is a special
case — chromeless per
[`screens/onboarding/onboarding.md`](./screens/onboarding/onboarding.md);
no logo, no Return. The empty-stack-confirm clause of stack-aware
Return still fires if the user attempts back via hardware / gesture.
Wizard carries its own minimal chrome (`[← Cancel]` on left, step
indicator centered, no logo) and already conforms to the left-slot
rule.

### Universal in-story chrome

Render on every in-story screen — reader, World, Plot, Story
Settings, Chapter Timeline:

- Generation status pill (hides when idle, shows during active
  pipeline phases: `reasoning…` / `generating narrative…` /
  `classifying…` / `closing chapter…`). Driven by pipeline event
  stream (per [`architecture.md`](../architecture.md)). Pipeline
  state is global to the active story; users navigating between
  in-story sub-screens during generation deserve the same affordance
  and click-to-cancel popover the reader has.
- Chapter token-progress strip. Small visual cost; tells users how
  close they are to chapter close regardless of which sub-screen
  they're on. No textual label, doesn't collide with the breadcrumb.
  Useful for awareness; ignorable when irrelevant.

### Reader-only chrome

Render on the reader / composer only:

- Chapter chip ▾ (chapter popover with jump + manage)
- Time chip (in-world date-time display)
- Branch chip (icon + count badge, shown only when > 1 branch
  exists — single-branch stories omit it). Tooltip reveals branch
  name; click opens the
  [Branch navigator](./screens/reader-composer/branch-navigator/branch-navigator.md#navigator--popover-desktop).

These are pulled from sub-screens for two reasons. Chapter and time
are textual indicators that overlap semantically with the breadcrumb
on every sub-screen — the breadcrumb already names where the user
is in the story. Branch navigation is a reader-level concern;
sub-screens don't switch branches as a primary action.

### Settings icon scope

The gear glyph's scope is determined by the screen's class:

- **Regular gear ⚙** opens **App Settings**. Renders only on
  app-level surfaces (story-list, Vault). Absent from in-story
  chrome.
- **A dedicated story-scoped icon** (specific glyph picked at
  visual identity) opens **Story Settings**. Renders only on
  in-story surfaces (reader, World, Plot, Chapter Timeline).
  Absent on Story Settings itself (self-reference).

App Settings remains reachable from in-story screens via the
Actions menu rather than chrome. Visual identity must pick glyphs
that read clearly different at glance — both icons being "geary"
defeats the rule's purpose.

**Scratch glyph vocabulary** for top-bar / chrome (placeholders
pending visual identity; chosen so wireframe ASCII and HTML mocks
read consistently and don't collide with row-action vocabulary in
[`patterns/icon-actions.md`](./patterns/icon-actions.md#glyph-vocabulary)):

| Concern        | Glyph | Notes                                               |
| -------------- | ----- | --------------------------------------------------- |
| App Settings   | `⚙`   | Regular gear; app-level surfaces only.              |
| Story Settings | `⛭`   | Gear without hub (`&#9965;`); in-story surfaces.    |
| Actions menu   | `⚲`   | Neuter symbol (`&#9906;`); chrome overflow / Cmd-K. |
| Return         | `←`   | Stack-aware back; see "Stack-aware Return" below.   |
| Branch         | `⎇`   | Reserved for branch semantics (chip + per-entry).   |
| Overflow row   | `⋯`   | Per-row / per-card overflow menus.                  |

`⎇` (branch) MUST NOT be reused for Actions or any non-branch
surface. The visual similarity at small sizes is real (`⚲` and `⎇`
both read as "circle with a stroke"); reviewers who confuse them
in mocks should treat the doc text as authoritative.

Visual identity (session 5) picked the canonical Lucide names for
this scratch table — see
[`foundations/iconography.md → Top-bar / chrome`](./foundations/iconography.md#top-bar--chrome).
Wireframes continue to render the scratch glyphs above for
visual placeholder consistency per the
[wireframe-authoring rule](../conventions.md#wireframe-authoring);
the iconography table is the implementation reference.

### Master-detail sub-header

**Master-detail surfaces with a kind selector + list pane** (World,
Plot) render an in-pane breadcrumb sub-header below the top bar
(`Characters / Kael`, `Threads / Crown's bargain`). The top-bar
breadcrumb is screen-level (`<story-title> / World`) and stays
stable as the user navigates list rows; the sub-header is reactive
content that updates with the in-pane selection.

**Single-content surfaces and master-detail surfaces with a
category rail** (Story Settings, Chapter Timeline) put the full
breadcrumb inline in the top bar — no sub-header. Their inner
navigation is captured by the rail or the list itself.

Any action beyond what these tiers and rules permit lives in the
Actions menu or the screen-specific chrome.

### Breadcrumb tappability

Both the top-bar breadcrumb and the master-detail sub-header are
**tappable for navigation**. Each parent segment in the path is a
link to that ancestor; tapping clears any subsequent state and
lands on the parent.

- **Top-bar breadcrumb segments.** `Aria's Descent / World` —
  tapping `Aria's Descent` returns to the reader (story root);
  tapping `World` is a no-op when already on World, otherwise
  navigates to the World list state.
- **Sub-header segments** (master-detail surfaces). `Characters /
Kael Vex` — tapping `Characters` clears the row selection
  (returns to "no character selected"; on phone, equivalent to
  popping the detail full-screen route per
  [the collapse rule](./foundations/mobile/collapse.md#world--kind-selector--list--detail-master-detail)).
- **Current segment is inert.** No-op on tap. Visual treatment
  emphasizes the segment (bold, full-color) as the "you are here"
  marker. If the current segment's text is truncated, tap reveals
  the full text in a transient popover per the
  [tap-to-tooltip rule on inert chrome text](./foundations/mobile/touch.md#tap-to-tooltip-on-inert-chrome-text).

The rule applies on every tier (desktop, tablet, phone). Same
expectation across platforms; standard UX convention. Tapping a
parent breadcrumb segment is a chrome-resident shortcut to the
back-arrow-plus-filter-selection equivalent path.

Stack-aware Return interaction: tapping a breadcrumb segment is
equivalent to popping the navigation stack repeatedly until that
segment is the current location. The stack updates coherently; no
orphan-state issues.

---

## Stack-aware Return

Header back-button (←) and system-level back actions (mobile
hardware back button, swipe-back gesture, etc.) are **stack-aware**:
they pop the in-session navigation stack rather than always routing
to a fixed parent.

- **Stack scope**: in-session only, reset on app restart. No
  cross-launch persistence.
- **Pop semantics**: Return = pop one level. The previous screen
  is whatever the user came from, even if that's a sibling rather
  than a hierarchical parent.
- **One-shot return targets**: certain entry paths register an
  override consumed by the next Return. `Edit info` on a story-list
  card boots the target story and routes to its Story Settings;
  the first Return goes back to story-list. If the user navigates
  beyond Story Settings (e.g., forward into the reader), the
  one-shot is consumed and subsequent Returns follow the default
  stack pop.
- **Empty stack (root state)**: a Return action with no previous
  page — fresh session before any navigation, or a deep-link entry
  that bypassed normal flow — is interpreted as "exit the app" and
  surfaces a confirm dialog before terminating. This matters most
  on mobile, where the system back button / swipe-back gesture is
  the primary exit pathway and unconfirmed exits drop user state
  silently. Desktop's window-close affordance is a separate exit
  pathway and follows OS-native patterns; this rule covers in-app
  back actions.

---

## Edit restrictions during in-flight generation

A generation pipeline owns the live store from begin-transaction to
commit (or abort). User-origin writes to story state and
pipeline-relevant settings are blocked while a transaction is in
flight. Cancel reverts the transaction and is always available.

The constraint isn't UX — it's a coherence requirement between two
writers (user, pipeline) racing on the same Zustand store.
Implementation contract is in
[`architecture.md → Generation transactions and edit gating`](../architecture.md#generation-transactions-and-edit-gating).

### Two pipelines covered

- **Per-turn pipeline** — Pre → Retrieval → Narrative →
  `[Classification ‖ Translation]` → Post. Triggered by user send /
  regenerate. User is actively waiting; the existing reader-chrome
  status pill plus the streaming narrative are sufficient
  affordance.
- **Chapter-close pipeline** — Boundary → Chapter metadata → Lore
  management → Memory compaction. Triggered by token-threshold
  cross at turn-commit time, or by explicit user close. Decided
  as a **blocking pipeline**: the user is gated for its full
  duration with a banner affordance (no streaming surface to
  anchor attention).

Both transactions are atomic per their `action_id` (see
[`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback))
— a single CTRL-Z reverses an entire turn or chapter-close, and
the orchestrator uses the same reverse-replay machinery to abort
mid-flight.

### What's gated

User-origin mutations to: story entries, entities (fields, status,
state, `injection_mode`), happenings, awareness links, lore,
threads, branch operations (rollback, switch, branch creation),
translations, story settings, app settings that feed
`promptContext`, calendar swap, lead switch, mode switch, narration
switch, manual `worldTime` correction, backup / export when
reachable from inside the story.

### What's not gated

- **Read-only browsing** — peek drawer, panel navigation, chapter
  timeline reads, branch navigator reads, the streaming narrative
  itself. Reads of the live store during pipeline writes are
  accepted; the user sees state in motion as the pipeline
  progresses.
- **Cancel** — always available, reverts the transaction via
  reverse-replay of the `action_id`'s deltas. Universal escape
  hatch.
- **In-story navigation** — moving between reader, World, Plot,
  Story Settings, Chapter Timeline, Branch Navigator inside the
  active story. The transaction continues; affordances follow the
  user.

### Affordance loci

**Status pill (chrome — universal).** The pill specified in
[Top-bar design rule](#top-bar-design-rule)
gains click-to-cancel: clicking the active pill opens a small
popover with `Cancel generation` (or `Cancel chapter close`) as
its single action; one click triggers abort. Pill dimensions stay
stable (no inline X chevron) so layout doesn't flicker on
transaction start / end.

**Banner (below chrome — chapter-close only).** A sticky banner
appears below the top bar for the duration of a chapter-close
transaction; dismissed on commit / abort:

```
Closing chapter: 2 of 4 — generating chapter metadata… [Cancel]
```

Per-turn pipelines do not use the banner — the streaming narrative
is the ambient progress indicator and the composer's send/cancel
button is the eye-line action surface. Adding a banner per turn
would shift layout every reply.

**Disabled controls + tooltips (across all screens).** Every
editable control disables when a transaction is in flight,
including form save buttons (so the user doesn't draft an edit
they can't submit). Hover/focus reveals a uniform tooltip:

| Pipeline      | Tooltip copy                                 |
| ------------- | -------------------------------------------- |
| Per-turn      | `Generation is in flight. Cancel to edit.`   |
| Chapter-close | `Chapter close in progress. Cancel to edit.` |

Tooltip copy is principle-owned. Per-screen docs cite, don't
reinvent.

**Story-leave abort-confirm modal.** Navigation that takes the
user **out of the active story** (story list, app settings, vault,
another story) while a transaction is in flight prompts a
confirmation:

```
Generation in flight

Leaving will cancel the in-flight generation and revert any
changes.

                              [Stay]    [Cancel & leave]
```

`Stay` dismisses the modal; user remains, transaction continues.
`Cancel & leave` triggers abort + revert, then proceeds with
navigation. Pack edits (vault is out-of-story) and global-settings
access naturally route through this modal — no per-feature gate
needed.

### Background agents

Future background agents (style-review and any agent that splits
out of chapter-close) declare their gate behavior at their own
design pass. Declaration interface lives with the implementation
contract in
[`architecture.md → Generation transactions and edit gating`](../architecture.md#generation-transactions-and-edit-gating);
this principle defers all per-agent choices to those passes.

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
  keys, default models per feature, **Story Defaults**
  (memory knobs, translation config, composer UX prefs, suggestions
  toggle — values copied into new stories on creation; see scope
  policy below), appearance, data (backup / import / export), UI
  language, about / diagnostics.
- **Story Settings** — per-story, owned by the story row. Scope:
  identity (tags, cover, accent, etc.), definitional fields
  (mode, lead, narration, genre, tone, setting, calendar),
  operational knobs (memory, translation, pack, composer UX prefs as
  story-owned values), Models overrides.

**Entry points:**

- **App Settings**: reached from the gear icon ⚙ in app-level
  chrome (story list; future Vault parent shell). On in-story
  screens it's reachable via the Actions menu — set-and-forget
  territory, the two-click route is acceptable.
- **Story Settings**: reached from the dedicated story-scoped
  Settings icon in the chrome of every in-story screen except
  Story Settings itself. Alternative entry from outside an active
  story: the `⋯ → Edit info` overflow on a story-list card boots
  the target story and routes directly to Story Settings; the
  first Return is [stack-aware](#stack-aware-return) and goes
  back to story-list.

Per the [Settings icon scope](#settings-icon-scope) rule the two
icons are visually distinguishable — same screen never carries
both gears.

**Storage shape mirrors the UI section split.** `stories.definition`
JSON holds definitional content (`mode`, `lead`, `narration`,
`genre`, `tone`, `setting`, calendar fields); `stories.settings` JSON
holds operational config (memory, translation, models, pack,
composer prefs). The Story Settings screen's left-rail "Story" /
"Settings" sections map 1:1 to these two storage blobs. Full schema
and rationale in
[`data-model.md → Story settings shape`](../data-model.md#story-settings-shape).

**Settings scope policy — two patterns:**

1. **Copy-at-creation** — App Settings · Story Defaults holds
   the defaults for new stories. On creation, those values are
   copied into the new story's `settings`. After creation, the story
   owns its values; changing the App Settings default does NOT
   propagate to existing stories.
2. **Override-at-render** — `settings.models` only. Story values are
   optional; absent fields resolve to the current global pick at
   render time. Changing the global propagates to every un-overridden
   story.

Definitional fields (everything in `stories.definition`) and identity
fields (tags, cover, accent, etc.) follow neither pattern — they're
authored in the wizard or per-story, with no global default.

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
[followups.md → Image generation](../parked.md#image-generation).

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

Field: `stories.definition.narration: 'first' | 'second' | 'third'`.

A first- or second-person story always has a lead (whose "I" / "you"
the narrator inhabits) — enforced as a hard zod constraint at the
`definition` boundary, not just a documented principle. A
third-person story can have a lead too (the camera's anchor) — or
none (creative mode with omniscient narration).

Encoding:

- `stories.definition.mode = 'adventure' | 'creative'`
- `stories.definition.leadEntityId` — must reference an entity with
  `kind='character'`. Required when:
  - `mode='adventure'`, OR
  - `narration ∈ { 'first', 'second' }`.

  The two requirements are independent; either alone is sufficient
  to require a lead. Optional only in `mode='creative' +
narration='third'` (the omniscient-narrator ensemble case).

- `stories.definition.narration = 'first' | 'second' | 'third'`

Cross-field constraint summary:

```
narration ∈ { 'first', 'second' }  →  leadEntityId != null
mode = 'adventure'                 →  leadEntityId != null
```

Both apply at the
[`StoryDefinition` zod boundary](../data-model.md#story-settings-shape).

**Lead is a generation-level concept, not a UI gate.** The UI never
restricts what the user can see regardless of mode. The "view through
character's eyes" filter is a separate, opt-in UI concept that can
target any character, not just the lead.

**Lead switching is a first-class feature.** Changing `leadEntityId`
is allowed at any point in the narrative. Previous leads revert to
plain characters. Entry points:

- **World Panel · detail-head ⋯ menu** — `Set as lead` listed
  alongside Export / Delete / View raw JSON on any character
  entity's detail head, rendered tab-agnostically. See
  [world.md → Detail head structure](./screens/world/world.md#detail-head-structure).
- **Reader peek drawer** — character peek-head shows a `Set as lead`
  inline text-action when not lead, or a `You` / `Protagonist` badge
  when current. Quick switch without navigating out. See
  [reader-composer → Peek drawer lead affordance](./screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters).
- **Actions menu** — "Set lead character → pick" searchable command.
- **Story Settings · Generation** — the `lead character` form field
  on the Generation tab is the form-shaped surface; assigning lead
  via field is shaped differently from the per-character
  `Set as lead` action above but it's the same mutation. See
  [story-settings.md → Generation tab](./screens/story-settings/story-settings.md#generation-tab--definitional-fields--authoring-aids).

All four are redundant entry points for the same mutation. Lead is
important enough that over-reachability beats one-true-place purity.

---

## Story-shaping content — genre, tone, setting

Sibling concept to "Mode, lead, and narration." Where mode/lead/
narration are orthogonal **axes** (each independently chosen), genre /
tone / setting are substantial **prose content** the user authors at
wizard time, injected into prompts to shape what the AI writes.

All three live in
[`stories.definition`](../data-model.md#story-settings-shape) and are
wizard-authored per story (no global default, no copy-at-creation).

### Two shapes

- **`genre` and `tone`** — preset+prose hybrid:
  `{ label: string; promptBody: string }`. Bundled preset catalog in
  code (~20-30 entries each for v1) gives the user an on-ramp; the
  user can edit either field freely. Selection copies the preset's
  `displayName` into `label` and the preset's `promptBody` into
  `promptBody` — fire-and-forget, no preset id stored. App updates
  to bundled presets don't propagate to existing stories.
- **`setting`** — freeform prose only (no preset). Settings are
  genuinely unique per story; preset clustering doesn't fit. A
  future Vault content type for reusable setting templates is
  parked in
  [`followups.md → Vault setting templates`](../parked.md#vault-setting-templates).

### No-modal-on-edit rule

Edits to genre / tone / setting prose — including post-wizard
substantial rewrites — do **not** trigger the
[Definitional-change confirmation modal](./screens/story-settings/story-settings.md#definitional-change-confirmations).
Unlike `mode` / `narration` / `composerWrapPov` (which reframe the
user's relationship to the story or invalidate established
patterns), prose content shifts AI output from the next turn forward
without coherence breaks. A soft warn-box at the top of the
Generation tab ("edits propagate from the next turn") is sufficient
guidance.

### Single canonical edit surface

Both `label` and `promptBody` for genre / tone are edited together
on the
[Story Settings · Generation tab](./screens/story-settings/story-settings.md#generation-tab--definitional-fields--authoring-aids).
The library card's "Genre:" overline reads `definition.genre.label`
directly — there's no echo of the field on the About tab. One
canonical edit surface per field; the library card is its own
surface where the result shows up.

### Definitional content is story-level, not branch-level

`stories.definition` lives at the story row, not per-branch. All
branches of a story share the same genre / tone / setting / mode /
narration. Editing definition propagates to all branches. A user
wanting tonal experimentation across narrative paths uses a separate
story, not a branch. Per-branch override is parked in
[`followups.md → Per-branch definition override`](../parked.md#per-branch-definition-override).

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
only governs off-scene/inactive rows. Whether (and how) the UI
surfaces this — e.g., a "structurally pinned" indicator on
active+in-scene rows so users know the mode is moot for them — is
parked in
[`followups.md → Structurally-pinned indicator`](../parked.md#structurally-pinned-indicator).

Mechanics (how `keyword_llm` retrieval works, token budgets, the
in-scene-bypass) live in
[`architecture.md → Retrieval / injection phase`](../architecture.md).

---

## Bulk operations — deferred

World panel does NOT include checkboxes or a bulk action bar in v1.
Same applies to other list surfaces (story list cards, plot rows).
Bulk ops (multi-select, batch status change, batch tag, batch
retire, batch export) are deferred pending their own design pass —
see
[`followups.md → Bulk operations on entities`](../parked.md#bulk-operations-on-entities)
for the parked sub-questions.

---

## Persistent app-level banners

Some app states warrant a persistent warn bar above the main
content of the **story list** screen — the only app-level surface
that sees them. Two banner shapes are defined today:

- **AI not configured** — fires when `app_settings.providers` is
  empty (user skipped onboarding, or deleted the last provider).
  Copy: `⚠ AI generation not configured. [Set up a provider →]`.
  CTA routes to
  [App Settings · Providers](./screens/app-settings/app-settings.md#generation--providers).
  Never re-opens the onboarding wizard — that path is intentionally
  one-shot (see
  [Onboarding → Skip behavior](./screens/onboarding/onboarding.md#skip-behavior)).
- **Profile errors** — fires when at least one profile has a
  configuration error (e.g., references a model that's no longer
  in the provider's catalog). Copy:
  `⚠ N profiles have configuration errors. [Open settings →]`.

**Mutual exclusion + priority.** Both banners can be true at the
same time — a user who skipped onboarding might also have leftover
profile errors from a prior session. Only one renders, with
**no-providers taking priority** (profile errors are downstream
of having a provider in the first place). When the user fixes the
no-providers state, profile-error renders if still applicable.

**Provider-only misconfiguration** (e.g., a key the user typed
wrong, but no profile references that provider yet) does **not**
trigger any banner. Per-row indicators on the Providers list
surface that lower-stakes case. A misconfigured provider only
escalates to banner status once a profile references it.

**Why no "Resume setup" CTA.** Once the user crosses the wizard's
skip threshold, onboarding is over; the banner sends them to App
Settings, where the affordances are richer and the hand-hold isn't
needed. Re-opening the wizard would duplicate paths and create
state-recovery questions we don't want.
