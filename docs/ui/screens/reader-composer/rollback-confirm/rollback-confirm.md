# Rollback confirmation

**Wireframe:** [`rollback-confirm.html`](./rollback-confirm.html) — interactive

The consent surface for entry deletion in the reader. Clicking the
per-entry `×` action triggers a rollback — the story hard-deletes
the target entry plus everything after it, per
[data-model → Entry mutability & rollback](../../../../data-model.md#entry-mutability--rollback).
Rollback can cascade across chapters; this surface is the gate
between a click and a non-trivial cascade.

Sub-screen of [reader-composer](../reader-composer.md). The trigger
is the per-entry `×` documented under
[per-entry actions](../reader-composer.md#per-entry-actions).
Rollback isn't a feature unto itself — it's the consent layer the
delete affordance routes through.

Cross-cutting principles:

- [Icon-actions pattern](../../../patterns/icon-actions.md) — `×` is
  a row-action icon; danger styling on hover.

## Two visible states

### Hover-preview — pre-click

Hovering the per-entry `×` icon (before click) accentuates every
affected entry with a warn left-border + warn-tinted entry number.
The visual count of accented rows is the in-context cascade
indicator: the user sees "this isn't one entry, it's a range" before
committing.

The accent uses the `--warn` token. No inline marker, no animation —
the multiplicity of bordered rows IS the communication. Entries
below the visible viewport are not specially indicated; the modal
carries the absolute count.

### Confirmation modal — post-click

Clicking the `×` opens a modal centered over the reader. Backdrop
dim per the standard modal pattern (see
[branch creation modal](../branch-navigator/branch-navigator.md#branch-creation--modal)
for the canonical shape). The hover-preview accent disappears once
the modal opens — the modal carries the consequence in numeric form,
not visual:

```
┌──── Delete from entry 47? ──────────── × ─┐
│                                              │
│  This rolls the story back to before         │
│  entry 47. The following are removed:        │
│                                              │
│  • 12 entries (47–58)                        │
│  • 1 chapter re-opened — chapter 5 will…     │  (only when cross-chapter)
│  • 23 world-state changes                    │
│                                              │
│              [ Cancel ]  [ Delete entries ]  │
└──────────────────────────────────────────────┘
```

- **Width** ~440px. Centered. Backdrop dim.
- **Title** — `Delete from entry <N>?` — names the trigger entry; the
  question mark signals consent gate.
- **Body** — one-sentence framing + bulleted impact list.
- **Foot** — `Cancel` (secondary) + `Delete entries` (danger
  primary, warn-coloured per the inline-delete convention in
  [branch navigator](../branch-navigator/branch-navigator.md#inline-delete-confirm)).
  Esc and click-outside both behave as Cancel.

## Counts

Three buckets, in commit order:

| Count                     | Source                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------- |
| **N entries**             | `op=create` deltas on `story_entries` in range                                          |
| **M chapters re-opened**  | `op=create` deltas on `chapters` in range (line omitted when `M = 0`)                   |
| **K world-state changes** | All other narrative deltas in range (entities, lore, threads, happenings, entry_assets) |

Buckets are coarse-grained on purpose. Per-table breakdown reads as
pedantic in a consent modal; "world-state changes" is the
load-bearing summary. The
[delta log](../../../../data-model.md#entry-mutability--rollback)
holds the full per-table record for anyone digging deeper (a future
[delta-log debug surface](../../../../followups.md#observability--debug-ui)
will expose it; deferred).

## Cross-chapter case

When the rollback range crosses one or more chapter boundaries —
i.e. at least one chapter was created after the target entry — the
chapter line surfaces with the **re-open** consequence bolded in the
copy:

> **1 chapter re-opened** — chapter 5 will return to in-progress.

Why bold: chapter close fires lore-mgmt + memory-compaction writes;
those reverse along with the chapter row itself. The re-open is the
load-bearing consequence the user needs to see, not just the count.

When `M = 0` (single-chapter rollback — the common case), the
chapter line is omitted entirely. When `M > 1`, the count
pluralises and lists the range (`2 chapters re-opened — chapters 4
and 5 will return to in-progress`).

## What the modal deliberately does NOT surface

- **CTRL-Z reversibility.** Rollback is reversible via CTRL-Z **only
  until the next user action**, per
  [data-model → action_id grouping](../../../../data-model.md#entry-mutability--rollback).
  Surfacing "reversible" would over-promise; surfacing the
  conditional ("…until your next turn") inflates the modal. The
  modal stays informational; users who want to undo can press
  CTRL-Z themselves.
- **Per-table breakdown.** The world-state-changes bucket is one
  number on purpose. Splitting into entities / lore / threads /
  happenings columns turns a consent modal into a debug surface.
- **Entry text snippets.** No previews of what's being deleted in
  the modal. The hover-preview state IS the visual; the modal is
  consent. Adding text snippets would inflate the modal and risk
  drifting from what's actually rolled back.

## Mobile

Modal renders identically on mobile (modals already cross-platform per
[branch creation modal mobile note](../branch-navigator/branch-navigator.md#mobile--bottom-drawer)).
Hover-preview is desktop-only; touch has no hover state. Tap-and-hold
as a fallback is deferred — same treatment as the icon-actions
mobile rule (touch sits at muted default, taps trigger directly).

## Edge cases

- **Most-recent entry only** — single entry, no chapter re-open, a
  handful of world-state changes. Modal still opens; counts read
  `1 entry, 3 world-state changes`. Skipping the modal for the
  smallest case isn't worth the inconsistency.
- **Entire-branch rollback** — deleting the first entry on a
  branch. Modal copy is identical; counts cover the entire branch.
- **During generation** — per
  [branch-navigator → during generation](../branch-navigator/branch-navigator.md#during-generation--switch--delete--create-blocked),
  the per-entry `×` is disabled while any pipeline phase is active.
  No modal opens because the trigger is unavailable.

## Screen-specific open questions

- **Animation on modal open.** The hover-preview accent disappears
  as the backdrop dims. A short fade (~150ms) on accent removal
  would read smoother than an abrupt swap. Visual-identity pass.
- **Count performance for deep rollbacks.** Hundreds of entries
  spanning thousands of deltas means a wide log scan. Likely
  non-issue at v1 scale; revisit if a real story hits the wall.
- **Multi-chapter copy specifics.** Wording for `M > 2` ("chapters
  4, 5, and 6") gets long. May want to truncate
  (`chapters 4–6 will return to in-progress`). Decide when a real
  rollback that wide shows up.
