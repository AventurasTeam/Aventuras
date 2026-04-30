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
- **Models** — visible list defaults to **pinned only** (a curated
  short-list of the user's working set). Below it: a `View all N
models →` toggle that expands to a search + filter view of the
  full catalog. Necessary for gateway providers like OpenRouter
  where 300+ models would be unusable as a flat list.
  - **Pinned section** — always visible. Short by design; this is
    the user's quick-access set.
  - **View all expanded** — search input (filter by name) + capability
    filter chips (`🧠 reasoning`, `⚙ structured`, `★ pinned only`) +
    scrollable list. Virtualized for large catalogs per
    [patterns → Large lists](../../patterns/lists.md#large-lists--virtualization-rule)
    (OpenRouter ships 340+ models). Pinned float to the top of the
    unified list.
  - **Per-row actions** — pin star (☆ / ★), capability badges
    (🧠 reasoning, ⚙ structured output where capability data is
    available), remove-from-cache (×).
  - **Threshold for showing "View all"** — providers with very few
    models (e.g., a local Ollama instance with 3 models) skip the
    pinned/all distinction and just show the full list inline. The
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

### Model fetching strategy

- **Refresh on app launch** — automatic on startup, **staggered**
  across configured providers to avoid hammering the network with
  parallel calls.
- **Manual refresh** per provider via the `↻` button on the model
  list head.
- **Cached results persisted** in SQLite alongside provider config;
  survive restarts even when offline.

### Provider menu (⋯)

- **Rename** — change display name.
- **Set as default** — moves the ⭐ to this provider; replaces the
  current default (one default total). Triggers update of any
  "App default" sentinel resolutions.
- **Remove** — confirmation prompt; profiles using this provider's
  models surface broken-config errors after removal (not auto-deleted).

### Default provider

One configured provider can be marked default (⭐ badge on the row).
Set during [Onboarding](../onboarding/onboarding.md#what-gets-seeded-silently),
editable here. The default provider seeds the Narrative profile
model and "Reset to defaults" actions across the rest of the app.

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

- **provider/model** — dropdown grouped by provider; model items show
  capability icons (🧠 reasoning, ⚙ structured output) inline.
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
accordion. Each profile carries the same fields as Narrative plus
`structured output` (auto / force on / force off):

- **`auto`** uses capability data: model supports → force-on; model
  doesn't → force-off; data unavailable → force-off (conservative).
- **force on / force off** override the auto logic.

`+ New profile` adds a profile (name + description + standard fields).
Profile `⋯` menu offers rename, duplicate, delete (delete is blocked
when agents are still assigned — the user is prompted to reassign
first).

**Default agent profiles seeded by
[Onboarding](../onboarding/onboarding.md#what-gets-seeded-silently):**
`Fast tasks` (cheap routine agents) and `Heavy reasoning` (lore-mgmt

- memory-compaction at chapter close). The names and exact
  assignment matrix are placeholder shapes; final templates land with
  implementation. User can rename / delete / extend.

### Assignments

Each agent dropdown picks a profile. Agents currently in the system:

- `classifier` — every reply
- `translation` — pipeline phase
- `suggestion` — next-turn suggestion pane
- `lore-mgmt` — chapter close
- `memory-compaction` — chapter close
- `retrieval` — retrieval phase (when designed)

Default assignment seeded by
[Onboarding](../onboarding/onboarding.md#what-gets-seeded-silently)
(typically all → `Fast tasks` except the chapter-close pair →
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

The **global error banner** above the main header aggregates all
broken profiles: `N profiles have configuration errors. [Open settings →]`.
The action button deep-links to App Settings · Profiles with the
first broken profile scrolled into view (or Keys if the issue is a
missing key).

### Custom model id + favorites + fetch refresh

Power-user features that earn their v1 weight:

- **Add custom model id** — bottom of the model dropdown, `+ Add custom…`
  opens a small input for an id the fetched list doesn't contain
  (custom OpenAI-compatible deployments, fine-tunes).
- **Favorite / pin** — small star toggle on each dropdown item.
  Pinned models float to the top of the list across all selectors.
- **Refresh fetch** — `↻` button on the provider row in Keys,
  per-dropdown manual refresh on the model picker.

## STORY DEFAULTS

Mirrors the corresponding Story Settings tabs, but configures the
**defaults** that get **copied into new stories at creation time**.
Per the
[settings scope policy](../../principles.md#settings-architecture--split-by-location)
(copy-at-creation): editing these does not propagate to existing
stories.

### Memory

Same form as Story Settings · Memory — chapter token threshold (with
preset buttons), recent buffer, compaction detail. Form component
literally reused; only data binding differs.

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

Theme picker, density toggle, conditional accent override. The
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

**Density** is a `comfortable` / `compact` segment. Persists at
[`app_settings.appearance.density`](../../foundations/theming.md#density-token-policy)
and applies app-wide independent of theme. May be cut at session 4
if the cross-platform implementation cost doesn't pencil — see the
session 4 cut path.

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
it. One picker UI handles all accent-overridable themes
uniformly.

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

Debug toggles, view-logs button, performance stats, raw-settings
export. Power-user / debug surface. Heavier observability tooling
(global delta-log browser) lives in its own future panel — see
followups.

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
share form components (Theme / Language / Density widgets in Step 1
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

## Screen-specific open questions

- **Reset to defaults action scope** — does "reset" wipe just one
  profile back to its onboarding-seed shape, or is there an
  app-level "reset everything"? Lean: per-profile reset only;
  app-level reset is too dangerous without a stronger confirmation
  flow.
- **Provider deletion** — see
  [`followups.md → Provider / profile / model-profile deletion semantics`](../../../followups.md#provider--profile--model-profile-deletion-semantics)
  (the working lean — broken-config state, no auto-delete — is
  recorded there pending the dedicated pass).
- **Custom OpenAI-compatible endpoint UX** — separate "Configure
  endpoint" surface (URL + auth scheme + model list strategy)?
  Or inline in the Keys row? Defer until we have a concrete custom
  endpoint to validate against.
- **Diagnostics tab depth** — currently lightweight. Likely grows
  over time (debug flags, retry counts, cache stats, schema
  inspector). Eventually overlaps with the planned global delta-log
  observability panel — boundary lands with the
  [Observability / debug UI followup](../../../parked.md#observability--debug-ui).
