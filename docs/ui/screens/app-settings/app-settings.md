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
- [Form controls — Select primitive](../../principles.md#form-controls--select-primitive)
- [Entity editing — explicit save, session-based](../../principles.md#entity-editing--explicit-save-session-based)

## Layout

```
┌────────────────────────────────────────────────────────────┐
│ ⚠ N profiles have configuration errors. [Open settings →] │ ← global error banner (when broken)
├────────────────────────────────────────────────────────────┤
│ [logo] App Settings                       [⎇] [←]          │ ← top bar
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

Six provider **types** available in v1:

- **Anthropic** — `/messages`
- **OpenAI** — chat + new `/responses`
- **Google** — Gemini
- **OpenRouter** — has model capability flags (reasoning, structured
  output)
- **NanoGPT** — has model capability flags
- **OpenAI-compatible** — catch-all for Ollama / LM Studio / any
  endpoint speaking OpenAI's chat shape (user supplies endpoint URL)

### Provider list

Empty by default after install (until Onboarding seeds one). Each
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
  ☆ claude-haiku-4.5     ⚙                 [×]
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
    scrollable list (windowed for large catalogs). Pinned models float
    to the top of the unified list.
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
Set during Onboarding, editable here. The default provider seeds the
Narrative profile model and "Reset to defaults" actions across the
rest of the app.

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

**Default agent profiles seeded by Onboarding:** `Fast tasks` (cheap
routine agents) and `Heavy reasoning` (lore-mgmt + memory-compaction
at chapter close). User can rename / delete / extend.

### Assignments

Each agent dropdown picks a profile. Agents currently in the system:

- `classifier` — every reply
- `translation` — pipeline phase
- `suggestion` — next-turn suggestion pane
- `lore-mgmt` — chapter close
- `memory-compaction` — chapter close
- `retrieval` — retrieval phase (when designed)

Default assignment seeded by Onboarding (typically all → `Fast tasks`
except the chapter-close pair → `Heavy reasoning`).

Image generation is **deferred** as a feature; no `imageGen` agent
entry until the feature lands. Tracked in
[`followups.md`](../../../followups.md#image-generation).

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

### Composer prefs

Same form as Story Settings · Generation · Authoring aids — composer
modes enabled, wrap POV (first / third), suggestions enabled.

## APP · Appearance

Theme picker, density (comfortable / compact), accent color
preference. Final styling lands with visual identity.

**Theme is a dropdown**, not a segment — built-in `light / dark /
system` will be joined by user-installable / user-authored custom
themes later, so cardinality grows past the segment threshold.
Defaulting to dropdown now avoids reshaping the control when
themes ship.

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

Same explicit-save pattern as Story Settings — see
[principles → Entity editing](../../principles.md#entity-editing--explicit-save-session-based).
First field edit opens a session; tab switching is within session;
Save commits all changes under one `action_id`; Discard throws away;
navigate-away guard when dirty.

## Top-bar

App Settings doesn't show story-context chrome (no chapter chip,
time chip, branch icon, gen status — none of those exist outside
a loaded story). Top bar carries:

- Logo + `App Settings` heading
- Actions (⎇)
- Return (←) → back to story list

## Onboarding adjacency

First-launch UX (no provider keys, no profiles configured) lives in
the dedicated Onboarding wireframe (separate inventory item). App
Settings is the edit surface for users who already know what they
want; Onboarding is the hand-hold for first-time setup. They share
form components; Onboarding's chrome is different (linear flow vs
random-access tabs).

The profile and provider chosen during Onboarding seed the initial
Narrative profile and the default provider.

## Screen-specific open questions

- **Reset to defaults action scope** — does "reset" wipe just one
  profile back to its onboarding-seed shape, or is there an
  app-level "reset everything"? Lean: per-profile reset only;
  app-level reset is too dangerous without a stronger confirmation
  flow.
- **Provider deletion** — when a user removes a provider key, what
  happens to profiles using that provider's models? Lean: profiles
  remain (with broken-config error state), prompting the user to
  re-pick. Don't auto-delete profiles on key removal.
- **Custom OpenAI-compatible endpoint UX** — separate "Configure
  endpoint" surface (URL + auth scheme + model list strategy)?
  Or inline in the Keys row? Defer until we have a concrete custom
  endpoint to validate against.
- **Diagnostics tab depth** — currently lightweight. Likely grows
  over time (debug flags, retry counts, cache stats, schema
  inspector). Eventually overlaps with the planned global delta-log
  observability panel — boundaries TBD.
