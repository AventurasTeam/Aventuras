# 2026-05-19 — Profile model picker

Resolves the `Profile model picker — provider/model selection UX`
followup (removed from `followups.md` in the same commit). The
Narrative + Agent profile cards in App Settings · Profiles each set
a `modelRef: {providerId, modelId}` composite; the current spec
renders this as one grouped-by-provider dropdown with capability
icons inline. The followup leaned toward splitting into two selects,
citing discoverability concerns as provider + model counts grow.

The pass reframed the lean. A single combined picker stays the right
target — IF it carries a type-to-search affordance and a sticky-footer
custom-add. The result is a new pattern primitive (not a Profile-card
inline widget) so future surfaces consuming the same `modelRef` shape
adopt the same affordance without re-deriving it.

## Outcome

A new `ProviderModelPicker` primitive at
[`docs/ui/patterns/provider-model-picker.md`](../ui/patterns/provider-model-picker.md).
Composes the Autocomplete substrate (popover/Sheet per-tier dispatch,
type-to-filter, virtualization per the validated 2026-05-06 stack)
but owns its own grouped source, rich row layout (capability icons +
favorite toggle), composite `{providerId, modelId}` commit value,
and sticky-footer custom-add composer.

Three key shape decisions:

1. **New primitive, not extend Autocomplete.** Following the TagInput
   precedent at
   [`2026-05-06-tag-input-compound.md`](./2026-05-06-tag-input-compound.md):
   Autocomplete's "single-value, terminal pick-or-create" contract
   strains under grouped + rich-row needs. Cleaner to leave Autocomplete
   tight and compose its substrate.
2. **Sticky footer for custom-add, not per-section tail.** Router-type
   providers (OpenRouter, OpenAI-compatible hubs) can carry hundreds
   of models per section; scrolling past 200+ rows to find a per-section
   `+ Add custom` tail is hostile. A single pinned footer is always
   one click away; the composer it reshapes into carries a small
   `Under: <provider>` dropdown for provider association.
3. **Modelid-only trigger, provider in menu context.** Trigger button
   shows current `modelId` + capability icons + chevron; provider
   context lives in the open picker's section headers. Compact trigger,
   provider visible the moment the picker opens.

The pass also surfaced two downstream concerns. **Custom-added model
storage** isn't covered by today's `providers[].cachedModels[]` shape
(documented as "result of /models fetch") — fixed inline by adding
`customModelIds?: string[]` to `providers[]`. The **data-model
authority fork** around `default_models` (seed source vs runtime
resolver) is a real docs-internal inconsistency the design surfaced
but didn't try to fix — punted to a new `## Data-model` followup.

## Decisions captured in canonical spec

Full anatomy, open-surface composition, search behavior, edge
states, and per-tier dispatch live in
[`patterns/provider-model-picker.md`](../ui/patterns/provider-model-picker.md)
— the canonical spec. The decisions below are the load-bearing
calls the design session made, captured here as the rationale
record. The contract is also restated near the end of this file as
a single at-a-glance reference (same TS shape as the pattern doc).

### Trigger shows `modelId` only, not `<provider> / <modelId>`

The current spec'd wireframe ran `Anthropic / claude-sonnet-4-7` as
the trigger label. The new design strips the provider prefix; the
trigger renders `modelId` + capability icons + chevron, with
provider context surfaced in the open picker's section headers.

Compact trigger preserves the Profile card's vertical rhythm
across configurations. When two instances of the same provider type
serve the same `modelId` (e.g. Anthropic (work) + Anthropic
(personal)), the trigger reads identically for either selection —
they're functionally equivalent from the user's call-shape
perspective. Disambiguation happens in the picker's section
context. The same-modelId-different-instance case isn't lost; it's
relocated to where it matters.

### Sticky-footer custom-add, not per-section tail

Router-type providers (OpenRouter, OpenAI-compatible hubs) can
carry hundreds of models per section. A per-section
`+ Add custom under <provider>` tail would force users to scroll
past 200+ rows to find the add affordance. The sticky footer is
always one click away regardless of scroll position; the composer
it reshapes into carries a small `Under: <provider>` dropdown for
provider association, removing the need for per-section tails.

### Composer's `Under:` default is current selection's provider

Auto-detection of provider from `modelId` pattern (e.g.
slash-prefixed router models) is fragile across the configured
provider mix. The composer's `Under:` dropdown defaults to the
current selection's provider when one is set, otherwise the
provider pointed to by `app_settings.default_provider_id`.
Predictable; users can override explicitly.

### Capability keyword search is i18n-sourced, not English-defaulted

