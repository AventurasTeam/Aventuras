# Reader / Composer

**Wireframe:** [`reader-composer.html`](./reader-composer.html) — interactive

The core screen. Entry list + composer + streaming AI reply. Right
rail for world-state Browse. Chapter navigation + in-world time in
the top-bar chrome. Next-turn suggestions between entries and
composer.

Most of the reader's behavior is governed by cross-cutting
principles in [principles.md](../../principles.md). Relevant sections:

- Top-bar design rule (essentials + discretionary)
- Chapter navigation (chip + popover + progress strip with color
  thresholds)
- In-world time display
- Per-entry actions (icons, permanent)
- Reasoning expansion + token metadata (brain icon in meta line)
- Composer mode (Do / Say / Think / Free)
- Next-turn suggestions (mode-specific categories)
- Streaming entry (reasoning phase + reply phase)
- Error surface (system entries in chat)
- Entity surfacing level 1 (Browse rail) and level 2 (peek drawer)
- Entity row indicators (three channels)
- Browse filter chips + accordion grouping

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│ [logo] <title ✎> · Chapter ▾ · 🕒 time    [status][br][⎇][⚙][←]│ ← top bar
├───────────────────────────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  (chapter progress strip)              │
├───────────────────────────────────────┬───────────────────────┤
│                                       │ Browse rail            │
│   entries scroll                      │ (scope chip if active) │
│                                       │ category dropdown      │
│                                       │ filter chips           │
│                                       │ search                 │
│                                       │ list (sorted, grouped) │
│                                       │ + Import from Vault    │
│   suggestions panel (after AI reply)  │                        │
│   composer (mode, regen, send/cancel) │                        │
└───────────────────────────────────────┴───────────────────────┘
```

(Right-side peek drawer slides in over the rail + narrative when
an entity row is clicked.)

## Screen-specific notes

- Title max-width capped at 320px with ellipsis + tooltip; keeps
  long titles from blowing out the header.
- Progress strip is **always visible**, color-graded by threshold.
- Suggestions panel appears between entries and composer (below
  the last entry, above the composer).
- Clicking a suggestion fills composer text + sets mode=`Free`.
- Entry hover reveals per-entry action icons at full opacity (they
  exist at 55% by default).
- Chapter break inline separators are minimalist (thin rule +
  chapter label + time at close).
- Per-chapter in-world time shows as a range in the popover
  (closed chapters) or "since <time>" (current chapter).
