# Inline delete confirm

Per-row destructive-action confirm that collapses the row's body in
place into a confirmation strip — no modal, no popover-within-popover.
Use when the destructive action belongs to a single list row (branch
delete inside the branch navigator, per-row delete inside Story
Settings) and the surrounding surface is itself an overlay or panel
where a stacked confirm would feel heavy.

Distinct from [`alert-dialog.md`](./alert-dialog.md): AlertDialog is
the centered, ceremonial consent gate for destructive actions whose
impact spans the wider app (rollback, calendar swap, provider /
profile deletion). Inline-delete-confirm scopes the gate to the row
the user is operating on, with cheaper visual weight.

Used by:

- [Branch navigator](../screens/reader-composer/branch-navigator/branch-navigator.md#inline-delete-confirm)
  — `× Delete this branch?` row collapses in place.
- [Story Settings · Branches](../screens/story-settings/story-settings.md)
  — same inline-confirm contract, cites this pattern.

## Shape

Triggered from the `×` icon on the row. The row's body collapses
into an inline confirmation block in place:

```
   alt-ending-2
   Delete this <kind>?       [ Cancel ]  [ Delete ]
```

- `Cancel` (or `Esc`) → revert to the read-only row.
- `Delete` → executes the deletion. The row removes from the list;
  the surrounding count / header updates; surrounding surface stays
  open.

## Layout transition

Animate height / padding (~150ms ease-out) on enter and exit so the
row's reshape reads as a deliberate state transition rather than a
layout glitch.

## Why not AlertDialog

- **Destructive scope is local.** A single row is being removed; the
  consequence is bounded to that row's data.
- **Host surface is already overlay-shaped.** Branch navigator is a
  popover; Story Settings · Branches is a panel. A modal-on-modal
  feels heavy and steals focus from the host the user is already
  engaging with.
- **Cancel cost is trivial.** Click `Cancel` and you're back. The
  modal's ceremonial weight isn't earning its keep here.

When deletion has cross-surface consequences (cascading writes,
broken-reference effects, etc.), upgrade to AlertDialog — see
[`alert-dialog.md → Rich content via composition`](./alert-dialog.md#rich-content-via-composition)
for the impact-list shape.
