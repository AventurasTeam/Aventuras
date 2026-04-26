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
- **[../followups.md](../followups.md)** — top-level ledger of
  outstanding data-model, architecture, and UX items.
- **`screens/<screen>/`** — one directory per surface. Holds the
  per-screen `.md` doc and its interactive `.html` wireframe.

## Screens

### Critical (MVP writing loop)

| #   | Screen                         | Directory                                                                |
| --- | ------------------------------ | ------------------------------------------------------------------------ |
| 1   | Story list (landing)           | [screens/story-list/](./screens/story-list/story-list.md)                |
| 2   | Story creation wizard          | pending                                                                  |
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
- Vault (reusable library)
- Import / export / backup
- Translation wizard
- Asset gallery

### Cross-cutting states (not standalone screens)

- Streaming / loading / error inside the reader (error surface
  locked as system entries — see [principles.md](./principles.md))
- Empty states for each list
- Mobile variants for everything (deferred)

## Scope of the initial session (2026-04-24)

- Locked: Reader / composer + World panel, plus all the cross-cutting
  decisions that emerged while wireframing those two (see
  [principles.md](./principles.md)).
- Data-model follow-ups accumulated in
  [`../followups.md`](../followups.md).
- Visual identity, feature components in Storybook, mobile variants,
  and pixel-fidelity mockups deferred to future sessions.
