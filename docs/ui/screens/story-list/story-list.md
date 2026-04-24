# Story list (landing)

**Wireframe:** [`story-list.html`](./story-list.html) — interactive

The landing screen. First thing the user sees after onboarding, and
the home surface between writing sessions. Lists their stories with
enough at-a-glance info to recognize them, plus entry points for
creating new and managing the library.

Cross-cutting principles that govern this screen are in
[principles.md](../../principles.md). Relevant sections:

- [Top-bar design rule](../../principles.md#top-bar-design-rule--essentials-vs-discretionary)
  (essentials — with `← Return` absent here because this IS the root)
- [Actions](../../principles.md#actions--platform-agnostic-action-directory) menu
- [Settings architecture — split by location](../../principles.md#settings-architecture--split-by-location)
  (gear opens App Settings here, not Story Settings)

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [logo] Aventuras                       [Actions][⚙]         │ ← lean top bar (no story context)
├─────────────────────────────────────────────────────────────┤
│ Stories · 6 total                          [+ New story]    │
│ ⌕ Search                [All][Pinned][Archived]  sort: ▾   │
├─────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │[cover]⭐│ │[cover]   │ │[cover]   │ │[cover]   │       │ ← grid
│ ├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤       │
│ │Aria's    │ │Iron      │ │Mornstone │ │Brine Tale│       │
│ │Descent   │ │Circuit   │ │Chronicle │ │          │       │
│ │Adv·Ch3·2h│ │Cre·Ch1·1d│ │Adv·Ch5·3d│ │Cre·Ch2·1w│       │
│ │description│ │description│ │description│ │description│    │
│ │[tag][tag]│ │[tag]     │ │[tag][+3] │ │[tag]     │       │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘
```

## Top-bar — app-level, lean

Landing is root. Only two essentials from the top-bar rule apply:

- **Actions** (⎇) — Cmd/Ctrl-K directory of all commands, reachable
  on every screen.
- **App Settings** (⚙) — opens the App Settings area (not Story
  Settings — no story context here).

Absent: return arrow (this is root), branch chip (no story), gen
status (no story).

The app's name ("Aventuras") replaces the story-title breadcrumb
slot — serves as chrome identity, non-interactive (or routes to
landing from anywhere else, but we're already here).

## Toolbar

- **Search** — single input, filters across title / description /
  tags. Left-anchored, takes available width up to ~360px.
- **Filter chips** — single-select: `All` / `Pinned` / `Archived`.
  `All` hides archived by default (they only appear when the
  `Archived` filter is active). `Pinned` shows only pinned.
- **Sort dropdown** — `last-opened` (default) / `created` / `title`.
  Single-select. Lean picker on the right.

**Sort invariant:** within any filter, **pinned stories are pinned
to the top**, matching the Layer 0 rule from the
[entity-list sort pattern](../../principles.md#entity-list-sort-order--static-four-layer).
Everything else sorts by the chosen key.

## Story card — text-first

Cards work beautifully **text-only**; covers are a nice-to-have
enhancement, not a requirement. Most users will never make a
cover, so the card design can't depend on one.

Grid: `auto-fill` at `minmax(280px, 1fr)`. 1–4+ columns per
viewport.

**Components:**

- **Thin colored left-edge strip** (4px) — mode-derived by default
  (`Adventure` blue, `Creative` purple), override via a user-set
  `accentColor` field on the story. Gives scannable visual variety
  without requiring cover art.
- **Genre overline** — small uppercase label above the title,
  newspaper-section style. Colored to match the accent. Comes from
  `stories.genre: string | null` — a **single free-text string**,
  not a list. Rendered verbatim: `Fantasy` / `Dark Fantasy` /
  `Medieval Mystery` / `Folk Horror` / `Slice of Life with Magic`
  — whatever the user typed. For drafts with no genre yet, shows
  a muted "Genre not set" placeholder. (If multi-genre stories
  become a common need later, split to `genres: string[]` — but
  for v1, one string keeps authoring friction low.)
- **Title row** — title (bold), with a **pin star inline before
  the title** that's a clickable toggle: outline + muted for
  unpinned (~25% opacity, reveals on hover), filled gold for
  pinned. Clicking flips the state. Pin is the only menu action
  promoted to inline chrome because it's frequent enough to earn
  a dedicated affordance. `Draft` or `Archived` status badges
  appear inline after the title when applicable.
- **Overflow menu (⋯)** — anchored to the **card's top-right
  corner** (absolute-positioned), out of the title row so titles
  don't compete with it. Click opens a menu with:
  - **Archive / Unarchive** (toggle)
  - **Edit info** — opens Story Settings → About for fast
    metadata edits without navigating into the story
  - **Duplicate** — clone the story row + current branch's
    entries + entities/lore snapshot. Other branches don't copy.
  - **Export** — per-story JSON export (distinct from full
    backup, per data-model decision)
  - **Delete** — destructive, confirmation required, shown last
    Pin/Unpin is NOT in this menu — it's the inline star toggle.
    All items also reachable via the global Actions menu.
- **Meta row** — mode name (written out: "Adventure" / "Creative"),
  current chapter (for active stories), last-opened relative time.
  Draft stories skip the chapter part — their draft-ness is already
  signaled by the `Draft` badge in the title row.
- **Description** — 3 lines with ellipsis overflow (more generous
  than chip-heavy cards). For stories with no description yet,
  italic "(no description yet)".
- **No tag chips on the card.** Tags still exist in data for
  search/filter; they're not primary card content.
- **No cover area by default.** If/when a user sets a cover image,
  it can surface as a subtle background or a small thumbnail —
  deferred to the visual identity session.

**Click behavior:**

- Click card body → open the story (route to Reader).
- Click ⋯ → open the per-story overflow menu (pin, archive,
  duplicate, export, delete, "add cover image…").

## Drafts — wizard session + explicit draft

Two complementary concepts that together make creating a story
forgiving without cluttering the library.

### Unfinished wizard session (automatic safety net)

- Zustand with persist (SQLite-backed) continuously saves wizard
  state on every step change.
- **One active session at a time** — the latest unfinished wizard
  attempt.
- Survives app restart.
- Re-entering `+ New story` detects the session and prompts:
  **"Continue unfinished draft?"** `[Continue] [Start fresh]`
  — "Start fresh" discards the session.
- **No library presence** — session state is not a `stories` row;
  it's transient wizard state, separate from the library.

### Explicit "Save as draft" (parked work)

- Button inside the wizard at any step.
- Creates a real `stories` row with `status = 'draft'`.
- Session state clears; user returns to story list.
- Draft appears in the library as a card with a `Draft` badge.
- **Many drafts allowed** — user can park multiple parallel ideas.
- Clicking a draft re-opens the wizard **pre-populated** with that
  draft's state; further edits update the same row.
- Completing the wizard transitions `status: draft → active`.
- Drafts can be deleted like any story (⋯ menu → Delete).

### Why both

The session covers "I got interrupted / closed the app by accident"
— nothing is ever lost. The explicit draft covers "I want to park
this idea and come back deliberately, maybe start another one in
parallel." Different failure modes / use cases, both light on the
user.

### Draft visual treatment

- Inline `Draft` badge next to the title (same pattern as `Archived`,
  yellow tint).
- Genre overline reads "Genre not set" (muted) if the user hadn't
  picked a genre yet.
- Meta line shows "draft · 0 entries".
- Left-edge accent still renders per mode (even draft stories have
  a chosen mode).
- Visible in the default `All` filter (they're active work-in-progress,
  should be discoverable).

## Empty state (first launch)

When the user has zero stories (first launch, or after deleting
all), the grid is replaced with a centered welcome:

- Illustration slot (visual identity landing).
- **Welcome to Aventuras** heading.
- Short copy pitching the product and reinforcing the local-first
  story.
- Big CTA: `+ Create your first story` — same destination as the
  header CTA, but scaled for first-impression weight.

The toolbar (search / filter / sort) hides in empty state — nothing
to search/filter. The `+ New story` header button also hides since
the centered CTA carries that role more prominently.

## Data-model dependencies

Story cards assume several identity fields that the current
`stories` schema does NOT yet have. See [followups.md](../../../followups.md):

- `genre: string | null` — free-text single label (shown as overline)
- `tags: string[]` — exists but NOT shown on cards; for search/filter
- `coverAssetId: string | null` — FK to `assets`, optional,
  power-user feature
- `accentColor: string | null` — optional user-set color for the
  left strip; fallback to mode-derived
- Pin/archive status — likely a `status` enum like entities
  (`active` / `pinned` / `archived`) or separate booleans
- `lastOpenedAt: integer` — distinct from `updated_at`

Until the schema pass lands, the wireframe assumes these fields
exist.

## Screen-specific open questions

- **Cover treatment when set**: subtle background image behind text?
  Small thumbnail in title row? Fully replacing the accent area?
  Deferred to the visual identity session.
- **Archived visibility**: currently `All` hides archived, `Archived`
  shows only archived. Alternative: `All` shows everything with
  archived dimmed. Current behavior keeps the library focused on
  active work.
- **Hover preview**: should hovering a card show a larger preview
  (fuller description, key entities, recent chapter summary)?
  Probably v2.
- **Bulk select on cards**: pinning/archiving N at once. Same deferred
  bulk-ops question as in World panel — revisit in the bulk pass.
- **Genre autocomplete**: free-text today, could offer suggestions
  drawn from common genres + genres used in other stories in this
  library. Would help consistency without forcing an enum.
- **Create flow entry point**: `+ New story` opens the Story Creation
  Wizard (inventory #2, pending).
