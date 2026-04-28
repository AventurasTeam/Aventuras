# Save-session pattern

Cross-cutting interaction pattern for "edit a row, commit a batch."
Used wherever the user enters an editable surface, mutates fields,
and explicitly commits — World panel, Plot panel, Story Settings,
App Settings, and any future detail-pane surface that gates writes
behind explicit save.

Sister patterns: [`entity.md`](./entity.md) (entity forms that ride
this), [`forms.md`](./forms.md), [`lists.md`](./lists.md),
[`data.md`](./data.md).

---

## Why explicit save (not autosave-on-blur)

Autosave-on-blur was rejected because it would (a) let a single
careless keystroke write a destructive change without friction, and
(b) produce delta noise (one `action_id` per field) that makes
CTRL-Z too granular. Explicit save bundles a coherent edit into one
reversible action.

---

## Session semantics

- **Session starts** on the first field edit (form becomes dirty).
- **Form-local state** is held by react-hook-form (already in
  stack); nothing writes to the Zustand store or SQLite until Save.
- **Tab switching is within session** — editing across multiple tabs
  is one session. Settings surfaces with section + tab nav (Story
  Settings, App Settings) treat the entire surface as one session.
- **Save commits** all session changes as deltas under a single
  shared `action_id`. CTRL-Z reverses the entire session as one step.
- **Discard** throws the session away without any writes.

---

## Save bar — the visible UI

A dirty session surfaces a **save bar** as a footer on the editable
pane. Shown ONLY when the session is dirty — clean state has no bar
(no chrome when reading).

Contents:

- Unsaved-change count + summary of which fields are dirty.
- **Discard** action (throws away the session).
- **Save** action (`Cmd/Ctrl-S` keyboard shortcut).

The bar is uniform across surfaces — same shape, same affordances,
same shortcuts. One component reused everywhere; no per-surface
variants.

### Visual

Established across World, Story Settings, App Settings, and any
future surface using the pattern. The visual is part of the
contract — not a per-surface choice:

```
┌────────────────────────────────────────────────────────────────┐
│ ●  3 unsaved changes — description, disposition  [Discard][Save⌘S] │
└────────────────────────────────────────────────────────────────┘
   warm-yellow background tint (#fff7dc); top border line
```

- **Background** — warm yellow tint (`#fff7dc`), reads as a sticky
  note over the surface chrome. Border-top (1px line) separates
  it from the panel content.
- **Layout** — single row, `justify-content: space-between` —
  dirty-note left, actions right.
- **Dirty-note (left zone):**
  - Small amber dot (`#c94`, 8px circle) as a state indicator —
    one constant primitive across surfaces.
  - Text in muted warm tone (`#765`, 12px): bolded
    `N unsaved change[s]` followed by an em-dash and the comma-
    separated list of dirty field names. Field names are
    user-recognizable labels (`description`, `accent color`,
    `Fast tasks profile temperature`), not internal identifiers.
- **Actions (right zone):**
  - **Discard** — bordered button, neutral background.
  - **Save** — solid dark button with the keyboard hint inline
    (`⌘S` on macOS, `Ctrl-S` on other platforms), bold weight.

**Surface-specific informational notes** (e.g., calendar editor's
"saving propagates labels to N stories using this calendar") layer
in as a small `⚠` icon with tooltip after the field list — a
single primitive, never a second row. The visual contract stays
single-row across surfaces.

**Positioning** — the save bar is a flex item at the bottom of the
editable pane (after the form sections). Not sticky-positioned;
on long forms it scrolls below the visible viewport. Sticky-
positioning is a cross-cutting change worth its own pass if it
becomes friction in practice; v1 stays consistent across surfaces
with the non-sticky pattern.

---

## Navigate-away guard — global intercept

A dirty session is protected against **any user action that would
silently discard it**, not just navigation events. Whenever the
user does something whose completion would lose the unsaved
changes, a confirmation modal intercepts:

> **Unsaved changes**
>
> Save / Discard / Cancel

Three actions, no implicit default:

- **Save** — commit the session, then proceed with the action.
- **Discard** — throw the session away, then proceed with the
  action.
- **Cancel** — keep the session and stay on the current surface.

**Intercept categories** (the "intent to leave" can be any of):

- **Selection change within the surface** — picking another row in
  a master-detail list (World, Plot), opening a different entity
  via the Browse rail or peek drawer, switching the active branch
  in the reader. Not a navigation event; just a state change that
  would replace the dirty surface's content.
- **In-app navigation** — clicking a navigation link, ← Return,
  Actions-menu route jumps, anything that fires a router event
  leaving the surface.
- **Window-close intent** — electron window-close or the web
  `beforeunload` event on page close / refresh.
- **Any other state transition that implicitly drops the dirty
  state** — closing a containing drawer/modal, sign-out actions,
  etc.

The guard is **global**: same modal, same copy, same actions
across every surface that uses the save-session pattern. The
intercept hooks are per-surface (a master-detail list wires the
row-click intent; a settings surface wires route changes; both
wire the window-close intent), but the user-visible UX is
identical. No surface gets to skip the guard while dirty.

---

## Quick-edit exception — peek drawer

The reader's peek drawer is the deliberate exception to the
session pattern: pencil edits on single text fields commit
immediately as one-field sessions (create the delta, write the
row, no save bar, no guard). Deep edits route to the World panel
where the explicit-save pattern applies.

---

## Where applied

- [World panel](../screens/world/world.md) — entity detail pane
  (one session per detail row).
- [Plot panel](../screens/plot/plot.md) — thread / happening detail
  pane.
- [Story Settings](../screens/story-settings/story-settings.md) —
  all tabs share one session.
- [App Settings](../screens/app-settings/app-settings.md) — all
  tabs share one session.
- [Chapter Timeline](../screens/chapter-timeline/chapter-timeline.md#save-session--per-card)
  — per-card variant (one session per chapter card; closing one
  card while another is dirty is blocked).
- [Vault calendars editor](../screens/vault/calendars/calendars.md)
  — editor surface uses the standard one-session-per-detail shape.
- Future master-detail surfaces inherit the pattern by default
  unless they declare a quick-edit exception like the peek drawer.
