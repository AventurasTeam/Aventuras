# Banners

Persistent app-level warn bars rendered above main content on the
**story list** screen — the only app-level surface that hosts them
in v1. Sister to [`toast.md`](./toast.md) (transient ephemeral
notifications); banners are persistent and tied to specific app
states that need explicit user action to clear.

Used by:

- [Story list](../screens/story-list/story-list.md#banner--ai-configuration)
  — the sole banner host today; mutual-exclusion priority resolver
  runs here.

## Variants

Three banner shapes are defined today:

- **AI not configured** — fires when `app_settings.providers` is
  empty (user skipped onboarding, or deleted the last provider).
  Copy: `⚠ AI generation not configured. [Set up a provider →]`.
  CTA routes to
  [App Settings · Providers](../screens/app-settings/app-settings.md#generation--providers).
  Never re-opens the onboarding wizard — that path is intentionally
  one-shot (see
  [Onboarding → Skip behavior](../screens/onboarding/onboarding.md#skip-behavior)).
- **Embedder not configured** — fires when no embedder default is
  set (user skipped Onboarding · Step 4, or removed all installed
  models without configuring a provider embedder). Copy:
  `⚠ Memory not configured — set up an embedder to create stories. [Open settings →]`.
  CTA routes to
  [App Settings · Embedding models](../screens/app-settings/app-settings.md#generation--embedding-models).
  Story creation is hard-gated until resolved.
- **Profile errors** — fires when at least one profile has a
  configuration error (e.g., references a model that's no longer
  in the provider's catalog). Copy:
  `⚠ N profiles have configuration errors. [Open settings →]`.
  CTA routes to
  [App Settings · Profiles](../screens/app-settings/app-settings.md#generation--profiles).

## Mutual exclusion + priority

Multiple banners can be true at the same time — a user who skipped
onboarding might have no provider AND no embedder AND leftover
profile errors from a prior session. Only one renders, with the
priority order:

```
no-providers > no-embedder > profile-errors
```

Provider must exist before embedder can be configured (provider
mode) or referenced (local mode also needs a provider for
narrative); both must exist before profile errors are
downstream-meaningful. When the user fixes the higher-priority
state, the next-priority banner takes over if still applicable.

## What does NOT trigger a banner

**Provider-only misconfiguration** (e.g., a key the user typed
wrong, but no profile references that provider yet) does NOT
trigger any banner. Per-row indicators on the Providers list
surface that lower-stakes case. A misconfigured provider only
escalates to banner status once a profile references it.

## Why no "Resume setup" CTA

Once the user crosses the wizard's skip threshold, onboarding is
over; the banner sends them to App Settings, where the affordances
are richer and the hand-hold isn't needed. Re-opening the wizard
would duplicate paths and create state-recovery questions we don't
want.

## Visual treatment

Subtle warn-tinted background (light amber on light themes; deep
amber-on-charcoal on dark themes), thin top + bottom border,
~10 px vertical padding, full-width across the story-list main
column. Icon glyph `⚠` precedes the copy; CTA is an underlined
link-styled inline word/phrase. Specific tokens land with the
themes pass.
