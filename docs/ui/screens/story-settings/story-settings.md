# Story Settings

**Wireframe:** [`story-settings.html`](./story-settings.html) — interactive

Per-story configuration surface. Reached from the ⚙ icon in the
reader's top bar. Two domains under one roof: **Story** (what the
story is — wizard-editable definitional fields) and **Settings** (how
it generates — post-creation tuning knobs).

App Settings reuses the same layout pattern with different
sections/tabs.

Cross-cutting principles that govern this screen are in
[principles.md](../../principles.md). Relevant sections:

- [Settings architecture — split by location](../../principles.md#settings-architecture--split-by-location)
- [Edit restrictions during in-flight generation](../../principles.md#edit-restrictions-during-in-flight-generation)
  (every editable field on this surface disables when a generation
  pipeline is in flight; save buttons too)
- [Mode, lead, and narration](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts)
- [Composer mode — send-time transform](../../principles.md#composer-mode--send-time-transform-narration-aware)
- [Models are override-only (per-story)](../../principles.md#models-are-override-only-per-story)
- [Form controls — Select primitive](../../patterns/forms.md#select-primitive)
  (segment / dropdown / radio render-mode rule applies to every
  picker on this surface)
- [Save-session pattern](../../patterns/save-sessions.md)
  (the same pattern applies here)
- [Naming convention — World / Plot](../../principles.md#naming-convention--world--plot-and-their-panel-descriptor)

## Layout

```
┌────────────────────────────────────────────────────────────┐
│ [logo] Aria's Descent / Story Settings  [status]   [⎇] [←] │ ← top bar
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ ← chapter token-progress strip
├───────────────┬────────────────────────────────────────────┤
│ STORY         │ About                                       │ ← pane header
│ • About       │ What the story is — identity and metadata.  │
│ · Generation  │ ─────                                       │
│               │ title: Aria's Descent                       │
│ SETTINGS      │ description: [textarea]                     │
│ · Models      │ genre: [Dark Fantasy]                       │
│ · Memory      │ tags: [chips] +                             │
│ · Translation │ author notes: [textarea]                    │
│ · Pack        │ ─ Appearance                                │
│ · Calendar    │ cover, accent color                         │
│ · Advanced    │ ─ Library                                   │
│               │ status: [Active|Archived] · ★ pinned        │
│               │                                             │
│               ├────────────────────────────────────────────┤
│               │ save bar (when dirty)                       │
└───────────────┴────────────────────────────────────────────┘
```

Left rail is the canonical **settings pattern**: sections (uppercase
labels) containing tabs (left-rail items). Active tab highlighted
with a left-edge accent. Reused by App Settings in a later wireframe.

## Two sections under one roof — wizard-editable vs post-creation tuning

The left rail splits into two sections reflecting two conceptually
distinct domains:

- **Story** section — wizard-editable fields. What the story IS.
  Tabs: About (identity), Generation (mode/lead/narration/tone +
  authoring aids).
- **Settings** section — post-creation tuning knobs. How it
  generates. Tabs: Models, Memory, Translation, Pack, Advanced.

Rationale for the seam: "wizard-editable" is a cleaner line than
"identity vs settings" because mode/lead/narration land
unambiguously on the wizard side — they're definitional, not tuning.
Collapsing both domains into one screen with a visual sectional
split avoids inflating the top-bar with a second entry point while
keeping the cognitive separation clear.

**No standalone "Edit Story" surface.** Editing story identity
happens on the `About` tab. Title is additionally click-to-edit
inline in the reader top bar for the fast case. The story list's
card `⋯ → Edit info` routes to `About` directly.

**Section split — what's in each tab:**

**Story section** (definitional — set during wizard, editable after):

- **About** — title, description, genre, tags, author notes
  (private), cover, accent color, library status (`active` /
  `archived` — segment per
  [Select primitive rule](../../patterns/forms.md#select-primitive)),
  pin (orthogonal star toggle; matches the inline-pin pattern on
  story-list cards).
- **Generation** — mode (adventure/creative), lead character,
  narration (first/second/third-person), tone/style, plus
  **Authoring aids** sub-section: composer modes toggle + wrap POV
  (first/third) + suggestions toggle. Behavior that shapes what the
  AI writes and how the user composes.

**Settings section** (operational — post-creation knobs):

- **Models** — per-feature override picks (see below)
- **Memory** — chapter threshold (with presets), recent buffer size,
  compaction detail
- **Translation** — master enable, target language, granular
  per-content-type toggles
- **Pack** — active pack + pack-declared variables (see below)
- **Calendar** — active calendar system + read-only summary; full
  spec in
  [`patterns/calendar-picker.md`](../../patterns/calendar-picker.md)
- **Advanced** — story ID, timestamps, branch info, diagnostics
  (export JSON, view raw settings)

## Models tab — overrides only

Story-level overrides are direct **model id** overrides. App-level
profile architecture (App Settings · Profiles) provides the resolution
chain; this tab lets the story bypass the chain for specific features.

### Narrative (always visible)

Top of the tab — narrative is the storyteller, central enough that
its slot is always rendered:

- **App default sentinel** resolves the chain and shows what's
  currently in effect:
  `App default: claude-sonnet-4-7 (Narrative profile)`.
- Picking a model pins that model id for this story regardless of
  changes to App Settings · Profiles · Narrative.
- `×` on the row removes the override; reverts to the App default
  sentinel.

### Agent overrides (empty by default)

`+ Add override` button. Click opens a picker showing all agents with
their currently-resolved chain:

- `classifier` — Fast tasks → gpt-4o-mini
- `translation` — Fast tasks → gpt-4o-mini
- `suggestion` — Fast tasks → gpt-4o-mini
- `lore-mgmt` — Heavy reasoning → claude-opus-4-7
- `memory-compaction` — Heavy reasoning → claude-opus-4-7
- `retrieval` — Fast tasks → gpt-4o-mini (when designed)

(Image generation is deferred — see
[followups.md](../../../followups.md#image-generation).)

User picks an agent; the override row materializes with a model
picker. `×` on the row removes the override; agent reverts to App
default.

Most stories override 0-1 agents — empty default keeps noise
proportional to actual overrides.

### Insulation from profile changes

Story-level overrides are model ids, not profile ids — they bypass
the profile chain entirely:

- Profile renamed / model changed / temperature changed → stories
  with override unaffected.
- Profile deleted → blocked at App Settings while agents are
  assigned; story-level overrides survive (they don't reference the
  profile id).
- Model removed from provider catalog → triggers the global
  broken-config banner (rendered at the top of every screen — see
  [App Settings](../app-settings/app-settings.md) for the surface
  that lets the user fix it). Story override stays valid only as
  long as the model id resolves.

### What story override **doesn't** include in v1

- Per-story full-profile override (creating a story-specific
  profile, etc.).
- Per-story custom JSON payload override.
- Per-story image-gen advanced parameters (size, style, quality —
  only the model id can be overridden).

Tracked as granular per-story controls in
[followups.md](../../../followups.md) — extension when demand
emerges.

### Data model

```ts
stories.settings.models: {
  narrative?: string;
  classifier?: string;
  translation?: string;
  suggestion?: string;
  loreMgmt?: string;
  memoryCompaction?: string;
  retrieval?: string;
}
```

(Image generation deferred — `imageGen` field added when the
feature lands.)

All fields optional; absent = resolve through the App Settings
profile chain at render time. See
[principles.md → Models are override-only](../../principles.md#models-are-override-only-per-story)
for the cross-cutting pattern.

## Generation tab — definitional fields + authoring aids

Houses the three orthogonal concepts (mode / lead / narration — see
[principles](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts)),
the tone/style note, and an **Authoring aids** sub-section toggling
composer modes / wrap POV / suggestions per-story.

**Some Generation fields trigger a confirmation modal at save**
once narrative exists. Mode and narration can't meaningfully change
mid-story without risking coherence breaks; composer wrap POV
(Authoring aids) shifts how new user input renders. The tab
surfaces a soft warn-box at the top once any entry has been
written; the actual confirmation lives at the save-session commit
step, not at field-edit time. See
[Definitional-change confirmations](#definitional-change-confirmations)
below for the flagged-field list, copy, and modal shape.

Lead is **not** flagged — lead-switching is a first-class action
per
[principles → Mode, lead, narration](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts).

## Memory tab — chapter threshold + recent buffer + compaction

**Chapter threshold** gets quick-pick preset buttons alongside the
numeric input: `Short (8k)`, `Balanced (24k)`, `Long (48k)`,
`Custom…`. Gentle guidance on typical choices without hiding the raw
number.

### Auto-close chapters

Per-story field: `stories.settings.chapterAutoClose: boolean`.
Default `true`. When off, the threshold becomes pure guidance — the
user wraps chapters manually and the reader's chapter progress strip
color (yellow at 80%, red at 90%) is the primary signal. The toggle
mirrors into App Settings · Memory as the same control bound to
`app_settings.default_story_settings.chapterAutoClose`, since Memory
is the form component reused across both surfaces.

### Prompt context — recent buffer

Only the most-recent N entries go **verbatim** into the prompt.
Earlier entries reach the prompt through the **retrieval agent** that
queries the delta log and relevant world state for the current
context, not direct insertion.

Per-story setting: `stories.settings.recentBuffer: number` (entries).
Default 10. Lives under a "Prompt context" sub-section on this tab.
Architecture covers the retrieval agent's mechanics in
[`architecture.md → Retrieval / injection phase`](../../../architecture.md).

This interacts with chapter closure: closed chapters' content is the
primary fodder for retrieval. Active / open-region entries are always
in the buffer (or reachable from it).

### Compaction detail

Single-line directive that tells the memory-compaction agent (running
at chapter close) what to focus on when condensing the just-closed
range. Free-form text. Default: empty (agent uses its built-in
defaults).

## Translation tab — display-only, opt-in, single target

**Architectural invariant: translations are display-only.** They
render alongside the source in the UI; they never feed back into
prompts or LLM context. The source content is canonical. This
isolates cost (translation runs only when enabled) from prompt
integrity (generation uses source always). See
[`architecture.md → Translation as a pipeline concern`](../../../architecture.md)
for the full invariant.

### Master enable + target

- Master `enable translation` toggle, off by default. Feature is
  niche enough not to justify being on for everyone.
- When enabled, one target language at a time per story. Multi-target
  was considered and rejected — cost + ambiguity outweigh benefit.
  Multiple-language conversion of an existing story is handled by
  the Translation Wizard (a separate flow that batches conversions —
  see [followups.md](../../../followups.md)).
- When disabled, target + granular toggles grey out; no translation
  writes happen.

### Granular per-content-type toggles

Not everything needs to render in the target language. Authors can
pick:

- Narrative content (the AI's reply text)
- User action text
- Entity fields (names, descriptions, kind-specific state)
- Lore bodies
- Threads + happenings (titles, descriptions)
- Chapter summaries

Each is an independent toggle. Default set (enabled on first
turn-on): narrative + user actions + entity fields + lore bodies.
Others off. User can flip.

### Data model note

The `translations` table already supports multi-language via its
`language` column (see
[`data-model.md → Translation`](../../../data-model.md)). The UI's
single-target limitation is a v1 scope decision, not a schema
limitation. Data-model is forward-compatible.

## Pack tab — active pack + variables

Two sections:

1. **Active pack selector** — dropdown; changing warns about
   prompt-shape rewrite on next turn.
2. **Pack variables** — form controls rendered **dynamically** from
   the active pack's variable schema.

### Pack variables

Packs declare a **variable schema** (names, types, defaults,
descriptions). The Pack tab renders form controls dynamically based
on the active pack's schema. Values are stored per-story.

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
invalidates the current variable values. Options: reset to new pack's
defaults / map by name where types match / keep unmapped values
orphaned but accessible. Decide before pack switching ships.

Pack authoring (editing the templates + declaring variables) lives on
the dedicated Prompt / Pack Editor screen (inventory #12).

## Calendar tab — picker + summary

The active calendar for this story. The tab content is the
calendar picker plus a read-only summary panel; full spec —
option-row content, summary sections, swap warnings, edit-
restrictions interaction — lives in
[`patterns/calendar-picker.md`](../../patterns/calendar-picker.md).

Story Settings is one of three host surfaces for the picker
primitive (App Settings, Story Settings, Wizard); this tab is the
swap-aware host. Swapping the calendar may surface a combined
confirmation modal (origin re-pick, hidden era flips, display
reformatting); details in the pattern doc.

### Era flips on this branch

Below the calendar picker + summary, the tab surfaces the era flip
log for the **current branch** — `branch_era_flips` is branch-
scoped, so switching branches via the reader's branch navigator and
returning here reloads the list against the new branch's flips.
Authoring lives in the reader (see
[`reader-composer.md → Era flip`](../reader-composer/reader-composer.md#era-flip));
this surface is read-only-plus-delete. The semantic seam is
slightly fuzzy — flips aren't strictly "settings" — but the
calendar tab is where everything calendar-related already lives.

**Per-row anatomy:**

- **Era name** — the canonical commit form (normalized to preset
  casing where applicable per the
  [Autocomplete-with-create primitive](../../patterns/forms.md#autocomplete-with-create-primitive)).
- **Anchor display** — `at_worldtime` rendered via the active
  calendar's formatter (e.g., `Reiwa 1 · May 1, 2019`). Shows
  `Start of story` when `at_worldtime = 0`.
- **Inline `×` delete icon** — follows the
  [icon-actions pattern](../../patterns/icon-actions.md)
  (always-visible-muted, brighten on hover; disabled during
  in-flight pipelines per the
  [hidden-vs-disabled rule](../../patterns/icon-actions.md#disabled-vs-hidden)).

No inline rename in v1 — see
[followups](../../../followups.md#inline-rename-for-era-flips-in-story-settings--calendar)
for the deferral.

**Sort.** `at_worldtime` ascending — chronological within the
branch's lifetime.

**Empty state.** When the active calendar has `eras !== null` but
the branch has no flips:

> No era flips on this branch yet. Use **Flip era…** in the reader
> to mark a new era.

**Sub-section visibility.** When the active calendar has
`eras: null` AND the branch has no orphan flips (see below),
the entire `Era flips on this branch` sub-section hides — there's
nothing meaningful to surface.

### Orphan flips (after calendar swap)

When the user swaps the active calendar to one with `eras: null`,
existing flips on the branch are kept as orphan data per the
[calendar-picker swap behavior](../../patterns/calendar-picker.md).
The flip-list still renders so users have a cleanup path:

> **Reiwa** · `Reiwa 1 · May 1, 2019` · `[from previous calendar]` · `×`

The `[from previous calendar]` annotation is muted text after the
anchor display. Delete still works the same way; CTRL-Z restores.

**Anchor display for orphans.** Formatter prefers the previously-
active calendar's renderer when its definition is still available
(calendar definitions live in `vault_calendars`, not on the story;
they survive the swap). If
the previous calendar was deleted from Vault, the row falls back
to the raw integer worldTime with a small `(raw)` annotation.

### Inline delete confirm

Click `×` → inline confirm in place (matching the
[branch-navigator inline delete pattern](../reader-composer/branch-navigator/branch-navigator.md#inline-delete-confirm)):

```
   Reiwa · Reiwa 1 · May 1, 2019
   Delete this flip?       [ Cancel ]  [ Delete ]
```

`Cancel` reverts to the read-only row. `Delete` writes the
delete-row delta and removes the row from the list. CTRL-Z
restores.

## Definitional-change confirmations

A small set of fields trigger a confirmation modal at **save** when
the dirty session changes them and the story has at least one entry.
The modal sits between the user clicking `Save` and the session
committing — `Cancel` returns to the dirty editor, `Save anyway`
commits per the normal
[save-session pattern](../../patterns/save-sessions.md).

Modal pattern follows the
[branch creation modal](../reader-composer/branch-navigator/branch-navigator.md#branch-creation--modal):
modal head + body + foot with `[Cancel]` + `[Save anyway]`. Body
lists each flagged field that's dirty plus a single-sentence
consequence for that field. No "type the story name to confirm"
friction — local-first, single-user, low stakes; the modal exists
to inform, not to gatekeep.

### Flagged fields

| Tab        | Field             | Why flagged                                                                                             |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| Generation | `mode`            | Switching adventure ↔ creative reframes the user's relationship to the story going forward.             |
| Generation | `narration`       | Changing first/second/third-person mid-story reads as a voice break unless intentional.                 |
| Generation | `composerWrapPov` | Changes how new user input in `Do` / `Say` / `Think` modes is rendered. Existing entries stay as-saved. |
| Pack       | `activePackId`    | Rewrites the prompt shape on the next turn. Story content unaffected; generation patterns shift.        |

Not flagged, deliberately:

- `leadEntityId` — first-class action; see
  [principles → Mode, lead, narration](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts).
- `worldTimeOrigin` — display-only shift. Stored worldTimes are
  unchanged; only the calendar formatter renders them differently.
- All operational tuning (memory, translation, models, pack
  variables) — the save bar itself is the commit affordance; no
  extra modal needed.

### Confirmation copy

Each flagged field has a single-sentence consequence string used in
the modal body. Wording stays informational (not "are you sure?") —
the user is committing on purpose; the modal exists to surface what
changes downstream:

- **`mode`** — "Reframes the user's relationship to the story going
  forward. Existing entries stay; new generation will treat you as
  a `[character|director]`."
- **`narration`** — "Changes the AI's prose voice from the next
  turn forward. Existing entries are unchanged."
- **`composerWrapPov`** — "Affects how new user input in `Do` /
  `Say` / `Think` modes is rendered. Existing entries stay
  as-saved."
- **`activePackId`** — "Switches the active pack — the prompt shape
  rewrites on the next turn. Story content stays; generation
  patterns change."

When multiple flagged fields are dirty in one session, the modal
stacks one bullet per field.

### Tab-level warn-box vs save-time modal

Two layers, different audiences:

- The **tab-level warn-box** (already in the
  [Generation tab](#generation-tab--definitional-fields--authoring-aids)
  and the [Pack tab](#pack-tab--active-pack--variables)) catches a
  user about to start editing a flagged field.
- The **save-time modal** catches a user who has edited and is
  about to commit. The warn-box is informational; the modal is
  consent.

### When the story is empty

No entries yet (story just created from the wizard) → no modal. The
flagged fields can be freely retuned; first turn locks them in
operationally.

## Save session

Same pattern as the World panel: **explicit save**, session-based.
First field edit opens a session; all changes across all tabs share
one `action_id`; Save commits as one unit; Discard throws it away;
navigate-away guard when dirty. See
[patterns → Save sessions](../../patterns/save-sessions.md)
for the full pattern.

## Top-bar

Per the [Top-bar design rule](../../principles.md#top-bar-design-rule):
universal essentials (logo + breadcrumb `<story-title> / Story
Settings` + Actions + ←) plus universal in-story chrome (status
pill + progress strip). Reader-only chrome (chapter chip ▾, time
chip, branch chip) is absent — this surface is configuring the
story, not reading it.

The Story Settings icon is absent here (self-reference; see
[Settings icon scope](../../principles.md#settings-icon-scope)).
App Settings is reachable via the Actions menu.

**Contextual Return.** When Story Settings is reached via the
story-list card overflow (`⋯ → Edit info`), the
[stack-aware Return](../../principles.md#stack-aware-return)
goes back to the story list on the first ←. If the user navigates
beyond Story Settings (e.g., forward into the reader), the one-shot
is consumed and subsequent Returns follow the default stack pop.

## Screen-specific open questions

- **Accent color picker**: the current swatch row is a quick-pick.
  Custom color (full color picker) is an `+ custom` affordance.
  Actual picker UI deferred.
- **Cover upload**: drag-drop + pick-from-assets. Detailed UX (crop,
  aspect enforcement) deferred.
- **Advanced tab depth**: currently shows identifiers + an export
  action + raw-settings view. Likely grows over time (debug flags,
  retry counts, cache stats).
