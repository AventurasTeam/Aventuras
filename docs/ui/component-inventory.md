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

| Compound       | Folder                  | Notes                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CalendarPicker | `components/compounds/` | Tier-adapted Select dropdown (rich two-line rows + `Manage in Vault →` tail) paired with an always-visible summary panel. Hosts: App Settings / Story Settings / Wizard. Layout `stacked` (default) vs `side-by-side`. Swap-warning AlertDialog (W1 / W2 / W3) intentionally out of scope — ships as a separate composition layer. |
| EntityKindIcon | `components/entity/`    | 22×22 box, Lucide glyph centered (User / MapPin / Package / Flag). Color inherits via `TextClassContext`.                                                                                                                                                                                                                          |
| FormRow        | `components/compounds/` | Container-keyed stacked-vs-2-col layout (label / hint / error / required slot). Library-agnostic — caller pipes the error string.                                                                                                                                                                                                  |
| ImporterMenu   | `components/compounds/` | Trigger button + popover menu shell for `+ New X ▾` / `+ Add Y ▾` / `Import …` affordances. Renders only the menu chrome (label, options, disabled-reason); per-option actions are caller-supplied.                                                                                                                                |
| JSONViewer     | `components/compounds/` | Tier-adapted Sheet (right drawer ≥ tablet, bottom sheet on phone) carrying `Raw JSON · <name>` header + Copy + ×, monospace pretty-printed body, disabled `Edit raw — coming later` footer. Read-only in v1.                                                                                                                       |
| ListRow        | `components/compounds/` | Pan-domain row carrying four indicator channels: lead-badge (slot), status-pill (slot), scene-presence (typed left-edge stripe), recently-classified (typed background-tint enum).                                                                                                                                                 |
| SaveBar        | `components/compounds/` | Save-session footer — dirty-note left, Discard / Save right. Bg derived from `--warning` at 12% via overlay-View (cross-platform). `⌘/Ctrl-S` shortcut on web only.                                                                                                                                                                |
| SwitchRow      | `components/compounds/` | Label + description + toggle, three-peer row.                                                                                                                                                                                                                                                                                      |

### Compounds — build-ready

| Compound  | Folder                  | Spec                                                                |
| --------- | ----------------------- | ------------------------------------------------------------------- |
| EntryCard | `components/reader/`    | [entry-card.md](./patterns/entry-card.md)                           |
| StoryCard | `components/story/`     | [story-card.md](./patterns/story-card.md)                           |
| TagInput  | `components/compounds/` | [forms.md → TagInput pattern](./patterns/forms.md#taginput-pattern) |
| Toolbar   | `components/compounds/` | [toolbar.md](./patterns/toolbar.md)                                 |

### Compounds — needs design

| Compound    | Surfaces                                                   | Open question                                                                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DeltaLogRow | History tabs across World / Plot / future global delta-log | Field-path strings, op label, change-summary text. Different shape from entity rows.                                                                                                                                                                                                                                             |
| Importer    | World / Plot per-row, Vault calendars, Story import        | Full picker wrapper around `ImporterMenu` — file dialog (web `<input>` / native `expo-document-picker`), paste flow, zod-validated parse, error display, future Vault picker. Action surfaces per host differ enough that the wrapper shape needs a design pass before scaffolding. Deferred until more import groundwork lands. |

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
