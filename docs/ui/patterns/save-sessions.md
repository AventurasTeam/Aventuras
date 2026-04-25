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

---

## Navigate-away guard — global intercept

Whenever the user tries to leave a dirty surface — clicking another
list row, switching branch, navigating out of the panel, navigating
between top-level routes, **closing the window** — a confirmation
modal intercepts:

> **Unsaved changes**
>
> Save / Discard / Cancel navigation

Three actions, no implicit default:

- **Save** — commit the session, then proceed with the navigation.
- **Discard** — throw the session away, then proceed with the
  navigation.
- **Cancel navigation** — keep the session and stay on the current
  surface.

The guard is **global**: every surface that uses this pattern wires
the same modal, same copy, same actions. The intercept covers
in-app navigation (router events) AND window-close events
(electron's `close` / web's `beforeunload`). No surface gets to
override the intercept; any intent to leave passes through it.

---

## Quick-edit exception — peek drawer

The reader's peek drawer is the deliberate exception to the
session pattern: pencil edits on single text fields commit
immediately as one-field sessions (create the delta, write the
row, no save bar, no guard). Deep edits route to the World panel
where the explicit-save pattern applies.

---

## Where applied

- World panel — entity detail pane (one session per detail row).
- Plot panel — thread / happening detail pane.
- Story Settings — all tabs share one session.
- App Settings — all tabs share one session.
- Future master-detail surfaces inherit the pattern by default
  unless they declare a quick-edit exception like the peek drawer.
