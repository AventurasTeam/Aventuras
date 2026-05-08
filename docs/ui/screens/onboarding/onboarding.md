# Onboarding (first launch)

**Wireframe:** [`onboarding.html`](./onboarding.html) — interactive

The first thing a user sees on a fresh install. A four-step linear
wizard that gets them from zero to a working AI configuration with
the minimum possible friction. Skippable at any step — anyone who
bypasses it lands on the [Story list](../story-list/story-list.md)
with a persistent warning bar nudging them to finish setup later in
[App Settings](../app-settings/app-settings.md).

Cross-cutting principles that govern this surface are in
[principles.md](../../principles.md). Relevant sections:

- [Settings architecture — split by location](../../principles.md#settings-architecture--split-by-location)
  (onboarding seeds App Settings; never touches Story Settings)
- [Form controls — Select primitive](../../patterns/forms.md#select-primitive)
  (theme picker is dropdown render mode)

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│                       Welcome to Aventuras                  │
│                          • • • •  step 1 of 4               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   App basics                                                 │
│   ─────────────                                              │
│   A few preferences before we get started. All of these      │
│   are editable later in App Settings.                        │
│                                                              │
│   Language    [System (English) ▾]                           │
│   Theme       [Default Light ▾]                              │
│   Density     [Default ▾]                                    │
│                                                              │
│                                                              │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│   [ Skip for now ]                          [ Next → ]       │
└─────────────────────────────────────────────────────────────┘
```

Centered card on a dim backdrop. No top bar, no Actions, no Settings
gear, no Return — the wizard IS the chrome at first launch. The
four-dot progress indicator under the title is the only navigation
context. `← Back` and `Next →` (or `Finish` on Step 4) live in the
footer along with the persistent `Skip for now` link.

## Cross-cutting decisions

These shape every step:

- **Four steps, no welcome screen.** The wizard opens directly on
  Step 1. Marketing/pitch copy belongs to the website, not the
  installed app's first interaction.
- **Skippable, no resume.** `Skip for now` ends onboarding
  permanently — `app_settings.onboarding_completed_at` records the
  timestamp regardless of whether the user finished or skipped.
  The wizard never re-opens after first dismissal. Users who skip
  rely on the [Story list banner](#story-list-integration--banner)
  to discover the missing setup.
- **No mid-wizard persistence beyond Step 1.** Step 1 selections
  commit on `Next` (they're valid `app_settings.appearance` /
  `app_settings.ui_language` values either way). Steps 2-4 are
  in-memory until the user clicks `Finish` — partial provider /
  embedder config is invalid by zod/TS contract and never touches
  the DB. Closing the window mid-wizard is identical to clicking
  `Skip`: Step 1 commits stay, Steps 2-4 selections are dropped,
  onboarding is marked done.
- **Defaults are sensible.** Every Step 1 field has a default that
  works without thinking. The user can `Next` through Step 1
  without touching anything; nothing here is load-bearing for the
  app to function.
- **Pre-Step-1 language flicker is acceptable.** If the OS locale
  isn't supported, Step 1 renders in the i18next fallback (English)
  before the user picks their language. Lands with i18n
  implementation; not a wireframe-stage decision.

## Step 1 — App basics

Three fields, all with defaults:

- **Language** — i18next-backed dropdown. Defaults to OS locale,
  rendered as `System (<locale>)` so the user knows what they'll get.
  Same control surfaces in
  [App Settings · Language](../app-settings/app-settings.md#app--language).
- **Theme** — picker. Defaults to a curated default (final pick
  lands at session 6 of the
  [foundations pass](../../foundations/README.md)). **Render mode
  is dropdown, not segment**, because Aventuras supports a curated
  gallery of palettes — each mode-locked (`light` | `dark`) — that
  grows past the segment threshold and will eventually be joined by
  user-installable themes. At wireframe stage the dropdown shows
  placeholder entries (`Default Light` / `Default Dark` /
  `Parchment`); the actual catalog ships with session 6 of the
  visual identity pass. Same control as
  [App Settings · Appearance](../app-settings/app-settings.md#app--appearance).
  No "System" entry — OS dark/light follow is parked-until-signal
  per [`parked.md`](../../../parked.md#os-darklight-follow).
- **Density** — picker. Defaults to `'default'` (sentinel
  resolving to `regular` on phone+tablet, `compact` on desktop
  per [`spacing.md → Density toggle`](../../foundations/spacing.md#density-toggle)).
  Four options: `Default` (recommended, with subtitle "Compact on
  desktop, Regular on phone and tablet"), `Compact`, `Regular`,
  `Comfortable`. Cascade picks dropdown render mode (4 options
  with descriptions on `Default` triggers radio; the other three
  flatten — final render mode resolves at impl per
  [forms.md cascade](../../patterns/forms.md#auto-derivation-cascade)).
  Same control surfaces in
  [App Settings · Appearance](../app-settings/app-settings.md#app--appearance).

`Next →` advances to Step 2 and writes the three values into
`app_settings.appearance`.

## Step 2 — Pick your provider

The user picks one provider type from a vertical list of four cards.
Single-select radio.

```
┌──────────────────────────────────────────────────┐
│  ◯  OpenRouter                                   │
│     Pay-as-you-go gateway across 300+ models     │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│  ◯  NanoGPT                                      │
│     Subscription-based access                    │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│  ◯  NVIDIA NIM                                   │
│     Free tier, hosted by NVIDIA                  │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│  ◯  OpenAI-compatible                            │
│     Ollama, LM Studio, custom endpoints          │
│     ⚠ Requires extra setup                       │
└──────────────────────────────────────────────────┘

Other providers (Anthropic, OpenAI, Google) available in Settings →
```

The three native picks cater to **distinct billing models** — PAYG,
subscription, free — so first-time users with very different cost
tolerances can each pick something that fits. The 4th option
(OpenAI-compatible) catches everyone running local models or
self-hosted endpoints.

Anthropic, OpenAI, and Google are intentionally **not** in the
wizard. They're available in
[App Settings · Providers](../app-settings/app-settings.md#generation--providers)
along with the other types.

**The footer link is a real wizard exit, not a passive hint.**
Clicking it has the same effect as `Skip for now` (commits any
Step 1 changes, drops Step 2/3 selections, marks
`onboarding_completed_at`) — but routes to **App Settings ·
Providers** with the `+ Add provider ▾` type picker open instead
of dropping the user on Story list. Same end state as Skip, just
landing the user where they're trying to go. Three exits total:
`Skip for now` (→ Story list, banner fires), this footer link
(→ App Settings · Providers, banner fires when they later visit
Story list), `Finish` on Step 3 (→ Story list, no banner).

`Next →` requires a selection.

## Step 3 — Configure provider

Step 3 morphs based on the Step 2 selection.

### Native (OpenRouter / NanoGPT / NVIDIA NIM)

```
┌────────────────────────────────────────────────────────┐
│   Connect to <Provider>                                │
│   ─────────────                                        │
│                                                         │
│   API key                                               │
│   [ ••••••••••••••••••••••••• ]               [ Test ] │
│                                                         │
│   Don't have one? Get an API key from <Provider> →     │
│                                                         │
└────────────────────────────────────────────────────────┘
   [ Skip for now ]              [ ← Back ]   [ Finish ]
```

- **`Test`** is optional. Hits the provider's `/models` (or
  equivalent auth endpoint). Success → green check. Failure → inline
  warning: `Couldn't reach <Provider>. Check the key, or finish
setup and fix later in Settings.` **Does not block `Finish`** —
  same skippable philosophy as the rest of the wizard.
- **Helper link** opens the provider's API-key acquisition page in
  the user's default browser.

`Finish` →

1. Writes the provider to `app_settings.providers` with `displayName`
   defaulted to the provider type.
2. Marks it as `default_provider_id`.
3. Auto-fetches the model catalog (background, non-blocking).
4. Seeds the [silent profile/assignment defaults](#what-gets-seeded-silently).
5. Marks `onboarding_completed_at`.
6. Routes to **Story list**. Brief [toast](../../patterns/toast.md)
   confirms:
   `<Provider> connected. Default model: <auto-pick>. Change anytime in Settings.`

### OpenAI-compatible

```
┌────────────────────────────────────────────────────────┐
│   Connect to a custom endpoint                         │
│   ─────────────                                        │
│                                                         │
│   Endpoint URL  *required                              │
│   [ http://localhost:11434/v1                       ]   │
│                                                         │
│   API key  (optional — many local servers don't        │
│             require one)                               │
│   [                                            ] [Test]│
│                                                         │
│   ⚠ You'll need to pick a model in Settings before     │
│      generation works. We'll take you there.           │
│                                                         │
└────────────────────────────────────────────────────────┘
   [ Skip for now ]              [ ← Back ]   [ Finish ]
```

- **Endpoint URL** — required. Surfaced inline (not collapsed)
  because there's no canonical default for "any compatible
  endpoint". Same field as
  [App Settings · Providers (OpenAI-compatible variations)](../app-settings/app-settings.md#openai-compatible--variations).
- **API key** — optional. Local servers (Ollama, LM Studio) typically
  don't authenticate. Empty allowed.
- **Warning copy** sets expectation: completing this step does NOT
  finish setup; the user still has to pick a model.

`Finish` →

1. Writes the provider with `type: 'openai-compatible'`,
   `endpoint`, and (optional) `apiKey`.
2. Marks it as `default_provider_id`.
3. Triggers a model auto-fetch synchronously (with a brief loading
   state).
4. **Routes by fetch outcome**:
   - **Models returned** → routes to
     [App Settings · Profiles](../app-settings/app-settings.md#generation--profiles)
     so the user can pick which model the Narrative profile uses.
     Reasoning: most local Ollama installs already have a model
     loaded; jumping straight to model selection completes setup
     in one more click.
   - **No models / fetch error** → routes to
     [App Settings · Providers](../app-settings/app-settings.md#generation--providers)
     with this provider's row pre-expanded and the
     `+ Add custom model id` affordance highlighted. The user adds
     a model id manually, then can navigate to Profiles.
5. Marks `onboarding_completed_at`.
6. The Story list banner does **not** fire on this path until the
   user actually navigates there — they're already in Settings,
   the work is in front of them.

## Step 4 — Pick an embedder

Story creation requires an embedder for retrieval-driven memory.
Step 4 is a single grouped picker covering both the curated catalog
(the common path) and any configured provider's embedding models.
Custom-file import is power-user-only and lives in
[App Settings · Embedding models](../app-settings/app-settings.md#generation--embedding-models),
not the wizard.

```
┌────────────────────────────────────────────────────────┐
│  Pick an embedder                                       │
│  ─────────────                                          │
│  An embedding model lets Aventuras find relevant        │
│  memory rows when generating responses.                 │
│                                                          │
│  Embedder model                                         │
│  [ MiniLM-L6 (lightweight) — 25 MB              ▾ ]    │
│                                                          │
│   (dropdown options, grouped:)                          │
│   ── Curated local models ──                            │
│   • MiniLM-L6 (lightweight)              25 MB          │
│       Small, fast, English-focused.                     │
│   • BGE-base-en (mid)                   120 MB          │
│       Higher quality, English-focused.                  │
│   ── Provider models ── (when configured provider       │
│                          supports embeddings)           │
│   • OpenRouter / text-embedding-3-small                 │
│                                                          │
│  Advanced setup → import a custom model file in         │
│  Settings · Embedding models                            │
│                                                          │
│  [ Skip for now ]                          [ Finish ]   │
└────────────────────────────────────────────────────────┘
```

The picker is a single Select with grouped options rather than
two radio cards — pickers scale better than radio lists when the
catalog grows, and one field reads more cleanly than two parallel
groups. Selecting an entry implicitly determines the backend
(curated entries set `backend=local`; provider entries set
`backend=provider`).

### Path A — Curated local model

Selecting a curated entry and clicking `Finish`:

1. **Triggers the curated download flow** — same dialog component
   as
   [App Settings · Embedding models · Add model](../app-settings/app-settings.md#installed-local-models)
   (live model-card fetch at the catalog's pinned
   `huggingfaceRevision`, license dialog with source URL +
   revision hash). Single canonical UI; the wizard just invokes
   it.
2. On accept, downloads the three required files into
   `<embedders-root>/<sanitized-id>/`, SHA256-verifies, writes
   `LICENSE.txt` + `.attestation` per
   [`memory/model-management.md → Download flow`](../../../memory/model-management.md#download-flow).
3. Seeds:
   - `app_settings.default_story_settings.embeddingBackend = 'local'`
   - `app_settings.default_story_settings.embedding_model_id = '<picked-id>'`
4. Routes to Story list (no banner — embedder configured).

If the user **declines the license** or **cancels mid-download**,
the download dialog dismisses back to Step 4 with the picker
unchanged — no defaults seed, the wizard remains on Step 4 so the
user can pick a different entry, retry, or skip. License-acceptance
is contingent on completion (see
[`memory/model-management.md → License attestation`](../../../memory/model-management.md#license-attestation)).

### Path B — Provider embedder

The "Provider models" group only appears in the dropdown when the
just-configured provider exposes embedding-capable models (per the
capability classification in
[App Settings · Providers' Embedding models section](../app-settings/app-settings.md#models--split-by-capability)).
For providers without embedding capability (e.g. Anthropic today),
the group is omitted entirely rather than shown disabled.

Selecting a provider entry and clicking `Finish`:

1. No download — the model lives on the provider, nothing to fetch
   locally.
2. Seeds:
   - `app_settings.default_story_settings.embeddingBackend = 'provider'`
   - `app_settings.default_story_settings.embedding_model_id = '<picked-id>'`
   - (Per-story `embedding_provider_id` lands once the
     [v1 followup](../../../memory/followups.md#v1-blocking)
     resolves; until then the provider is implicitly the default.)
3. Routes to Story list (no banner).

### Skip on Step 4

Same shape as Skip on any earlier step — onboarding marked done,
Steps 2-4 in-memory state dropped (provider config from Step 3
still gets committed on Skip from Step 4 — behavior parity with
clicking `Finish` on a provider-configured wizard, just without
the embedder seed). Story list banner fires noting embedder needs
configuration.

### Why no custom-file import here

Custom imports require the user to provide three HF files plus
pick an EP under which to validate the model. That's enough
ceremony to belong on a power-user surface, not a first-launch
wizard. The wizard's advanced-setup link routes to Settings if the
user needs that path.

## Skip behavior

`Skip for now` is present on every step. Clicking it:

1. Commits whatever Step 1 changes the user made (defaults if they
   didn't touch anything).
2. Commits Step 3 provider config if Step 3 was completed (i.e.,
   skip-from-Step-4 keeps the provider; skip-from-earlier-steps
   drops provider config too).
3. Drops Step 4 in-memory selection (no embedder seeds).
4. Marks `onboarding_completed_at` with the skip timestamp.
5. Routes to **Story list**, where the
   [banner](#story-list-integration--banner) fires noting whatever
   remains unconfigured (provider, embedder, or both).

The wizard never re-opens. Users who skipped configure providers
the same way as users whose initial provider stopped working: from
[App Settings · Providers](../app-settings/app-settings.md#generation--providers).

**No "Continue setup" or "Resume wizard" UX exists.** Once dismissed
the wizard is done. This is intentional — a one-shot wizard whose
state can resurface unexpectedly is a worse experience than a clear
banner the user can dismiss when they're ready to act on it.

## What gets seeded silently

Whether the user clicks `Finish` on a native provider or completes
the OAI-compat path, the same set of `app_settings` records get
written without any user-facing UI:

- **Default provider** — the just-configured provider becomes
  `default_provider_id`.
- **Narrative profile** — created with `kind: 'narrative'`, name
  `Narrative`, model = the auto-picked default for native
  providers, or `unset` for OAI-compat (filled in when the user
  picks a model in Settings).
- **Agent profiles** — two created from preset templates:
  - `Fast tasks` — cheap routine agents.
  - `Heavy reasoning` — chapter-close work.
- **Assignments** — every agent in the
  [agent registry](../../../data-model.md#app-settings-storage)
  gets wired to one of the two profiles. Includes
  `wizard-assist` (backs all AI calls fired from the
  [Story creation wizard](../wizard/wizard.md)), seeded to
  the `Fast tasks` profile by default.
- **Embedder default** (Step 4) — when the user finishes Step 4
  with a curated pick or provider pick:
  - `app_settings.default_story_settings.embeddingBackend` set to
    `'local'` or `'provider'` per the pick.
  - `app_settings.default_story_settings.embedding_model_id` set
    to the chosen model id.
  - For curated picks, the model file lands in
    `<embedders-root>/<sanitized-id>/` per
    [`memory/model-management.md → Storage layout`](../../../memory/model-management.md#storage-layout).
  - When Step 4 is skipped, no embedder defaults seed; the Story
    list banner notes embedder needs setup.

> **Note:** the specific profile names (`Fast tasks` /
> `Heavy reasoning`), the per-agent assignment matrix, and the
> auto-pick model for each native provider are **placeholder
> shapes** for the wireframe. The final templates land alongside
> implementation when we've benchmarked which models / parameter
> envelopes actually fit each agent's job.

The user discovers any of this only by visiting
[App Settings · Profiles](../app-settings/app-settings.md#generation--profiles)
deliberately. Onboarding never mentions the words "profile",
"agent", or "assignment".

## Story list integration — banner

When the user skips this wizard (per [Skip behavior](#skip-behavior)),
the story list shows a persistent warn bar driving them back to App
Settings · Providers when ready. Banner copy, mutual exclusion with
the profile-error banner, and the no-Resume-Setup-CTA rationale all
live in
[principles → Persistent app-level banners](../../principles.md#persistent-app-level-banners).
Onboarding is the trigger driver; the story list is the host
surface.

## Mobile expression

Renders per the
[mobile foundations contracts](../../foundations/mobile/README.md).
Full-screen route on every tier per
[layout.md → Surface bindings](../../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces);
the wizard IS the chrome at first launch, so no universal top-bar
applies. Tablet inherits desktop verbatim per
[navigation.md → Tablet](../../foundations/mobile/navigation.md#tablet-6401023-px);
phone-tier specifics below.

- **Centered card → full-bleed on phone.** Desktop and tablet
  frame a 560-px-wide centered card on a dim backdrop. On phone
  the card fills the viewport — no max-width, no margin, no
  shadow, no border-radius. The dim backdrop is invisible because
  the card covers the screen.
- **Header padding.** `28px 36px` → `16px 20px` on phone.
- **Body padding.** `28px 36px` → `16px 20px`.
- **Footer padding.** `14px 24px` → `12px 16px`.
- **Form rows** (Step 1: `[110px label] [control]` grid). Stays —
  labels are short (`Language`, `Theme`); 110 px label alongside
  ~218 px control fits at 360 px width without reflow.
- **Provider cards** (Step 2). Already vertical
  (`flex-direction: column`); naturally phone-friendly. No reflow.
- **Step 3 native variant.** `[API key input][Test]` row — input
  flexes, test button shrinks padding. Helper link wraps below.
- **Step 3 OAI-compat variant.** Endpoint URL input on its own
  row, `[API key][Test]` on the next, warning callout below. All
  fit under normal flex behavior.
- **Footer.** `[Skip for now] [foot-spacer] [Back] [Next/Finish]`
  stays horizontal on phone; "Skip for now" is short, padding
  compresses.
- **Provider exit-link** (`Set up Anthropic / OpenAI / Google →`)
  wraps onto two lines on phone. Acceptable.
- **Status bar style** binds to the active theme's `themeMode` per
  [platform.md → Status bar style](../../foundations/mobile/platform.md#status-bar-style);
  Step 1's theme pick takes effect for the rest of onboarding once
  committed.
- **Safe areas.** Card edges honor `insets.top` and
  `insets.bottom` per
  [platform.md → Safe areas](../../foundations/mobile/platform.md#safe-areas)
  — content doesn't slide under the notch / home indicator.

Design rationale and adversarial findings in
[`explorations/2026-05-01-mobile-group-a-entry-flow.md`](../../../explorations/2026-05-01-mobile-group-a-entry-flow.md).

## Data-model touchpoints

Schema-side changes settled in this pass:

- **`app_settings.onboarding_completed_at`** — singleton timestamp
  set on first dismissal (whether `Finish`, `Skip for now`, or the
  Step 2 footer-link exit). Driving condition for whether the
  wizard renders as root on app boot. Schema authority in
  [`data-model.md → App settings storage`](../../../data-model.md#app-settings-storage).
- **Provider type enum** — `app_settings.providers[].type` now
  includes `'nvidia-nim'` alongside the existing six. Schema
  authority in
  [`data-model.md → App settings storage`](../../../data-model.md#app-settings-storage);
  UI surface in
  [App Settings · Providers](../app-settings/app-settings.md#generation--providers).

Open implementation TODO (not a decision):

- **Default-model auto-picks per native type** — each of OpenRouter
  / NanoGPT / NVIDIA NIM needs a hardcoded default model id the
  Narrative profile gets seeded with. Lives with implementation
  (model availability shifts faster than docs).

## Screen-specific open questions

- **OAI-compat with mixed result on auto-fetch** — what counts as
  "models returned"? An empty array clearly routes to Providers; a
  non-empty array clearly routes to Profiles. Edge case: fetch
  returns 200 OK with a single garbage entry. Lean: trust the count;
  any non-empty list routes to Profiles, the user filters from
  there. Revisit if real endpoints surface bad data.
- **Banner dismissal** — should the no-providers banner be
  dismissible (e.g. "Don't show again" → silent until app
  restart)? Lean: no. The banner is the only standing reminder
  for users who skipped; making it dismissible recreates the
  problem skip already solved.
- **Auto-pick model migration** — if our hardcoded auto-pick model
  for, say, OpenRouter gets retired by the provider, the user's
  Narrative profile breaks the next time they generate. This is the
  same failure mode the existing
  [`N profiles have configuration errors`](../app-settings/app-settings.md#per-profile-error-states--global-banner)
  banner already covers — no new design needed, but worth flagging
  as a foreseeable flow.
