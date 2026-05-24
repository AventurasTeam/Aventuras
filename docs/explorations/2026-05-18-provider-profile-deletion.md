# Provider / profile deletion semantics

**Date:** 2026-05-18.
**Resolves:** the "Provider / profile / model-profile deletion
semantics" followup (formerly in `followups.md`); now landed in
[`data-model.md → App settings storage`](../data-model.md#app-settings-storage).
**Scope:** deletion semantics for `app_settings.providers[]` entries
and `app_settings.profiles[]` entries; the visible-error contract
those deletions imply; per-story export/import handling of
references that would otherwise dangle.

## Frame

The followup names three concepts ("provider, profile, or model
profile") and points at the calendar precedent's
"block when references exist" rule as the suggested shape. Walking
the schema clarifies two things:

- **Two concepts, not three.** The followup names the same thing
  twice — "profile" and "model profile" both refer to entries in
  `app_settings.profiles[]`. The
  [`data-model.md → ID shape`](../data-model.md#id-shape--kind-prefixed-uuids-throughout)
  table lists three distinct ID prefixes (`prov_`, `prof_`, `mod_`),
  but only `prov_` and `mod_` map to schema in active use; the
  `prof_` slot has no current consumer. Surfaced as a separate
  followup (see [Followups generated](#followups-generated)).
- **Calendar precedent doesn't fit cleanly.** Calendar deletion is
  blocked on any inbound reference because calendars _shape persistent
  story content_ — repointing a story's calendar reinterprets every
  `at_worldtime` integer. Providers/profiles are _infrastructure
  plumbing_ (which endpoint a call hits, which parameter envelope a
  call uses). The cost of a wrong cascade is lower; the cost of
  blocking on every inbound reference is higher because the fan-out is
  much wider than a calendar's.

So the design diverges from the calendar precedent, deliberately.

## Reference topology

What references what, and the fan-out shape for each:

| Concept      | Referenced from                                                                                                                                  | Fan-out         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| **Provider** | `app_settings.default_provider_id`                                                                                                               | single anchor   |
|              | `app_settings.embedding_provider_id` (when app-level `embedding_backend` defaults to `provider`)                                                 | single anchor   |
|              | `stories.settings.embedding_provider_id` (when that story's `embeddingBackend === 'provider'`)                                                   | many per story  |
|              | `app_settings.profiles[].modelRef.providerId`                                                                                                    | many            |
|              | `app_settings.default_models[agentId].providerId`                                                                                                | many            |
| **Profile**  | `app_settings.assignments[agentId]`                                                                                                              | many            |
|              | `kind: 'narrative'` is structurally tied to story rendering — already undeletable per the existing schema; not a "reference" in the usual sense. | (special-cased) |

**Note on `stories.settings.models[agentId]`.** Per
[`story-settings.md → Models tab`](../ui/screens/story-settings/story-settings.md#models-tab--overrides-only),
story-level model overrides are **direct model id strings**
(`Record<AgentId, string>`), not `{providerId, modelId}` composites.
The override bypasses the profile chain entirely and doesn't name a
provider. Provider deletion therefore cannot dangle a per-story
model override — the override either resolves against the profile-
chain's provider context or doesn't (broken-model-catalog case,
which is handled by the pre-existing global broken-config banner,
not by this design).

Profile fan-out is narrow; provider fan-out is wide. The design
treats this asymmetry by anchoring blocks on **load-bearing single
pointers** (the `default_*` slots) and letting wide-fan derivative
references dangle.

## Design

### Posture

Single posture across both concepts: **deletion is permitted unless
it removes an active default; dangling references stay as data and
error visibly at next use.** No silent re-pointing, no
cascade-deletes of dependent rows, no fallback chains.

The principle: when the user removes a config item, surface the
consequences honestly. They confirmed the deletion knowing the impact;
the broken references that result are evidence of _their_ intent,
preserved as data until they choose to repair.

### Section 1 — Blocking rules

Deletion is blocked when **any active embedder pointer** points at
the provider, or when the provider is the app-level narrative
default, or when the profile is the narrative profile:

1. The provider equals `app_settings.default_provider_id`. This is
   the narrative anchor and seeds "Reset to defaults" across the
   app. User must change `default_provider_id` to another provider
   in App Settings → Providers before this delete is permitted.
2. The provider equals `app_settings.embedding_provider_id` **and**
   the app-level `embedding_backend` defaults to `provider`. User
   must switch the app-level embedding backend to local or pick a
   different default embedding provider in App Settings → Memory
   first.
3. **Any story uses this provider as its embedder.** Specifically:
   any row in `stories` has `settings.embedding_provider_id`
   matching the candidate provider AND `settings.embeddingBackend ===
'provider'`. User must run [Model swap UX](../memory/retrieval.md#model-swap-ux)
   on each affected story (switching its embedder to local or to
   another provider, with a re-index) before the delete is
   permitted. Cost: a per-deletion `stories` query that scans
   `settings.embedding_provider_id` against the candidate. Acceptable
   — deletion is rare, the query is single-column and bounded by
   story count.
4. The profile has `kind: 'narrative'`. Already enforced in the
   schema; the narrative profile is structurally required and
   undeletable. No change.

**Why extend the embedder block to per-story.** Story-level
embeddings are a load-bearing data dependency — the story's vec0
vectors were produced by this embedder's model, and the runtime
needs the same embedder to query them. Without the embedder, memory
pipeline breaks for that story until repaired via Model swap UX
(which re-indexes against a different model). Blocking deletion
forces the user to deliberately make that swap before the provider
goes away, surfacing the cost (re-index time) in the swap UX where
the user already expects it. Letting the per-story embedder pointer
dangle would surface the same cost later as a system entry / pill
error, but the user would discover it mid-turn rather than mid-
deletion — worse moment to be informed of a re-index.

The `providers[].length ≥ 1` invariant falls out for free —
`default_provider_id` always points into `providers[]`, the
pointed-at provider can't be deleted, so `providers[]` retains at
least one entry. No explicit "block last provider" check needed.

### Section 2 — Cascade behavior on permitted deletes

When a delete passes the Section 1 blocks, the row vanishes from
`app_settings.providers[]` or `app_settings.profiles[]`. Dangling
references stay as data:

**Provider delete:**

| Reference site                                    | Behavior                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `app_settings.profiles[].modelRef.providerId`     | Left intact. Profile shows broken-provider indicator in Profiles tab. Errors at LLM-call time.    |
| `app_settings.default_models[agentId].providerId` | Left intact. Per-agent default shows broken indicator in App Settings. Errors at agent-fire time. |

Per-story embedder pointers (`stories.settings.embedding_provider_id`)
can't reach Section 2 — Section 1's per-story block prevents
deletion while any story uses the provider as its embedder.
Per-story model overrides (`stories.settings.models[agentId]`)
are direct model id strings and don't reference providers — they
have nothing to dangle.

**Profile delete:**

| Reference site                      | Behavior                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `app_settings.assignments[agentId]` | Key removed (assignment unset). Agent has no profile assigned. Errors at agent-fire time. **No fallback to narrative.** |

The delete itself is a single
`UPDATE app_settings SET providers = ?` / `profiles = ?` /
`assignments = ?` write. No multi-table fan-out; no transaction
coordination needed beyond the single column write.

### Section 3 — Confirm dialog UX

Two distinct dialog shapes.

**Blocker dialog** — surfaces when a Section 1 block fires. Single
action, copy varies by which block:

- Provider is `default_provider_id`: "This provider is the default
  for new stories and 'Reset to defaults'. Pick a different default
  in App Settings → Providers → Default before deleting."
- Provider is `embedding_provider_id` and app-level backend is
  `provider`: "This provider supplies the app's default embedding
  model. Switch the embedding backend to local or pick a different
  embedding provider in App Settings → Memory before deleting."
- Any story uses this provider as its embedder: "This provider is
  the embedder for N stories: 'Story A', 'Story B', … Switch each
  story's embedder (Story Settings → Memory) before deleting." Up
  to 3 story names enumerated inline; remaining stories collapse to
  "+N more."
- Profile is `kind: 'narrative'`: "The Narrative profile is required
  and cannot be deleted."

The blocker dialog does **not** offer inline "fix this for me"
shortcuts — the user navigates to the right setting and reconfigures
deliberately, then retries the delete. The reconfiguration is its
own decision, not a side-effect of attempting a delete.

**Confirm-with-impact dialog** — surfaces when the delete is
permitted. AlertDialog primitive
([alert-dialog.md](../ui/patterns/alert-dialog.md)) with destructive
CTA variant. Body structure:

1. **Headline:** "Delete provider '<displayName>'?" /
   "Delete profile '<name>'?"
2. **Impact summary** — counts only, no per-row enumeration.
   Suppressed when there is no fan-out. Example for provider:

   > Deleting this provider will leave broken references in:
   >
   > - **3 model profiles** — their model selection will fail at
   >   next use.
   > - **2 agent defaults** — these agents will fail at next run.
   >
   > You'll see clear errors when these are encountered. Fix by
   > picking new models / providers in the affected settings.

3. **Destructive CTA:** "Delete provider" / "Delete profile". Cancel
   is default focus.

Profile-delete dialog enumerates affected agent names (Classifier,
Translation, etc.), since fan-out is narrow enough to list:

> Deleting this profile will unset assignments for:
>
> - **Classifier**, **Translation** — these agents will run without
>   a profile and fail at next call until you assign new profiles.

**Counts computed at dialog-open time** by walking
`app_settings.profiles[]` and `app_settings.default_models`. No
story-side query needed — per-story model overrides don't reference
provider id, per-story embedder usage is Section-1-blocked
(so a permitted delete is provably not used as any story's
embedder).

**Zero-impact case:** dialog collapses to a plain "Are you sure?"
when no inbound references exist.

### Section 4 — Visible-error contract at use time

Two error modes for any dangling reference: **passive indicators**
on settings surfaces, and **pre-flight system entries** in the
reader chat when a pipeline would have called the broken config.

**Passive indicators — settings surfaces.**

Vocabulary: warning-toned Tag
([chips.md → Tag](../ui/patterns/chips.md)) inline with the broken
value, tappable to the row's existing edit affordance. Surfaces:

- App Settings → Profiles tab — profile row renders the warning Tag
  in place of the provider name when `modelRef.providerId` doesn't
  resolve.
- App Settings → Default models — per-agent row renders the warning
  Tag in place of the provider name.
- App Settings → Agents (Assignments) — agent rows where
  `assignments[agentId]` is unset render "⚠ No profile assigned" in
  place of the profile name.
- Story Settings → Models override — per-agent override row with a
  dangling provider renders the warning Tag plus a "Clear override"
  affordance to revert to the default.

**Pre-flight check before any LLM call.**

The [generation pipeline orchestrator](../generation-pipeline.md)
walks the pipeline's declared `phases` list and validates each
phase's resolver inputs (assignments, profile lookups, default_models
lookups, story-override lookups) **before phase 0 fires.** If any
required resolver returns `undefined` or unset, the run halts
pre-flight, no LLM call goes out, no tokens spent.

The validation is selective per pipeline kind:

- **New-turn pipeline:** retrieval agent resolved config, narrative
  profile's `modelRef`, classifier (if piggyback is off and a
  separate classifier call would fire), suggestions (if
  `suggestionsEnabled`).
- **Chapter-close pipeline:** chapter-close agent resolved config.
- **Memory probe:** retrieval agent resolved config.
- **Background periodic classifier:** classifier resolved config (its
  own pre-flight at scheduled fire time).

Per-story embedder pointers (`stories.settings.embedding_provider_id`)
are **not validated by pre-flight** — they're a Section-1 invariant,
provably non-dangling because the deletion-block prevents their
backing provider from going away. Story-level model overrides
(`stories.settings.models[agentId]` — pure model id strings) are
similarly out of pre-flight scope: model-catalog freshness is
covered by the existing global broken-config banner per
[`app-settings.md → Per-profile error states`](../ui/screens/app-settings/app-settings.md#per-profile-error-states--global-banner).

Pre-flight cost is in-memory lookups against `app_settings` (already
in Zustand). Negligible.

**System-entry shape on pre-flight failure (turn-blocking pipelines).**

Joins the existing
[reader-composer.md → Error surface](../ui/screens/reader-composer/reader-composer.md#error-surface--system-entries-vs-persistent-state-pill)
vocabulary as new variants of "transient pipeline failure":

> The `default_models[agentId]` row below is superseded by the May
> 19 default-models-authority redesign
> ([exploration](./2026-05-19-default-models-authority.md)) — the
> construct no longer exists; the resolver walks story-override →
> `assignments[agentId]` → `profile.modelRef`, full stop. Row kept
> for historical context.

| Resolver failure                                     | System-entry copy                                                      | Actions                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| Narrative profile's `modelRef.providerId` is missing | "Couldn't generate — the Narrative profile's provider is missing."     | `Fix profile` · `View details` · `Dismiss`    |
| Agent profile's `modelRef.providerId` is missing     | "Couldn't run \<agent\> — the assigned profile's provider is missing." | `Fix profile` · `View details` · `Dismiss`    |
| `assignments[agentId]` is unset                      | "Couldn't run \<agent\> — no profile assigned."                        | `Assign profile` · `View details` · `Dismiss` |
| `default_models[agentId].providerId` missing         | "Couldn't run \<agent\> — the default model's provider is missing."    | `Fix default` · `View details` · `Dismiss`    |

No `Roll back this turn` action — pre-flight halt fires _before_
any deltas are written, so there's nothing to roll back.

**New-turn affordance disables until resolved** — mirrors the
embed-failed pattern. Affordance re-enables when the user dismisses
the system entry, fixes the config (Zustand subscription detects the
change; next send re-runs pre-flight which now passes), or routes
through the action button and returns with the config repaired.

**First-failure short-circuit.** If multiple resolvers are broken
simultaneously, pre-flight reports the first one detected in phase
order (retrieval before narrative before classifier). User fixes
one, hits send again, next pre-flight surfaces the next break.
Avoids piling up a wall of system entries.

**Resolver-time error is the safety net.** Pre-flight could miss a
race (config changes between pre-flight pass and the actual call;
e.g., another session deletes a provider mid-turn — not a v1 concern
in practice but worth noting). The runtime failure during the LLM
call falls back to the same system-entry vocabulary. Same copy,
same actions; the user can't tell which layer caught it.

**Periodic classifier — pill error variant.**

The periodic classifier is its own pipeline kind, separate from the
new-turn pipeline. Pre-flight at scheduled fire time follows the
same rules. On failure, no LLM call goes out, and the failure
surfaces via the
[`generation-status-pill`](../ui/patterns/generation-status-pill.md)
error variant — NOT the system-entry surface. Reasoning: the
classifier didn't fire from a user action, isn't blocking the active
turn, and matches the established
"failed-persistent classifier" pill precedent.

Pill copy combines cause + consequence:

> The `default_models['classifier']` row below is superseded by the
> May 19 default-models-authority redesign — see the note above the
> system-entry table.

| Periodic classifier pre-flight failure               | Pill copy                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `assignments['classifier']` is unset                 | "Classifier has no profile — retrieval coverage thinning"                      |
| Assigned profile's `modelRef.providerId` is missing  | "Classifier profile's provider is missing — retrieval coverage thinning"       |
| `default_models['classifier'].providerId` is missing | "Classifier default model's provider is missing — retrieval coverage thinning" |

Tap-to-route lands in the relevant settings surface
(Agents → Classifier / Profiles → that profile / Default models →
Classifier). Same `active > error > hidden` priority as the existing
classifier-offline variant. State is sticky across user navigation;
if the user is outside the affected story when the classifier
fails pre-flight, the pill picks up the error variant on the user's
next entry into that story.

### Section 5 — Per-story export / import

Per-story exports already exclude vec0 vectors (`sqlite-vec` virtual
tables live outside the entry-table sweep that the export iterates).
This design formalizes that exclusion and extends it to other
foreign references:

**Stripped on export.** The per-story export envelope omits:

- `stories.settings.models[agentId]` — exporter's per-agent model
  overrides. User preferences tied to the exporter's local providers;
  meaningless on another setup.
- `stories.settings.embedding_provider_id` — exporter's app_settings
  provider reference.
- `stories.settings.embedding_model_id` — exporter's embedding model
  choice; the importer will use their own.
- **vec0 vectors** — reproducible cache, not source data.

**Applied on import.** The stripped slots take the importer's local
defaults:

- `models` → `{}` (no overrides; agents fall back to importer's
  `default_models`).
- `embedding_provider_id` / `embedding_model_id` → copied from
  importer's `app_settings`, same path as new-story creation.
- vec0 → empty; re-index pipeline runs post-insert using the
  importer's embedder (same compute as a Model swap re-index pass).

**Consequence:** no broken-reference handling at import time.
Imported stories never carry foreign references in the first place.
The deletion-semantics design has zero interaction with the
per-story import flow.

**Import dialog UX.** Surfaces the re-index cost up front:

> Importing "Story title". Will index memory using your current
> embedder (~N entries, ~M seconds).

Same re-index pipeline as
[Model swap UX in `memory/retrieval.md`](../memory/retrieval.md#model-swap-ux)
— proven path.

**Full backup restore (.sqlite snapshot) unchanged.** Replaces the
whole DB including `app_settings` and vec0; all references stay
internally consistent. Out of scope.

## Adversarial pass

**Load-bearing assumption — block scope.** Two reference shapes
block deletion: app-level defaults (`default_provider_id` and
`embedding_provider_id`) and per-story embedder pointers
(`stories.settings.embedding_provider_id`). The block on per-story
embedders extends the original "defaults only" framing because
embedder data is load-bearing (vec0 vectors are tied to the
embedder's model) and a dangling per-story embedder breaks memory
mid-turn rather than during a deliberate swap. All other reference
sites (per-agent defaults, profile modelRef, agent assignments)
have a clean failure shape via pre-flight system entries. Per-story
model overrides are direct model id strings and don't reference
providers at all — they don't dangle from this design.

**Read-site impact.** Resolver functions returning
`Provider | undefined` / `Profile | undefined` based on id lookup
must handle the undefined case; existing read sites likely assume
non-null today. Implementation-time audit needed (Profiles tab,
Default models UI, Story Settings → Models override, plus the
orchestrator's new pre-flight validation pass).

**Doc-integration cascades.** Resolved followup removed from
`followups.md`; new followup added for translation-row
export/import semantics (separate concern that surfaced during this
session, scoped out by user). `Backup & export format` in
data-model.md gains explicit stripping rules. Generation-pipeline.md
gains pre-flight phase in the orchestrator contract.
Reader-composer.md `Error surface` table extends with five new
system-entry variants. Generation-status-pill.md extends the periodic-classifier
error mapping.

**Missing perspective.**

- **Undo / rollback semantics on the delete itself.** App_settings
  writes aren't delta-tracked in v1 (same as calendar deletion).
  User re-creates manually if they regret a delete. Acceptable for
  v1; revisit if real demand surfaces.
- **Concurrent-edit during dialog.** Local-first single-process app;
  no scenario in v1.
- **Telemetry on pre-flight failures.** Could be logged via the
  diagnostics surface. Not load-bearing for this design.
- **Provider-type-aware repointing in the dialog.** Considered and
  rejected — would re-introduce a silent re-pointing path that
  contradicts the design principle. The user manually repoints
  before deletion if they want a clean swap.

**Verified vs. assumed.**

- Verified by file read: schema shapes in
  [`data-model.md`](../data-model.md), the
  [error-surface](../ui/screens/reader-composer/reader-composer.md#error-surface--system-entries-vs-persistent-state-pill)
  vocabulary, the
  [calendar deletion precedent](../data-model.md#vault-content-storage),
  the [pipeline framework's phase-list contract](../generation-pipeline.md),
  vec0 storage in [`memory/retrieval.md → Storage`](../memory/retrieval.md#storage),
  story-level override semantics in
  [`story-settings.md → Models tab`](../ui/screens/story-settings/story-settings.md#models-tab--overrides-only)
  (overrides are direct model ids, not `{providerId, modelId}` —
  caught mid-integration; corrected the design).
- Assumed: implementation-side resolver functions surface `undefined`
  cleanly without changes — audit at implementation time.

## Doc-integration plan

Canonical edits applied as a single commit. Drift pass runs on the
staged diff before commit fires.

- **`data-model.md → App settings storage`** — new subsection
  "Provider / profile deletion semantics" specifying Section 1
  blocking rules + Section 2 cascade behavior. Light reference to
  the calendar deletion precedent's divergence.
- **`data-model.md → Backup & export format`** — explicit stripping
  rules added to the per-story export bullet: omits
  `stories.settings.models`, `stories.settings.embedding_*`, vec0
  vectors. Cross-link to retrieval.md → Model swap UX for the
  re-index trigger.
- **`generation-pipeline.md → Orchestrator`** — pre-flight phase
  added to the orchestrator contract. New subsection
  "Config pre-flight validation" describing the
  `phases × resolver inputs` walk + halt-before-phase-0 behavior on
  failure.
- **`ui/screens/reader-composer/reader-composer.md → Error surface`**
  — system-entries table extended with four broken-reference
  variants (narrative-profile / agent-profile / unset-assignment /
  agent-default broken-provider).
- **`ui/screens/app-settings/app-settings.md`** — Providers tab gains
  the delete-flow (blocker dialog vs confirm-with-impact dialog) +
  warning-Tag passive indicator language. Profiles tab and
  Default-models section pick up the warning-Tag indicator on rows
  with dangling providers. Agents (Assignments) tab picks up the
  "No profile assigned" warning indicator.
- **`ui/screens/story-settings/story-settings.md`** — Models tab
  "Insulation from profile changes" prose corrected: the existing
  "Profile deleted → blocked at App Settings while agents are
  assigned" line predates this design; updated to reflect the new
  profile-delete shape (delete unsets assignments, not blocked).
  Per-story model overrides themselves are unchanged (still pure
  model id strings; don't dangle from provider delete).
- **`ui/patterns/generation-status-pill.md`** — error-variant table
  extends with the three periodic-classifier broken-reference
  variants.
- **`ui/patterns/alert-dialog.md`** — confirm-with-impact dialog
  added as a new consumer in the Used-by list.
- **`followups.md`** — resolved entry "Provider / profile /
  model-profile deletion semantics" removed. New followup added:
  "Translation rows in per-story export/import" (surfaced during
  this session, scoped out as separate concern).

No wireframe updates in scope — the dialogs and indicators reuse
existing patterns (AlertDialog, Tag) and existing per-screen
wireframes already accommodate the indicator surface area.

## Followups generated

- **Translation rows in per-story export/import.** During Section 5
  draft, the question of whether cached translation rows should
  travel with a per-story export — and how they reconcile with the
  importer's translation backend / language settings — surfaced as
  an unresolved concern. Out of scope here, parked as a new
  `followups.md` entry. Lands at the next pass over translation
  pipeline / export format.
- **`prof_` ID prefix — confirm intent.** The
  [`data-model.md → ID shape`](../data-model.md#id-shape--kind-prefixed-uuids-throughout)
  table reserves `prof_` distinct from `prov_` (provider instance)
  and `mod_` (model profile), but no current schema consumes it.
  Either remove (if the historical concept has been fully absorbed
  into `prov_` / `mod_`) or annotate the row as
  reserved-for-future. Investigation belongs with a doc-cleanup
  pass, not this design.