The picker accepts a `capabilityKeywords` prop (i18n-sourced map of
localized keyword strings → capability flag names). Whole-token
match against typed search; typing `r` doesn't match every
reasoning model, but typing `reasoning` (or its localized
equivalent) does. The picker doesn't ship English defaults at the
primitive level — consumers thread localized strings in via the
existing i18n layer (the app is i18n from day 1, per
[`app-settings.md → APP · Language`](../ui/screens/app-settings/app-settings.md#app--language)).

### Broken favorite row renders with warning, doesn't hide

A favorite row whose `modelId` is no longer in the provider's
catalog renders with a warning-tone `⚠` indicator and a warning
Tag — click still commits (and the consumer's profile-level error
state surfaces the broken reference). Silent hiding loses
information the user explicitly opted into; visible warning lets
the user see what they had and decide whether to unfavorite or fix.

### Trigger broken-state Tag composes within the existing card envelope

The
[`Per-profile error states + global banner`](../ui/screens/app-settings/app-settings.md#per-profile-error-states--global-banner)
section already owns the Profile card's overall broken-state
treatment (red border, error icon, inline error text). The
picker's trigger renders its own warning-tone Tag (`⚠ Provider
missing` or `⚠ <modelId>` per which side broke) INSIDE that
envelope — additive composition, not replacement. The card's
envelope says "this profile is broken"; the trigger Tag says
"specifically, the model reference is the broken element."

### Idempotent commit on currently-selected row

Clicking the row that's already selected fires `onChange` with the
same value and closes the picker — standard Select idiom. Avoids
the "I opened the picker by accident, click my current value to
dismiss" confusion that "do-nothing-on-current" semantics introduce.

### Consumer composition — Profile cards (the entire family)

Two consumers in v1, both inside App Settings · Profiles:

- **Narrative profile** — always rendered, `kind: 'narrative'`.
  One picker, writes to `narrative_profile.modelRef`.
- **Agent profile cards** — collapsible accordion, user-creatable,
  `kind: 'agent'`. Each card has the same picker, writes to that
  profile's `modelRef`.

The current spec's `provider/model` paragraph (one grouped
dropdown with capability icons inline) is replaced with a one-line
reference to the new pattern doc. Agent profile cards inherit via
the "same fields as Narrative" clause already in
[`app-settings.md → Agent profiles`](../ui/screens/app-settings/app-settings.md#agent-profiles).

`default_models` deliberately has no UI. Per clarification during
this design pass, `app_settings.default_models` is a **baked-in
per-provider map in code**, consulted only at "Reset to defaults"
time to seed `profile.modelRef`. Not user-mutable. Runtime
resolution is `stories.settings.models[agentId]` (override) →
`profile.modelRef` via `assignments[agentId]`. The data-model docs
describe `default_models` inconsistently across multiple sections
(sometimes as stored mutable state with dangling-reference
semantics, sometimes as the runtime resolver authority) — see the
new followup below for the reconciliation pass that resolves it.

## Contract

Informative — finalized at component implementation per the
project's existing primitive convention. Restated here for the
exploration record; canonical TS shape also lives at
[`patterns/provider-model-picker.md → API`](../ui/patterns/provider-model-picker.md#api).

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
  models: ModelEntry[]
}

type ProviderModelPickerProps = {
  value: ModelRef | null
  onChange: (next: ModelRef) => void
  placeholder?: string

  providers: ProviderSource[]
  favorites: ModelRef[]
  onFavoriteToggle: (ref: ModelRef) => void

  onAddCustom: (ref: ModelRef) => void
  onRefreshProvider?: (providerId: string) => void

  capabilityKeywords: Record<string, keyof Capabilities>

  disabled?: boolean
  disabledReason?: string
  'aria-invalid'?: boolean | 'true' | 'false'

  className?: string
}
```

Contract-shape notes that earned their session weight:

- **`onAddCustom` precedes `onChange`.** Host receives the new
  ModelRef, stores it (extending `providers[].customModelIds` per
  the data-model edit below), re-renders picker with updated
  `providers`, fires `onChange` to select the new entry.
- **No `kind` discriminator prop.** Picker doesn't know whether
  it's powering a narrative profile or an agent profile. All it
  knows is `value: ModelRef`. Keeps the contract tight; if future
  consumers need different filtering (e.g. embedding-only models),
  that's a new `filter?: (model) => boolean` prop at the time, not
  now.
- **`onRefreshProvider` is optional** so consumers without refresh
  capability (Storybook fixtures, future read-only review surfaces)
  suppress the section `⋯` Refresh action cleanly.

## Doc-integration impact

### New file

**`docs/ui/patterns/provider-model-picker.md`** — full primitive
spec. Anatomy + open-surface composition + search behavior + edge
states + contract + per-tier dispatch + keyboard + Storybook story
list. `Used by:` cites App Settings · Profiles → Narrative profile +
Agent profiles. Cross-pattern citations:
[`forms.md → Autocomplete-with-create primitive`](../ui/patterns/forms.md#autocomplete-with-create-primitive)
(the substrate composed),
[`forms.md → Input primitive`](../ui/patterns/forms.md#input-primitive)
(search bar),
[`overlays.md`](../ui/patterns/overlays.md) (per-tier dispatch),
[`toolbar.md`](../ui/patterns/toolbar.md) (search-bar adornment
convention),
[`chips.md`](../ui/patterns/chips.md) (warning-tone Tag for broken
states),
[`icon-actions.md`](../ui/patterns/icon-actions.md) (favorite-toggle
visibility).

### Edits to `docs/ui/patterns/README.md`

- New index entry pointing to `provider-model-picker.md` with a
  one-line summary.

### Edits to `docs/ui/screens/app-settings/app-settings.md`

- **`### Narrative profile (always present)`** — replace the
  `provider/model` paragraph with a one-line pointer to the new
  pattern doc.
- **`### Custom model id + favorites + fetch refresh`** — entire
  section body transformed into a pointer to the new pattern doc.
  Section heading retained (it's an anchor target referenced
  elsewhere).
- **`### Per-profile error states + global banner`** — add a
  sentence noting the picker's trigger renders its broken-state Tag
  inline; the section's existing list of broken-config copy stays
  authoritative.
- **Vocabulary cleanup** — existing "Favorite / pin" / "Pinned
  models" language across this file aligns to "Favorite" /
  "Favorites" terminology (per the data-model rename, below).

### Edits to `docs/data-model.md`

- **`### App settings storage` — `providers[]` shape.** Two
  changes:
  1. **Rename `pinnedModelIds` → `favoriteModelIds`** (string[]).
     Aligns the field name with the picker's UI vocabulary
     ("Favorites" stays as the surface noun, per design call).
  2. **Add `customModelIds?: string[]`** alongside `cachedModels[]`.
     Per-provider list of user-added model ids that aren't in the
     fetched catalog. Picker walks `cachedModels` + `customModelIds`
     to compose its row source; custom entries carry no capability
     data (intended).

### Edits to `docs/followups.md`

- **Remove** the `### Profile model picker — provider/model
selection UX` entry under `## UX` (resolved).
- **Add new `## Data-model` section** (file currently has only
  `## UX`; ordering Data-model then UX).
- **Add** `### Reconcile default_models authority — seed source vs
runtime resolver` to that new section.

### Edits to `docs/ui/component-inventory.md`

- **Add `ProviderModelPicker` row** under `## Compounds —
build-ready`. Folder: `components/compounds/` per the
  [`components/README.md → Picking a folder`](../../components/README.md#picking-a-folder)
  rule — it composes Autocomplete + Sheet + Popover + Input + Tag +
  Button, compound territory.

### Wireframe updates

**`docs/ui/screens/app-settings/app-settings.html`**:

- **Trigger visuals** drop the `Anthropic / ` provider-name prefix
  in the Narrative + Agent profile model triggers.
- **One stubbed popover overlay** shows the open picker surface
  (sticky search bar + Favorites pinned section + provider sections
  with sticky headers + sticky `+ Add custom model…` footer).

### Exploration record

This file (`docs/explorations/2026-05-19-profile-model-picker.md`).

## New followups generated

- **`docs/followups.md → ## Data-model → ### Reconcile
default_models authority — seed source vs runtime resolver`**
  (new section + new entry).

## Verified vs assumed

**Verified:**

- `providers[]` data shape including `pinnedModelIds` (renamed in
  this integration to `favoriteModelIds`) and `cachedModels`
  (`data-model.md:1234`).
- The data-model authority fork around `default_models` (multiple
  inconsistent descriptions across `data-model.md`,
  `generation-pipeline.md`, and the deletion-semantics exploration).
- Autocomplete's per-tier dispatch (popover/Sheet) at
  `forms.md → Autocomplete-with-create primitive`.
- The TagInput precedent for new-primitive-vs-extend-Autocomplete
  (`2026-05-06-tag-input-compound.md`).
- App Settings · Profiles' Profile card shape (Narrative + Agent
  cards, "same fields as Narrative plus structured output" cascade).
- Mobile expression already routes "model picker dropdown" to Sheet
  (`app-settings.md:821`).

**Assumed:**

- Virtualization (`@tanstack/react-virtual` + `FlatList`) carries
  through 200+ row sections without special handling beyond what
  the validated 2026-05-06 stack provides.
- Sheet keyboard handling resolution (currently a followup) will
  produce a primitive-side mechanism the picker can adopt without
  re-spec.
- Sheet + Popover ARIA resolution (currently a followup) will
  produce shared role + labelling conventions the picker adopts
  without re-spec.

Both "assumed" items are tracked followups already; the picker
design doesn't introduce new risk, just inherits the existing risk
envelope.
