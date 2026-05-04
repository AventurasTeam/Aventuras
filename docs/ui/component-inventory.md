# Component inventory

Build queue for the remaining UI primitives, app-domain compound
components, and layout shells. Tracks: what's shipped, what's specced
and ready to scaffold, what needs a design pass before building, and
what's deferred.

Sister to [`components.md`](./components.md) (construction
conventions), [`patterns/README.md`](./patterns/README.md) (pattern
specs), and [`../followups.md`](../followups.md) (decision-shaped
open items). This file is roadmap-shaped — entries leave the file
when they ship.

## States

- **shipped** — file exists in `components/ui/`, story exists.
- **build-ready** — pattern / foundation / per-screen doc fully
  specs the contract; no further design pass needed before
  scaffolding.
- **needs-design** — surface uses it or wireframe shows it, but
  there's no written contract yet. Run a design pass via
  [`aventuras-design`](../../.claude/skills/aventuras-design) before
  scaffolding.

## Primitives

Generic, single-purpose, reusable. Live in `components/ui/`.

### Primitives — shipped

Avatar, Button, Checkbox, Heading, Icon, Input, Popover, Select,
Sheet, Skeleton, Spinner, Switch, SwitchRow, SwitchVisual, Textarea,
Text. Plus the `NativeOnlyAnimatedView` utility wrapper.

### Primitives — build-ready

| Primitive          | Spec                                                                                                     | Notes                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| FormRow            | [forms.md → Form rows](./patterns/forms.md#form-rows--stacked-on-narrow-container)                       | Container-keyed stacked-on-narrow wrapper around label + control + hint. Adopting consumers handles half the work. |
| Autocomplete       | [forms.md → Autocomplete-with-create primitive](./patterns/forms.md#autocomplete-with-create-primitive)  | Primary v1 consumer: tag inputs on stories + entities.                                                             |
| EmptyState         | [lists.md → Empty list / table state](./patterns/lists.md#empty-list--table-state)                       | Centered placeholder; title + sub-text contract per kind.                                                          |
| NoResults          | [lists.md → No-results state](./patterns/lists.md#no-results-state-search--filter-narrowed-to-zero)      | One-liner below the toolbar. Trivial.                                                                              |
| SearchInput        | [lists.md → Search bar scope](./patterns/lists.md#search-bar-scope)                                      | Input + scope tooltip + ⓘ help-popover composition.                                                                |
| LoadOlderButton    | [lists.md → Load-older](./patterns/lists.md#load-older--log-shaped-unbounded-lists)                      | Explicit-click append. Trivial Button variant.                                                                     |
| IconAction         | [icon-actions.md](./patterns/icon-actions.md)                                                            | Always-visible-muted, hover-brightens. Used on every row-shaped surface.                                           |
| SaveBar + NavGuard | [save-sessions.md → Save bar](./patterns/save-sessions.md#save-bar--the-visible-ui), Navigate-away guard | Bar = composition; NavGuard = hook + global handler.                                                               |
| KindIcon           | [iconography.md → Entity kind glyphs](./foundations/iconography.md#entity-kind-glyphs)                   | 22×22 box, glyph from the canonical table. Trivial.                                                                |
| Toast              | [toast.md](./patterns/toast.md)                                                                          | Top-center, severity variants, swipe-up dismiss + ×, queue cap 3. Custom (no rn-reusables baseline).               |
| TabBar             | [tabs.md](./patterns/tabs.md)                                                                            | Underline style, optional per-tab count. Strip-only — substitutes to Select on narrow tiers per Group C rule.      |
| Chip               | [chips.md → Chip](./patterns/chips.md#chip--square-toggleable)                                           | Square (4px radius), toggleable filter / state indicator. `selected` + `onPress` props.                            |
| Tag                | [chips.md → Tag](./patterns/chips.md#tag--pill-labeled-content)                                          | Pill (full radius), labeled content. `removable` / `tone` (soft) / `dashed` (add affordance) props.                |
| Accordion          | [accordion.md](./patterns/accordion.md)                                                                  | Strip default; card composition via className. `type="multiple"` default. Chevron -90°→0° on expand.               |
| AlertDialog        | [alert-dialog.md](./patterns/alert-dialog.md)                                                            | Modal-on-every-tier consent gate. Rich content via composition. Destructive via Button variant (asChild).          |

### Primitives — needs design

_Empty — all primitives have specs._ As new primitive needs surface,
add rows here with the baseline column naming the react-native-reusables
source per [components.md → Sourcing](./components.md#sourcing--react-native-reusables-as-baseline)
(or `_none_` for from-scratch).

### Primitives — deferred

| Primitive   | Blocker                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VirtualList | Library choice — `react-window` vs `@tanstack/react-virtual` not picked. RN-Web compat untested. Tracked in [followups.md → Virtual-list library choice](../followups.md#virtual-list-library-choice). |

## Compound app components

Domain-shaped composites built from primitives. Directory layout TBD
(`components/app/`, `components/<screen>/`, or per-domain — decide as
the first compound lands).

### Compounds — build-ready

| Compound       | Spec                                                                                       | Notes                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| ListRow        | [entity.md](./patterns/entity.md)                                                          | Four indicator channels, kind-icon variants per surface, recently-classified accent.                      |
| CalendarPicker | [calendar-picker.md](./patterns/calendar-picker.md)                                        | Hosted in App Settings / Story Settings / Wizard. Spec covers all three host adaptations + swap warnings. |
| JSONViewer     | [data.md → Raw JSON viewer](./patterns/data.md#raw-json-viewer--shared-modal-pattern)      | Modal-shaped read-out.                                                                                    |
| Importer       | [data.md → Import counterparts](./patterns/data.md#import-counterparts--file-based--vault) | File picker + Vault picker.                                                                               |

### Compounds — needs design

| Compound    | Surfaces                                                         | Open question                                                                                                                     |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| EntryCard   | Reader composer narrative                                        | Variable-height entries, expandable reasoning body, scroll-anchor on above-viewport mutations. Non-trivial.                       |
| StoryCard   | Story List grid                                                  | Title + blurb (3-line) + favorite star + overflow menu — borderline whether the wireframe is enough.                              |
| DeltaLogRow | History tabs across World / Plot / future global delta-log       | Field-path strings, op label, change-summary text. Different shape from entity rows.                                              |
| Toolbar     | List-pane tops on World / Plot / Story List / Reader Browse rail | Search + filter chips + sort + ⓘ + kind-selector. Cross-surface ordering, overflow behavior.                                      |
| TagInput    | Story tags, entity tags                                          | Concrete instance of Autocomplete-with-create — likely a config rather than a separate compound. Resolve once Autocomplete lands. |

## Layout shells

Top-level layout primitives.

### Shells — build-ready

| Shell              | Spec                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| MasterDetailLayout | [collapse.md](./foundations/mobile/collapse.md), [layout.md](./foundations/mobile/layout.md) |

### Shells — needs design

| Shell         | Question                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ScreenShell   | Header + body + optional save-bar footer. Does every screen route through one shell or compose ad-hoc? Header contract (title / back / overflow).      |
| ListPane      | Toolbar + list + EmptyState + footer +New as one component vs ad-hoc with sub-primitives. Reusability vs coupling trade-off — five surfaces ride this. |
| DetailPane    | Header + TabBar + tab body + SaveBar. Tab body shape is per-kind; what's the shared shell + slot contract?                                             |
| ComposerShell | Reader-composer's idiosyncratic layout. Likely all-locality; no extracted shell. Confirm during reader-composer build pass.                            |
