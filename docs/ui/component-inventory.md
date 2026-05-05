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

- **shipped** — component file + story exist in the folder dictated
  by [components.md → Directory layout](./components.md#directory-layout).
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

Accordion, AlertDialog, Avatar, Button, Checkbox, Chip, Heading,
Icon, Input, Popover, Select, Sheet, Skeleton, Spinner, Switch,
SwitchVisual, Tabs, Tag, Textarea, Text, Toast. Plus the
`NativeOnlyAnimatedView` utility wrapper.

### Primitives — build-ready

| Primitive    | Spec                                                                                                    | Notes                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Autocomplete | [forms.md → Autocomplete-with-create primitive](./patterns/forms.md#autocomplete-with-create-primitive) | Primary v1 consumer: tag inputs on stories + entities.                   |
| EmptyState   | [lists.md → Empty list / table state](./patterns/lists.md#empty-list--table-state)                      | Centered placeholder; title + sub-text contract per kind.                |
| IconAction   | [icon-actions.md](./patterns/icon-actions.md)                                                           | Always-visible-muted, hover-brightens. Used on every row-shaped surface. |

### Primitives — needs design

_Empty — all primitives have specs._ As new primitive needs surface,
add rows here with the baseline column naming the react-native-reusables
source per [components.md → Sourcing](./components.md#sourcing--react-native-reusables-as-baseline)
(or `_none_` for from-scratch).

### Primitives — deferred

| Primitive   | Blocker                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VirtualList | Library choice — `react-window` vs `@tanstack/react-virtual` not picked. RN-Web compat untested. Tracked in [followups.md → Virtual-list library choice](../followups.md#virtual-list-library-choice). |

## Generic compounds

Domain-agnostic peer compositions of primitives. Live in
`components/compounds/` per
[components.md → Directory layout](./components.md#directory-layout).

### Generic compounds — shipped

SwitchRow.

### Generic compounds — build-ready

| Compound | Spec                                                                               | Notes                                                                                                              |
| -------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| FormRow  | [forms.md → Form rows](./patterns/forms.md#form-rows--stacked-on-narrow-container) | Container-keyed stacked-on-narrow wrapper around label + control + hint. Adopting consumers handles half the work. |

## Compound app components

Domain-shaped composites built from primitives. Directory placement
follows [components.md → Directory layout](./components.md#directory-layout):
single-domain compounds in `components/<domain>/`, cross-domain
compounds in `components/app/`.

### Compounds — build-ready

| Compound       | Folder               | Spec                                                                                       | Notes                                                                                                                                                   |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ListRow        | `components/app/`    | [entity.md](./patterns/entity.md)                                                          | Four indicator channels, kind-icon variants per surface, recently-classified accent. Pan-domain consumer.                                               |
| KindIcon       | `components/entity/` | [iconography.md → Entity kind glyphs](./foundations/iconography.md#entity-kind-glyphs)     | 22×22 box, glyph from the canonical entity-kind table. Domain-coupled — was a primitive candidate, reclassified per the directory-layout decision rule. |
| SaveBar        | `components/app/`    | [save-sessions.md → Save bar](./patterns/save-sessions.md#save-bar--the-visible-ui)        | Composition; pairs with the `useNavGuard` hook (lives in `hooks/`, not here).                                                                           |
| CalendarPicker | `components/app/`    | [calendar-picker.md](./patterns/calendar-picker.md)                                        | Hosted in App Settings / Story Settings / Wizard. Spec covers all three host adaptations + swap warnings.                                               |
| JSONViewer     | `components/app/`    | [data.md → Raw JSON viewer](./patterns/data.md#raw-json-viewer--shared-modal-pattern)      | Modal-shaped read-out.                                                                                                                                  |
| Importer       | `components/app/`    | [data.md → Import counterparts](./patterns/data.md#import-counterparts--file-based--vault) | File picker + Vault picker.                                                                                                                             |

### Compounds — needs design

| Compound    | Surfaces                                                         | Open question                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EntryCard   | Reader composer narrative                                        | Variable-height entries, expandable reasoning body, scroll-anchor on above-viewport mutations. Non-trivial.                                                                       |
| StoryCard   | Story List grid                                                  | Title + blurb (3-line) + favorite star + overflow menu — borderline whether the wireframe is enough.                                                                              |
| DeltaLogRow | History tabs across World / Plot / future global delta-log       | Field-path strings, op label, change-summary text. Different shape from entity rows.                                                                                              |
| Toolbar     | List-pane tops on World / Plot / Story List / Reader Browse rail | Search + filter chips + sort + ⓘ + kind-selector. Absorbs the previous SearchInput primitive (Input + scope tooltip + ⓘ help-popover). Cross-surface ordering, overflow behavior. |
| TagInput    | Story tags, entity tags                                          | Concrete instance of Autocomplete-with-create — likely a config rather than a separate compound. Resolve once Autocomplete lands.                                                 |

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
| DetailPane    | Header + Tabs + tab body + SaveBar. Tab body shape is per-kind; what's the shared shell + slot contract?                                               |
| ComposerShell | Reader-composer's idiosyncratic layout. Likely all-locality; no extracted shell. Confirm during reader-composer build pass.                            |
