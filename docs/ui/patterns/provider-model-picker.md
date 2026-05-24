# ProviderModelPicker

Searchable, grouped, rich-row picker for setting a
`modelRef: {providerId, modelId}` composite. Composes
[`SearchableOverlayList`](./searchable-overlay-list.md) in
`searchPlacement: 'in-overlay'` mode — the substrate provides
per-tier popover/Sheet dispatch, type-to-filter, virtualization, and
keyboard nav. This pattern owns its grouped source, rich row layout
(capability icons, favorite toggle), composite commit shape, and
sticky-footer custom-add composer.

Sister patterns:
[`forms.md → Input primitive`](./forms.md#input-primitive) (search
bar), [`overlays.md`](./overlays.md) (Popover/Sheet substrate),
[`toolbar.md`](./toolbar.md) (search-bar adornment convention),
[`chips.md`](./chips.md) (warning-tone Tag for broken states), and
[`icon-actions.md`](./icon-actions.md) (favorite-toggle visibility
shaped like inline row actions).

Used by:

- [App Settings · Profiles → Narrative profile](../screens/app-settings/app-settings.md#narrative-profile-always-present)
- [App Settings · Profiles → Agent profiles](../screens/app-settings/app-settings.md#agent-profiles)

## API

```ts
type ModelRef = { providerId: string; modelId: string }

type Capabilities = {
  reasoning?: boolean
  structured?: boolean
  // additional v1 capability flags as defined
}

type ModelEntry = {
  id: string // modelId
  capabilities?: Capabilities // absent = capability data unavailable
}

type ProviderSource = {
  id: string // providerId
  name: string // user-facing label (e.g. 'Anthropic (work)')
  models: ModelEntry[] // ordered as the provider returned them
}

type ProviderModelPickerProps = {
  value: ModelRef | null // controlled; null shows placeholder
  onChange: (next: ModelRef) => void // fires on commit + close
  placeholder?: string // trigger copy when value is null; default 'Pick a model'

  providers: ProviderSource[] // grouped source data, in display order
  favorites: ModelRef[] // cross-provider favorites
  onFavoriteToggle: (ref: ModelRef) => void

  onAddCustom: (ref: ModelRef) => void
  onRefreshProvider?: (providerId: string) => void // section ⋯ Refresh; omitted = hidden

  capabilityKeywords: Record<string, keyof Capabilities>
  // i18n-sourced map: localized keyword → capability flag.
  // Picker matches typed search against keys exactly (whole-token).

  disabled?: boolean
  disabledReason?: string // web title-tooltip, parity with Input / Autocomplete
  'aria-invalid'?: boolean | 'true' | 'false'

  className?: string
}
```

Fully controlled — no internal selection state. Same convention as
Select and Autocomplete.

## Anatomy

Three surfaces: a **Trigger** button at the consumer site, an
**Open surface** (anchored popover on desktop/tablet, bottom Sheet
on phone) carrying search + Favorites + grouped provider sections,
and a **Footer composer** for custom-add.

### Trigger

```
┌─ model ───────── claude-sonnet-4-7 🧠⚙  ▾ ┐
└───────────────────────────────────────────┘
```

Single form-control row inside the consumer's field list.

- **`modelId`** — left-aligned. Truncated mid-string with ellipsis
  if it exceeds available width.
- **Capability icons** — right-aligned in a fixed column. Glyph
  vocabulary: `🧠` reasoning, `⚙` structured output. Only icons for
  capabilities the selected model actually carries; unavailable
  capability data → blank column.
- **Chevron** — `▾` at the rightmost edge.

Provider context is **not** in the trigger — the open picker's
section headers carry it. Keeps the trigger compact; provider
visible the moment the picker opens. When multiple instances of the
same provider type both serve the same `modelId` (e.g. Anthropic
(work) + Anthropic (personal)), the trigger shows the same `modelId`
either way; the open section context disambiguates which instance
was picked.

**Broken-config variants.** Mirror the per-profile error vocabulary
at
[`app-settings.md → Per-profile error states + global banner`](../screens/app-settings/app-settings.md#per-profile-error-states--global-banner):

- **Provider missing** (`modelRef.providerId` references a deleted
  provider). Trigger renders as a warning-tone Tag: `⚠ Provider
missing`. Click still opens the picker, scrolled to the first
  existing provider's section.
- **Model not in catalog** (provider exists, model id not in
  fetched list). Trigger renders `⚠ <modelId>` with warning Tag
  wrapping the id. Click opens the picker scoped to that
  provider's section.

The trigger doesn't carry its own retry / refresh affordance —
those live in App Settings · Providers. The trigger's job: show
the broken state and route to fix.

**Disabled state.** Uniform per
[`principles.md → Edit restrictions during in-flight generation`](../principles.md#edit-restrictions-during-in-flight-generation).
Trigger shows current value (no chevron animation, no hover state),
can't open. Matches Input's edit-restriction treatment. If a
pipeline begins while the picker is already open, the host drives
the substrate's controlled `open` to `false` to force-close.

### Open surface — desktop / tablet (anchored popover, ~320–360 px)

```
┌────────────────────────────────────────────┐
│ 🔍  Search models…                       × │ ← sticky search bar
├────────────────────────────────────────────┤
│ ⭐ Favorites                               │
│   ⭐ claude-sonnet-4-7   [Anthropic] 🧠⚙   │
│   ⭐ gpt-5               [OpenAI]    🧠⚙   │
├────────────────────────────────────────────┤
│ Anthropic                       (4)    ⋯  │ ← sticky section header
│     claude-opus-4-7               🧠⚙ ☆   │
│   ✓ claude-sonnet-4-7             🧠⚙ ⭐  │
│     claude-sonnet-4-6             🧠⚙ ☆   │
│     claude-haiku-4-5              🧠   ☆  │
├────────────────────────────────────────────┤
│ OpenAI                          (3)    ⋯  │
│     gpt-5                         🧠⚙ ⭐  │
│     gpt-5-mini                       ⚙ ☆  │
│     gpt-4o-mini                      ⚙ ☆  │
├────────────────────────────────────────────┤
│ + Add custom model…                        │ ← sticky footer
└────────────────────────────────────────────┘
```

### Open surface — phone (bottom Sheet, ~95vh)

```
┌────────────────────────────────────────────┐
│ ━━━                                        │ ← drag handle
│ Pick a model                            ×  │ ← Sheet header
├────────────────────────────────────────────┤
│ 🔍  Search models…                       × │ ← sticky search bar
├────────────────────────────────────────────┤
│ (same content, full-width)                 │
├────────────────────────────────────────────┤
│ + Add custom model…                        │ ← sticky footer
└────────────────────────────────────────────┘
```

### Search bar

The search input is provided by
[`SearchableOverlayList`](./searchable-overlay-list.md) — sticky at
the top of the scroll region, `🔍` and `×`-clear adornments,
placeholder `Search models…`, autofocused on open. Not pre-filled
from the current selection: opening shows the full list with the
current selection scroll-anchored mid-viewport via the substrate's
`initialScrollRowId`.

### Sections + rows

Provider sections are grouped in the order
`app_settings.providers[]` declares (the same order App Settings ·
Providers renders). Each section header carries `(N)` for
visible-row count (= total when unfiltered, matching count when
filtered) and a `⋯` glyph that opens an Actions menu.

**Section header `⋯` menu.**

- `Refresh fetch ↻` — re-runs the provider's `/models` fetch.
  Scroll position anchors to the top of that provider's section on
  refresh (explicit user action; mild context loss acceptable).

Custom-add does NOT live in this menu — it lives in the sticky
footer (below).

**Each model row** left-to-right:

1. **Favorite toggle** — `☆` (empty) / `⭐` (filled) leading the row.
   Its own click target; leading position gives the row a consistent
   action zone independent of selection state.
2. **`modelId`** — primary identifier, monospace-affordable, flexes
   to fill and truncates on overflow.
3. **Capability icons** — `🧠⚙` trailing-aligned in a reserved-width
   column so rows align even when a model has no capability data.

The currently-selected row carries a `bg-bg-sunken` surface tint via
the substrate's `selectedRowIds` prop (see
[`searchable-overlay-list.md → Filter, keyboard, focus & lifecycle`](./searchable-overlay-list.md#filter-keyboard-focus--lifecycle)) —
the same affordance Select uses for customContent rows. No inline
glyph: the tint reads cleanly at the row level and frees the leading
position for the favorite toggle. When the same model surfaces in
both the Favorites strip and its provider section, both mirrors tint
together.

**Row click semantics.**

- Click on the row body → commit and close. Idempotent: clicking
  the currently-selected row fires `onChange` with the same value
  and closes the surface. Standard Select idiom; avoids the "click
  current to dismiss" trap.
- Click on the favorite toggle → toggle favorite state; picker
  stays open. Propagates to the Favorites pinned section without
  delay.

### Favorites pinned section

Cross-provider strip at the top, rendered only when at least one
favorite exists. Each row carries a `[Provider]` Tag at the
right-edge column so the user can tell which provider the favorite
lives on (two providers can share the same `modelId`).

**Broken favorite — model removed from provider catalog.** Row
renders with warning-tone `⚠` indicator at the left and the same
warning Tag treatment the trigger uses. Click still commits
(consumer's profile-level error state then surfaces the broken
reference). User favorited intentionally; hiding loses information.

Surfacing is **deliberately picker-open-only**, both v1 and post-v1.
If the broken favorite is also the active assignment (per
[`app-settings.md → Per-profile error states + global banner`](../screens/app-settings/app-settings.md#per-profile-error-states--global-banner)),
the global error banner fires through the existing pre-flight
path. A standalone broken favorite — favorited but not assigned
anywhere — is informational only; the user notices when they
reach for it. No push-surface needed.

**Toggle propagation.** Toggling favorite in either the Favorites
pinned section OR its source-section mirror flips the same data
point. Both rows reflect instantly.

### Sticky footer — custom-add composer

```
Rest state:
┌────────────────────────────────────────────┐
│ + Add custom model…                        │
└────────────────────────────────────────────┘

Clicked:
┌────────────────────────────────────────────┐
│ Add custom model                           │
│ [ gpt-4o-experimental                    ] │
│ Under: [ Anthropic                     ▾ ] │
│            Cancel  [ Add ]                 │
└────────────────────────────────────────────┘
```

Pinned at the bottom of the open surface; always one click away
regardless of scroll position.

- **`modelId` input** — text field. Pre-fills from the search bar's
  typed value on first open in a session (so a user who typed a
  miss can fall through to footer-click with the id already
  populated). Subsequent composer opens in the same session don't
  re-prefill — avoids state leakage.
- **`Under:` selector** — provider picker rendered as an inline
  expandable dropdown: a trigger button (`Under: <Provider> ▾`) that
  expands a panel directly below within the composer when tapped, no
  Portal and no overlay. The panel caps at ~5 rows with internal
  scroll so a long provider list can't push the Cancel / Add row
  off-screen. The standard project `Select` is **not** used here —
  on phone its Sheet would nest inside the picker's own Sheet (banned
  by [`overlays.md`](./overlays.md)) and would land behind the
  Input's keyboard regardless. Default: current selection's provider
  if any, otherwise the provider pointed to by
  `app_settings.default_provider_id`. No auto-detection from
  modelId pattern — explicit pick only.
- **`Cancel`** — return to rest state; discard typed input.
- **`Add`** — fires `onAddCustom(newRef)`; host stores the new
  entry (extending `providers[].customModelIds` — see
  [data-model edit](../../data-model.md#app-settings-storage));
  picker re-renders with updated `providers` and the host's
  `onChange` selects the new row.

**Cross-tier behavior.** Identical on every tier: the inline
expandable `Under:` (above) means the composer never opens a nested
overlay. The desktop and phone surfaces differ only in the host
overlay (Popover vs Sheet) the composer rides inside of.

## Search behavior

**Filter scope.** Case-insensitive substring match against:

- `modelId` (typing `sonnet` matches `claude-sonnet-4-7`,
  `anthropic/claude-sonnet-4-7`).
- `providerName` (typing `anth` collapses to Anthropic-namespaced
  rows; also catches OpenRouter rows via `modelId` substring on
  `anthropic/...`).
- **Capability keywords** as discrete whole-token matches — only
  when the typed value equals a known keyword (`reasoning`,
  `structured`, etc., sourced from `capabilityKeywords` prop). Not
  substring; typing `r` doesn't match every reasoning model.

**Capability keywords are i18n-sourced** via the
`capabilityKeywords` prop. Consumer threads localized strings in;
the picker doesn't ship English-string defaults at the primitive
level. Storybook fixtures show English defaults for demonstration.

**Section collapse.**

- Sections with zero matching rows hide entirely.
- Section header `(count)` rerenders to matching-row count.
- Favorites pinned section follows the same rule.

**No-results state.** Filter matches nothing:

- Scroll region shows a single muted-tone empty row:
  `No models match "<typed>"`.
- Sticky footer stays — `+ Add custom model…` is the obvious next
  step, composer's `modelId` field pre-populates from the typed
  value.

**Out of scope.**

- Fuzzy / typo-tolerant matching (substring suffices for v1).
- Capability-filter chips at the top of the open surface.
- Recently-picked elevation (different signal from favorites).

## Edge states

**No providers configured.** Empty-state nudge in the body:

```
┌────────────────────────────────────────────┐
│ 🔍  Search models…                         │
├────────────────────────────────────────────┤
│   No providers configured.                 │
│   Add one in App Settings → Providers      │
│   [+ Add provider]                         │
├────────────────────────────────────────────┤
│ + Add custom model…                        │
└────────────────────────────────────────────┘
```

- Deep-link route to App Settings · Providers, same handling the
  global broken-config banner uses.
- Sticky footer stays. Clicking surfaces a single composer error
  (`No providers configured — add one first`) with the same
  deep-link. No commit possible.
- Mostly theoretical;
  [`onboarding.md`](../screens/onboarding/onboarding.md) seeds at
  least one provider on first launch. Specified for edge flows that
  delete to zero.

**Single provider configured.** Picker still renders the grouped
layout — one section header, one provider. No special collapsed-flat
mode. Composer's `Under:` auto-selects the single provider; chooser
becomes a static label.

**Capability data unavailable.** Mirrors the
[`app-settings.md → Narrative profile · thinking slider`](../screens/app-settings/app-settings.md#narrative-profile-always-present)
conditional rule: capability column stays blank (no `?`, no grey
placeholder). No `unavailable` glyph in rows — too noisy at scale.

**Custom-added models.** Render as ordinary rows inside the
assigned provider's section. No "custom" badge — the user typed it;
flagging adds noise without resolving real ambiguity. Capability
column blank.

## Per-tier dispatch

Per-tier overlay dispatch — an anchored popover on desktop/tablet
(~320–360 px wide), a bottom Sheet on phone (`sheetSize: 'tall'`,
drag-to-dismiss) — is provided by
[`SearchableOverlayList`](./searchable-overlay-list.md). Sheet
keyboard handling, focus management, and the Sheet/Popover ARIA
contract follow the substrate and [`overlays.md`](./overlays.md).

## Keyboard

Trigger, search-input filtering, `↓`/`↑` highlight navigation,
`Enter` to commit the highlighted row, and `Esc` (clear-then-close,
via `escClearsQueryFirst: true`) follow
[`SearchableOverlayList`](./searchable-overlay-list.md).
Picker-specific: the footer composer, when open, Tabs through the
`modelId` input → `Under:` dropdown → Cancel → Add; Enter inside
`modelId` is Add (when both fields are valid); Esc is Cancel.

## Storybook

Stories cover:

- **default** — fully populated, multiple providers, mixed
  capability data, some favorites.
- **single-provider** — only one provider configured.
- **no-providers** — empty-state nudge.
- **broken-trigger — provider-missing** — trigger renders warning
  Tag, click opens with first existing section.
- **broken-trigger — model-not-in-catalog** — trigger renders model
  warning, click opens scoped to that provider's section.
- **broken-favorite** — favorite row's model id no longer in the
  provider's catalog; row renders with warning indicator.
- **filter — substring** — typed `sonnet` filters and recounts
  sections.
- **filter — capability-keyword** — typed `reasoning` (or localized
  equivalent via `capabilityKeywords` prop) filters to reasoning
  models.
- **filter — no-results** — typed value matches nothing; footer
  pre-fills composer.
- **footer composer** — open / typing / provider-selection /
  cancel / add lifecycle.
- **virtualization** — provider with 200+ models (router-type
  scenario); scroll smooth, sticky headers behave.
- **disabled** — uniform disabled treatment with `disabledReason`
  surfacing as web title-tooltip.

Belongs in the same `Patterns/Form controls/` Storybook tree as
Select and Autocomplete.
