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
- [Mode, lead, and narration](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts)
- [Composer mode — send-time transform](../../principles.md#composer-mode--send-time-transform-narration-aware)
- [Models are override-only (per-story)](../../principles.md#models-are-override-only-per-story)
- [Form controls — Select primitive](../../principles.md#form-controls--select-primitive)
  (segment / dropdown / radio render-mode rule applies to every
  picker on this surface)
- [Entity editing — explicit save, session-based](../../principles.md#entity-editing--explicit-save-session-based)
  (the same pattern applies here)
- [Naming convention — World / Plot](../../principles.md#naming-convention--world--plot-and-their-panel-descriptor)

## Layout

```
┌────────────────────────────────────────────────────────────┐
│ [logo] Aria's Descent / Story Settings     [⎇] [←]          │ ← top bar
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
│ · Advanced    │ cover, accent color                         │
│               │ ─ Library                                   │
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
  [Select primitive rule](../../principles.md#form-controls--select-primitive)),
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
- **Advanced** — story ID, timestamps, branch info, diagnostics
  (export JSON, view raw settings)

## Models tab — overrides only

Every field is optional. Absent = use the global App Settings pick at
render time.

- Empty state shows as a dashed/italic `App default: <model>`
  sentinel so the user always sees what's currently in effect.
- Choosing a model in the dropdown pins an override for this story.
- Pinning means the story is insulated from future changes to the
  global default.

**Per-feature overrides:**

- `narrative` — the main story AI
- `classifier` — scene extraction after each reply
- `translation` — user-facing string translation
- `imageGen` — portraits / scene illustrations
- `suggestion` — next-turn suggestion pane

**Data model:**

```ts
stories.settings.models: {
  narrative?: string;
  classifier?: string;
  translation?: string;
  imageGen?: string;
  suggestion?: string;
}
```

All fields optional; absent = use the global App Settings value at
render time. See
[principles.md → Models are override-only](../../principles.md#models-are-override-only-per-story)
for the cross-cutting pattern.

## Generation tab — definitional fields + authoring aids

Houses the three orthogonal concepts (mode / lead / narration — see
[principles](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts)),
the tone/style note, and an **Authoring aids** sub-section toggling
composer modes / wrap POV / suggestions per-story.

**Some Generation fields are effectively immutable once narrative
exists.** Mode, lead, and narration can't meaningfully change
mid-story without breaking coherence. The tab surfaces a soft
warn-box at the top once `chapter 1 + entry 1` has been written.
Individual dangerous fields trigger a confirmation prompt on edit
(specifics — which fields are soft-warn vs hard-lock and the
confirmation copy — deferred per
[followups.md](../../../followups.md)).

## Memory tab — chapter threshold + recent buffer + compaction

**Chapter threshold** gets quick-pick preset buttons alongside the
numeric input: `Short (8k)`, `Balanced (24k)`, `Long (48k)`,
`Custom…`. Gentle guidance on typical choices without hiding the raw
number.

**Auto-close toggle** — when off, the threshold is just guidance and
the user wraps chapters manually. The reader's chapter progress strip
color (yellow at 80%, red at 90%) becomes the primary signal.

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

## Save session

Same pattern as the World panel: **explicit save**, session-based.
First field edit opens a session; all changes across all tabs share
one `action_id`; Save commits as one unit; Discard throws it away;
navigate-away guard when dirty. See
[principles.md → Entity editing](../../principles.md#entity-editing--explicit-save-session-based)
for the full pattern.

## Top-bar

Story Settings doesn't show the reader's chapter chip / time chip /
progress strip / gen status — all reader-specific. The top bar
carries only:

- Logo + story-title / Story Settings breadcrumb
- Actions (⎇)
- Return (←) → back to reader

The ⚙ gear that normally opens Story Settings is absent here — we're
already in it.

## Screen-specific open questions

- **Accent color picker**: the current swatch row is a quick-pick.
  Custom color (full color picker) is an `+ custom` affordance.
  Actual picker UI deferred.
- **Cover upload**: drag-drop + pick-from-assets. Detailed UX (crop,
  aspect enforcement) deferred.
- **Immutability confirmation wording**: which fields are soft-warn
  vs hard-lock, and the dialog copy. Deferred per
  [followups.md](../../../followups.md).
- **Pack switching mid-story**: supported but "rewrites the prompt
  shape on the next turn." User should be warned (current wireframe
  has a subtle info box, but a confirmation might be warranted).
- **Advanced tab depth**: currently shows identifiers + an export
  action + raw-settings view. Likely grows over time (debug flags,
  retry counts, cache stats).
