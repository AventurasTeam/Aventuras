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

Accordion, AlertDialog, Autocomplete, Avatar, Button, Checkbox,
Chip, EmptyState, Heading, Icon, IconAction, Input, Popover, Select,
Sheet, Skeleton, Spinner, Switch, SwitchVisual, Tabs, Tag, Textarea,
Text, Toast. Plus the `NativeOnlyAnimatedView` utility wrapper.

### Primitives — build-ready

_Empty — every primitive on the v1 build queue has shipped._

### Primitives — needs design

_Empty — all primitives have specs._ As new primitive needs surface,
add rows here with the baseline column naming the react-native-reusables
source per [components.md → Sourcing](./components.md#sourcing--react-native-reusables-as-baseline)
(or `_none_` for from-scratch).

### Primitives — deferred

_Empty — no primitives currently blocked on a design decision._

Virtualization library choice is resolved (`@tanstack/react-virtual`
on web, `FlatList` on native) and validated inside Autocomplete's
suggestion list. A standalone `VirtualList` primitive isn't built:
the second consumer with materially different requirements
(reader narrative, with scroll-anchoring on above-viewport
mutations) will inform whether one shared primitive makes sense or
whether `NarrativeStream` should own its own virtualized shape.

## Compounds

Peer compositions of primitives. Domain-agnostic and
multi-domain compounds live in `components/compounds/`;
single-domain compounds live in `components/<domain>/`. Folder
column distinguishes per-row. See
[components.md → Directory layout](./components.md#directory-layout)
for the rule.

### Compounds — shipped

| Compound  | Folder                  | Notes                                         |
| --------- | ----------------------- | --------------------------------------------- |
| SwitchRow | `components/compounds/` | Label + description + toggle, three-peer row. |

### Compounds — build-ready

| Compound       | Folder                  | Spec                                                                                       | Notes                                                                                                                                                           |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FormRow        | `components/compounds/` | [forms.md → Form rows](./patterns/forms.md#form-rows--stacked-on-narrow-container)         | Container-keyed stacked-on-narrow wrapper around label + control + hint. Adopting consumers handles half the work.                                              |
| ListRow        | `components/compounds/` | [entity.md](./patterns/entity.md)                                                          | Four indicator channels, kind-icon variants per surface, recently-classified accent. Pan-domain consumer.                                                       |
| KindIcon       | `components/entity/`    | [iconography.md → Entity kind glyphs](./foundations/iconography.md#entity-kind-glyphs)     | 22×22 box, glyph from the canonical entity-kind table. Single-domain (entity) — was a primitive candidate, reclassified per the directory-layout decision rule. |
| SaveBar        | `components/compounds/` | [save-sessions.md → Save bar](./patterns/save-sessions.md#save-bar--the-visible-ui)        | Composition; pairs with the `useNavGuard` hook (lives in `hooks/`, not here).                                                                                   |
| CalendarPicker | `components/compounds/` | [calendar-picker.md](./patterns/calendar-picker.md)                                        | Hosted in App Settings / Story Settings / Wizard. Spec covers all three host adaptations + swap warnings.                                                       |
| JSONViewer     | `components/compounds/` | [data.md → Raw JSON viewer](./patterns/data.md#raw-json-viewer--shared-modal-pattern)      | Modal-shaped read-out.                                                                                                                                          |
| Importer       | `components/compounds/` | [data.md → Import counterparts](./patterns/data.md#import-counterparts--file-based--vault) | File picker + Vault picker.                                                                                                                                     |

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
