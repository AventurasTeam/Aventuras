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
- [Search bar scope](../../principles.md#search-bar-scope)
  (Profiles tab gets a search input over the agent profile list)

## Layout

```
┌────────────────────────────────────────────────────────────┐
│ ⚠ N profiles have configuration errors. [Open settings →] │ ← global error banner (when broken)
├────────────────────────────────────────────────────────────┤
│ [logo] App Settings                       [⎇] [←]          │ ← top bar
├───────────────┬────────────────────────────────────────────┤
│ PROVIDERS     │ Profiles                                    │ ← pane header
│ · Keys        │ ─────                                       │
│ · Profiles    │ Narrative profile                           │
│ · ImageGen    │ [model] [temp] [max] [think] [timeout]      │
│               │ ▸ Advanced — custom JSON                    │
│ STORY DEFAULTS│                                             │
│ · Memory      │ Agent profiles      [+ New profile]         │
│ · Translation │ ▾ Fast tasks                                │
│ · Composer    │   …                                         │
│               │ ▸ Vision tasks                              │
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

11 tabs across 3 sections.

## Section split

**PROVIDERS** — LLM provider configuration (keys, profiles for text
models, image-gen config).
**STORY DEFAULTS** — values copied into new stories at creation time
(per the
[settings scope policy](../../principles.md#settings-architecture--split-by-location)).
**APP** — general app behavior (theme, language, data ops, about,
diagnostics).

## PROVIDERS · Keys

API key entry per provider. Six providers in v1:

- **Anthropic** — `/messages`
- **OpenAI** — chat + new `/responses`
- **Google** — Gemini
- **OpenRouter** — has model capability flags (reasoning, structured
  output)
- **NanoGPT** — has model capability flags
- **OpenAI-compatible** — catch-all for Ollama / LM Studio / custom
  endpoints (user supplies endpoint URL + key)

Each provider row shows:

- Status (✓ configured / ○ not set)
- API key (masked: `••••••••••••a3f`); edit / remove actions
- Model fetch state — `12 cached · [refresh ↻]`. The fetch hits the
  provider's `/models` endpoint and caches the result; manual refresh
  re-fetches.
- "Default" badge ⭐ on the user's chosen default provider (one star
  total across all providers).

**Default provider** — set during onboarding, editable here. The
default provider seeds the Narrative profile and "reset to defaults"
actions across the rest of the app.

**Storage.** API keys live in SQLite per the data strategy. Encryption
at rest is a tracked followup; surfacing it here would be premature.

## PROVIDERS · Profiles

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
routine agents), `Vision tasks` (image gen — actually moved to its
own tab; see ImageGen below), `Heavy reasoning` (lore-mgmt +
memory-compaction at chapter close). User can rename / delete /
extend.

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

## PROVIDERS · ImageGen

Different shape from text profiles — image-gen parameters don't
overlap with temperature/max-output/thinking. Single configuration
(no profile system; image-gen is one job, one model):

- **provider/model** — dropdown filtered to image-gen capable models.
- **size** — preset dropdown (256, 512, 1024, custom).
- **quality** — preset (standard / hd / etc., per provider).
- **style** — preset (vivid / natural / etc., per provider).
- **custom prompt prefix** — optional text prepended to all generated
  prompts (style direction).
- **timeout** — same 5–300s pattern.
- **Advanced — custom JSON payload** — same per-field override
  affordance.

Story Settings · Models can override the imageGen model id (and
nothing else for v1; deep per-story image-gen params is a followup).

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

Theme picker (light / dark / system), density (comfortable /
compact), accent color preference. Final styling lands with visual
identity.

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
- **Import story** — `.avts` file picker (also accepts legacy `.avt`
  via migration import — see followups).
- **Export all stories** — bulk per-story export.

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
