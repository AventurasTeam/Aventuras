# App Settings

**Wireframe:** [`app-settings.html`](./app-settings.html) — interactive

Global app configuration. Reached from the ⚙ icon on the story list
(no story context = app-level settings). Same layout pattern as
[Story Settings](../story-settings/story-settings.md): top bar +
left-rail sections containing tabs + right-pane form. Maximum
component reuse — every form widget that appears here also appears
on Story Settings, just bound to different data.

Cross-cutting principles that govern this surface are in
[principles.md](../../principles.md). Relevant sections:

- [Settings architecture — split by location](../../principles.md#settings-architecture--split-by-location)
- [Models are override-only (per-story)](../../principles.md#models-are-override-only-per-story)
  (this surface is the source side; Story Settings is the override side)
- [Form controls — Select primitive](../../patterns/forms.md#select-primitive)
- [Save-session pattern](../../patterns/save-sessions.md)

## Layout

```
┌────────────────────────────────────────────────────────────┐
│ ⚠ N profiles have configuration errors. [Open settings →] │ ← global error banner (when broken)
├────────────────────────────────────────────────────────────┤
│ [logo] App Settings                       [⚲] [←]          │ ← top bar
├───────────────┬────────────────────────────────────────────┤
│ GENERATION    │ Profiles                                    │ ← pane header
│ · Providers   │ ─────                                       │
│ · Profiles    │ Narrative profile                           │
│               │ [model] [temp] [max] [think] [timeout]      │
│ STORY DEFAULTS│ ▸ Advanced — custom JSON                    │
│ · Memory      │                                             │
│ · Translation │ Agent profiles       [+ New profile]        │
│ · Composer    │ ▾ Fast tasks                                │
│               │ ▸ Heavy reasoning                           │
│ APP           │                                             │
│ · Appearance  │ Assignments                                 │
│ · Language    │ classifier:  [Fast tasks ▾]                 │
│ · Data        │ translation: [Fast tasks ▾]                 │
│ · About       │ …                                           │
│ · Diagnostics │                                             │
│               ├────────────────────────────────────────────┤
│               │ save bar (when dirty)                       │
└───────────────┴────────────────────────────────────────────┘
```

10 tabs across 3 sections.

## Section split

**GENERATION** — LLM generation configuration (provider instances +
profiles for text models). Image generation is **deferred** —
tracked as its own followup. The agent assignment list reflects this
(no `imageGen` entry).
**STORY DEFAULTS** — values copied into new stories at creation time
(per the
[settings scope policy](../../principles.md#settings-architecture--split-by-location)).
**APP** — general app behavior (theme, language, data ops, about,
diagnostics).

## GENERATION · Providers

**Providers are user-managed instances**, not a fixed list of slots.
The user adds providers as they want, can configure multiple
instances of the same type (e.g., separate work + personal Anthropic
keys, or two OpenAI-compatible endpoints pointing at different
local Ollama installs).

Seven provider **types** available in v1:

- **Anthropic** — `/messages`
- **OpenAI** — chat + new `/responses`
- **Google** — Gemini
- **OpenRouter** — has model capability flags (reasoning, structured
  output). Surfaced in [Onboarding](../onboarding/onboarding.md#step-2--pick-your-provider).
- **NanoGPT** — has model capability flags. Surfaced in
  [Onboarding](../onboarding/onboarding.md#step-2--pick-your-provider).
- **NVIDIA NIM** — free-tier hosted inference. Surfaced in
  [Onboarding](../onboarding/onboarding.md#step-2--pick-your-provider).
- **OpenAI-compatible** — catch-all for Ollama / LM Studio / any
  endpoint speaking OpenAI's chat shape (user supplies endpoint URL)

### Provider list

Empty by default after install (until
[Onboarding](../onboarding/onboarding.md#step-3--configure-provider)
seeds one, or the user skips and adds one here directly). Each
configured provider renders as a collapsible row:

```
[+ Add provider ▾]              ← type picker

▾ Anthropic   [Anthropic]   ⭐ default            [⋯]
  display name:   [Anthropic]
  api key:        [•••••a3f]  [Edit] [Test]
  ▸ Endpoint override
  ▸ Custom headers
  ─────
  Models   12 cached · last 2h ago · ⟳
  ★ claude-sonnet-4-7    🧠 ⚙              [×]
  ☆ claude-haiku-4-5     ⚙                 [×]
  ★ claude-opus-4-7      🧠 ⚙              [×]
  …
  + Add custom model id

▸ Anthropic (personal)   [Anthropic]              [⋯]
▸ OpenRouter (work)      [OpenRouter]             [⋯]
▾ Ollama (local)         [OpenAI-compatible]      [⋯]
  endpoint:       http://localhost:11434/v1   ← required, not collapsed
  api key:        (empty — optional)
  …
```

Each provider carries:

- **Display name** — user-chosen, shown in dropdowns and assignments.
  Defaults to the type name with a `(N)` suffix when multiple of the
  same type exist (`Anthropic`, `Anthropic (2)`, etc.).
- **Type badge** — small chip in the card header next to the display
  name. Shows the underlying provider type so the user always knows
  what each instance is regardless of its display name.
- **API key** — masked. Edit / remove actions inline. Optional
  `Test` button hits the provider's `/models` or auth endpoint to
  verify connectivity.
- **Endpoint override** — collapsed by default; users don't need to
  think about endpoints for native types (Anthropic, OpenAI, Google,
  OpenRouter, NanoGPT). Expand only to override (proxy, regional
  endpoint, etc.). **Exception**: OpenAI-compatible type renders the
  endpoint inline (not collapsed) since it's required — there's no
  default URL for "any compatible endpoint."
- **Custom headers** — optional key/value pairs for proxy auth or
  custom routing. Collapsed by default.
- **Models** — visible list defaults to **favorites only** (a curated
  short-list of the user's working set). Below it: a `View all N
models →` toggle that expands to a search + filter view of the
  full catalog. Necessary for gateway providers like OpenRouter
  where 300+ models would be unusable as a flat list.
  - **Favorites section** — always visible. Short by design; this is
    the user's quick-access set.
  - **View all expanded** — search input (filter by name) + capability
    filter chips (`🧠 reasoning`, `⚙ structured`, `★ favorites only`) +
    scrollable list. Virtualized for large catalogs per
    [patterns → Large lists](../../patterns/lists.md#large-lists--virtualization-rule)
    (OpenRouter ships 340+ models). Favorites float to the top of the
    unified list.
  - **Per-row actions** — favorite star (☆ / ★), capability badges
    (🧠 reasoning, ⚙ structured output where capability data is
    available), remove-from-cache (×).
  - **Threshold for showing "View all"** — providers with very few
    models (e.g., a local Ollama instance with 3 models) skip the
    favorites/all distinction and just show the full list inline. The
    smart pattern only earns its weight when the catalog is
    non-trivial.
- **Add custom model id** — always available below the model list.
  For fine-tunes / local models / anything the provider's `/models`
  endpoint doesn't list. Especially relevant for OpenAI-compatible
  where auto-discovery may be limited or unreliable.

### OpenAI-compatible — variations

The OpenAI-compatible type differs from the others:

- **Endpoint required** — surfaced inline (not collapsed). User must
  fill it (`http://localhost:11434/v1` for Ollama, custom URL for
  any other compatible endpoint).
- **API key optional** — local servers typically don't authenticate.
  Empty key allowed; field shows `(empty — not required)`.
- **Capability data unavailable** — no provider-level capability
  flags. `auto` for structured output resolves to `force-off`
  (conservative); reasoning slider visible but with the
  `capability data unavailable` info text. User can flip per profile
  if they know the model supports it.
- **Custom model id is more prominent** — auto-discovery may return
  no models or partial lists; manual entry is the primary path.

### Models — split by capability

Each provider's models surface as **two collapsible sections**
within its card:

- **Text models** — chat-completion / instruct models. Consumed
  downstream by Profiles (narrative + agent profiles).
- **Embedding models** — embedding-capable models. Consumed
  downstream by the Embedder default selector in Memory tab.

Both sections **default collapsed** showing only their head row
(name + count + `Refresh`). The user expands a section to see
the model list, favorites/full/search affordances, and add-custom-id.
Refetch is per-section: clicking `Refresh` on the head row
refreshes only that capability category.

For providers that don't expose embedding-capable models (e.g.
Anthropic today), the Embedding models head shows
`Embedding models · none` and the expanded body has an explanatory
empty state. The section isn't hidden — explicit empty surface is
more discoverable than a missing one.

Both sections are populated from the same `/models` endpoint at
fetch time; capability metadata in
`app_settings.providers[].cachedModels[].capabilities` carries the
classification. Capabilities are detected from the provider but
always user-overridable (per the global pattern; some providers
report inconsistently, custom endpoints may run models the
provider's metadata doesn't recognize).

**Capability badges per category.** Each model row shows the
capability badges relevant to its category as small clickable
chips. Click toggles the user override; visual state distinguishes
detected-on (filled), user-overridden-on (filled, marked), and
off (outline).

| Category         | Badge | Capability                                                                                                                                                                   |
| ---------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text models      | 🧠    | `reasoning` — model exposes thinking-tokens API                                                                                                                              |
| Text models      | ⚙     | `structuredOutput` — model supports the JSON-schema / structured-output mode                                                                                                 |
| Embedding models | 🪆    | `matryoshkaSupported` — model trained for representation truncation (per [`retrieval.md → Matryoshka effective dim`](../../../memory/retrieval.md#matryoshka-effective-dim)) |

When the Matryoshka badge is on, the tooltip shows the model's
curated dim ladder (`capabilities.matryoshkaDims`); a user-
overridden-on without a declared ladder falls back to a sensible
defaults set (`[512, 1024, 2048, native]` clamped to native).
The badge itself is the only knob here — actual per-story dim
selection happens at [story creation](../wizard/wizard.md#memory-cost--matryoshka-effective-dim);
Models tab is just the capability-toggle layer.

### Model fetching strategy

- **Refresh on app launch** — automatic on startup, **staggered**
  across configured providers to avoid hammering the network with
  parallel calls.
- **Manual refresh** per provider, per capability section via the
  `↻` button on the section head row.
- **Cached results persisted** in SQLite alongside provider config;
  survive restarts even when offline.

### Provider menu (⋯)

- **Rename** — change display name.
- **Set as default** — moves the ⭐ to this provider; replaces the
  current default (one default total). Triggers update of any
  "App default" sentinel resolutions.
- **Remove** — confirmation flow per the
  [deletion-semantics design](../../../data-model.md#app-settings-storage).
  Both shapes are
  [AlertDialog](../../patterns/alert-dialog.md) consumers:
  - **Blocker dialog** when an active default or embedder pointer
    references this provider (full rule set in the deletion-semantics
    design linked above). Copy points the user at the relevant surface
    to change the anchor before retrying: App Settings →
    Providers → Default for the narrative anchor, App Settings →
    Memory for the app-level embedder, or
    [Model swap UX](../../../memory/retrieval.md#model-swap-ux)
    per-story for the per-story embedder case.
  - **Confirm-with-impact dialog** otherwise — enumerates broken-
    reference impact (profile count, agent-default count) by
    walking `app_settings.profiles[]` and `app_settings.default_models`.
    No story-side query — per-story embedder usage is provably
    nonexistent (blocker dialog would have fired) and per-story
    model overrides are pure model id strings that don't reference
    providers. Destructive CTA, cancel default. After confirm:
    references stay as data and surface as warning-Tag indicators
    on this surface + system-entry errors at next pipeline use.
    No auto-delete of dependent profiles, no fallback re-pointing.

### Default provider

One configured provider can be marked default (⭐ badge on the row).
Set during [Onboarding](../onboarding/onboarding.md#what-gets-seeded-silently),
editable here. The default provider seeds the Narrative profile
model and "Reset to defaults" actions across the rest of the app.

**Cannot be deleted while default.** The Remove action surfaces the
blocker dialog ("This provider is the default … pick a different
default before deleting"). User must move ⭐ to another provider in
this same surface, then retry. Mirrors the deletion-semantics design
linked above; the `providers[].length ≥ 1` invariant falls out for
free.

### Storage

API keys live in SQLite per the data strategy. Encryption at rest is
a tracked followup; surfacing it in the wireframe would be premature.

## GENERATION · Profiles

The complex tab. Three vertical zones; narrative dominates the
viewport top, agent profiles are a manageable accordion below,
assignments anchor the bottom.

### Narrative profile (always present)

Always visible at the top, "big" — narrative is the storyteller, the
single most-edited profile. Cannot be deleted; can be reconfigured.

Fields:

- **provider/model** —
  [ProviderModelPicker primitive](../../patterns/provider-model-picker.md).
  Sets `modelRef: {providerId, modelId}`. Trigger shows the modelId
  - capability icons; the open picker carries type-to-search,
    cross-provider Favorites, grouped provider sections, and a
    sticky-footer custom-add composer.
- **temperature** — 0–1 slider.
- **max output** — slider with `[✎ custom]` for direct numeric input
  beyond the slider's range.
- **thinking** — slider, **conditional** rendering rules:
  - Provider known + model supports → slider visible.
  - Provider known + model doesn't → slider hidden, info text
    `Reasoning: not supported`.
  - Capability data unavailable → slider visible, info text
    `Reasoning: capability data unavailable — slider applies if model supports it`.
- **timeout** — 5–300s slider, `[✎ custom]` for outliers. Default 60s.
- **structured output** — agent profiles only; not on narrative.
- **Advanced — custom JSON payload** — collapsed by default. Per-field
  override merged on top of the constructed request payload. Any
  parameters we don't surface in UI (`top_k`, `seed`,
  `repetition_penalty`, etc.). JSON-validated; warning if invalid.

### Agent profiles

User-creatable, named, with description. Listed as a collapsible
[Accordion](../../patterns/accordion.md) (card-style composition —
each profile is its own bordered card). Each profile carries the
same fields as Narrative plus `structured output` (auto / force on
/ force off):

- **`auto`** uses capability data: model supports → force-on; model
  doesn't → force-off; data unavailable → force-off (conservative).
- **force on / force off** override the auto logic.

`+ New profile` adds a profile (name + description + standard fields).
Profile `⋯` menu offers rename, duplicate, delete. Delete is permitted
even when agents are assigned to the profile, per the
[deletion-semantics design](../../../data-model.md#app-settings-storage):
the confirm-with-impact dialog enumerates affected agents by name,
and on confirm the assignments are **unset** (not auto-reassigned to
another profile, not falling back to narrative). Affected agents
surface as "No profile assigned" in the Assignments section and as
system-entry errors at next pipeline use.

The narrative profile is `kind: 'narrative'` and cannot be deleted —
blocker dialog applies.

**Default agent profiles seeded by
[Onboarding](../onboarding/onboarding.md#what-gets-seeded-silently):**
`Fast tasks` (cheap routine agents) and `Heavy reasoning` (lore-mgmt
at chapter close). The names and exact assignment matrix are
placeholder shapes; final templates land with implementation. User
can rename / delete / extend.

### Assignments

Each agent dropdown picks a profile. Agents currently in the system:

- `classifier` — every reply
- `translation` — pipeline phase
- `suggestion` — next-turn suggestion pane
- `lore-mgmt` — chapter close
- `retrieval` — retrieval phase (when designed)

Default assignment seeded by
[Onboarding](../onboarding/onboarding.md#what-gets-seeded-silently)
(typically all → `Fast tasks` except `lore-mgmt` →
`Heavy reasoning`). Placeholder split — finalized with
implementation.

Image generation is **deferred** as a feature; no `imageGen` agent
entry until the feature lands. Tracked in
[`followups.md`](../../../parked.md#image-generation).

### Per-profile error states + global banner

Profiles render their own error state when broken — red border /
error icon / inline error text:

- "Provider key missing — open Keys"
- "Model `gpt-4o` no longer in provider's catalog"
- "No model selected"
- "Provider missing" — the profile's `modelRef.providerId` references
  a deleted provider (per the
  [deletion-semantics design](../../../data-model.md#app-settings-storage)).
  Same row-level vocabulary; warning-tone Tag in place of the provider
  name, tappable to the profile edit dialog.

Agent rows in **Assignments** likewise carry a warning indicator when
`assignments[agentId]` is unset post-profile-delete: "⚠ No profile
assigned" in place of the profile name, tappable to a profile picker.

The [ProviderModelPicker](../../patterns/provider-model-picker.md)
trigger renders its own broken-state Tag inline when the model
reference is the broken element — `⚠ Provider missing` or
`⚠ <modelId>` depending on which side broke — composing within the
profile card's overall red-border envelope. Both render together;
the card's envelope says "this profile is broken," the picker's
trigger Tag says "specifically, the model reference."

The **global error banner** above the main header aggregates all
broken profiles + unset assignments:
`N profiles have configuration errors. [Open settings →]`.
The action button deep-links to App Settings · Profiles with the
first broken profile scrolled into view (or Keys if the issue is a
missing key, or Assignments if the issue is an unset agent).

### Custom model id + favorites + fetch refresh

Power-user features owned by the
[ProviderModelPicker primitive](../../patterns/provider-model-picker.md):

- **Add custom model** — sticky-footer composer at the bottom of
  the open picker. `modelId` input + `Under:` provider dropdown +
  Add. Stored as `app_settings.providers[].customModelIds`. Custom
  entries render as ordinary rows inside the assigned provider's
  section.
- **Favorites** — `⭐` toggle on each row; favorited models surface
  in a cross-provider Favorites section pinned at the top of the
  picker. Stored as `app_settings.providers[].favoriteModelIds`.
- **Refresh fetch** — `↻` action in each provider section's `⋯`
  menu inside the picker. The same affordance also lives on the
  provider row in App Settings · Providers · Keys.

## GENERATION · Embedding models

The place where **installed local models** are managed (install,
test, EP override, remove) plus a **cross-story staleness
aggregate**. Sits under Generation alongside Providers and Profiles
— embedders are infrastructure, not a story default.

**Provider embedders aren't installed; they live on the configured
providers' Embedding models lists in
[Providers](#generation--providers).** The default _selection_
(which embedder — local or provider — new stories inherit) lives
under [Memory](#memory)'s Embedder default card. Three surfaces,
three concerns: Providers fetches and lists provider-side models;
this tab manages local models on disk; Memory selects which one is
the default for new stories.

### Installed local models

Accordion list. Each row collapsed shows: model id + size + status
icon (✓ tested-ok / ⚠ error / — never tested) + overflow handle.
Tapping the row expands to:

- Backend (`local`) and on-disk folder reference.
- Last-tested timestamp + last test outcome.
- `[Test embedder]` button — runs init + smoke-test embed.
- `Execution provider` picker. Defaults to the catalog's
  `default_ep[platform]` for curated entries, or the user's pick
  at import time for custom entries. Override persists in the
  model's `runtime.json`.

Overflow menu (`⋯`) on the collapsed row: `Remove…` (warn-and-
confirm; details in
[`memory/model-management.md → Removal`](../../../memory/model-management.md#removal)).

`+ Add model` opens an action picker with three paths:

- **Curated catalog** — list of pre-vetted models from the bundled
  JSON catalog (see
  [`memory/model-management.md → Curated catalog`](../../../memory/model-management.md#curated-catalog)).
  Triggers the
  [embedder download dialog](../../patterns/embedder-download.md)
  for license fetch + download + verify against pre-known SHA256s.
- **From HuggingFace id…** — power-user path. User types a
  `<namespace>/<model>` id or pastes a HuggingFace URL; the dialog
  fetches model card + file listing live, validates the required
  ONNX exports are present, then runs license fetch + download +
  verify (computed hashes, no pre-check). Uses the
  [embedder download dialog's custom HF id variant](../../patterns/embedder-download.md#custom-hf-id-variant).
  EP picker before download.
- **Import custom files…** — filesystem-supplied. Three-file
  import per
  [`memory/model-management.md → Custom file import`](../../../memory/model-management.md#custom-file-import);
  uses the
  [embedder download dialog's custom-import variant](../../patterns/embedder-download.md#custom-import-variant).

### Embedding status — across stories

Cross-story aggregate. Lists every story across the database that
has stale embedding rows, with the blocking reason and an
`Open story settings` action that navigates into that story's
Memory tab. Counterpart to the per-story view (Story Settings ·
Memory · Embedding status).

Empty state: `No stories have pending re-embeds.` Otherwise, one
row per affected story:

> **Story Title**
> 12 rows pending re-embed under MiniLM-L6 · model removed
> `[ Open story settings ]`

Full design context in
[`memory/model-management.md → Staleness UI`](../../../memory/model-management.md#staleness-ui).

## STORY DEFAULTS

Mirrors the corresponding Story Settings tabs, but configures the
**defaults** that get **copied into new stories at creation time**.
Per the
[settings scope policy](../../principles.md#settings-architecture--split-by-location)
(copy-at-creation): editing these does not propagate to existing
stories.

### Memory

Mirrors Story Settings · Memory's
[Chapter close + Prompt context + Classifier (cadence + piggyback
only) + Retrieval budgets + Embedder default](../story-settings/story-settings.md#memory-tab)
sections, bound to `app_settings.default_story_settings.*` instead
of `stories.settings.*`. Form components literally reused; only
data binding differs.

Two intentional differences from the per-story version:

- **No classifier status block, no `Run classifier now` button.**
  Those are per-story operational state (live progress, failures,
  manual override), not seedable defaults.
- **Embedder default is the selection only — backend toggle plus a
  model picker.** Picker source switches with the backend toggle:
  - **`local`** — lists installed local models from
    [Embedding models](#generation--embedding-models). Inline
    `manage →` link routes there for installation / EP override
    / removal.
  - **`provider`** — lists embedding-capable models grouped by
    provider, sourced from each provider's Embedding models list
    in [Providers](#generation--providers). No separate config
    surface; the picker IS the selection.

  `Test embedder` button next to the picker runs init + smoke-test
  embed against whatever's currently selected.

- **Effective-dim default.** Conditional row, only when the
  selected default backend is `provider` AND the picked model has
  `capabilities.matryoshkaSupported = true`. Surfaces the same
  picker shape as the wizard's
  [Memory cost section](../wizard/wizard.md#memory-cost--matryoshka-effective-dim)
  (curated ladder + Custom… + storage / latency preview), bound to
  `app_settings.default_story_settings.effectiveDim`. Hidden for
  non-Matryoshka models and for `local` backends. Default
  pre-selection follows the wizard's platform-aware rule (mobile
  → smaller dim, desktop → native). Editing this default does not
  propagate to existing stories — they're locked at their
  creation-time dim.

### Translation

Same form as Story Settings · Translation — master enable, target
language, granular per-content-type toggles.

### Calendar

Default calendar system seeded into new stories at creation. Same
calendar picker primitive as Story Settings · Calendar (full spec
in
[`patterns/calendar-picker.md`](../../patterns/calendar-picker.md)),
without swap warnings — App Settings changes don't propagate to
existing stories. Field copy: `Default for new stories. Existing
stories keep their current picks.`

### Composer prefs

Same form as Story Settings · Generation · Authoring aids — composer
modes enabled, wrap POV (first / third), suggestions enabled.

## APP · Appearance

Theme picker, reader font size, conditional accent override. The
visual identity contract that backs this surface lives in
[`foundations/`](../../foundations/README.md) — this section
describes the form-shaped affordance only.

**Theme is a dropdown**, not a segment, listing the curated
gallery from the
[theme registry](../../foundations/theming.md#theme-registry).
Each entry is a palette, mode-declared (`light` / `dark`); pairing
between modes is an authoring convention, not a system feature.
Default lands at session 6 once the curated gallery is authored.
Future user-authored themes (parked-until-signal per
[`parked.md`](../../../parked.md#user-authored-themes)) extend the
same gallery without changing the picker shape.

**Reader font size** is a 4-state `S` / `M` / `L` / `XL` segment.
Persists at
[`app_settings.appearance.readerFontScale`](../../foundations/typography.md#reader-font-size-setting)
and scales reader entry content only — prose body, entry titles,
entry meta. Reader-side chrome (top-bar, action buttons, toolbar)
and the rest of the app (lore detail panes, peek drawer, wizard
prose) stay at locked sizes. Live preview is the reader itself —
no embedded sample paragraph here. Default `M` (multiplier `1.0`).

**Accent override is conditional.** Renders only when the active
theme has
[`accentOverridable: true`](../../foundations/theming.md#accent-override-opt-in)
(likely Default Light / Default Dark in v1). Opinionated themes
(Parchment, Catppuccin Mocha, Tokyo Night, etc.) hide the picker
— their accent is part of the personality and isn't user-tweakable.
The override persists across theme switches; switching to an
opinionated theme silently dormants it; switching back re-applies
it. The
[ColorPicker primitive](../../patterns/color-picker.md) renders
the swatch row and the `+ custom` affordance; the wrapper passes
the
[curated palette](../../foundations/color.md#curated-accent-palette),
the active theme's authored `--accent` as `fallbackColor` (label:
`Use theme accent`), and a `customWarning` that runs
[`deriveAccent`](../../foundations/color.md#accent-derivation-algorithm)
and surfaces a warning when the resulting `--accent-fg × --accent`
pair falls below 4.5:1 (warn-but-allow, per the
[Known limitations](../../foundations/color.md#known-limitations)
posture).

**Density picker.** Four options: `Default` (recommended,
sentinel that resolves per tier — compact on desktop, regular on
phone+tablet), `Compact`, `Regular`, `Comfortable`. Persists at
[`app_settings.appearance.density`](../../../data-model.md). The
contract — values, sizing tokens, resolution mechanism — lives
in [`spacing.md → Density toggle`](../../foundations/spacing.md#density-toggle).
The same control surfaces in
[Onboarding Step 1](../onboarding/onboarding.md#step-1--app-basics);
Appearance lets users adjust post-onboarding.

Density isn't an accessibility setting per se — font scaling
(reader font size) and contrast targets handle those concerns
elsewhere. `Comfortable` density helps users with motor
difficulties (larger tap targets) but isn't a substitute for
proper a11y affordances; OS-level accessibility settings (text
size, bold text, reduced motion) still apply on top.

### Show jump-to-top button

Boolean toggle, default **off**. Controls whether the floating
jump-to-top affordance renders in the
[reader's scroll chrome](../reader-composer/reader-composer.md#jump-buttons).
The underlying functionality (`Home` keyboard shortcut, Actions menu
entry `Jump to top of branch`) stays available regardless — the
toggle gates the visible button only, not the capability. Pure UI
chrome preference; app-wide; not copied per-story.

## APP · Language

UI language dropdown — i18next-driven. Language tags ISO 639-1.
Defaults to OS locale on first launch; user can override.

Note: this is **app-UI translation only**, distinct from per-story
content translation (Story Settings · Translation). The two are
independent.

## APP · Data

Operational data actions. Each is destructive or large-impact, so
each has a confirmation step:

- **Full backup** — `VACUUM INTO`-based snapshot, includes the assets
  directory. Per data-model.
- **Restore** — file picker; confirmation modal warning that the
  current DB will be replaced. Lists what'll be overwritten.
- **Export all stories** — bulk per-story export.

**Per-story import is intentionally NOT here** — it lives on the
story list alongside `+ New story` (see
[story-list](../story-list/story-list.md)). One affordance per
action, no duplication. Legacy `.avt` migration runs through that
same picker.

## APP · About

Version + OS + license + opensource credits + repo link. Lightweight.

## APP · Diagnostics

Configuration surface for the observability layer. Toggles + a
performance-stats / raw-settings-export pane. Navigation into the
hub itself (which subsumes the previously-placeholdered
view-logs button) lives in the global Actions (⚲) menu, not in
this tab body — see
[Diagnostics Hub](../diagnostics/diagnostics.md).

### Enable diagnostics capture (master gate)

Toggle bound to
[`app_settings.diagnostics.enabled`](../../../data-model.md#diagram).
Off by default. Master gate for the entire diagnostics layer
(memory probe captures, the in-memory diagnostics store, console
mirroring) per
[`observability.md → Gating model`](../../../observability.md#gating-model).
When off:

- Every diagnostics sink (`logger`, `httpCallSink`,
  `turnCaptureSink`) no-ops at function entry.
- Memory probe captures stop writing across every story.
- The Diagnostics Hub entry in the Actions menu is hidden.
- The three in-memory ring buffers (`turnCaptures`, `httpCalls`,
  `logEntries`) wipe immediately on toggle-off.

When on:

- Sinks become active. Subsystems' emissions populate the
  buffers; UI subscribes and renders live.
- Memory probe writes occur for stories whose
  [`stories.settings.probe_mode_active`](../../../data-model.md#diagram)
  is also on.
- The Diagnostics Hub entry appears in the Actions menu.

Persisted `probe_captures` are NOT wiped on toggle-off (memory
probe's existing rule); only the in-memory buffers vaporize.

### Include debug-level emissions

Secondary toggle bound to
`app_settings.diagnostics.debug_level_enabled`. Default off.
Disabled (grayed) when the master gate is off; meaningful only
when master is on. When off, `logger.debug(...)` calls no-op;
`warn` and `error` still flow.

### Memory probe — per-story activation

Inline reference to the
[memory probe per-story toggle](../../../memory/probe.md#scope)
on each story's Story Settings · Memory tab. App-level here is
the gate above; per-story activation is the second half. Short
explanatory copy plus an inline link to the most-recently-opened
story's Story Settings (or a story picker if none).

### Performance stats + raw-settings export

Existing power-user pane content. Independent of the master
toggle.

## Save session

Standard [save-session pattern](../../patterns/save-sessions.md).
Session boundary: this entire surface — any tab, any field.

## Top-bar

Standard chrome per
[principles → Top-bar design rule](../../principles.md#top-bar-design-rule),
app-level slice: logo + `App Settings` heading + Actions (⚲) + ←.
Universal in-story chrome (status pill + progress strip) and
reader-only chrome (chapter chip, time chip, branch chip) are both
absent — none of that state exists outside a loaded story. The
gear glyph slot here is empty by self-reference (per
[Settings icon scope](../../principles.md#settings-icon-scope) the
regular gear opens App Settings, which is the surface itself).

## Onboarding adjacency

First-launch UX (no provider keys, no profiles configured) lives in
the dedicated [Onboarding](../onboarding/onboarding.md) wireframe.
App Settings is the edit surface for users who already know what
they want; Onboarding is the hand-hold for first-time setup. They
share form components (Theme / Language widgets in Step 1
are literally the same controls as the App / Appearance + Language
tabs); Onboarding's chrome is different (linear flow vs random-
access tabs).

The provider chosen during Onboarding seeds the initial default
provider, the Narrative profile model, and the two default agent
profiles. See
[Onboarding → What gets seeded silently](../onboarding/onboarding.md#what-gets-seeded-silently).
Skipped Onboarding is permanent — there's no "resume the wizard"
affordance from here; users who skipped configure the same way as
anyone else.

## Mobile expression

App Settings is a two-pane navigation surface (left rail + content
pane on desktop / tablet); on phone it collapses list-first per
[`mobile/collapse.md → Two-pane navigation surfaces`](../../foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings).
Same shape as
[Story Settings](../story-settings/story-settings.md#mobile-expression);
differences track this surface's data shape, not the mobile
expression itself.

- **Master-detail collapse on phone.** List state shows all 10
  tabs across 3 sections (GENERATION: Providers, Profiles; STORY
  DEFAULTS: Memory, Translation, Composer; APP: Appearance,
  Language, Data, About, Diagnostics) as a vertical scroll list.
  Tap → tab content as inner full-screen route; back returns to
  list state.
- **List-state nav rows on phone** follow the same shape as
  [Story Settings's mobile expression](../story-settings/story-settings.md#mobile-expression)
  — 44 px tap-target floor, sentence-case sans 16 px label,
  chevron-right glyph, no left-bar accent on phone, sentence-case
  caption group separators. Surface-specific secondary-line
  candidates: `Appearance → <theme name>`, `Language → <code>`,
  `Calendar → <calendar name>` (App Settings's calendar tab is
  app-default; Story Settings overrides per story). Multi-setting
  tabs (Providers, Profiles, Memory, Translation, Composer, Data,
  About, Diagnostics) omit secondary.
- **Top-bar shape on phone** is the app-level non-root variant per
  [`mobile/navigation.md → Phone`](../../foundations/mobile/navigation.md#phone--640-px):
  slim single-row `[←] [App Settings] [⚲]`. No `⛭` (this surface
  isn't in-story; nothing for `⛭` to point to). No `⚙`
  (self-reference per
  [`principles.md → Settings icon scope`](../../principles.md#settings-icon-scope)).
- **Global error banner** (per
  [Layout](#layout)) sits above the top bar on every tier. On
  phone the banner copy truncates with ellipsis if needed; the
  CTA chip stays full-tap-target. Banner is app-level chrome; it
  doesn't hide when the user enters a tab's detail route.
- **Provider list accordion** stacks each provider's configuration
  controls vertically inside the expanded row on phone.
- **Form rows** follow the
  [stacked-on-narrow-container rule](../../patterns/forms.md#form-rows--stacked-on-narrow-container)
  shared with
  [Story Settings's mobile expression](../story-settings/story-settings.md#mobile-expression)
  — stacked on narrow containers (phone, tablet portrait detail
  pane), 2-col on wider containers (tablet landscape, desktop).
- **Profile / provider accordion editors use a tighter label
  column on wide containers.** The 90 px override scoped to
  `.profile-body` and `.narrative-card` applies only when the
  form container is `≥ 640 px` — these editors are denser
  (slider + numeric input + capability annotations on every row)
  and need the extra horizontal room. On narrow containers the
  stacked rule subsumes the override (no label column to shrink);
  on wide containers, main settings rows beside the editors stay
  at 120 px.
- **Slider numeric inputs shrink** from 80 → 50 px on tablet and
  phone via the same `< 1024 px` @container. Slider track
  takes the freed space (it has `flex: 1`); inputs hold 3-4
  chars max ("0.8", "4096", "low", "60s") so 50 px fits cleanly.
- **API key row wraps on narrow tiers.** The status text plus
  Add/Test (or Edit/Test) action buttons sit inline when room
  allows; below combined width the buttons drop below the status
  text via `flex-wrap`.
- **Chapter token threshold uses a chip-row preset+custom
  hybrid** matching
  [Story Settings's threshold control](../story-settings/story-settings.md#mobile-expression)
  — Short / Balanced / Long / Custom… as `.add-chip` cells with
  natural wrap, plus a numeric input below when `Custom…` is
  active. Same primitive on both surfaces; sits outside Select's
  cardinality cascade because it's a preset+numeric hybrid.
- **Narrative profile head** is a single full-width title (no
  subtitle); the previous "always present · cannot be deleted"
  annotation was chrome noise that didn't earn its space.
- **Model picker dropdown** routes to Sheet (medium) on phone per
  the existing
  [`mobile/layout.md → Surface bindings`](../../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces)
  binding (rich grouped list, virtualized).
- **Modals stay Modal** at every tier (provider configuration
  edits, profile delete confirmations, etc.).
- **Save bar, navigate-away guard, stack-aware Return** identical
  to
  [Story Settings's mobile expression](../story-settings/story-settings.md#mobile-expression).
- **Phone landscape** (~700–900 px) lands in tablet tier; rail +
  content side-by-side.

## Screen-specific open questions

- **Reset to defaults action scope** — does "reset" wipe just one
  profile back to its onboarding-seed shape, or is there an
  app-level "reset everything"? Lean: per-profile reset only;
  app-level reset is too dangerous without a stronger confirmation
  flow.
- **Custom OpenAI-compatible endpoint UX** — separate "Configure
  endpoint" surface (URL + auth scheme + model list strategy)?
  Or inline in the Keys row? Defer until we have a concrete custom
  endpoint to validate against.
- **Diagnostics tab depth** — currently lightweight. Likely grows
  over time (cache stats, schema inspector, additional power-user
  config knobs). Observability surfaces themselves live in the
  [Diagnostics Hub](../diagnostics/diagnostics.md) (Actions menu
  entry), not in this tab body; this tab body stays a configuration
  surface.
