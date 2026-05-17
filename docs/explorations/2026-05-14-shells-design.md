# Layout shells design — ScreenShell, EntityListPane, DetailPane

Resolves the four "Shells — needs design" rows in
[`component-inventory.md`](../ui/component-inventory.md): ScreenShell,
ListPane, DetailPane, ComposerShell. Three ship; one stays deferred.

[`MasterDetailLayout`](../ui/foundations/mobile/collapse.md) is
already build-ready as the responsive 2-pane frame and isn't
re-litigated here — it's the layer the shells below compose into,
not a peer.

## Shell decomposition

The four shell concerns slot together as nested layers:

```
ScreenShell                         (chrome wrapper — top bar, banners, body)
  └── MasterDetailLayout            (responsive 2-pane frame, build-ready)
        ├── EntityListPane          (left pane — master list)
        └── DetailPane              (right pane — selected detail)
              └── SaveBar           (dirty-state footer, already shipped)
```

[plot.md → Implementation reuse](../ui/screens/plot/plot.md#implementation-reuse)
previously named a single `MasterDetailShell` that conflated
ScreenShell + MasterDetailLayout. That reference gets rewritten to
the clearer decomposition above.

---

## Shell 1 — ScreenShell

**Verdict — ship.**

The top-bar contract in
[`principles.md → Top-bar design rule`](../ui/principles.md#top-bar-design-rule)
already pins every load-bearing rule (Logo-vs-Return on the left,
variant-derived right cluster, in-story status pill + token strip,
settings-icon scope, banner positioning). ScreenShell is the code
embodiment of those rules — variant-driven chrome with typed slots
for the page-specific content (breadcrumb title, status indicators,
reader-only chip cluster).

Onboarding and Wizard stay **out of scope** — they carry their own
minimal chrome (Onboarding is chromeless; Wizard renders
`[← Cancel]` + step indicator). Neither is a ScreenShell consumer.

### Consumer table

| Variant    | Surfaces                              | Left         | Right cluster                  |
| ---------- | ------------------------------------- | ------------ | ------------------------------ |
| `app-root` | Story List, Vault home                | Logo         | `[⚙][⚲]`                       |
| `app`      | App Settings                          | `[←]` Return | `[⚲]` (⚙ omitted — self-ref)   |
| `in-story` | Reader, World, Plot, Chapter Timeline | `[←]` Return | `[statusSlot][⛭][⚲]`           |
| `in-story` | Story Settings                        | `[←]` Return | `[statusSlot][⚲]` (⛭ self-ref) |

Self-reference omission is driven by a `hideSelfReferentialIcon`
flag — Story Settings and App Settings opt in. Cheaper than adding
two more variant enum values; readable at the callsite.

### ScreenShell API

```ts
type ScreenShellProps = {
  variant: 'app-root' | 'app' | 'in-story'

  title?: ReactNode // page-provided breadcrumb content.
  // Consumers should render via a <BreadcrumbTitle>
  // compound to get tappable parent-segment behavior
  // per principles.md → Breadcrumb tappability.

  centerExtras?: ReactNode // tier-aware reader-only chips.
  //   desktop / tablet → inline beside title
  //   phone            → chip strip below progress strip
  // Shell handles the reshuffle via useTier().

  mobileChipAction?: ReactNode // phone-only, right-anchored in the chip strip.
  // Reader's [☰ Browse] trigger; hidden ≥ 640 px.

  statusSlot?: ReactNode // in-story only. Composes one or more status
  // indicators (GenerationStatusPill, World review
  // pill, future). Shell renders the slot in a
  // flex-row container; consumer arranges contents.

  chapterProgress?: number // in-story only. 0–100 drives the token-progress
  // strip. Shell owns the strip rendering; consumer
  // passes the number from pipeline orchestrator state.

  banners?: ReactNode // banner stack above the bar. AI-not-configured,
  // profile-errors per principles.md; future banners
  // compose here. Shell positions the slot.

  hideSelfReferentialIcon?: boolean // Story Settings → suppresses ⛭.
  // App Settings   → suppresses ⚙.

  children: ReactNode // body content
}
```

### ScreenShell — shell-owned

- **Left slot affordance** — Logo on `app-root`, `[←]` Return
  (stack-aware) elsewhere. Derived from `variant`, not a prop.
- **Right cluster shape** — order and contents derived from
  `variant` + `hideSelfReferentialIcon` per the consumer table.
- **Token-progress strip** — rendered immediately below the bar
  when `variant === 'in-story'` and `chapterProgress != null`.
  Open question: whether the strip is always rendered for layout
  stability (with 0% visual) or hidden until the first chapter
  starts. See [Open questions](#open-questions).
- **Banner stack positioning** — above the bar, multi-banner
  with priority order per
  [principles.md → Persistent app-level banners](../ui/principles.md#persistent-app-level-banners).
- **`centerExtras` tier reshuffle** — inline beside title on
  desktop / tablet; migrates to a chip strip below the progress
  strip on phone, with `mobileChipAction` right-anchored via
  `margin-left: auto` per the
  [navigation.md chip-strip layout convention](../ui/foundations/mobile/navigation.md#reader-chip-strip-phone-only).
- **Settings-icon scope** — ⚙ vs ⛭ derived from variant per the
  [principles.md rule](../ui/principles.md#settings-icon-scope).

### ScreenShell — does NOT own

- **Breadcrumb content** — page fills `title`. World renders a
  BreadcrumbTitle with its own segments (story title plus the
  screen name); the shell positions the slot but doesn't decide
  what's in it.
- **Master-detail sub-header** (`Characters / Kael` etc.) — lives
  inside `MasterDetailLayout`, not in the top bar.
- **Status pill state and wiring** — consumer wires the pill from
  pipeline orchestrator state and passes it via `statusSlot`.
- **`centerExtras` content** — Reader composes its chapter / time
  / branch chips and passes them as a single ReactNode. Other
  surfaces pass nothing.
- **Body composition** — `children` is consumer territory.

---

## Shell 2 — EntityListPane

**Verdict — ship, narrowly scoped.**

The inventory's "ListPane" framing called out five surfaces. The
genuinely shared shape ("Toolbar + virtualized list + EmptyState +
+New affordance") fits **two consumers only**: World list pane and
Plot list pane. Other "consumers" share fragments (Toolbar pattern,
virtualization, EmptyState) but not the assembled shell — Story
List uses a grid body and puts `[+ New story]` in the toolbar
header; Reader Browse rail has no "+New" (importer-driven) and is
chrome-owned by the reader; settings rails are nav-lists with no
toolbar at all. Those surfaces compose ad-hoc with the underlying
patterns.

### Layout

```
┌─────────────────────────────────────┐
│ [Characters ▾]                 [+]  │ ← kind selector + minimalist add
│ ⌕ Search                            │
│ [All][Active][Retired]   sort: ▾    │ ← filter chips (+ optional sort)
├─────────────────────────────────────┤
│                                     │
│ virtualized list                    │
│                                     │
└─────────────────────────────────────┘
```

The `[+]` add affordance is an **icon-action** (per
[patterns/icon-actions.md](../ui/patterns/icon-actions.md) —
always-visible-muted + hover-brighten) right-anchored on the kind
selector row. Tooltip and accessibility label come from
`addAction.label`. Moves the "+ New" out of the footer and saves a
row of vertical space; the affordance is always-visible without
scrolling to the bottom.

**EmptyState gains a labeled call-to-action** to compensate for the
icon-only `[+]` being too subtle for an empty pane. Consumer
renders something like `"No characters yet. [+ Add your first one]"`
inside the `emptyState` slot.

### EntityListPane API

```ts
type EntityListPaneProps = {
  kindSelector?: ReactNode // dropdown trigger ("Characters ▾", "Threads ▾").
  // World uses Select; Plot uses Tabs.Segment for the
  // 2-way Threads / Happenings toggle. Optional —
  // a future single-kind list could omit it.

  addAction: {
    // right-anchored on the kind-selector row.
    label: string // drives tooltip + a11y label ("New character")
    onPress: () => void // visual: minimalist [+] icon-action button
  }

  search: ToolbarSearchProps // search state — passes through to Toolbar pattern

  filterChips: ReactNode // chip strip — consumer renders chips with state.
  // Active chip drives the addAction.label upstream.

  sortControl?: ReactNode // optional sort dropdown (lore list uses this).

  children: ReactNode // the virtualized list — consumer renders rows.
  // Shell wraps in scroll container with width pin.

  emptyState: ReactNode // shown when isEmpty. Required — every consumer must
  // have a designed empty state, no blank pane fallback.
  isEmpty: boolean // consumer derives; shell switches list / empty render.
}
```

### EntityListPane — shell-owned

- **Kind-selector row chrome** — slot on the left, `[+]` icon-action
  on the right; consistent height token across consumers.
- **Toolbar composition** — search + filter chips + optional sort
  per [patterns/toolbar.md](../ui/patterns/toolbar.md). Shell wires
  the search slot; consumer renders filter chips and optional sort.
- **List / EmptyState switch** — when `isEmpty`, render the
  EmptyState slot in place of the list. Otherwise render children.
- **Width pin** — desktop/tablet master-detail width (~340 px per
  [world.md → Layout](../ui/screens/world/world.md#layout)).
  Phone tier collapse is `MasterDetailLayout` territory.

### EntityListPane — does NOT own

- **Row rendering** — consumer's virtualization stack
  (`@tanstack/react-virtual` on web, `FlatList` on native — picked
  & validated in Autocomplete 2026-05-06; reader-narrative
  scroll-anchoring still open per
  [followups → Reader narrative scroll-anchoring on prepend](../ui/screens/reader-composer/reader-composer.md#anchor-preservation-under-shifts)).
- **Active-filter → addAction.label coupling** — consumer derives
  the label and passes it. Shell-side derivation would force the
  shell to know about kind enums, which is a leak.
- **Row glyphs, badges, and per-kind composition** — every kind
  renders its own row component (CharacterRow, LocationRow, ThreadRow,
  HappeningRow, etc.).

### Non-consumers — composition recipe

| Surface            | Composes via                                                               |
| ------------------ | -------------------------------------------------------------------------- |
| Story List         | Toolbar pattern + grid of StoryCards + `[+ New story]` in toolbar header   |
| Reader Browse rail | Toolbar pattern + virtualized list, no `+New` footer (importer-driven)     |
| Settings rails     | Nav list with uppercase section headers; no toolbar / empty state / `+New` |
| Chapter Timeline   | Card stack, not list pane                                                  |

---

## Shell 3 — DetailPane

**Verdict — ship.**

[plot.md → Implementation reuse](../ui/screens/plot/plot.md#implementation-reuse)
explicitly assumes a shared `DetailPane` — breadcrumb, name + ⋯
menu, tab strip, scrollable content. World and Plot share the head
shape 100%; the per-kind variation is in tab composition and tab
body content (consumer-rendered).

Settings details (Story Settings, App Settings) are a different
shape — no internal head, no internal tabs (the left rail of the
parent layout IS the navigation). They compose ad-hoc on top of
their own settings rail; not DetailPane consumers.

### DetailPane API

```ts
type DetailPaneProps = {
  // Head
  kindIcon: ReactNode // small kind glyph (◇ thread, ☺ character, etc.)
  kindName: string // "character" | "location" | "item" | "faction"
  // | "lore" | "thread" | "happening"

  nameSlot: ReactNode // inline-editable name compound — consumer renders.
  // See InlineEditableName dependency below.

  badges?: ReactNode // recently-classified badge, non-default
  // injection-mode chip, draft chip — consumer composes.

  overflowMenu: ReactNode // ⋯ menu content (Set as lead, Export entity as JSON,
  // View raw JSON, Delete entity, etc.).

  // Tabs strip
  tabs: ReactNode // Tabs primitive strip — consumer renders per-kind
  // tab labels per patterns/tabs.md.

  // Body
  children: ReactNode // selected tab content. Shell owns the scroll
  // container; consumer renders the per-kind body.

  // Save bar
  saveBar?: ReactNode // optional. Consumer passes the already-shipped
  // <SaveBar> compound when dirty.
}
```

### DetailPane — shell-owned

- **Head layout** — kind-breadcrumb row, then name row with
  `nameSlot` left, `badges` middle, `overflowMenu` right.
  Horizontal separator below.
- **Tabs strip position** — immediately below the head.
- **Body scroll container** — `flex-1`, vertical scroll, padding
  tokens per [spacing.md](../ui/foundations/spacing.md).
- **SaveBar position** — sticky at bottom when consumer passes one.

### DetailPane — does NOT own

- **Name editing logic** — `nameSlot` is consumer-rendered; the
  pencil glyph, hover-to-reveal, escape-cancels, blur-saves
  behavior is the InlineEditableName compound's concern.
- **Tab composition** — explicitly per-kind hand-written per
  [world.md → Tabs](../ui/screens/world/world.md#tabs--per-kind-composition).
  "Schema is the validation contract; UI owns layout."
- **Per-tab body content** — `children` is consumer's territory.
- **Save-session state** — consumer wires dirty state and decides
  when to mount SaveBar; shell only positions the slot.
- **Cross-tier collapse** — that's `MasterDetailLayout` territory.

### Dependency — InlineEditableName

Doesn't exist yet in inventory or patterns. The "Entity name
(inline-editable with pencil)" affordance described in
[world.md → Detail head structure](../ui/screens/world/world.md#detail-head-structure)
is currently a per-screen implementation hand-wave. DetailPane
takes `nameSlot: ReactNode`, so it's not blocked, but every
DetailPane consumer (World + Plot) needs an InlineEditableName to
fill the slot.

Lands as a new **build-ready** primitive — wraps Input with a
pencil affordance, blur-save / Escape-cancel semantics, hover-to-
reveal pencil on desktop, always-visible pencil on touch tiers.
Spec lives in `patterns/forms.md` (or a new `inline-editable.md`)
when its own build pass starts.

---

## Shell 4 — ComposerShell

**Verdict — deferred (no change from inventory).**

The inventory's question (`Reader-composer's idiosyncratic layout.
Likely all-locality; no extracted shell. Confirm during reader-
composer build pass.`) is the correct framing. The reader-composer
has a unique layout that's unlikely to share with anything else;
forcing a shell shape now risks designing for non-existent
consumers.

Revisit at the reader-composer build pass — by which point the
reader's needs will be empirically clear, and the question "is
there a shell here?" will be a small ad-hoc decision rather than
an up-front design pass.

---

## Open questions

### Token-progress strip visibility before the first chapter

[navigation.md → Reader chip strip](../ui/foundations/mobile/navigation.md#reader-chip-strip-phone-only)
specifies that the **chip strip** is hidden when a story has no
chapters yet. The **progress strip** is shown in all in-story
wireframes but the no-chapters case isn't explicitly addressed.

Two options:

- **Always rendered, empty (0% visual)** — layout stability across
  the chapter-start transition; user sees the affordance the
  moment a chapter begins.
- **Hidden until first chapter starts** — matches the chip-strip
  rule; saves vertical space on brand-new stories.

Lean: always rendered. The strip is ~3 px tall; layout stability
beats a sliver of vertical-space recovery. Lands when ScreenShell
ships and the first in-story screen wires it.

### Multi-pill composition in `statusSlot`

The
[GenerationStatusPill followup](../ui/patterns/generation-status-pill.md#open-items)
already names a second pill — `⚠ N need review` for World — that
sits beside the generation pill. With statusSlot as a single
ReactNode, the consumer composes both pills in a flex-row before
passing to the shell. Open: whether the World review pill is a
new compound or composes existing primitives. Tracked in the
GenerationStatusPill followup; not a ScreenShell concern beyond
"slot accepts arbitrary ReactNode content."

### `InlineEditableName` compound

Required by DetailPane's nameSlot; no existing inventory entry.
Lands as a new build-ready row. Spec gets written when its own
build pass starts. DetailPane is not blocked on this — the slot is
ReactNode — but every DetailPane consumer will need it.

---

## Integration plan

### `docs/ui/component-inventory.md`

- **Drop** three rows from `Shells — needs design`: ScreenShell,
  ListPane, DetailPane. Leaves only **ComposerShell** in that table
  (confirmed deferred).
- **Add** three rows to `Shells — build-ready` (alongside
  MasterDetailLayout):
  - ScreenShell — spec at this exploration doc.
  - EntityListPane — spec at this doc.
  - DetailPane — spec at this doc.
- **Add** InlineEditableName to `Primitives — build-ready` (or
  Compounds — build-ready, depending on classification). Spec
  reference: world.md detail head + this doc's Dependency section.

### `docs/ui/screens/world/world.md`

- Update the `## Layout` ASCII wireframe: move `+ New <kind>` out
  of the footer cell to the kind-selector row as a minimalist
  `[+]` icon-action.
- Add a one-line note in the `## List pane` section explaining the
  position change (or fold into the layout caption).

### `docs/ui/screens/plot/plot.md`

- Update the `## Layout` ASCII wireframe: same `+ New <kind>`
  position change as World.
- Rewrite the `## Implementation reuse` section:
  - Drop the conflated `MasterDetailShell` reference.
  - Document the clean decomposition: ScreenShell (chrome) →
    MasterDetailLayout (2-pane frame) → EntityListPane +
    DetailPane → SaveBar.
  - Rename `ListPane` references to `EntityListPane`.

### `docs/followups.md`

No new entries from this design pass (all open questions either
fold into existing followups or get answered at first-consumer
implementation). The
[GenerationStatusPill followup](../ui/patterns/generation-status-pill.md#open-items)
already covers the World review pill case that statusSlot needs to
handle.

### Wireframes (HTML)

- **`docs/ui/screens/world/world.html`** — kind-selector row gets
  the `[+]` icon-action trigger (with the existing import-counterparts
  popover repositioned to drop below it); list-pane footer markup
  removed; empty-state slot grows a labeled CTA inline.
- **`docs/ui/screens/plot/plot.html`** — same shape, with side-
  conditional `threads-only` / `happenings-only` triggers so the
  active segment's tooltip and CTA copy track the segment toggle.

---

## Adversarial pass — findings

- **Load-bearing assumption** — that consumer-counts are stable.
  Verified: 100% head-shape match between World and Plot per
  plot.md; statusSlot handles multi-pill via ReactNode composition;
  centerExtras is reader-only across all in-story surfaces;
  chapterProgress is single-sourced from orchestrator state.
- **Edge cases** —
  - Empty list on World/Plot → EntityListPane EmptyState slot with
    labeled CTA. ✅
  - Empty story (no chapters) → progress strip behavior is the one
    open question; flagged above. ⚠
  - Phone tier transition → shell uses `useTier()` for centerExtras
    reshuffle. ✅
  - Plot's Threads | Happenings segment vs World's kind dropdown →
    `kindSelector: ReactNode` accepts either. ✅
- **Read-site impact** — plot.md "Implementation reuse" section
  needs rewriting; world.md + plot.md ASCII wireframes need
  updating. Tracked in integration plan.
- **Missing perspective** — InlineEditableName compound flagged as
  new build-ready dependency; not a blocker for DetailPane.

What was **not** found: no contradictions between the three
shells; no slot-naming collisions across shells; no doc-rule
violations (anchor links resolve, no `+` separator prose,
README-as-index preserved).
