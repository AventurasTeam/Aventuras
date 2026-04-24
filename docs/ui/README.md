# UI docs

Design documentation for Aventuras' UI. Companion to `docs/data-model.md`
(what's stored) and `docs/architecture.md` (how code is organized); these
docs tell you what the app looks like and how its surfaces behave.

Low-fi wireframes live as interactive static HTML at `docs/wireframes/`.
Prose, rationale, and decisions live here.

## Layout

- **[principles.md](./principles.md)** — cross-cutting decisions that
  apply across multiple surfaces (top-bar rule, entity row patterns,
  save model, injection modes, etc.). Read this first.
- **[followups.md](./followups.md)** — data-model and architecture
  follow-ups the UI work surfaced, stacked for later sessions.
- **Per-wireframe docs** — screen-specific notes, link to each
  interactive HTML artifact.

## Screens

### Critical (MVP writing loop)

| #   | Screen                         | Doc                                        | Wireframe                                                  |
| --- | ------------------------------ | ------------------------------------------ | ---------------------------------------------------------- |
| 1   | Story list (landing)           | [story-list.md](./story-list.md)           | [story-list.html](../wireframes/story-list.html)           |
| 2   | Story creation wizard          | pending                                    | pending                                                    |
| 3   | Reader / composer              | [reader-composer.md](./reader-composer.md) | [reader-composer.html](../wireframes/reader-composer.html) |
| 4   | App Settings                   | pending                                    | pending                                                    |
| 5   | Onboarding / empty state       | pending                                    | pending                                                    |
| -   | Story Settings (from reader ⚙) | [story-settings.md](./story-settings.md)   | [story-settings.html](../wireframes/story-settings.html)   |

### Supporting (lands with MVP)

| #   | Screen                      | Doc                    | Wireframe                                          |
| --- | --------------------------- | ---------------------- | -------------------------------------------------- |
| 6   | World (entities + lore)     | [world.md](./world.md) | [world-panel.html](../wireframes/world-panel.html) |
| 7   | Branch navigator            | pending                | pending                                            |
| 8   | Plot (threads + happenings) | pending                | pending                                            |
| 9   | Chapter timeline            | pending                | pending                                            |

### Power-user / deferred

- Prompt / pack editor (desktop-only)
- Vault (reusable library)
- Import / export / backup
- Translation wizard
- Asset gallery

### Cross-cutting states (not standalone screens)

- Streaming / loading / error inside the reader (error surface
  locked as system entries — see principles.md)
- Empty states for each list
- Rollback confirmation UX (separate wireframe pass pending)
- Mobile variants for everything (deferred)
- "Some settings become immutable" UX (deferred)

## Scope of the initial session (2026-04-24)

- Locked: Reader / composer + World panel, plus all the cross-cutting
  decisions that emerged while wireframing those two (see
  principles.md).
- Data-model follow-ups accumulated in `followups.md`.
- Visual identity, feature components in Storybook, mobile variants,
  and pixel-fidelity mockups deferred to future sessions.
