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
Chip, Dialog, EmptyState, Heading, Icon, IconAction, Input, Popover, Select,
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

| Compound               | Folder                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CalendarPicker         | `components/compounds/` | Tier-adapted Select dropdown (rich two-line rows + `Manage in Vault →` tail) paired with an always-visible summary panel. Hosts: App Settings / Story Settings / Wizard. Layout `stacked` (default) vs `side-by-side`. Swap-warning AlertDialog (W1 / W2 / W3) intentionally out of scope — ships as a separate composition layer.                                                                                                                                                                      |
| DeltaLogRow            | `components/compounds/` | History-tab row across World, Plot, and the future global delta-log surface. Renders one `deltas` entry: op, target, field path, pre-rendered diff summary, source. Spec: [delta-log-row.md](./patterns/delta-log-row.md).                                                                                                                                                                                                                                                                              |
| EmbedderDownloadDialog | `components/compounds/` | Three-payload install workflow modal (curated catalog / HF id / custom file import). Single canonical component invoked from Onboarding Step 4, App Settings · Embedding models · Add model, and Story Settings · Memory · Switch embedder. Pure View + reducer-driven container; ships with a stub driver. Real platform drivers wired per consumer; HF-id and custom-import driver effects pending — see [followups](../followups.md). Spec: [embedder-download.md](./patterns/embedder-download.md). |
| EntityKindIcon         | `components/entity/`    | 22×22 box, Lucide glyph centered (User / MapPin / Package / Flag). Color inherits via `TextClassContext`.                                                                                                                                                                                                                                                                                                                                                                                               |
| EntryCard              | `components/compounds/` | Reader-composer narrative row. Renders all five entry kinds (`user`, `ai`, `opening`, `system`, `streaming`) as full-width bubbles with kind-keyed styling, conditional reasoning body, in-place edit, muted world-time footer. Spec: [entry-card.md](./patterns/entry-card.md).                                                                                                                                                                                                                        |
| FormRow                | `components/compounds/` | Container-keyed stacked-vs-2-col layout (label / hint / error / required slot). Library-agnostic — caller pipes the error string.                                                                                                                                                                                                                                                                                                                                                                       |
| ImporterMenu           | `components/compounds/` | Trigger button + popover menu shell for `+ New X ▾` / `+ Add Y ▾` / `Import …` affordances. Renders only the menu chrome (label, options, disabled-reason); per-option actions are caller-supplied.                                                                                                                                                                                                                                                                                                     |
| JSONViewer             | `components/compounds/` | Tier-adapted Sheet (right drawer ≥ tablet, bottom sheet on phone) carrying `Raw JSON · <name>` header + Copy + ×, monospace pretty-printed body, disabled `Edit raw — coming later` footer. Read-only in v1.                                                                                                                                                                                                                                                                                            |
| ListRow                | `components/compounds/` | Pan-domain row carrying four indicator channels: lead-badge (slot), status-pill (slot), scene-presence (typed left-edge stripe), recently-classified (typed background-tint enum). Below-row collision strip extension pending — see [Modifications pending](#modifications-pending).                                                                                                                                                                                                                   |
| SaveBar                | `components/compounds/` | Save-session footer — dirty-note left, Discard / Save right. Bg derived from `--warning` at 12% via overlay-View (cross-platform). `⌘/Ctrl-S` shortcut on web only.                                                                                                                                                                                                                                                                                                                                     |
| StoryCard              | `components/compounds/` | Story List grid card. Single consumer; visual shape pinned in [story-list.md](./screens/story-list/story-list.md#story-card--text-first). Typed compound contract plus favorite-star visibility deviation from icon-actions. Spec: [story-card.md](./patterns/story-card.md).                                                                                                                                                                                                                           |
| SwitchRow              | `components/compounds/` | Label + description + toggle, three-peer row.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| TagInput               | `components/compounds/` | Multi-value, iterative tag entry. Composes Tag + Input primitives into a bordered surface accumulating committed tags as removable chips alongside inline typing. Spec: [forms.md → TagInput pattern](./patterns/forms.md#taginput-pattern).                                                                                                                                                                                                                                                            |
| Toolbar                | `components/compounds/` | List-pane chrome compound: search, filter chips, conditional sort, cross-tier overflow rule that wraps cleanly from desktop single-row to narrow stacked-rows. Spec: [toolbar.md](./patterns/toolbar.md).                                                                                                                                                                                                                                                                                               |

### Compounds — build-ready

_Empty — every build-ready compound has shipped._

### Compounds — needs design

| Compound               | Surfaces                                                                                                                                                                                                   | Open question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CollisionResolveDialog | World entity rows (`name_collision_flag = true`)                                                                                                                                                           | Three-path resolution modal (Merge / Rename / Keep as distinct), each path swapping the dialog body shape. Merge carries a canonical-side picker plus a field-diff grid (only divergent fields shown). Spec lives in [`world.md → Collision review and entity merge`](./screens/world/world.md#collision-review-and-entity-merge); needs a design pass on the diff-grid contract and the three-body-mode shell before scaffolding.                                                                                                                                                                                                                                                                                                     |
| Importer               | World / Plot per-row, Vault calendars, Story import                                                                                                                                                        | Full picker wrapper around `ImporterMenu` — file dialog (web `<input>` / native `expo-document-picker`), paste flow, zod-validated parse, error display, future Vault picker. Action surfaces per host differ enough that the wrapper shape needs a design pass before scaffolding. Deferred until more import groundwork lands.                                                                                                                                                                                                                                                                                                                                                                                                       |
| StatusPill             | Reader top-bar, World, Plot, Story Settings, Chapter Timeline (universal in-story chrome per [`principles.md → Universal in-story chrome`](./principles.md#universal-in-story-chrome)); ListRow slot fills | No canonical component or spec today — only declared as universal in-story chrome behavior. Drives pipeline-phase labels (`reasoning…` / `generating narrative…` / `classifying…` / `closing chapter…`), idle-hide, click-to-cancel popover, and reader-composer's error-tinted variant (`Embedder offline — N rows pending` / `Classifier offline — retrieval coverage thinning`). Reader's "error-pill variant" copy references chrome that doesn't yet exist as a component. Needs a design pass to settle: contract (states + variants + slot for click target), where it lives (compound or moves into ListRow's status-pill slot type), and whether the error variant is a different render path or a state of the same machine. |

### Modifications pending

Contract extensions on already-shipped components that have a written spec and are waiting on implementation.

| Component | Modification                                                                                                                                                                                                                                                                                                                                                                     | Spec                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| ListRow   | Below-row "collision strip" extension — row-conditional inline strip (`⚠ Collides with <other-name>` link + `Resolve →` button), warn-tinted, rendered unconditionally on flagged rows. Fifth indicator channel beyond the existing four; structural (below-row appendage) rather than slotted. World-flagged rows only at v1; contract still belongs on the pan-domain ListRow. | [world.md → Collision review and entity merge](./screens/world/world.md#collision-review-and-entity-merge) |

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
