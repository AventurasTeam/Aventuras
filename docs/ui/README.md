# UI docs

Design documentation for Aventuras' UI. Companion to
[`docs/data-model.md`](../data-model.md) (what's stored) and
[`docs/architecture.md`](../architecture.md) (how code is organized);
these docs tell you what the app looks like and how its surfaces
behave.

Low-fi wireframes live as interactive static HTML colocated with each
screen's `.md` doc under `docs/ui/screens/<screen>/`. Prose,
rationale, and decisions live alongside.

## Layout

- **[principles.md](./principles.md)** — cross-cutting decisions
  that apply across multiple surfaces. Philosophy + architecture-
  shaped rules (top-bar rule, settings architecture, mode/lead/
  narration, injection rules, etc.). Read this first.
- **[patterns/](./patterns/README.md)** — sibling to principles.
  Component-shaped reusable primitives that the principles imply
  (entity rows, list rendering, Select primitive, JSON viewer,
  imports). Cross-cutting like principles, but visual-spec rather
  than philosophy.
- **[foundations/](./foundations/README.md)** — visual identity
  contract: token slots (color, font-family, structural,
  user-orthogonal), theme data shape, switching mechanism,
  persistence, accent-override opt-in, curated 10-theme gallery.
  Multi-session pass — feature-complete for v1 across sessions
  1–6. Tokens consumed by patterns and screens alike.
- **[../followups.md](../followups.md)** — active outstanding
  items (current milestone) across data-model, architecture, and
  UX. See [`../parked.md`](../parked.md) for items deferred beyond
  v1 (post-v1 confirmed + parked-until-signal).
- **`screens/<screen>/`** — one directory per surface. Holds the
  per-screen `.md` doc and its interactive `.html` wireframe.

## Screens

### Critical (MVP writing loop)

| #   | Screen                         | Directory                                                                |
| --- | ------------------------------ | ------------------------------------------------------------------------ |
| 1   | Story list (landing)           | [screens/story-list/](./screens/story-list/story-list.md)                |
| 2   | Story creation wizard          | [screens/wizard/](./screens/wizard/wizard.md)                            |
| 3   | Reader / composer              | [screens/reader-composer/](./screens/reader-composer/reader-composer.md) |
| 4   | App Settings                   | [screens/app-settings/](./screens/app-settings/app-settings.md)          |
| 5   | Onboarding (first launch)      | [screens/onboarding/](./screens/onboarding/onboarding.md)                |
| -   | Story Settings (from reader ⚙) | [screens/story-settings/](./screens/story-settings/story-settings.md)    |

### Supporting (lands with MVP)

| #   | Screen                      | Directory                                                                                                   |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 6   | World (entities + lore)     | [screens/world/](./screens/world/world.md)                                                                  |
| 7   | Branch navigator            | [screens/reader-composer/branch-navigator/](./screens/reader-composer/branch-navigator/branch-navigator.md) |
| 8   | Rollback confirmation       | [screens/reader-composer/rollback-confirm/](./screens/reader-composer/rollback-confirm/rollback-confirm.md) |
| 9   | Plot (threads + happenings) | [screens/plot/](./screens/plot/plot.md)                                                                     |
| 10  | Chapter Timeline            | [screens/chapter-timeline/](./screens/chapter-timeline/chapter-timeline.md)                                 |

### Power-user / deferred

- Prompt / pack editor (desktop-only)
- Vault (reusable library) — broader shell deferred; first
  sub-wireframe (calendar editor) lands at
  [`screens/vault/calendars/`](./screens/vault/calendars/calendars.md)
- Import / export / backup
- Translation wizard
- Asset gallery

### Cross-cutting states (not standalone screens)

- Streaming / loading / error inside the reader (error surface
  locked as system entries — see
  [reader-composer.md → Error surface](./screens/reader-composer/reader-composer.md#error-surface--system-entries-not-chrome-indicators))
- Empty states for each list
- Mobile / responsive variants for every surface — contract +
  multi-session plan at
  [`foundations/mobile/`](./foundations/mobile/README.md). Per-screen
  retrofits are a session-7+ consumer pass; surfaces with
  pre-foundations `## Mobile` sections (branch-navigator,
  rollback-confirm) are interim until reconciled by their per-screen
  retrofit.
