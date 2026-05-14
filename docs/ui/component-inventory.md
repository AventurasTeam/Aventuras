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
Chip, Dialog, EmptyState, Heading, Icon, IconAction, InlineEditableName,
Input, Popover, Select, Sheet, Skeleton, Spinner, Switch, SwitchVisual,
Tabs, Tag, Textarea, Text, Toast. Plus the `NativeOnlyAnimatedView`
utility wrapper.

### Primitives — build-ready

_Empty — every build-ready primitive has shipped._

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

| Compound               | Folder                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CalendarPicker         | `components/compounds/` | Tier-adapted Select dropdown (rich two-line rows + `Manage in Vault →` tail) paired with an always-visible summary panel. Hosts: App Settings / Story Settings / Wizard. Layout `stacked` (default) vs `side-by-side`. Swap-warning AlertDialog (W1 / W2 / W3) intentionally out of scope — ships as a separate composition layer.                                                                                                                                                                                                                                                                                                            |
| CollisionListRow       | `components/compounds/` | Wraps shipped `ListRow` with a warn-tinted below-row collision strip carrying a `⚠ Collides with <other-name>` link and a `Resolve →` button. Strip is a sibling element outside the row's tap surface — own tap targets for link + button. World list-renderer's only call site at v1; pan-domain by contract so any future row-conditional warn extension can reuse the shape. Spec: [2026-05-13-collision-resolve-design.md](../explorations/2026-05-13-collision-resolve-design.md).                                                                                                                                                      |
| CollisionResolveDialog | `components/compounds/` | Two-side collision resolution modal (Merge / Rename / Keep as distinct) for entity rows carrying `name_collision_flag`. Three body modes inline; merge body owns canonical pick + per-field radio + tag-deselect chips + relations summary; rename + keep bodies stateless or near-stateless. Pure View; Promise-driven `onResolve` driver wired by World consumer. Spec: [2026-05-13-collision-resolve-design.md](../explorations/2026-05-13-collision-resolve-design.md); resolution-write drivers pending — see [followups](../followups.md).                                                                                              |
| DeltaLogRow            | `components/compounds/` | History-tab row across World, Plot, and the future global delta-log surface. Renders one `deltas` entry: op, target, field path, pre-rendered diff summary, source. Spec: [delta-log-row.md](./patterns/delta-log-row.md).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| EmbedderDownloadDialog | `components/compounds/` | Three-payload install workflow modal (curated catalog / HF id / custom file import). Single canonical component invoked from Onboarding Step 4, App Settings · Embedding models · Add model, and Story Settings · Memory · Switch embedder. Pure View + reducer-driven container; ships with a stub driver. Real platform drivers wired per consumer; HF-id and custom-import driver effects pending — see [followups](../followups.md). Spec: [embedder-download.md](./patterns/embedder-download.md).                                                                                                                                       |
| EntityKindIcon         | `components/entity/`    | 22×22 box, Lucide glyph centered (User / MapPin / Package / Flag). Color inherits via `TextClassContext`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| EntryCard              | `components/compounds/` | Reader-composer narrative row. Renders all five entry kinds (`user`, `ai`, `opening`, `system`, `streaming`) as full-width bubbles with kind-keyed styling, conditional reasoning body, in-place edit, muted world-time footer. Spec: [entry-card.md](./patterns/entry-card.md).                                                                                                                                                                                                                                                                                                                                                              |
| FormRow                | `components/compounds/` | Container-keyed stacked-vs-2-col layout (label / hint / error / required slot). Library-agnostic — caller pipes the error string.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GenerationStatusPill   | `components/compounds/` | Top-bar generation status pill (universal in-story chrome per [`principles.md → Universal in-story chrome`](./principles.md#universal-in-story-chrome)). Owns the priority machine (active generation > sticky error > hidden), maps phase + error enums to copy, renders tier-aware (icon-only on phone), and owns the click-to-cancel Popover for the active variant. Error variant taps fire `onErrorTap(code)` for the consumer to route. Spec: [2026-05-13-status-pill-design.md](../explorations/2026-05-13-status-pill-design.md); pipeline orchestrator + memory error observation wiring pending — see [followups](../followups.md). |
| ImporterMenu           | `components/compounds/` | Trigger button + popover menu shell for `+ New X ▾` / `+ Add Y ▾` / `Import …` affordances. Renders only the menu chrome (label, options, disabled-reason); per-option actions are caller-supplied.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| JSONViewer             | `components/compounds/` | Tier-adapted Sheet (right drawer ≥ tablet, bottom sheet on phone) carrying `Raw JSON · <name>` header + Copy + ×, monospace pretty-printed body, disabled `Edit raw — coming later` footer. Read-only in v1.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ListRow                | `components/compounds/` | Pan-domain row carrying four indicator channels: lead-badge (slot), status-pill (slot), scene-presence (typed left-edge stripe), recently-classified (typed background-tint enum).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| SaveBar                | `components/compounds/` | Save-session footer — dirty-note left, Discard / Save right. Bg derived from `--warning` at 12% via overlay-View (cross-platform). `⌘/Ctrl-S` shortcut on web only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| StoryCard              | `components/compounds/` | Story List grid card. Single consumer; visual shape pinned in [story-list.md](./screens/story-list/story-list.md#story-card--text-first). Typed compound contract plus favorite-star visibility deviation from icon-actions. Spec: [story-card.md](./patterns/story-card.md).                                                                                                                                                                                                                                                                                                                                                                 |
| SwitchRow              | `components/compounds/` | Label + description + toggle, three-peer row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| TagInput               | `components/compounds/` | Multi-value, iterative tag entry. Composes Tag + Input primitives into a bordered surface accumulating committed tags as removable chips alongside inline typing. Spec: [forms.md → TagInput pattern](./patterns/forms.md#taginput-pattern).                                                                                                                                                                                                                                                                                                                                                                                                  |
| Toolbar                | `components/compounds/` | List-pane chrome compound: search, filter chips, conditional sort, cross-tier overflow rule that wraps cleanly from desktop single-row to narrow stacked-rows. Spec: [toolbar.md](./patterns/toolbar.md).                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Compounds — build-ready

_Empty — every build-ready compound has shipped._

### Compounds — needs design

| Compound | Surfaces                                            | Open question                                                                                                                                                                                                                                                                                                                    |
| -------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Importer | World / Plot per-row, Vault calendars, Story import | Full picker wrapper around `ImporterMenu` — file dialog (web `<input>` / native `expo-document-picker`), paste flow, zod-validated parse, error display, future Vault picker. Action surfaces per host differ enough that the wrapper shape needs a design pass before scaffolding. Deferred until more import groundwork lands. |

## Layout shells

Top-level layout primitives.

### Shells — shipped

| Shell       | Folder               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ScreenShell | `components/shells/` | Chrome wrapper — variant-driven (`app-root` / `app` / `in-story`). Owns left slot (Logo vs ← Return), variant-derived right cluster, token-progress strip (always rendered on `in-story` for layout stability), banner stack, and tier-aware reshuffle of reader chip cluster via `useTier()`. Page fills slots for title / status / extras. Spec: [2026-05-14-shells-design.md → ScreenShell](../explorations/2026-05-14-shells-design.md#shell-1--screenshell). |

### Shells — build-ready

| Shell              | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MasterDetailLayout | [collapse.md](./foundations/mobile/collapse.md), [layout.md](./foundations/mobile/layout.md)                                                                                                                                                                                                                                                                                                                                          |
| EntityListPane     | Master list pane for World + Plot. Toolbar + virtualized list + EmptyState. Kind selector row carries the minimalist `[+]` icon-action (replaces the prior footer `+ New <kind>` cell). Spec: [2026-05-14-shells-design.md → EntityListPane](../explorations/2026-05-14-shells-design.md#shell-2--entitylistpane). Story List grid / Browse rail / settings rails compose ad-hoc with the underlying patterns rather than this shell. |
| DetailPane         | Master detail pane for World + Plot. Head (kind-breadcrumb + nameSlot + badges + ⋯) + tabs strip + scrollable body + optional SaveBar slot. Tab composition is per-kind, hand-written by each detail-pane consumer. Depends on InlineEditableName primitive. Spec: [2026-05-14-shells-design.md → DetailPane](../explorations/2026-05-14-shells-design.md#shell-3--detailpane).                                                       |

### Shells — needs design

_Empty — every shell question is resolved. Reader-composer's
chrome stays all-locality (no extracted shell); revisited at the
reader-composer build pass only if cross-surface signal surfaces._
