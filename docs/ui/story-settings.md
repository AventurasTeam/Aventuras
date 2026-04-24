# Story Settings

**Wireframe:** [`docs/wireframes/story-settings.html`](../wireframes/story-settings.html) — interactive

Per-story configuration surface. Reached from the ⚙ icon in the
reader's top bar. Two domains under one roof: **Story** (what the
story is — wizard-editable definitional fields) and **Settings**
(how it generates — post-creation tuning knobs).

App Settings reuses the same layout pattern with different
sections/tabs.

Most of the behavior is governed by cross-cutting principles in
[principles.md](./principles.md). Relevant sections:

- Settings architecture (split by location — App vs Story)
- Adventure vs Creative mode, unified lead concept
- Composer mode — send-time transform, POV-aware
- Entity editing — explicit save, session-based (same pattern
  applies here)
- Naming convention (World/Plot descriptor)

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
│               │ status: ●Active ○Pinned ○Archived          │
│               │                                             │
│               ├────────────────────────────────────────────┤
│               │ save bar (when dirty)                       │
└───────────────┴────────────────────────────────────────────┘
```

Left rail is the canonical **settings pattern**: sections (uppercase
labels) containing tabs (left-rail items). Active tab highlighted
with a left-edge accent. Reused by App Settings in a later wireframe.

## Section split — wizard-editable vs post-creation tuning

**Story section** (definitional — set during wizard, editable
after):

- **About** — title, description, genre, tags, author notes
  (private), cover, accent color, library status (active/pinned/
  archived).
- **Generation** — mode (adventure/creative), lead character,
  narration (first/second/third-person), tone/style, plus
  **Authoring aids** sub-section: composer modes toggle + wrap
  POV (first/third) + suggestions toggle. Behavior that shapes
  what the AI writes and how the user composes.

**Settings section** (operational — post-creation knobs):

- **Models** — per-feature override picks (see below)
- **Memory** — chapter threshold (with presets), recent buffer
  size, compaction detail
- **Translation** — master enable, target language, granular
  per-content-type toggles (see principles.md for rationale)
- **Pack** — active pack + pack-declared variables (see below)
- **Advanced** — story ID, timestamps, branch info, diagnostics
  (export JSON, view raw settings)

## Models tab — overrides only

Every field is optional. Absent = use the global App Settings pick.

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
render time.

## Generation tab — immutability warning

Some Generation fields (mode, lead, narration) are effectively
immutable once narrative exists — changing them mid-story can break
coherence.

Pattern: a soft warn-box at the top of the tab when `chapter 1 +
entry 1` has been written. Individual dangerous fields trigger a
confirmation prompt on edit (specifics deferred — see followups).

## Memory tab — preset buttons + recent buffer

Chapter threshold gets **quick-pick preset buttons** alongside the
numeric input: `Short (8k)`, `Balanced (24k)`, `Long (48k)`,
`Custom…`. Gentle guidance on typical choices without hiding the
raw number.

**Recent buffer** is the new per-story knob that governs how many
most-recent entries always land verbatim in the prompt before the
retrieval agent handles earlier content. Lives under a "Prompt
context" sub-section on the Memory tab. See
`principles.md` → "Prompt context — recent buffer + retrieval".

## Translation tab — see principles

Translation UX fully covered in `principles.md` →
"Translation — display-only, opt-in, single target". Short version:
master enable toggle + single target language + granular per-
content-type toggles + architectural reminder that translations are
display-only.

## Pack tab — active pack + variables

Two sections:

1. **Active pack selector** — dropdown; changing warns about
   prompt-shape rewrite on next turn.
2. **Pack variables** — form controls rendered **dynamically** from
   the active pack's variable schema. Each pack declares its own
   variables (name, type, default). Typical types: enum (dropdown/
   radio), number (input), boolean (toggle), string (input/textarea).
   Values persist in `stories.settings.packVariables` keyed by name.

Pack authoring (editing the templates + declaring variables) lives
on the dedicated Prompt / Pack Editor screen (inventory #12).

## Save session

Same pattern as the World panel: **explicit save**, session-based.
First field edit opens a session; all changes across all tabs
share one `action_id`; Save commits as one unit; Discard throws
it away; navigate-away guard when dirty. See `principles.md`
"Entity editing — explicit save, session-based" for full details.

## Top-bar

Story Settings doesn't show the reader's chapter chip / time chip
/ progress strip / gen status — all reader-specific. The top bar
carries only:

- Logo + story-title / Story Settings breadcrumb
- Actions (⎇)
- Return (←) → back to reader

The ⚙ gear that normally opens Story Settings is absent here —
we're already in it.

## Screen-specific open questions

- **Accent color picker**: the current swatch row is a quick-pick.
  Custom color (full color picker) is an `+ custom` affordance.
  Actual picker UI deferred.
- **Cover upload**: drag-drop + pick-from-assets. Detailed UX
  (crop, aspect enforcement) deferred.
- **Immutability confirmation wording**: which fields are
  soft-warn vs hard-lock, and the dialog copy. Deferred per
  followups.
- **Pack switching mid-story**: supported but "rewrites the prompt
  shape on the next turn." User should be warned (current wireframe
  has a subtle info box, but a confirmation might be warranted).
- **Advanced tab depth**: currently shows identifiers + an export
  action + raw-settings view. Likely grows over time (debug flags,
  retry counts, cache stats).
