# 2026-05-19 — `default_models` authority reconciliation

Resolves the `Reconcile default_models authority — seed source vs
runtime resolver` followup (added earlier the same day during the
ProviderModelPicker design, removed from `followups.md` in the same
commit as this resolution).

The docs described `app_settings.default_models` inconsistently —
sometimes as stored mutable state and runtime resolver authority,
sometimes adjacent to the resolver chain. User clarification pinned
the intended model: it's a **baked-in code constant**, not stored
state. Consulted only at seed-time (Onboarding) and at user-triggered
`Reset to defaults`. Runtime resolution for agents goes
`stories.settings.models[agentId]` (override) → `profile.modelRef`
via `assignments[agentId]`, never through this constant.

## Outcome

`app_settings.default_models` is **deleted** from the data model. A
new code constant `PROVIDER_DEFAULTS` replaces it, indexed by
`(providerType, role)` and carrying the full default Profiles-page
state (narrative profile defaults + agent profile set + assignment
matrix). Same constant powers both onboarding's silent seed and a
new page-level `Reset to defaults` action on App Settings · Profiles.

Three key shape decisions:

1. **Code constant, not stored data.** Provider-recommended models
   evolve with provider releases. Tracking defaults as code lets the
   recommendation set update with an app release rather than a data
   migration. Already-seeded users keep their snapshot; explicit
   `Reset to defaults` is the re-seed path.
2. **Whole-page reset, not per-field.** `Reset to defaults` replaces
   narrative profile + agent profile set + assignment matrix in one
   transaction. Discards any user-added agent profiles. Mirrors the
   original onboarding seed shape; single AlertDialog gate.
3. **No-defaults case clears, doesn't fallback.** Provider types
   without a `PROVIDER_DEFAULTS` entry (`openai-compatible`, where
   the right model varies per deployment) clear `profiles[]` and
   `assignments` to empty / blank. Broken-state vocabulary surfaces
   immediately at next fire time — honest about the configuration
   need.

## Shape

```ts
type RoleDefaults = {
  modelId: string
  temperature?: number
  maxOutput?: number
  thinking?: number
  timeout?: number
  // structuredOutput on agent-profile entries
}

type ProviderTypeDefaults = {
  narrative: RoleDefaults
  agentProfiles: Array<{
    name: string
    description: string
    defaults: RoleDefaults
  }>
  defaultAssignments: Partial<Record<AgentId, string>>
  // agentId → profile NAME from agentProfiles above; resolved to
  // generated UUIDs at seed time
}

const PROVIDER_DEFAULTS: Partial<Record<ProviderType, ProviderTypeDefaults>>
```

Reset-to-defaults flow:

```
lookup = PROVIDER_DEFAULTS[providers[default_provider_id].type]

if (lookup):
  - generate UUIDs for narrative + each agent profile
  - replace profiles[] with seeded narrative + agent profiles
  - resolve defaultAssignments by name → generated UUIDs
  - replace assignments with that resolved matrix

if (undefined):
  - profiles[] = [empty narrative profile, no modelRef]
  - assignments = {}
  - broken-state surfaces at next fire
```

## Doc-integration impact

- **`data-model.md → App settings storage` ER diagram.** Remove the
  `default_models` row from the `app_settings` block.
- **`data-model.md → App settings storage → Default models — render-time
resolver fallback`** subsection rewritten as **`Reset-to-defaults
seed map — code constant, not stored`**. Documents the
  `PROVIDER_DEFAULTS` shape, reset semantics (including the
  no-defaults branch), and the rationale for code-not-data.
- **`data-model.md → Provider/profile deletion semantics`.** Bullet
  about `default_models[agentId].providerId` dangling references on
  provider delete removed. Under the right model the constant
  references provider TYPES, not instance IDs, so it has nothing to
  dangle.
- **`generation-pipeline.md → Config pre-flight validation`.** Third
  bullet (about validating `default_models[agentId].providerId`)
  removed. The second bullet (`profile.modelRef.providerId` for each
  resolved profile) already covers the agent-model validation under
  the correct resolution chain; the deleted bullet was redundant.
  Story-level override caveat folded into the second bullet as a
  parenthetical.
- **`app-settings.md → Agent profiles`** seed-source paragraph now
  points at `PROVIDER_DEFAULTS` as the canonical source (and notes
  Reset to defaults consults the same constant).
- **`app-settings.md → Assignments`** default-assignment seed
  paragraph likewise points at `PROVIDER_DEFAULTS`.
- **`app-settings.md → Reset Profiles to defaults`** — new section
  between Assignments and Per-profile error states. Specs the
  button placement (top of tab, right-aligned), AlertDialog confirm
  copy (including the no-defaults warning variant), and re-seed
  semantics.
- **`onboarding.md → What gets seeded silently`** updated so the
  Narrative profile + Agent profiles + Assignments bullets each
  reference `PROVIDER_DEFAULTS[type]` paths. OAI-compat branch
  spelled out explicitly (no agent profiles, empty assignments —
  broken state until configured).
- **`app-settings.html` wireframe** gains the `↺ Reset to defaults`
  button at the top of the Profiles tab, right-aligned next to the
  tab title.
- **`followups.md`**: `Reconcile default_models authority` entry
  removed; with it goes the temporary `## Data-model` section
  (no other entries currently). File returns to single `## UX`
  section.

Historical exploration `2026-05-18-provider-profile-deletion.md`
stays as-is per the project's "explorations are frozen historical
reasoning" convention. Its references to `default_models[agentId].providerId`
read as the pre-reconciliation model; canonical docs are now
authoritative.

## Verified vs assumed

**Verified:**

- The four affected canonical sections (`data-model.md` ER diagram,
  data-model.md "Default models" subsection, data-model.md
  deletion-semantics bullet list, `generation-pipeline.md` pre-flight
  validation) are the only canonical surfaces touching
  `default_models`. The deletion exploration is historical, not
  canonical.
- The onboarding seed and the Profiles-page `Reset to defaults`
  share the same code source — the user's clarification specified
  both flows.
- The `PROVIDER_DEFAULTS` shape covers the spec'd seeded matrix
  shape (Narrative + N agent profiles + agentId → profile-name
  matrix) that onboarding currently spec'd as preset templates.

**Assumed:**

- `PROVIDER_DEFAULTS` content for each native provider type will be
  finalized at implementation alongside model benchmarking — the
  spec stays at the wireframe-placeholder level (`Fast tasks` /
  `Heavy reasoning`) until then. No design-time blocker.
- The `Reset to defaults` button placement (top of tab,
  right-aligned next to tab title) matches the project's general
  "destructive page-level action" idiom. No standing pattern
  explicitly covers this; the placement reads as obvious for v1.
