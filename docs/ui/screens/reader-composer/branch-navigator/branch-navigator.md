# Branch navigator

**Wireframe:** [`branch-navigator.html`](./branch-navigator.html) — interactive

Two related surfaces for the [branch model](../../../../data-model.md#branch-model):

- The **navigator** itself — an anchored popover (desktop) or
  bottom drawer (mobile) for switching between existing branches
  and lightweight management (rename, delete).
- The **creation modal** — triggered from the reader's per-entry
  `⎇ Branch from this entry` action; required name input.

Both live in this directory because they share one domain (branch
lifecycle UI). The reader is where both are triggered; this doc is
where the surfaces are specified.

Cross-cutting principles that govern these surfaces are in
[principles.md](../../../principles.md). Relevant sections:

- [Top-bar design rule](../../../principles.md#top-bar-design-rule)
  (the reader's branch chip is the desktop entry point — branch
  chip is reader-only chrome)
- [Edit restrictions during in-flight generation](../../../principles.md#edit-restrictions-during-in-flight-generation)
  (branch switch / create / delete disable while a generation
  pipeline is in flight; navigation that crosses the story boundary
  routes through the principle's abort-confirm modal)

## Layout

```
─── Reader top bar ──────────────────────────────────────────
 ← │ <story> · Ch 5 · 🕒 ... │ [status] [⎇ 3] [⎇] [⚙] │
                                       ↓
                          (click chip — desktop popover)
                                       ↓
       ┌── Branches · 3 ──────────────── × ─┐
       │                                     │
       │  ✓  main                            │  ← current
       │                                     │
       │     alt-ending-2          [✎] [×]   │  ← inline icons on hover
       │                                     │
       │     the-trap             [✎] [×]    │
       │                                     │
       └─────────────────────────────────────┘
```

Anchored to the top-bar branch chip. Click outside or `Esc` to
dismiss.

## Navigator — popover (desktop)

Width ~360px; vertical list of one row per branch. Header carries
the title + total count + close affordance. Body is rows. No
footer (no `+ New branch` here — see
[Why no creation entry point in the navigator](#why-no-creation-entry-point-in-the-navigator)
below).

### Per-row anatomy

Two zones per row:

- **Left**: marker (`✓` filled when current, `○` muted otherwise),
  followed by the branch name.
- **Right**: two inline action icons — `✎` (rename) and `×`
  (delete) — following the
  [icon-actions pattern](../../../patterns/icon-actions.md)
  (always-visible-but-muted, brighten on row hover/focus, same
  affordance on desktop and mobile).

That's it. **No** lineage hint, **no** fork-point reference, **no**
created-at timestamp, **no** divergence count. Branch names carry
the full identity load — see
[Branch creation — modal](#branch-creation--modal) for why naming
is required at creation time.

Click anywhere on the row body (anywhere except the action icons)
→ switch active branch, close the navigator. Reader reloads
showing the new branch's content + the chip's count badge updates
to reflect the new current.

### Row actions — inline icons

Two icons on the right side of each row, both reachable in a
single click:

- **`✎` Rename** — opens [inline rename](#inline-rename) on this row.
- **`×` Delete** — opens [inline delete confirm](#inline-delete-confirm)
  on this row. **Hidden** on the root branch (the one with
  `parent_branch_id = null`) and on the **current** branch (you
  can't delete out from under your own active session). Per the
  [hidden-vs-disabled rule](../../../patterns/icon-actions.md#disabled-vs-hidden):
  these are structural unavailabilities (not temporary), so they
  hide rather than grey out.

No `Set as default`, no `Pin`, no `Duplicate`, no overflow menu.
Branches don't have a default-vs-non-default concept
(`stories.current_branch_id` IS the user's current focus); pinning
would compete with the implicit "current is always at top by
sort"; duplication is what forking already does and lives at the
per-entry level. With only two row actions and direct icons, an
overflow menu (`⋯`) would add a click for no gain — and the
nested-popover pattern (popover → menu) is awkward visually.

### Sort order

Branches sort by `created_at` ascending — root first, then
siblings in fork order. Stable, intuitive ("main, then the
order I forked them in"), no extra state to remember. The
**current** branch always renders first regardless of position
(matches the [story list pinned-to-top sort layer](../../story-list/story-list.md#story-card--text-first))
— because "where am I?" is the navigator's most-asked question
and putting the answer first costs nothing.

### During generation — switch / delete / create blocked

While the
[generation-status pill](../../../principles.md#top-bar-design-rule)
is active (any pipeline phase: reasoning, generating, classifying,
chapter-closing), branch lifecycle operations are **paused**:

- **Switch** — row body click is non-interactive. Rows render at
  reduced opacity. A small banner at the top of the navigator
  reads `Generation in progress — switching paused.` with no
  action — the user dismisses it by waiting or by cancelling the
  generation from the composer's `Send → Cancel` transform.
- **Delete** — `×` icon hidden across all rows during generation
  (same hide rule used for root + current).
- **Create** — the per-entry
  [`⎇ Branch from this entry` action](../reader-composer.md#per-entry-actions)
  is disabled in the reader, so the
  [creation modal](#branch-creation--modal) can't open. Per-entry
  icons follow the same muted-then-brighten pattern; disabled
  state is the third tier (greyed, no hover brighten, tooltip
  explains).

**Rename remains allowed** — it's a metadata-only write to
`branches.name` and doesn't touch branch state or interfere with
the in-flight pipeline.

The `stories.current_branch_id` mutation is what generation
depends on, so blocking switching is the load-bearing protection.
The other restrictions are conservative consistency: if you can't
switch, allowing delete/create produces a UI where some lifecycle
ops work mid-generation and others don't, which is more confusing
than blocking them as a set.

### Inline rename

Triggered from the `✎` icon — **not** from clicking the name
directly (a bare name-click switches the branch; we don't want a
single click to be ambiguous between "go there" and "edit this").

The row's name swaps for an editable input pre-filled with the
current name, focused, text selected. The `✓` marker stays
visible. The action icons collapse. Confirm controls aren't a
separate button row — they're keyboard-only:

- **Enter** → save (writes the new name to `branches.name`,
  collapses back to the read-only row).
- **Esc** → cancel (discards the in-flight name, collapses back).
- **Click outside the input** → save (treat as Enter — the user is
  visibly committing by moving focus elsewhere).

Validation: empty / whitespace-only names are rejected at save
time (the input border turns warn-colored, save is a no-op until
the user fixes or cancels). Same uniqueness behavior as creation
— the data model doesn't enforce it; the navigator doesn't either.

### Inline delete confirm

Triggered from the `×` icon. The row's body collapses into an
inline confirmation block in place — no modal, no popover-
within-popover:

```
   alt-ending-2
   Delete this branch?       [ Cancel ]  [ Delete ]
```

`Cancel` (or `Esc`) → revert to the read-only row.
`Delete` → executes the deletion. The row removes from the list;
the navigator's count in the header decrements; the navigator
stays open. The chip's count badge in the reader top bar updates
when the popover closes.

Deletion is a single SQL cascade per the
[composite-PK design](../../../../data-model.md#branch-model) —
every branch-scoped row with that `branch_id` goes (entries,
entities, lore, threads, happenings, chapters, deltas, etc.).
Assets are reference-counted via `entry_assets`; orphaned assets
are GC'd in a separate sweep, not inline.

**Implementation note:** the row's expansion from "compact" to
"row + confirmation buttons" is functional as drawn, but the
layout shift will feel jolting without a transition. Animate
height/padding (~150ms ease-out) on enter and exit so the change
reads as a deliberate state transition rather than a layout
glitch.

## Why no creation entry point in the navigator

The navigator is for **selecting from existing branches** plus
light management. **Creating** a branch requires a fork point —
which is necessarily a specific entry — and the canonical way to
specify "this entry" is the per-entry
[`⎇ Branch from this entry` action](../reader-composer.md#per-entry-actions)
in the reader.

A footer button like `+ New branch from current entry` would
introduce ambiguity (which entry counts as "current" — the latest,
the one in view, the user's last interaction?) and would
duplicate an affordance that already exists in the natural place.
We deliberately omit it.

## Branch creation — modal

The per-entry `⎇ Branch from this entry` action opens a small
modal centered over the reader:

```
┌──── New branch ──────────────────── × ─┐
│                                          │
│   Branching from entry 47.               │
│                                          │
│   Name *                                 │
│   [                                  ]   │
│                                          │
│                  [ Cancel ]  [ Create ]  │
└──────────────────────────────────────────┘
```

- **Width** ~360px. Centered. Backdrop dim.
- **Context line** — `Branching from entry <N>.` Reminds the user
  of the fork point. Read-only — the entry is fixed by the
  trigger.
- **Name** — single text input, **required**. Focused on open.
- **Confirm button** (`Create`) — **disabled** until the name is
  non-empty (whitespace doesn't count). Enter in the input field
  also confirms.
- **Cancel** — closes the modal, no branch created. Esc and
  click-outside both behave as Cancel.

### After confirm

1. New `branches` row written with `parent_branch_id = <current>`,
   `fork_entry_id = <triggering entry id>`, `name = <input>`.
2. Branch-scoped rows materialized per the
   [hard-fork copy procedure](../../../../data-model.md#branch-model).
3. `stories.current_branch_id` updates to the new branch.
4. Reader reloads on the new branch (content is byte-identical up
   to the fork point). The chip's count badge increments and now
   shows; `Esc → Esc` cycle of "open navigator → see new branch
   highlighted" is the user's mental confirmation.

No toast — the chip update + reader being on the new branch is
self-evidence.

### Name uniqueness

The data model doesn't enforce uniqueness (`branches.name` is
plain text). The creation modal doesn't either, and neither does
inline rename — two branches can share a name within a story.
This is a deliberate non-feature: name collisions are the user's
responsibility. Branches are identified by `id` everywhere data
flows; names are purely display labels.

## Single-branch state

When `stories.current_branch_id` is the only branch in the story:

- The reader's top-bar chip is **hidden** (per the
  [reader-only chrome rule](../../../principles.md#reader-only-chrome)
  — chip shown only when >1 branch).
- The navigator is therefore **not reachable from the chip**.
- It IS reachable from the
  [Actions](../../../principles.md#actions--platform-agnostic-action-directory)
  menu (`Browse branches`). Opening it on a single-branch story
  shows one row with `Rename` available but `Delete` disabled
  (root + current = both deletion blocks apply). The header reads
  `Branches · 1`.
- The **creation modal** is reachable as always — from the
  per-entry `⎇` action. Creating a second branch causes the chip
  to appear on next render.

## Mobile — bottom drawer

The popover renders as a bottom drawer instead of an anchored
popover:

- Slides up from the bottom edge of the viewport.
- Full viewport width, capped to ~480px.
- **Grab handle** at the top edge as the dismissal cue — no
  separate close button. Drag-down on the handle or tap-on-
  backdrop dismisses. The handle is the typical drawer
  affordance; an X would be visual redundancy.
- Same content + same per-row layout. Action icons follow the
  same always-visible-but-muted treatment as desktop (touch
  doesn't have a hover state, so the muted default is the
  steady-state visual; tap brightens transiently).
- Inline rename + delete confirm work identically.

The creation modal is unchanged on mobile — modals already work
the same way.

## Empty state

Not applicable. A story always has at least the root branch
(created with the story itself). The navigator can't render with
zero rows.

## Data-model touchpoints

No new schema. This pass uses:

- [`branches`](../../../../data-model.md#branch-model) — `id`,
  `story_id`, `parent_branch_id`, `fork_entry_id`, `name`,
  `created_at`. Composite PKs on branch-scoped tables guarantee
  fork copies and deletions are simple cascades.
- `stories.current_branch_id` — the single field that "switch
  branch" mutates.

## Screen-specific open questions

- **Tree visualization** — explicitly out of scope this pass. If
  users build deeply-nested branch trees and the flat list loses
  structure, revisit with a tree view (probably as an opt-in
  toggle, not a default — most users will have shallow shapes).
- **Branch detail / metadata view** — currently no surface for
  "when was this branched, from where, how many entries diverged."
  If demand emerges, lands as either a Story Settings · Branches
  tab or a `View details →` row action. Premature now.
- **"Where did the delete icon go?" discoverability** — the
  delete icon is hidden on root + current rather than greyed.
  Trade-off favors visual cleanliness; revisit if real users
  hit the question.
