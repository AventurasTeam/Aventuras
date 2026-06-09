# Aventuras — data model

Living design doc for the v2 schema. The diagram below is the source of
truth as we iterate; once we commit, it'll be mirrored by the drizzle
`schema.ts` and this doc becomes the "why" alongside it.

---

## Diagram

```mermaid
erDiagram
    stories ||--o{ branches : "has"
    branches ||--o{ story_entries : "contains"
    branches ||--o{ entities : "owns snapshot of"
    branches ||--o{ lore : "owns snapshot of"
    branches ||--o{ threads : "tracks"
    branches ||--o{ happenings : "records"
    branches ||--o{ chapters : "segments into"
    branches ||--o{ branch_era_flips : "tracks era flips"
    branches ||--o{ translations : "owns snapshot of"
    branches ||--o{ embeddings : "owns snapshot of"
    branches ||--o{ probe_captures : "captures retrieval state for"
    branches ||--o{ deltas : "logs changes in"
    story_entries ||--o{ deltas : "triggers"
    story_entries }o--|| chapters : "belongs to (once chaptered)"
    story_entries ||--o{ entry_assets : "attaches"
    assets ||--o{ entry_assets : "referenced by"
    happenings ||--o{ happening_involvements : "involves"
    happenings ||--o{ happening_awareness : "known by"
    entities ||--o{ happening_involvements : "participates in"
    entities ||--o{ happening_awareness : "aware of"
    branches ||--o{ character_relationships : "owns snapshot of"
    entities ||--o{ character_relationships : "linked in (a or b)"

    stories {
        text id PK
        text title
        text description
        json tags "string[]; search/filter only, not shown on cards"
        text cover_asset_id FK "optional; references assets"
        text accent_color "optional hex/HSL; falls back to mode-derived"
        text status "draft | active | archived (lifecycle; mutually exclusive)"
        integer favorite "0 | 1; orthogonal to status"
        integer last_opened_at "distinct from updated_at; drives last-opened sort"
        json definition "definitional content (what the story IS); see 'Story settings shape' decision"
        json settings "operational config (how it generates); see 'Story settings shape' decision"
        integer created_at
        integer updated_at
        text current_branch_id FK
    }

    branches {
        text id PK
        text story_id FK
        text parent_branch_id FK "null if root"
        text fork_entry_id "entry in parent branch the fork diverged from"
        text name
        integer created_at
        json classifier_status "per-branch periodic-classifier status: lifecycle state, last-success-at, last-error, retry-count, and processedThrough (highest entry position fully processed; pass range is (processedThrough, head]). Operational state — branches is not delta-logged, so reversal clamps processedThrough imperatively. See docs/memory/classifier.md → Persistence"
    }

    story_entries {
        text id PK
        text branch_id FK
        integer position "ordered within branch"
        text kind "user_action | ai_reply | system | opening"
        text content
        text chapter_id FK "null while in open region; set at chapter-create time"
        json metadata "worldTime + sceneEntities + currentLocationId + generation provenance; see 'Entry metadata shape' decision below"
        integer created_at
    }

    entities {
        text id PK
        text branch_id FK "entity state is per-branch"
        text kind "character | location | item | faction"
        text name
        text description
        text status "staged | active | retired"
        text retired_reason "free-form; only meaningful when status=retired. Hard-finality only — e.g. 'killed by Kael', 'temple destroyed in quake', 'faction disbanded after coup', 'exiled to the southern wastes'. Off-screen-but-alive characters stay status=active with stale lastSeenAt; see docs/memory/edge-cases.md → Retirement"
        text injection_mode "always | auto | disabled; short-circuited by active+in-scene invariant"
        integer name_collision_flag "0 | 1; 1 = same-name collision detected at classifier extraction; surfaces in World panel for review. See docs/memory/edge-cases.md → Name collision"
        json state "typed per kind"
        json tags
        integer embedding_stale "0 | 1; 1 = embedded fields (name/description) need (re-)embedding. Set on any embedded-field write whose content hash differs from the vector's source_hash (edit, create, or failed sync); cleared when the pre-retrieval sync stage embeds the row or content reverts to the embedded value. Still flagged at retrieval means the sync stage couldn't embed it (embedder unavailable), so it is excluded. See docs/memory/retrieval.md → Compute lifecycle"
        integer created_at
        integer updated_at
    }

    lore {
        text id PK
        text branch_id FK "lore forks with the branch"
        text title
        text body
        text category "free-form user label — e.g. magic-system / religion / cosmology"
        json tags
        json keywords "string[]; user-authored at create OR lore-mgmt-emitted at chapter close. Drives keyword retrieval pathway alongside embedding similarity. See docs/memory/retrieval.md → Hybrid retrieval per type"
        text injection_mode "always | auto | disabled"
        integer priority "0..100; higher = more weight in retrieval ranker. See docs/memory/retrieval.md → The ranker"
        integer embedding_stale "0 | 1; 1 = embedded fields (title/body) need (re-)embedding. Set on any embedded-field write whose content hash differs from the vector's source_hash (edit, create, or failed sync); cleared when the pre-retrieval sync stage embeds the row or content reverts to the embedded value. Still flagged at retrieval means the sync stage couldn't embed it (embedder unavailable), so it is excluded. See docs/memory/retrieval.md → Compute lifecycle"
        integer created_at
        integer updated_at
    }

    threads {
        text id PK
        text branch_id FK
        text title
        text description
        text category "free-form user label — e.g. quest / arc / prophecy"
        text icon "string key from preset icon catalog"
        text status "pending | active | resolved | failed"
        text injection_mode "always | auto | disabled"
        text triggered_at_entry_id "entry the thread was triggered at; FK-less ref into story_entries, branch-scoped (resolved via (branch_id, id))"
        text resolved_at_entry_id "entry the thread resolved at; FK-less ref into story_entries"
        integer embedding_stale "0 | 1; 1 = embedded fields (title/description) need (re-)embedding. Set on any embedded-field write whose content hash differs from the vector's source_hash (edit, create, or failed sync); cleared when the pre-retrieval sync stage embeds the row or content reverts to the embedded value. Still flagged at retrieval means the sync stage couldn't embed it (embedder unavailable), so it is excluded. See docs/memory/retrieval.md → Compute lifecycle"
        integer created_at
        integer updated_at
    }

    happenings {
        text id PK
        text branch_id FK
        text title
        text description
        text category "free-form — e.g. battle / encounter / discovery / scheduled"
        text icon "string key from preset icon catalog"
        text temporal "in-world time anchor for happenings WITHOUT a narrative position; free-form (e.g. '1872 AR', 'future', 'ongoing', 'next solstice')"
        text occurred_at_entry_id "narrative entry ref (FK-less into story_entries, branch-scoped); null = outside narrative (use temporal instead). When set, in-world time derives from the referenced entry's metadata.worldTime."
        integer common_knowledge "1 = everyone knows; skip awareness links"
        integer embedding_stale "0 | 1; 1 = embedded fields (title/description) need (re-)embedding. Set on any embedded-field write whose content hash differs from the vector's source_hash (edit, create, or failed sync); cleared when the pre-retrieval sync stage embeds the row or content reverts to the embedded value. Still flagged at retrieval means the sync stage couldn't embed it (embedder unavailable), so it is excluded. See docs/memory/retrieval.md → Compute lifecycle"
        integer created_at
        integer updated_at
    }
    %% CHECK (occurred_at_entry_id IS NULL OR temporal IS NULL) — mutual exclusivity enforced at the SQLite level

    happening_involvements {
        text id PK "hinv_${uuid}; surrogate single ID — needed as delta target (same reason as character_relationships)"
        text branch_id FK "composite PK with id; forks with branches"
        text happening_id FK
        text entity_id FK "character | location | item | faction"
        text role "optional free-form — actor / target / site / etc."
    }

    happening_awareness {
        text id PK "haw_${uuid}; surrogate single ID — needed as delta target (same reason as character_relationships)"
        text branch_id FK "composite PK with id; forks with branches"
        text happening_id FK
        text character_id FK "entity where kind=character"
        text learned_at_entry_id "entry where this character learned it; FK-less ref into story_entries"
        real decay_resistance "0..1; scales recency decay (1=no decay, 0=normal). Set by classifier severity at extraction; tunable by user toggle and lore-mgmt at chapter close. See docs/memory/retrieval.md → Pinning"
        integer retrieval_count "incremented by ranker on injection (post budget-fill); per-chapter counter, reset at chapter close after lore-mgmt phase 3d. Delta-logged so rollback reverses retrieval-driven counts. See docs/memory/chapter-close.md → 3d awareness pin tuning"
        text source "free-form LLM-authored descriptor — e.g. 'overheard in tavern' / 'told by Jorin' / 'witnessed firsthand'; used verbatim in prompts"
    }
    %% UNIQUE(branch_id, character_id, happening_id) — upsert semantics in classifier and user-edit paths; duplicates can't accumulate at the DB level

    character_relationships {
        text id PK "rel_${uuid}; needed as delta + translation target"
        text branch_id FK "composite PK with id; relationships fork with branches"
        text a_id FK "entity where kind=character; canonical-ordered (a_id < b_id)"
        text b_id FK "entity where kind=character"
        text kind "a's view of b — free-form LLM/user-authored; nullable until that POV is observed"
        text inverse_kind "b's view of a — free-form; nullable until that POV is observed"
        integer created_at
        integer updated_at
    }
    %% CHECK (a_id < b_id) — canonical ordering invariant, enforced at write time + as DB backstop
    %% CHECK (kind IS NOT NULL OR inverse_kind IS NOT NULL) — at least one POV must be known; UI delete = both nulled = row removed
    %% UNIQUE(branch_id, a_id, b_id) — one row per pair per branch; gives clean UPSERT semantics in classifier and user-edit paths

    chapters {
        text id PK
        text branch_id FK
        integer sequence_number "1, 2, 3... within branch"
        text title "LLM-suggested at create, user-editable"
        text summary "LLM-generated at create"
        text theme "short thematic tag"
        json keywords "for retrieval / injection"
        text start_entry_id "FK-less ref into story_entries, branch-scoped"
        text end_entry_id "FK-less ref into story_entries; always set — only closed chapters exist as rows"
        integer token_count "accumulated across chapter entries"
        integer closed_at
        integer embedding_stale "0 | 1; 1 = embedded fields (summary/theme) need (re-)embedding. Set on any embedded-field write whose content hash differs from the vector's source_hash (edit, create, or failed sync); cleared when the pre-retrieval sync stage embeds the row or content reverts to the embedded value. Still flagged at retrieval means the sync stage couldn't embed it (embedder unavailable), so it is excluded. See docs/memory/retrieval.md → Compute lifecycle"
        integer created_at
        integer updated_at
    }

    branch_era_flips {
        text id PK
        text branch_id FK "composite PK with id; per-branch narrative state"
        integer at_worldtime "physical seconds since story start; the moment the era flips. at_worldtime ≥ 0; flip at 0 overrides the calendar's defaultStartName"
        text era_name "user-chosen / preset name for the new era; free-form text"
        integer created_at
    }

    assets {
        text id PK "UUID"
        text kind "image | audio | file"
        text mime_type
        text file_path "relative to app data dir — binary lives on disk, not in SQLite"
        integer size_bytes
        text content_hash "sha256 for dedup"
        integer created_at
        integer pending_delete_at "unix seconds; NULL = active, non-NULL = in trash, sweeper unlinks past retention window. See Assets (images & future media) → Cleanup on delete — trash-can pattern"
    }

    entry_assets {
        text id PK "ast_${uuid}; surrogate single ID — delta target handle"
        text branch_id FK "composite PK with id; entry_assets fork with branches (rows copied; assets shared by reference)"
        text entry_id FK
        text asset_id FK
        text role "generated_image | background | reference | etc."
        integer position "ordering within entry"
    }

    translations {
        text id PK
        text branch_id FK "composite PK with id; translations fork with branches"
        text target_kind "entity | lore | thread | happening | story_entry | character_relationship | chapter"
        text target_id "id in the target table; polymorphic FK (no DB constraint)"
        text field "which field of the target row is translated (name, description, body, title, content, kind, inverse_kind, etc.); supports dotted paths into state JSON"
        text language "ISO 639-1 code (en, es, ja, ...)"
        text translated_text
        integer created_at
        integer updated_at
    }

    embeddings {
        text id PK
        text branch_id FK "composite PK with id; embeddings fork with branches"
        text target_kind "entity | lore | happening | thread | chapter"
        text target_id "id in the target table; polymorphic FK (no DB constraint)"
        text field "embedded field name (description, body, composite, etc.)"
        text model_id "canonical embedding model id; the model that produced this row's vector. Within a single branch all rows share one model (vector-space invariant for retrieval); across the database different stories' rows may be under different models. See docs/memory/retrieval.md → Storage"
        integer dim "vector dimension"
        blob vector "packed float32/float16 vector"
        text source_hash "xxhash of source field at embed time. Two roles per docs/memory/retrieval.md → Compute lifecycle: reference for the per-row embedding_stale flip (a write compares the row's current hash against this), and the retrieval tripwire (a candidate whose content hash mismatches this, after the sync stage has run, signals a write that bypassed the flag, i.e. a bug)."
        integer updated_at
    }
    %% UNIQUE(branch_id, target_kind, target_id, field, model_id)
    %% Not delta-logged — embeddings are deterministic from source content. See docs/memory/retrieval.md → Storage
    %% Physical storage: per-type sqlite-vec `vec0` virtual tables (entities_vec, lore_vec, happenings_vec, threads_vec, chapter_summaries_vec) joined to metadata by id, scoped per row by branch_id auxiliary column. The polymorphic shape above is the logical view; vec0 doesn't filter efficiently across mixed-type rows. See docs/memory/retrieval.md → Storage

    probe_captures {
        text id PK
        text branch_id FK "composite PK with id; captures fork with branches"
        text target_entry_id "the entry whose retrieval pass this capture diagnoses; FK-less ref into story_entries, branch-scoped"
        integer captured_at
        text capture_mode "light | deep; light stores per-row sims + score components, deep adds candidate vectors. See docs/memory/probe.md → Capture model"
        text embedding_model_id "model active at capture; bound to deep-mode vectors for vector-space validity. Light captures are model-agnostic post-capture (sims are pre-computed cosines)."
        text failure_reason "nullable; set when retrieval failed at capture time (embedder unavailable, empty pool, KNN error). Banner-rendered in inspect UI; simulate disabled."
        blob payload "gzipped JSON of full capture record per docs/memory/probe.md → Capture format (queries + per-type pool + funnel summary + structural floor + stale counts + params snapshot)"
        integer payload_size "pre-compression byte count; surfaces as storage-usage indicator in capture-list UI"
    }
    %% Not delta-logged — captures are diagnostic, not story state. Rollback must NOT unwind probe data. See docs/memory/probe.md → Capture format
    %% Forking does NOT copy captures to the new branch — they're meaningful only against the candidate pool that existed when written; new branch starts empty. See docs/memory/probe.md → Capture model
    %% FIFO eviction at 100 captures per story (across all branches). New write past cap drops oldest in same transaction. Per-capture delete + "clear all" remain available as user actions. See docs/memory/probe.md → Eviction

    deltas {
        text id PK
        text branch_id FK
        text entry_id FK "survival anchor: reverse this delta iff this entry is reversed. Foreground turn delta → its own turn; periodic_classifier fact → its provenance entry; translation → its target's content-defining-delta anchor; null (chapter close, user direct edit) → reverse positionally by own commit position. See Entry mutability & rollback → Survival anchor"
        text action_id "groups deltas into one user-visible action (used for CTRL-Z batching)"
        integer log_position "append-only ordering within branch"
        text source "ai_classifier | periodic_classifier | user_edit | lore_agent | chapter_close"
        text target_table "story_entries | entities | lore | threads | happenings | happening_involvements | happening_awareness | character_relationships | chapters | entry_assets | translations | branch_era_flips"
        text target_id "id in target_table"
        text op "create | update | delete"
        json undo_payload "op=create: null; op=update: nested-partial diff of changed paths with their PRE-change values per Entry mutability & rollback; op=delete: full row to re-insert"
        integer encoding_version "writer-stamped encoding-contract version; defaults to 1 at v1. Reserved for future apply-time dispatch when delta-logged column shapes or encoding rules change. See Entry mutability & rollback"
        integer created_at
    }
    %% INDEX deltas_chain_idx (branch_id, target_id, log_position) — chain-walk index for the diff cache walk and future rollback / CTRL-Z chain reads. See architecture.md → Delta history diff resolution. target_table excluded: the kind-prefixed UUID invariant makes target_id globally unique, so target_table stays in the query as a defensive post-filter rather than an index discriminator.
    %% UNIQUE INDEX deltas_log_position_uniq (branch_id, log_position) — backstop. The action-layer's MAX+1 assignment is the primary mechanism (see "log_position assignment" below); this index catches buggy writers at insert time. Can't double-up deltas_chain_idx because target_id sits between branch_id and log_position.

    vault_calendars {
        text id PK "UUID; user-authored calendars only — built-ins live in code/repo JSON loaded at boot"
        text name "display name; for clones, original-preset-name copied verbatim. Type indicator (built-in/custom) is a UI chip, not encoded in the name"
        json definition "CalendarSystem shape per calendar-systems/spec.md — tiers, eras, displayFormat, baseUnitName, secondsPerBaseUnit, leapDayPosition?, etc."
        integer favorite "0/1; user-toggled per row; surfaced as a star in Vault and as the curated list in pickers"
        integer created_at
        integer updated_at
    }

    app_settings {
        text id PK "constant 'singleton' — global, single-row config table"
        json providers "Array<ProviderInstance>; user-managed multi-instance, includes API keys"
        json profiles "Array<ModelProfile>; narrative + agent profiles for LLM call params"
        json assignments "Record<agentId, profileId>; which profile each agent uses by default"
        text default_provider_id "FK into providers[].id; seeds Narrative + 'Reset to defaults'"
        text embedding_model_id "canonical embedding model id; filename-derived for local downloads (includes quant suffix), provider id for provider mode, user-supplied label for power-user file imports. Any textual change fires the re-index dialog unconditionally. See docs/memory/retrieval.md → Embedding infrastructure"
        text embedding_provider_id "FK into providers[].id when embedding_backend defaults to 'provider'; null when defaults to 'local'. Users may run a different provider for embeddings than for narrative LLM calls. Distinct from default_provider_id (narrative) — embedders have no LLM-profile parameter shape (no temperature, max output, thinking, structured-output) so they don't route through the Profiles tab."
        json default_story_settings "see 'Story settings shape' — copy-at-creation source for new stories"
        text default_calendar_id "id into the merged calendar registry (built-ins from code + vault_calendars rows); seeds new stories' calendarSystemId"
        json appearance "{ themeId, readerFontScale, accentOverride?, density } — density: 'default'|'compact'|'regular'|'comfortable' (sentinel 'default' resolves per tier; see ui/foundations/spacing.md#density-toggle)"
        text ui_language "ISO 639-1; defaults to OS locale on first launch"
        integer onboarding_completed_at "set on first dismissal of the onboarding wizard (Finish, Skip, or Step 2 footer-link exit); null = wizard renders as root on next boot"
        json diagnostics "debug toggles. Includes enabled boolean (master gate for the diagnostics layer — memory probe captures, the in-memory diagnostics store, console mirroring; off by default) and debug_level_enabled boolean (secondary gate for debug-level log emissions; off by default; meaningful only when enabled is on). Per-story memory probe activation in stories.settings.probe_mode_active is no-op while enabled is off. See docs/observability.md → Gating model"
        integer created_at
        integer updated_at
    }
```

---

## Decisions

_Each subsection captures a design choice and why we made it. Fill in as we go._

### ID shape — kind-prefixed UUIDs throughout

Every database identifier is stored as **`{kind-prefix}_{uuid}`** —
the prefix is part of the ID string, not just a column-level
convention. Stripe-style. Applies universally across the data
model:

#### LLM-facing kinds (substituted to short placeholders at prompt build)

| Kind             | ID prefix |
| ---------------- | --------- |
| Character entity | `char_`   |
| Location entity  | `loc_`    |
| Item entity      | `item_`   |
| Faction entity   | `fact_`   |
| Lore             | `lore_`   |
| Thread           | `thr_`    |
| Happening        | `hap_`    |
| Chapter          | `chap_`   |

`entities` is one table with `kind` as discriminator; the ID
prefix matches the kind. The prefix is redundant with the column
in storage but load-bearing for the placeholder substitution layer
(see below), so the prefix authoritatively encodes kind.

#### Non-LLM-facing kinds (never substituted)

| Concept                        | ID prefix |
| ------------------------------ | --------- |
| Story                          | `story_`  |
| Branch                         | `br_`     |
| Story entry                    | `entry_`  |
| Action (delta grouping)        | `act_`    |
| Pipeline run                   | `run_`    |
| Profile                        | `prof_`   |
| Provider                       | `prov_`   |
| Pack                           | `pack_`   |
| Calendar definition            | `cal_`    |
| Entry asset                    | `ast_`    |
| Translation (singular PK case) | `tr_`     |
| Character relationship         | `rel_`    |
| Happening involvement          | `hinv_`   |
| Happening awareness            | `haw_`    |

External IDs (provider responses from OpenAI / Anthropic / etc.)
keep their native format unchanged — only IDs that originate inside
the app are prefixed. Every row that is a **delta target or
translation target carries a surrogate single ID** so the delta log
and `translations` table can address it by one value — this is why
`character_relationships`, `happening_involvements`,
`happening_awareness`, and `entry_assets` each have one
(`rel_` / `hinv_` / `haw_` / `ast_`) despite a composite _natural_
key, which is retained as a `UNIQUE` backstop. What stays
tuple-addressed (no single prefixed ID) is pure lookups that are
neither delta nor translation targets — the `translations`
`(target_kind, target_id, field, language)` lookup and the
`embeddings` UNIQUE tuple.

#### Generation

```ts
const generateCharacterId = (): CharacterId => `char_${crypto.randomUUID()}` as CharacterId

// ... one helper per kind. Branded template-literal types:
type CharacterId = `char_${string}`
type LocationId = `loc_${string}`
type LoreId = `lore_${string}`
// ... etc.
```

The brand is compile-time only; at runtime the value is a plain
string with the prefix.

#### Why prefix universally

- **Grep-friendliness everywhere.** Any ID in a SQL query, log
  line, or error message reveals its kind without lookup.
- **Generic placeholder substitution.** The substitution walker
  recognizes LLM-facing IDs by their prefix-pattern alone — no
  per-context-kind code, no Zod schema introspection, no
  hand-maintained UUID-field registry. Storage uniformity makes the
  pattern-based walker bulletproof.
- **Stripe precedent.** Well-trodden convention; easy to onboard
  contributors familiar with it.

#### Why prefix-tagged UUIDs over sequential prefix IDs

Earlier consideration: store IDs as `char_3`, `loc_5` (sequential
counter, no UUID) so the LLM can copy them reliably. Rejected
because: per-story counter coordination, branch-counter
interaction, Vault-import renumbering with FK rewriting, and
never-reuse-after-delete tracking all become real concerns. The
prefix-tagged UUID model decouples LLM-side handling from storage
— see [Placeholder substitution](#placeholder-substitution-llm-facing-handles)
below.

#### Placeholder substitution (LLM-facing handles)

The LLM never sees prefix-tagged UUIDs in prompts. A substitution
layer in the generation pipeline (per
[`generation-pipeline.md → Run-scoped state`](./generation-pipeline.md#run-scoped-state--intermediates-and-per-kind-contexts))
walks the assembled context before each LLM call, swapping
UUIDs for short placeholders (`c1`, `c2`, `l1`, …) drawn from a
per-kind counter scoped to the current LLM call. The map is
discarded at run end.

Vault import implications:

- Importing a character template into story X: allocate a fresh
  `char_<uuid>` for the import, or keep the original — both are
  fine (UUID collision is astronomically improbable). Lean fresh
  allocation so identity is always local to a story.
- No FK rewriting elsewhere — nothing carries cross-story
  references; everything is one story scope.

### Checkpoint model

**Decided:** no first-class "checkpoint" concept. The old app used checkpoints
as plumbing to enable rollback and branching; in v2 those operations work at
AI-reply granularity directly, so checkpoints-as-user-feature disappear.
Optional user-named bookmarks (game-save style) may return later as a UI
affordance, fully decoupled from the rollback/branch machinery.

### Branch model

**Decided:** any `story_entry` is a valid branch point — symmetric with
rollback. **No chapter-boundary restrictions on either** (we explicitly
considered bounding rollback/branching by the latest closed chapter, and
rejected it: that would re-introduce checkpoint-style gatekeeping we went
out of our way to drop).

Branching is a **hard fork** — the new branch is fully standalone,
including its change history. On creation from entry N (where
`L = min(log_position)` among entry (N+1)'s deltas, or the head if N is
the latest entry):

1. Copy parent's CURRENT rows for every branch-scoped table per the
   manifest below into the new branch.
2. Copy parent's deltas with `log_position < L` into the new branch —
   plus any background (`periodic_classifier`) delta with
   `log_position >= L` whose survival anchor is a kept entry
   (`position(entry_id) <= position(N)`). A lagging fact about an entry
   ≤ N that committed late would otherwise be rewound away in step 3,
   silently dropping facts about kept turns (see
   [Entry mutability & rollback → Survival anchor](#survival-anchor)).
   The new branch thus carries the complete history up to the fork point
   and rollback on the new branch can reach any entry 1..N.
3. Reverse-apply parent's deltas with `log_position >= L` **except those
   copied in step 2** (i.e. `entry_id IS NULL OR position(entry_id) >=
position(N+1)`) onto the new branch's copied rows. These rewind the
   copies from "parent's current state" to "state as of entry N." The
   post-fork deltas themselves are NOT copied — their only purpose was to
   rewind, and keeping them would contradict the rewound state.

**Branch-copy manifest.** Every branch-scoped table behaves the same
way at fork unless flagged otherwise:

| Table                     | Behavior           | Notes                                                                                                                                                                                                                           |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `story_entries`           | Copy 1..N          | Entries N+1..head are not in the fork (the new branch reaches them via the reverse-replay step on the post-fork deltas, which themselves don't copy).                                                                           |
| `entities`                | Copy current rows  | Per-branch state after step-3 rewind reflects state at entry N.                                                                                                                                                                 |
| `lore`                    | Copy current rows  | —                                                                                                                                                                                                                               |
| `threads`                 | Copy current rows  | —                                                                                                                                                                                                                               |
| `happenings`              | Copy current rows  | —                                                                                                                                                                                                                               |
| `happening_involvements`  | Copy current rows  | —                                                                                                                                                                                                                               |
| `happening_awareness`     | Copy current rows  | —                                                                                                                                                                                                                               |
| `character_relationships` | Copy current rows  | Branch-scoped per the schema.                                                                                                                                                                                                   |
| `chapters`                | Copy current rows  | —                                                                                                                                                                                                                               |
| `branch_era_flips`        | Copy current rows  | —                                                                                                                                                                                                                               |
| `translations`            | Copy current rows  | Composite PK includes `branch_id`; translations fork with branches.                                                                                                                                                             |
| `entry_assets`            | Copy rows 1..N     | Tiny rows; point at the same `assets[id]` on disk (share-by-reference).                                                                                                                                                         |
| `assets`                  | Share by reference | Hard-fork for narrative data; shared-by-reference for binary media. See [Cleanup on delete — trash-can pattern](#assets-images--future-media).                                                                                  |
| `*_vec` (embeddings)      | Copy current rows  | vec0 tables partition by `branch_id`; new branch needs its own vectors so post-fork edits stay branch-local. Cost is 2x storage at fork moment; per-branch re-embed on edits stays clean. Storage-optimization followup parked. |
| `deltas`                  | Per step 2 above   | Special case — pre-fork log copies (step 2), post-fork deltas reverse-apply onto copies then are NOT copied (step 3). Not a "current rows" copy.                                                                                |

If a branch-scoped table is added to the schema later, it MUST get a
row here in the same commit. New branch-scoped table without a
manifest row is a bug.

**`branches.classifier_status` at fork.** Not a manifest row — it is a
column, not a branch-scoped table. The new branch initializes
`processedThrough = min(parent.processedThrough, position(N))` (it cannot
have processed turns it does not contain, and step 2 already copied facts
about kept entries up to that point); the rest of the status resets to
idle, so a fresh branch does not inherit a parent's failed-persistent
state. See
[classifier.md → Persistence](./memory/classifier.md#persistence).

Reads on the new branch are always fast because state is pre-materialized
— no lineage walk, no copy-on-write. Branch creation cost is linear in
rows + post-fork delta count; both are modest.

**Primary keys on all branch-scoped tables are composite `(branch_id, id)`.**
The `id` is a UUID generated once at row creation and never regenerated.
On branch copy, `INSERT ... SELECT` flips branch_id and leaves everything
else (including id and all internal references) verbatim. Cross-references
— FK columns AND id-references buried inside `entities.state` JSON
(`parent_location_id`, `current_location_id`, `equipped_by`, etc.) — stay
valid because they all resolve within the new branch's scope automatically.
The alternative (single-column UUID PK + generate-fresh-on-copy) would
require walking every reference site including state JSON to rewrite IDs
during copy; that's where bugs would hide forever. Composite PK sidesteps
the whole category. Tables at the global scope (`stories`, `assets`) keep
single-column PKs since they aren't branched.

Text duplication across branches is acceptable (one data point: a 350k-word
story exported as JSON is ~2.5MB — branches at 10x are still tiny). The
one thing that would have exploded is binary media, which we externalize
(see Assets below). Branches share assets via reference, not copy.

Deep rollback across multiple closed chapters is allowed; it simply
reverses more deltas (including the lore-agent's writes, memory
compaction's consolidations, and the chapter-row itself — all logged as
deltas so all reversible). UI surfaces a soft warning ("this will undo 3
chapters of agent work"), not a hard block.

### World-state storage

**Decided:** one unified `entities` table for actors (character, location,
item, faction) with a `kind` discriminator, a typed-JSON `state` column,
and a `status` lifecycle (staged | active | retired). Collapses the old
app's dual world-state-vs-lorebook design — the "staged lorebook character
not yet introduced" use case becomes `status = staged` on an entity.

Reference material (magic systems, religions, cosmology, IP-specific
terminology — things that _are_, not things that _happen_) lives in a
separate `lore` table. No structured state, no lifecycle — purely retrieval
fodder. `lore` is per-branch (same snapshot-at-fork model as entities) so
users can edit static lore as the story evolves and the AI can organically
introduce new lore without polluting sibling branches.

Historical/scheduled events are NOT lore — they moved to `happenings` (see
below), because events are things that occurred/will occur and participate
in character knowledge in a way static reference doesn't.

`entities` gains a `retired_reason` freeform text column alongside
`status`, only meaningful when `status=retired` ("killed by Kael",
"faction disbanded after coup", etc.).

#### Description vs `state` boundary

`entities.description` (top-level text column) is the
**user-authoritative "who" prose**. State is the **typed,
classifier-mutable layer** carrying everything that needs structure
for query, classifier evolution, or prompt rendering.

The split rule:

- **Description** holds the prose-y identity sketch. Whoever spawns
  the entity authors the initial description (user via wizard /
  `+ New entity` → user-authored; classifier via mid-story discovery
  → classifier-authored once). Subsequent writes are **user-only**
  in v1.
- **State** holds typed slots for: things that evolve mid-stream
  (classifier needs structural slots to record changes), things
  needed structurally (entity refs, hierarchy walks, caches), and
  things the UI needs as discrete fields rather than parsed from
  prose.

The classifier writes prose well at _introduction_ moments; mid-stream
description rewrites risk coherence drift across long stories. Keeping
description as a stable user-authoritative surface protects the entity's
"who" from per-turn churn; typed state slots absorb the per-turn /
per-chapter evolution.

**v1 collapse:** the lore-management agent suggestion-queue UI
(autonomous-vs-confirm-mode toggle on classifier-proposed description
revisions) is deferred. Until it ships, classifier never updates
description after first introduction; user is the only ongoing editor.
Stale descriptions are the user's problem until they edit — acceptable
v1 floor. The suggestion-queue UI is a separate UX design pass; the
broader memory-mgmt design landed in
[`docs/memory/`](./memory/README.md).

#### `CharacterState` shape

```ts
type CharacterState = {
  // Identity — visual descriptors (type-relaxed strings, no enum lock-in)
  visual: {
    physique?: string // height + build merged
    face?: string // facial features, complexion, expression-tendency
    hair?: string // color + style + state
    eyes?: string // color + distinctive eye traits
    attire?: string // live current attire — classifier-updates on observed change
    distinguishing?: string[] // catch-all: scars, tattoos, voice tone, gait, posture, scent
  }

  // Identity — personality + motivation
  traits: string[] // who they are: personality / skills / background; soft cap 8
  drives: string[] // what pushes/pulls them: goals, fears, sore spots; soft cap 6
  voice?: string // single prose note on speech pattern

  // Entity-graph references — split across UI tabs (Connections + Carrying)
  current_location_id: EntityId | null
  equipped_items: EntityId[] // unique items only (worn/wielded)
  inventory: EntityId[] // unique items only (carried, not active)
  stackables?: Record<string, number> // currencies + ammo + supplies
  // string-keyed quantities, lowercase canonical
  faction_id: EntityId | null // primary affiliation, single

  // Cache (classifier-maintained denormalization)
  lastSeenAt: {
    entryId: string
    locationId: string | null
    worldTime: number
  } | null
}
```

**Visual descriptors are type-relaxed strings**, not enums. Enum
vocabularies don't survive contact with genre flexibility — "disposition"
in romance vs war saga vs eldritch horror demands different vocabularies.
Free strings let the classifier write whatever fits the prose; field
names stay stable for UI and translation.

**`attire` is live current attire**, not signature. Classifier updates on
observed prose change ("Kael changed into noble robes"). Staleness risk
is acknowledged; mitigation is prompting discipline + chapter-close
compaction.

**`traits` and `drives` are flat string arrays.** Symmetric shape; UI
renders as chip groups; classifier emits one element at a time. A third
`behaviors` bag was considered and rejected — "negotiates before fighting"
is functionally a trait ("diplomatic") or a drive ("avoids violence");
separate bag silently bloats with mis-classified entries.

**`voice` is single-string, optional.** Distinct from `distinguishing[]`
because dialogue-coherence demands voice be surfaced explicitly; folding
into distinguishing buries it.

**`equipped_items` vs `inventory` asymmetry.** Both are `EntityId[]` of
unique items; the split is semantic — equipped is what's actively in use,
inventory is what's carried but stowed. Stackables don't go through
either; they live in the separate `stackables` slot.

**`lastSeenAt`** drives "last seen 3 days ago in The Tavern" UX on the
World panel and Browse rail; without caching, surfacing this would
require walking entry history per row on every render. Classifier
updates whenever the character is present in `metadata.sceneEntities`
of a new entry (or is the location's anchor via
`metadata.currentLocationId`).

#### Stackable items — holder-side `Record<string, number>`, not entities

Fungible items (currencies, ammunition, generic supplies) are NOT
modeled as entities. They're string-keyed quantities held on the
character via `stackables`.

**Why not item entities + count.** An earlier draft proposed an
`is_stackable` flag on `ItemState` plus a counted-inventory shape. The
classifier-prompt cost was prohibitive: to dedup stackables on creation,
the classifier would need to inspect "all stackable items in the branch"
(or accept duplicate entities for chapter-close compaction to merge).
Either route adds real prompt-token cost or intermediate-state noise.
The shape is also over-modeled — gold pieces don't need descriptions,
conditions, or any entity machinery; they're just quantities.

**Convention:**

- Lowercase canonical keys (`"gold"`, not `"Gold"` or `"Gold pieces"`).
- Cross-character consistency is classifier-prompt discipline +
  lore-mgmt compaction (key normalization at chapter close).
- Transfer ("Aria gives Kael 50 gold") writes deltas under one matching
  `action_id`: decrement on Aria's `stackables.gold`, increment-or-create
  on Kael's.
- Depletion: decrement; if count → 0, remove the key from the Record.

**v1 limitations** — locations don't get stackables (loose-fungibles-at-
locations stay in prose); named fungibles with descriptions ("magical
arrows blessed by Vael") aren't well-supported (model as a unique item
entity covering the whole batch, or narrate). Both tracked in followups.

#### Containers — descriptive-only in v1

Container items (satchel, quiver, purse, chest) exist as ordinary item
entities; their _contents_ live on whoever holds the container
(character.inventory + character.stackables). The "in the satchel"
relationship is narrative texture, not structural.

Structural one-level containment (`is_container` + `contained_*` on
`ItemState`) was considered and deferred — cycle prevention, transfer-
cascade complexity, and a holder-tree UI add cost most narratives don't
need. Additive future: those fields can land in v1.5 without breaking
v1 data; existing satchel entities just gain them when filled in.

UX consequence: users expecting D&D-grade "drag gold into purse" find
that gold lives on the character, not in the purse. UI labels say
"Carried items" / "Carried quantities" at the character level, not
"Satchel contents." Container items get a flagged display with a
tooltip ("Container — contents are tracked on the holder").

#### `LocationState` shape

```ts
type LocationState = {
  parent_location_id: EntityId | null // compositional hierarchy
  condition?: string // ongoing dynamic state delta from description baseline
  // ("war-damaged", "abandoned since the plague")
}
```

**`parent_location_id`** is a self-referential reference to another
entity where `kind=location`, giving locations a containment hierarchy
(Shop → Town Square → City). Distinct from characters'
`current_location_id` / items' `at_location_id`, which are _positional_
(where something is right now); `parent_location_id` is _compositional_
(this place is part of that place). Prompt rendering walks the parent
chain at runtime (e.g. `Aria is in [Shop in Town Square in City]`).
Cycle prevention is app-layer — SQLite can't enforce it.

**Cycle guard owner.** The action-layer mutator that writes
`entities.state.parent_location_id` (per
[`generation-pipeline.md → Narrow action functions`](./generation-pipeline.md#narrow-action-functions-over-write-set-declarations))
validates pre-commit: walks the proposed parent chain
(`new_parent → its parent → ...`) within the same branch's
location entities and rejects if the walk visits the entity being
updated. Depth-cap at 100 with an error log on cap-hit (shouldn't
happen in real data).

**Failure mode.** Rejected writes return
`{ status: 'rejected', reason: 'parent-cycle' }` (mirrors the
gate-rejection shape at
[`generation-pipeline.md → Action rejection`](./generation-pipeline.md#action-rejection--defense-in-depth)).
Classifier writes hitting the rejection surface as a phase-level
`recoverable_error` (the retry tier handles LLM mistakes). User
edits surface as a form-validation error in the World panel —
user fixes or leaves it.

**Why so few fields.** Locations are dramatically less dynamic than
characters. Type, appearance, atmosphere, landmark features all
naturally live in `description` prose, established at spawn time and
edited by the user when needed. Discrete change events (the bell
tower fell, the gate was breached) are recorded as `happenings` rows
with the location as a participant via `happening_involvements` — not
as state mutations. State carries the _running consequence_ (`condition:
"earthquake-damaged"`), not the event log.

#### `ItemState` shape

```ts
type ItemState = {
  at_location_id: EntityId | null // location of item if loose;
  // null when held by a character
  // (look up via character.equipped_items / inventory)
  condition?: string // dynamic state ("intact", "broken",
  //                "cursed", "activated")
}
```

**Position convention.** `at_location_id = null` means "held by a
character — find via character arrays." Single source of truth in the
held direction (character arrays are canonical for held items); no
back-pointer on item to drift against. Cost: "who holds the silver
coin?" requires scanning characters' equipped + inventory arrays.
Acceptable for v1 scale; FTS5 upgrade applies if it bites.

**Why so few fields.** What an item _is_ (type, material, properties,
magical traits, history, value) fits cleanly in description prose.
Position and dynamic condition are the two things that genuinely
need typed slots.

#### `FactionState` shape

```ts
type FactionState = {
  standing?: string // dynamic power/situation
  // ("ascendant after the coup", "embattled in the south")
  agenda?: string[] // current goals/objectives; soft cap 4
}
```

Identity (ideology, history, structure, founding circumstances,
signature reputation) lives in description prose. `standing` is the
faction's dynamic-state slot (parallel to LocationState.condition);
`agenda` parallels character `drives` with a tighter cap because
faction-level goals are coarser-grained than individual motivations.

Member roster derives from inverse query on `character.faction_id`;
inter-faction relationships are out of scope for v1 — only
character-to-character relationships are modeled (see
[Character-to-character relationships](#character-to-character-relationships)).

#### Character-to-character relationships

**Decided:** char→char relationships are first-class branch-scoped
rows in a dedicated `character_relationships` table. Free-form `kind`
text from both perspectives, accumulated over time as the classifier
observes evidence.

```sql
CREATE TABLE character_relationships (
  id TEXT PRIMARY KEY,             -- rel_${uuid}
  branch_id TEXT NOT NULL,
  a_id TEXT NOT NULL,              -- character entity; a_id < b_id (canonical)
  b_id TEXT NOT NULL,              -- character entity
  kind TEXT,                       -- a's view of b; nullable
  inverse_kind TEXT,               -- b's view of a; nullable
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (a_id < b_id),
  CHECK (kind IS NOT NULL OR inverse_kind IS NOT NULL),
  UNIQUE (branch_id, a_id, b_id)
);
CREATE INDEX idx_char_rel_branch_a ON character_relationships(branch_id, a_id);
CREATE INDEX idx_char_rel_branch_b ON character_relationships(branch_id, b_id);
```

**One row per pair.** Symmetric AND asymmetric relationships share the
shape — `kind`/`inverse_kind` carry the two perspectives independently
("Aria → Kael: sister", "Kael → Aria: brother") and either may be
null until that POV is observed. Single row keeps lookups cheap and
gives clean UPSERT semantics.

**Canonical ordering invariant: `a_id < b_id`.** Lexicographic string
compare on the `char_${uuid}` IDs. Application write path always
sorts `(subject, object)` from the classifier emission before insert;
the slot the known `kind` text lands in flips per:

```ts
function normalizeForWrite(subjectId: EntityId, objectId: EntityId, kind: string) {
  const [a_id, b_id] = subjectId < objectId ? [subjectId, objectId] : [objectId, subjectId]
  const isSubjectA = subjectId === a_id
  return {
    a_id,
    b_id,
    kind: isSubjectA ? kind : null, // subject is a → kind = a's view of b
    inverse_kind: isSubjectA ? null : kind, // subject is b → kind = b's view of a
  }
}
```

The DB-level `CHECK (a_id < b_id)` is a backstop against application
bugs, not the primary enforcement.

**UPSERT-merge across entries.** The classifier emits one perspective
per entry. Subsequent entries that surface the inverse POV merge
into the same row:

| Entry | Classifier emits          | Row state after write                                     |
| ----- | ------------------------- | --------------------------------------------------------- |
| 1     | `(Kael, Aria, "sister")`  | `(a=Aria, b=Kael, kind=null, inverse_kind="sister")`      |
| 2     | `(Aria, Kael, "brother")` | `(a=Aria, b=Kael, kind="brother", inverse_kind="sister")` |

Both POVs accumulate without the classifier ever needing to know
canonical ordering — the app's write path normalizes.

**Lookup helper.** Always query both columns; normalize the
perspective at read-time so callers see relationships from their own
character's POV:

```ts
type RelationshipView = {
  rowId: RelationshipId
  otherId: EntityId
  selfToOther: string | null // null until that POV is observed
  otherToSelf: string | null
}

function getRelationships(characterId: EntityId, branchId: BranchId): RelationshipView[] {
  const rows = db.select(
    `
    SELECT id, a_id, b_id, kind, inverse_kind
    FROM character_relationships
    WHERE branch_id = ? AND (a_id = ? OR b_id = ?)
  `,
    [branchId, characterId, characterId],
  )

  return rows.map((row) => {
    const isA = row.a_id === characterId
    return {
      rowId: row.id,
      otherId: isA ? row.b_id : row.a_id,
      selfToOther: isA ? row.kind : row.inverse_kind,
      otherToSelf: isA ? row.inverse_kind : row.kind,
    }
  })
}
```

UI / LLM-prompt-injection paths decide how to render unknown
perspectives ("Aria considers Kael a brother; Kael's view of Aria
isn't recorded yet").

**Authoring policy: v1 lean — classifier wins on prose evidence.**
Both classifier and user write; classifier UPSERTs on subsequent
contradicting prose. User edits "stick" only until classifier reads
contradicting prose. Same policy as the rest of CharacterState (see
the authoring matrix under
[World-state storage](#world-state-storage)). No per-field
provenance in v1 — the parked v1.5
per-field work and the parked per-entity classifier-lock primitive
(see [parked.md](./parked.md)) will both eventually layer over this
shape without schema changes here.

**Classifier prompt contract.** Emit `(subject_id, object_id, kind)`
per entry, where subject is the character whose POV the prose
expresses. **Only fill the perspective the entry shows** — do not
infer the inverse from biology or convention. ("Kael called Aria
sister" → write Kael's POV only; do NOT auto-write "brother" for
Aria because she may not see Kael as her brother — estranged,
adopted, denial.) Update an existing row on contradicting prose
("Aria stopped thinking of Kael as a brother — only as a rival")
rather than creating a duplicate. Soft cap per scene: only the
relationships the prose actually surfaces; do not enumerate the
cast pairwise.

**Translation.** `kind` and `inverse_kind` are both translatable via
the [translations](#translation) table — `target_kind =
'character_relationship'`, `field` is either `'kind'` or
`'inverse_kind'`. The polymorphic-target pattern needs no
relationship-specific schema additions on the translations side.

**Delta-log participation.** Every write (INSERT/UPDATE/DELETE)
produces a delta under the entry's `action_id`; supports CTRL-Z
reversal same as every other branch-scoped table. `character_relationships`
is added to the `deltas.target_table` enum (line above).

**Lifecycle on retirement.** Retired characters (per
[retirement semantics](#characterstate-shape) — soft status change,
not delete) keep their relationship rows as historical fact. UI dims
or badges retired participants. No `ON DELETE CASCADE` since
character entities aren't hard-deleted in v1.

**Branch forking copies relationships.** Like every other
branch-scoped table, fork copies the rows to the new branch; branches
then diverge independently. Aria may still be Kael's sister in branch
A while a user edit in branch B re-types it as "estranged" — no
cross-branch coupling.

**Out of scope for v1:**

- Inter-faction relationships (member roster derives from
  `character.faction_id`; richer faction-faction edges deferred).
- Graph traversal primitives — "all of Aria's family transitively"
  is a recursive query the caller writes, not a built-in helper.
- Per-field provenance / classifier-lock — parked, both layer over
  this shape without changes.

#### Soft caps + compaction discipline

Schema does NOT enforce field-count caps via Zod `.max()` (would
create production write-rejection drama on classifier overflow). Bloat
is mitigated structurally:

- **Soft caps in classifier prompt.** `traits ≤ 8`, `drives ≤ 6`,
  `agenda ≤ 4`. Classifier prompt explicitly directs "replace, don't
  append" when at cap.
- **No per-turn classifier write to traits / drives / agenda.** These
  slow-evolving identity fields update only at chapter-close
  lore-mgmt agent. Per-turn pipeline handles scene metadata,
  `lastSeenAt`, `current_location_id`, attire changes,
  `equipped_items` / `inventory` / `stackables` transfers.
  Personality / behavioral / motivational fields lag scene-by-scene
  observations by up to one chapter — the right cadence for these
  fields specifically.
- **Chapter-close compaction (lore-mgmt agent).** Dedupes synonyms
  ("brave" + "courageous" → one), prunes outdated ("former alcoholic"
  10 chapters past sobriety → drop), consolidates overly-specific
  entries. The long-term bloat fix; soft caps are the per-turn
  discipline.

Cadence stratification is `architecture.md` territory; this section
declares the _requirement_ (compaction at chapter close), not the
agent design.

**Zod degradation bounds** (separate from soft caps — these are
"don't crash on pathological values" caps, much higher than the
prompt-discipline caps): `voice.max(2000)` characters; `traits` /
`drives` / `agenda` arrays `.max(50)`; `distinguishing.max(20)`;
each visual sub-field `.max(500)`; `condition` / `standing`
`.max(500)`; `stackables` keys non-empty + `.max(40)` characters;
`stackables` values non-negative integers.

#### Translation targets

The [`translations`](#translation) table can address state fields
via dotted paths. The split:

**Translatable** (text content the user faces in different languages):

- All `visual.*` sub-fields (string and per-element of `distinguishing[]`).
- `traits[]`, `drives[]`, `voice` per element / single string.
- `condition` (Location, Item).
- `standing` (Faction).
- `agenda[]` per element.

**Not translatable** (structural / numeric):

- All `EntityId` references (`current_location_id`, `equipped_items`,
  `inventory`, `parent_location_id`, `at_location_id`, `faction_id`).
- `lastSeenAt` (numeric snapshot).
- `stackables` keys — translatable in principle, but key normalization
  across characters is structurally complex; v1 treats keys as
  canonical lowercase English, untranslated. The _concept_ (gold) is
  rendered translated in narrative prose; the key is a structural
  identifier.
- `stackables` values (numeric counts).

#### Authorship contract

Per-field "who writes / when":

| Field group                                 | First write                                  | Subsequent writes                                         |
| ------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| `description` (top-level)                   | Whoever spawns the entity                    | User-only in v1                                           |
| `visual.*`                                  | Classifier from prose, or user via form      | Both — classifier evolves on observed prose change        |
| `traits`, `drives`                          | Classifier from prose                        | Classifier (chapter-close lore-mgmt only) + user via form |
| `voice`                                     | Classifier from prose, or user via form      | Both                                                      |
| `current_location_id`                       | Classifier per-turn                          | Classifier per-turn primary; user can edit                |
| `equipped_items`, `inventory`, `stackables` | Classifier per-turn                          | Classifier per-turn primary; user can edit                |
| `faction_id`                                | Classifier or user                           | Both                                                      |
| `lastSeenAt`                                | Classifier-only                              | Classifier-only                                           |
| `parent_location_id`                        | User at creation, or classifier on discovery | Both — rare changes                                       |
| `condition` (Location/Item)                 | Classifier or user                           | Both                                                      |
| `standing`, `agenda` (Faction)              | Classifier or user                           | Classifier (chapter-close) + user                         |
| `at_location_id` (Item)                     | Classifier per-turn                          | Classifier per-turn primary; user can edit                |

Manual user edit vs classifier overwrite policy is parked as an
architecture concern. v1 lean: classifier writes from prose-evidenced
changes; user edits "stick" only until classifier reads contradicting
prose. Per-field provenance metadata (deferred to v1.5) is the proper
fix.

### Story identity fields

**Decided:** `stories` gains identity metadata as columns (not inside
the JSON blobs). Columns where the library needs filter/sort/search
access; JSON reserved for shape that doesn't require direct SQL
queries.

- `tags json` — `string[]`. Indexable via `json_each` for
  search/filter. Not shown on library cards (tag phrases are longer
  than chip format tolerates).
- `cover_asset_id text FK → assets.id` — optional. Cards are
  text-first; covers are a power-user enhancement, rendered in a
  future visual-identity pass.
- `accent_color text` — optional hex/HSL. Falls back to mode-derived
  default (Adventure blue, Creative purple) when null.
- `status text` — lifecycle enum `draft | active | archived`,
  mutually exclusive.
  - `draft` is only reachable via wizard save; transitions to
    `active` on wizard completion and is not user-togglable from the
    library afterward.
  - `active ↔ archived` toggle via overflow menu.
  - Drafts cannot be archived (archive action is gated on
    `status='active'`); they can only be completed or deleted.
- `favorite integer` — 0 or 1. Orthogonal to `status` — any status
  can be favorited. Inline star toggle on the library card. Naming
  parallels the per-row `favorite` flag on `vault_calendars`.
- `description text` — freeform user-text slot for the story's
  blurb / log line / running notes. Shown on library cards
  (3-line ellipsis). Not injected into any LLM prompt; purely
  the user's own context surface.
- `last_opened_at integer` — distinct from `updated_at` (which
  reflects any write). Touched when the user navigates into the
  story; drives the default `last-opened` sort on the library.

**Library sort invariant:** `favorite DESC, <chosen_sort_key>` —
favorited stories always float to the top within any filter. Mirrors
the Layer 0 rule for lead-character sort on entity lists.

### Story settings shape

**Decided:** `stories` carries TWO zod-parsed JSON blobs, split by
lifecycle:

- **`definition`** — definitional content (what the story IS).
  Wizard-authored at story creation; no global default. Edits propagate
  to all branches of the story (definition is story-level, not
  branch-level).
- **`settings`** — operational config (how it generates). Copy-at-
  creation from `app_settings.default_story_settings`; story owns its
  values thereafter. Some fields use override-at-render instead
  (models only).

Both are parsed with defaults applied at load time (parse mechanics
in architecture.md → "Settings: strict types, defaults at load").
The split mirrors the two-section left rail of the
[Story Settings screen](./ui/screens/story-settings/story-settings.md):
`definition` ↔ Story section, `settings` ↔ Settings section.

**`stories.definition` shape:**

```ts
stories.definition: {
  // Author-relationship
  mode: 'adventure' | 'creative'
  leadEntityId: string | null       // see cross-field constraint below; must reference entity with kind=character
  narration: 'first' | 'second' | 'third'

  // Substantial prompt content — preset+prose hybrid (see "Genre + tone preset+prose hybrid" below)
  genre: { label: string; promptBody: string }
  tone:  { label: string; promptBody: string }

  // Substantial prompt content — freeform
  setting: string                   // freeform prose; the world / time / place

  // World time — see calendar-systems/spec.md for the primitive
  calendarSystemId: string          // references CalendarSystem.id in the calendar registry
                                    //   (built-ins in code + user-authored in vault_calendars);
                                    //   seeded from app_settings.default_calendar_id at creation
  worldTimeOrigin: TierTuple        // Record<tierName, number> matching the active calendar's tier shape
                                    //   Earth: { year, month, day, hour, minute, second }
                                    //   Shire: { year, month, day }
                                    //   Stardate: { count }
}
```

**Cross-field constraint** (enforced at the zod boundary on
`definition`):

```
narration ∈ { 'first', 'second' }  →  leadEntityId != null
```

A first- or second-person story has a lead by definition (whose "I"
or "you" the narrator inhabits). Coexists with the existing
`mode='adventure' → leadEntityId != null` rule; either alone is
sufficient to require a lead. Wizard rejects commit; Story Settings
rejects save. Creative + third-person + null lead remains valid (the
omniscient-narrator ensemble case).

**`stories.settings` shape (operational only):**

```ts
stories.settings: {
  // Memory — defaults copied from App Settings → Story Defaults at creation.
  // Full design in docs/memory/cadence.md and docs/memory/retrieval.md.
  chapterTokenThreshold: number     // default 24000
  chapterAutoClose: boolean         // auto-close at threshold; off = threshold is guidance only, user wraps manually; default true
  fullChapterInBuffer: boolean      // default false; two-mode axis — true = full current chapter verbatim, false = last partialChapterBuffer entries of current chapter
  partialChapterBuffer: number       // default 10; entries from current chapter when fullChapterInBuffer = false. See docs/memory/cadence.md → User-tunable knobs
  protectedBuffer: number            // default 10; chapter-boundary spillover floor — applies to BOTH modes. If current chapter has fewer entries, fill from previous chapter up to this floor. See docs/memory/cadence.md → User-tunable knobs
  classifierCadence: number          // turns between periodic classifier runs in the background; entry-counted. Cadence-vs-window overlap warning only fires in partial mode (full mode catches up unclassified entries at chapter close)
  piggybackMode: 'on' | 'off'       // capability-gated; on = narrative emits structured trailing block; off = separate per-turn classifier pass
  embeddingBackend: 'provider' | 'local'   // embedding runtime (provider endpoint OR bundled local ONNX); both produce identical retrieval algorithm
  embedding_model_id: string        // canonical embedding model id; copied from app_settings.embedding_model_id at story creation. Locked thereafter unless the user explicitly re-indexes via the model swap UX. Different stories may carry different model ids; vec0 partitions per branch. See docs/memory/retrieval.md → Storage and Model swap UX
  embedding_swap_target?: string    // model id of the in-flight re-index target. Non-null while a stage-then-flip swap is in progress; cleared atomically with the swap's Phase 2 commit. Crash recovery on story open surfaces a resume/cancel prompt when this is set. See docs/memory/retrieval.md → Model swap UX
  embedding_provider_id?: string    // required when embeddingBackend === 'provider'; FK into app_settings.providers[].id picking which provider supplies the embedding endpoint. Distinct from the narrative-side provider routing (a user may run e.g. OpenAI for narrative and a local embedding provider, or vice versa). Null / undefined when embeddingBackend === 'local'.
  retrievalBudgets: {                // per-type token budgets, hard partitions in v1 (no spillover); see docs/memory/retrieval.md → Per-type retrieval budgets
    entities: number
    lore: number
    happenings: number
    threads: number
    chapters: number                 // chapter summaries pool
  }
  effectiveDim?: number              // Matryoshka effective dim — null = use model native dim, <N> = truncate stored vectors and queries to N. Set at story creation, locked thereafter same as embedding_model_id. Provider-only (local model is small enough that truncation isn't worth the quality tail). See docs/memory/retrieval.md → Matryoshka effective dim
  probe_mode_active: boolean        // per-story activation of the memory probe. No-op while app_settings.diagnostics.enabled is off. Default false. See docs/memory/probe.md and docs/observability.md → Gating model

  // Composer
  composerModesEnabled: boolean     // adventure-only; creative ignores
  composerWrapPov: 'first' | 'third' // how composer modes wrap user input (NOT narration)
  suggestionsEnabled: boolean       // gates next-turn suggestion pane

  // Next-turn suggestions — user-customizable category palette + literal count
  suggestionCount: number           // chips per emission; default 3, range 1-6. Decoupled from #enabled categories: model picks per-slot from the enabled palette
  suggestionCategories: {           // ordered palette; copied at story creation from app_settings.default_suggestion_categories[mode] (sibling field — per-mode shape doesn't fit Partial<StorySettings>)
    id: string                      // stable per-story uuid
    label: string                   // visible chip overline ("Action", "Confront", user-edited)
    promptHint: string              // prose snippet fed to the suggestion agent for this slot
    color: string                   // slot key from the curated accent palette (theme-resolved at render; not raw hex)
    enabled: boolean                // emission gate; disabled-but-defined entries stay editable in settings
    order: number                   // explicit ordering; user-draggable
  }[]

  // Translation
  translation: {
    enabled: boolean
    targetLanguage: string | null   // ISO 639-1
    granularToggles: {
      narrative: boolean
      entityNames: boolean
      entityDescriptions: boolean
      lore: boolean
      threads: boolean
      happenings: boolean
      chapterMeta: boolean
    }
  }

  // Models — override-at-render pattern. Keys are agent ids drawn from the
  // assignments registry (single source of truth, evolves over time);
  // narrative is the always-present storyteller slot. Image generation is
  // deferred past v1 — `imageGen` returns when the feature lands.
  // `memory-compaction` was dropped — chapter-close lore-mgmt subsumes its
  // role per the cadence stratification; see docs/memory/chapter-close.md.
  models: {
    narrative?: string              // optional override; absent = resolve through assignments[agentId] → profile.modelRef
    classifier?: string
    translation?: string
    suggestion?: string
    'lore-mgmt'?: string             // kebab-case agent ids match the UI labels in app-settings + story-settings Models tabs
    retrieval?: string               // auto-mode injection fallback consumer — LLM call to resolve marginal embedding+keyword candidates with injection_mode='auto'
  }

  // Pack
  activePackId: string | null
  packVariables: Record<string, unknown>  // values keyed by variable name; zod-validated per active pack's declared schema
}
```

`compactionDetail` (a freeform user prose directive on the prior
schema) is **dropped** in this design pass. The original
"memory-compaction agent" it directed no longer exists — chapter-
close lore-mgmt subsumes its role per
[docs/memory/chapter-close.md](./memory/chapter-close.md). Power
users can author packs that bias prompts more rigorously than a
one-line soft hint.

#### Genre + tone preset+prose hybrid

Both `genre` and `tone` carry the same shape: a short `label` (used
in chrome — library-card overline, etc.) and a multi-paragraph
`promptBody` (substantial prose injected into generation context).
Wizard selection is **preset-driven** with snapshot copy:

- User picks from a bundled preset catalog (Hard sci-fi / Cozy
  fantasy / Noir / …); the preset's `displayName` copies into
  `label`, the preset's `promptBody` copies into `promptBody`.
- User can edit either freely afterward.
- **Fire-and-forget** — no preset id stored on the story. App
  updates that change the bundled preset don't propagate to existing
  stories. Mirrors the calendar-clone pattern (see
  [Vault content storage](#vault-content-storage)).
- **No-preset path:** preset selection is optional; user can skip
  and author label + prose from scratch.

Preset catalog lives in code (bundled JSON, ~20-30 entries each for
v1). User-authored presets in Vault are deferred —
[Vault content types for genre / tone / setting templates](./parked.md#vault-content-types-for-genre--tone--setting-templates)
captures the post-v1 path.

#### Why two JSON columns, not promoting to columns

Each definitional compound field (`genre`, `tone`, `worldTimeOrigin`)
needs a JSON-typed column anyway — promoting to columns yields no
query benefit and adds schema rigidity for every future definitional
addition. JSON keeps the shape additive. The library-card genre
overline reads `definition.genre.label` via `json_extract`;
performance is fine for thousands of stories, and an indexed
expression solves any future scale.

The previous single-`settings` shape semantically overloaded "settings"
to mean both definitional content and operational config. The split
disentangles them and matches the UI's two-section structure.

**Scope policy — two patterns for global vs story.**

1. **Copy-at-creation** (operational + UX prefs — `stories.settings`).
   App Settings exposes a **"Story Defaults"** section holding the
   `settings` field shape (the underlying schema field is
   `app_settings.default_story_settings`; the UI label is "Story
   Defaults"). On story creation the current globals are copied into
   the new story's `settings`. After creation, the story owns its
   values; changing the global default does NOT propagate to existing
   stories.
2. **Override-at-render** (`settings.models` only). Fields are
   optional; absent means "resolve the agent through the App Settings
   profile chain at render time" — `assignments[agentId] → profile.modelRef`.
   Changing the global profile / assignment propagates to every
   un-overridden story. The UX difference (Models' dashed-italic "App
   default: X" sentinel vs copy-at-creation fields showing a concrete
   value) derives directly from this pattern split. Unresolved
   agents pre-flight-error at generation time.

Most operational fields seed from `app_settings.default_story_settings`;
a few — `default_provider_id`, `default_calendar_id` — sit as
top-level sibling fields on `app_settings` because they're single-id
pointers into a registry rather than full state copies. Same
copy-at-creation semantics; just a different source path.

**`stories.definition` follows neither pattern** — every field is
wizard-authored per story; no global default exists. Definitional
fields are `definition`'s entire scope by construction.

**`stories.definition` fields are NOT translation targets.** The
substantial prose in `genre.promptBody` / `tone.promptBody` /
`setting` is user-typed source-language input consumed by the AI
during generation; it's not AI-output displayed in different UI
languages. The [translations](#translation) table targets user-facing
in-story content (both AI output and the user's own action text), not
author-input config.

**Narration vs composer wrap POV — orthogonal axes, often confused.**
`narration` governs how the AI writes prose (`first | second | third`
person). `composerWrapPov` governs how the composer's lazy-input modes
(Do/Say/Think) wrap user text into sendable form. These are distinct:
second-person narration doesn't imply wrapping user input as "You
reach for..." — that would produce nonsense. Composer wrap POV is
restricted to `first | third` (second not offered); narration has all
three.

### App settings storage

**Decided:** global app config lives in a single-row `app_settings`
table keyed on `id = 'singleton'`. Heavy use of JSON columns;
schema can normalize into per-domain tables later if a real reason
emerges. For v1 the JSON-blob approach trades schema rigour for
fewer migrations during the rapid-iteration period.

**Provider instances — multi-instance, user-managed.**

```ts
app_settings.providers: Array<{
  id: string                                 // stable UUID per instance
  type: 'anthropic' | 'openai' | 'google' | 'openrouter' | 'nanogpt' | 'nvidia-nim' | 'openai-compatible'
  displayName: string                        // user-chosen; e.g. 'Anthropic (work)'
  apiKey: string                             // see encryption note below
  endpoint?: string                          // override default; required for openai-compatible
  favoriteModelIds: string[]                 // user's working set; floats to top of selectors
  cachedModels?: Array<{                     // result of /models fetch; survives offline restarts
    id: string
    capabilities?: {
      reasoning?: boolean
      structuredOutput?: boolean
      matryoshkaSupported?: boolean          // NEW: model supports Matryoshka representation truncation. See docs/memory/retrieval.md → Matryoshka effective dim
      matryoshkaDims?: number[]              // NEW: curated dim ladder declared by the model card (e.g., [256, 512, 1024, 1536, 2048, 3072]). Picker surfaces these first; Custom… accepts any N up to native.
    }
  }>
  customModelIds?: string[]                  // user-added model ids not in the fetched catalog (custom OpenAI-compatible deployments, fine-tunes). Bare ids without capability data; picker walks cachedModels + customModelIds to compose its row source.
  cachedAt?: number                          // last successful /models fetch timestamp
}>
```

`app_settings.default_provider_id` references one of the above; the
default seeds Narrative profile creation and "Reset to defaults"
actions across the rest of the app.

**Profiles — narrative + agents.**

```ts
app_settings.profiles: Array<{
  id: string                                 // stable UUID
  kind: 'narrative' | 'agent'                // narrative is special-cased (always present, undeletable)
  name: string                               // 'Narrative' / 'Fast tasks' / 'Heavy reasoning' / etc.
  description?: string                       // user-authored, agent profiles only
  modelRef: { providerId: string; modelId: string }  // composite — disambiguates same modelId across providers
  temperature?: number                       // 0-2 (provider-dependent; Anthropic caps at 1, OpenAI/Google allow 2)
  maxOutput?: number
  thinking?: number                          // reasoning slider; conditional on model capability
  timeout?: number                           // seconds; default 60
  structuredOutput?: 'auto' | 'force-on' | 'force-off'  // agent profiles only
  customJson?: Record<string, unknown>       // advanced — per-field merge over constructed payload
}>
```

`modelRef` is a composite `{ providerId, modelId }` rather than a
bare model id string — the same model id can exist on multiple
provider instances (e.g. two Anthropic keys, two OpenAI-compatible
endpoints). The composite resolves unambiguously.

**Assignments — which profile each agent uses.**

```ts
app_settings.assignments: Record<AgentId, string>  // agentId → profile.id
```

The `AgentId` registry is the single source of truth for which
agents exist. v1 ships:
`classifier | translation | suggestion | lore-mgmt | retrieval | wizard-assist`.
Narrative is not an agent — it's the storyteller, always wired to
the `kind: 'narrative'` profile, no assignment slot needed.

`wizard-assist` backs all AI calls fired from the
[Story creation wizard](./ui/screens/wizard/wizard.md) (title chips,
description / genre / tone / setting / opening prose, cast and lore
list suggestions). One agent serves the whole wizard surface;
splitting per-call-shape is a parked concern (see
[parked.md → Wizard-assist agent profile splitting](./parked.md#wizard-assist-agent-profile-splitting)).

**Reset-to-defaults seed map — code constant, not stored.**

Onboarding's initial seed and the App Settings · Profiles `Reset to
defaults` action both source from a baked-in code constant indexed
by `(providerType, role)`:

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
  narrative: RoleDefaults // seeds the narrative profile
  agentProfiles: Array<{
    // seeds the agent profile set
    name: string // e.g. 'Fast tasks'
    description: string
    defaults: RoleDefaults
  }>
  defaultAssignments: Partial<Record<AgentId, string>>
  // agentId → profile NAME from the
  // seeded set above; resolved to
  // generated UUIDs at seed time
}

const PROVIDER_DEFAULTS: Partial<Record<ProviderType, ProviderTypeDefaults>>
```

Runtime resolution for an agent's model never consults this
constant — it walks `stories.settings.models[agentId]` (override,
modelId string) → `profile.modelRef` via `assignments[agentId]`.
For narrative the chain is just `narrative_profile.modelRef`. The
constant only fires at seed-time and on user-triggered `Reset to
defaults` — it has no presence in the hot render path.

**Reset-to-defaults semantics.** Look up
`PROVIDER_DEFAULTS[providers[default_provider_id].type]`:

- **Found.** Replace `app_settings.profiles[]` with the seeded
  narrative + agent profiles (fresh UUIDs at seed time). Replace
  `app_settings.assignments` with the seeded matrix (profile-name
  → newly-generated id resolution).
- **Undefined** (e.g. `openai-compatible`, where the right model
  varies per deployment). `profiles[]` becomes a single empty
  narrative profile (no `modelRef`, default params blank).
  `assignments` becomes an empty Record. The standard broken-state
  vocabulary surfaces at next fire time — profile cards render
  warning trim, agent rows show `⚠ No profile assigned`, global
  banner aggregates.

`Reset to defaults` is a single page-level action on App Settings ·
Profiles (not per-section), gated behind an AlertDialog confirm —
it wipes any user-added agent profiles plus the entire assignment
matrix, not just a single field.

**Why a code constant, not stored data.** The defaults track
provider-recommended models, which evolve as providers ship new
models. Tracking them as code lets the recommendation set update
with a release rather than a data migration. The user's stored
state (`profiles[]`, `assignments`) snapshots whatever the constant
returned at seed-time; subsequent constant updates don't propagate
to already-seeded users — explicit `Reset to defaults` is the
re-seed path.

**Story Defaults (`default_story_settings`) — copy-at-creation source.**

```ts
app_settings.default_story_settings: Partial<StorySettings>
```

Mirrors the operational
[`stories.settings`](#story-settings-shape) shape — chapter threshold,
auto-close, protected buffer + partial chapter buffer, translation
block, composer prefs, suggestions toggle, `suggestionCount`. On story creation these copy
into the new `stories.settings`; the story owns its values thereafter.
The per-mode `suggestionCategories` palette doesn't fit
`Partial<StorySettings>` (story-side is a flat array, default-side
needs adventure / creative branches) so it lives on
`app_settings.default_suggestion_categories` as a sibling field
(see below). Definitional fields (those in `stories.definition` —
`mode`, `leadEntityId`, `narration`, `genre`, `tone`, `setting`,
`calendarSystemId`, `worldTimeOrigin`) are absent from this default
shape — they're wizard-authored per story with no global default.

**Default calendar pointer.**

```ts
app_settings.default_calendar_id: string | null // seeds new stories' calendarSystemId
```

A single-id pointer into the merged calendar registry. It is `null`
at first init — no calendar is seeded (`vault_calendars` starts
empty); whether to seed a built-in default or require an explicit
pick is a calendar-domain decision deferred to the calendar slices.
Calendar definitions themselves live in
[`vault_calendars`](#vault-content-storage)
(user-authored) + code (built-ins) — Vault content storage is
documented in its own decision section below.

**Default suggestion categories (per-mode).**

```ts
app_settings.default_suggestion_categories: {
  adventure: SuggestionCategory[]   // shape per stories.settings.suggestionCategories
  creative: SuggestionCategory[]
}
```

Per-mode dict; sibling field on `app_settings` rather than nested
inside `default_story_settings` because the per-mode shape doesn't
fit `Partial<StorySettings>` (`stories.settings.suggestionCategories`
is a flat array — the story's mode is fixed at creation and only
the mode-matched default applies). Same placement rationale as
`default_calendar_id`. Bundled curated initial values ship in code
(genre/tone-preset-style JSON catalog); user-editable in App Settings
→ Story Defaults → Suggestion categories. Editor lives in
[`story-settings.md → Suggestion categories`](./ui/screens/story-settings/story-settings.md#suggestion-categories);
emission and edge cases in
[`reader-composer.md → Next-turn suggestions`](./ui/screens/reader-composer/reader-composer.md#next-turn-suggestions).

**Why one table, not several.** Providers, profiles, and
assignments form one tightly-coupled config envelope — they're
edited together, deleted together (uninstall = drop the row), and
queried together at app open. Splitting into per-domain tables
would mean three INSERTs / three loads / three sync points for
zero query benefit (no JOIN ever runs against this data — it's
loaded once into Zustand at boot).

**Encryption at rest — deferred.** API keys live unencrypted in
the `providers[].apiKey` JSON. v1 is local with no network
exposure of the DB; the threat model that justifies encryption
hasn't materialized. Tracked in
[parked.md](./parked.md#encryption-at-rest-for-provider-keys).

**Provider / profile deletion semantics.** Deliberate divergence
from the calendar precedent below: providers and profiles are
infrastructure plumbing (which endpoint a call hits, which
parameter envelope a call uses), not data that shapes persistent
story content. Deletion is permitted unless it removes an active
default; dangling references stay as data and surface as visible
errors at next use. No silent re-pointing, no cascade-deletes of
dependent rows, no fallback chains.

**Provider deletion is blocked** when any active embedder pointer
or the app-level narrative default points at it. Specifically:

- Provider equals `default_provider_id`.
- Provider equals `app_settings.embedding_provider_id` AND the
  app-level `embedding_backend` defaults to `provider`.
- Any story has `settings.embedding_provider_id` matching the
  provider AND `settings.embeddingBackend === 'provider'`. Per-story
  embedder is load-bearing data: the story's vec0 vectors were
  produced by this embedder, and the runtime needs the same
  embedder to query them. The user runs
  [Model swap UX](./memory/retrieval.md#model-swap-ux) on each
  affected story before the delete is permitted, surfacing the
  re-index cost where the user already expects it.

The user changes the relevant defaults first, then retries. The
`providers[].length ≥ 1` invariant falls out for free —
`default_provider_id` always points into `providers[]`, and the
pointed-at provider can't be deleted.

**Profile deletion is blocked** when `kind === 'narrative'`
(already enforced — the narrative profile is structurally required).
Agent profiles are deletable.

**On a permitted delete**, the row vanishes from
`app_settings.providers[]` / `app_settings.profiles[]`. References
to its id stay intact:

- `profiles[].modelRef.providerId` matching a deleted provider →
  left as-is; profile errors at next LLM-call time.
- `assignments[agentId]` matching a deleted profile → key removed
  (assignment unset). Agent has no profile assigned; errors at next
  fire time. **No fallback to the narrative profile** — the user
  unassigned explicitly and gets to see the agent is unconfigured.

Per-story model overrides (`stories.settings.models[agentId]`) are
direct model id strings (not `{providerId, modelId}` composites)
and don't reference providers — they have nothing to dangle from
provider/profile deletion. Model-catalog freshness is handled by
the pre-existing global broken-config banner, separate from this
design.

Resolver-time failure shape and the pre-flight validation that
catches these before any LLM call fires are documented in
[`generation-pipeline.md → Config pre-flight validation`](./generation-pipeline.md#config-pre-flight-validation);
the visible-error contract in the reader (system entries) is in
[`reader-composer.md → Error surface`](./ui/screens/reader-composer/reader-composer.md#error-surface--system-entries-vs-persistent-state-pill).

### Vault content storage

**Decided:** non-story user content (calendars, future packs,
scenarios, character templates) lives in **per-type top-level
tables** prefixed with `vault_` — `vault_calendars` ships in v1;
`vault_packs`, `vault_scenarios`, `vault_character_templates` etc.
land when those features ship. Vault is the unified UI surface that
will browse and edit these in one place; storage stays per-type.

**`vault_calendars`** holds user-authored CalendarSystem definitions
(clones of built-ins, plus from-scratch entries when L3 lands).
Built-ins continue to live in code (or repo JSON loaded at boot)
and are merged with `vault_calendars` rows into one in-memory
`Map<id, CalendarSystem>` at app init. Stories reference calendars
by id; resolver does direct lookup against the merged registry.
Built-in ids (`'earth-gregorian'`) are stable strings; clone ids are
UUIDs — disjoint by construction, no precedence rule needed.

`app_settings.default_calendar_id` is a single-id pointer into the
merged registry — parallel to `default_provider_id`. The pointer
stays on `app_settings` since it's a global default, not registry
content.

**Favorite is a per-row flag** on `vault_calendars`, not a separate
app-level array. Surfaced as a `★`/`☆` toggle on Vault cards and
calendar pickers; sorts favorited rows above non-favorited ones.
Built-ins live in code so they have no row to carry the flag —
favoriting a built-in requires cloning it first (the resulting
`vault_calendars` row is the favoritable artifact). Acceptable
constraint: the workflow that prompts a "I want this favorited" is
also the workflow that prompts "I want to tweak its label or
displayFormat," so the clone step has independent value.

**Cloning a built-in** copies its definition to a new
`vault_calendars` row with a new UUID and the original preset name
copied verbatim. The `built-in` / `custom` chip in the editor UI
is the type indicator — no suffix is baked into the name. The
original built-in is never mutated; the clone is fully independent
from creation onward.

**Vault content deletion** is blocked when any story references the
content's id; otherwise allowed. Calendars set this stricter
precedent in v1. Provider/profile deletion is deliberately softer
— see
[App settings storage → Provider / profile deletion semantics](#app-settings-storage).

**Why per-type, not polymorphic.** Future Vault content types have
unrelated schemas — packs hold prompt template strings + variables,
scenarios are whatever shape lands, character templates are a
subset of entity state. Forcing them through one row shape
(`vault_items` with `kind` discriminator + JSON body) is premature
with only one type in flight. The unification question earns its
weight when ≥2 content types ship and we can validate against
actual schema overlap. Tracked in
[`parked.md`](./parked.md#vault-content-storage-pattern).

**Vault UI** is deferred per [`ui/README.md`](./ui/README.md); v1
surfaces the calendar editor as the first sub-wireframe under a
Vault parent (placeholder shell), with the broader Vault
navigation landing later.

### Entry metadata shape

**Decided:** `story_entries.metadata` is the per-entry JSON blob for
structured classifier/pipeline output alongside the raw `content`.
Distinct from `content` because it's structured, typed, and
delta-logged. Shape:

```ts
story_entries.metadata: {
  // Generation provenance (AI entries only)
  tokens?: { prompt: number, completion: number, reasoning?: number }
  model?: string
  generationTimingMs?: number
  reasoning?: string                // persisted reasoning text from providers that expose it; mirrors `tokens.reasoning` (the count). Optional — undefined when the provider doesn't surface reasoning.

  // Scene presence — classifier-authored
  sceneEntities: string[]           // entity IDs present in this entry's scene (characters + items)
  currentLocationId: string | null  // location entity that IS the current scene; singleton

  // In-world time — classifier-authored, user-editable
  worldTime: number                 // physical seconds since story start; calendar-uniform. Storage invariant: ≥ 0. Classifier writes are monotonically non-decreasing (delta ≥ 0 hard); user manual edits may produce non-monotonic sequences which the UI flags and consumers tolerate. See "In-world time tracking" below.

  // Next-turn suggestions — emission output for the chip strip displayed below this entry
  nextTurnSuggestions?: {
    items: { categoryId: string; text: string }[]  // 1..suggestionCount; categoryId references stories.settings.suggestionCategories[].id (orphans render with neutral fallback per reader-composer.md)
    source: 'piggyback' | 'classifier' | 'refresh' // emission path that wrote this (diagnostic; dev-mode surfacing)
    refreshGuidance?: string                        // present when source === 'refresh' and the composer-partial was passed; persisted so reload faithfully shows refresh-influenced chips
  }
}
```

**Reasoning text persistence.** `reasoning` is written at stream
completion alongside `tokens.reasoning`. Field stays undefined for
providers that don't expose reasoning text. Translation behavior:
stays untranslated (provenance, not user-facing narrative — same
treatment as `model`). Read sites: the
[EntryCard pattern](./ui/patterns/entry-card.md#reasoning-expansion)
expands the brain-toggle reasoning body from this field;
export/backup includes it as part of the entry record. Search
scope intentionally excludes it (provenance, not searchable
narrative content).

**Scene presence is kind-aware.** `sceneEntities` carries characters
and items — the things that come and go. `currentLocationId` is the
singleton "we are here" pointer. Factions are not scene-tagged; a
faction isn't in a scene the way a person is.

**Metadata edits are delta-logged.** Unlike `content` (the single
per-column side-channel exemption, see "Entry mutability & rollback"),
metadata mutations write a delta. Consequence: a user correcting
`worldTime` on an entry after the classifier over-advanced during a
flashback produces a reversible delta, reachable via CTRL-Z or
rollback. Same for `sceneEntities` / `currentLocationId` user-edits.
`nextTurnSuggestions` rewrites (manual refresh, re-emission after
rollback) write a delta the same way; rollback restores prior chips.

**Next-turn suggestions emission.** `nextTurnSuggestions` is the
per-entry persistence of the chip strip rendered below this entry.
Three emission paths write it: narrative-fold under
`piggybackMode='on'`, classifier-fold under `'off'`, and the
dedicated `suggestion-refresh` pipeline for user-triggered re-roll.
Translation rows for chip text are cached by
`(target_language, hash(chip.text))` — content-addressable,
self-invalidating across re-rolls and CTRL-Z. UI shape and the
chip-tap consumption flow live in
[`ui/screens/reader-composer/reader-composer.md → Next-turn suggestions`](./ui/screens/reader-composer/reader-composer.md#next-turn-suggestions).

### Opening entry

**Decided:** the opening of a story is `story_entries[1]` of the
initial branch — a first-class narrative entry, not a settings
field. Adds a new value to the `story_entries.kind` enum:

```ts
story_entries.kind:
  'user_action' | 'ai_reply' | 'system' | 'opening'  // NEW: 'opening'
```

**Authorship discriminator: `metadata.model`.** Set when the wizard's
AI-assist path generated the opening; `null` when the user wrote it
themselves. No separate `authorSource` field needed — model presence
is the discriminator.

**AI-generated openings emit minimal classification inline.** The
wizard's opening-generation call uses structured output to produce
prose AND minimal scene metadata in one call:

```ts
{
  prose: string,
  sceneEntities: string[],          // subset of wizard-curated cast entity ids
  currentLocationId: string | null, // one of the wizard-curated cast location ids
  worldTime: 0                      // story start; always 0
}
```

The model is constrained to reference only the wizard-curated cast
in the metadata refs (passed as enum-shaped reference data in the
generation context). Prose can mention unbacked names freely
("Old Jorin was sleeping at the bar") — only the metadata refs are
constrained.

**No separate classifier pass on the opening (v1).** User-written
openings start with empty metadata (`worldTime: 0`,
`sceneEntities: []`, `currentLocationId: null`); turn 2's classifier
populates scene presence going forward. The first AI reply's prompt
context includes the opening prose verbatim (protected buffer
covers it — chapter 1 has only the opening entry, so the protected
floor pulls the opening into context), so the AI grounds itself
from prose regardless of metadata state. A separate tagging pass for user-written openings is parked
in
[`parked.md → Classifier-on-opening retrofit`](./parked.md#classifier-on-opening-retrofit).

**Opening invariants** (enforced at the action layer):

- **Position invariant.** Always position 1 of its branch. Action
  layer rejects any write that would create or move an `opening`
  entry to a different position.
- **Block-delete.** `op=delete` on `kind='opening'` is rejected at
  the action layer. Use cases for "redo the opening" are addressed
  by text-edit (the existing side-channel exemption — see "Entry
  mutability & rollback") or by a wizard-driven regenerate pass
  (parked in
  [`parked.md → Regenerate-opening affordance — post-commit from reader chrome`](./parked.md#regenerate-opening-affordance--post-commit-from-reader-chrome)).
- **Branching:** copies forward via the standard branch-copy
  mechanism — the opening behaves like any entry being copied into
  the new branch.
- **Rollback:** can target entry 1 (which leaves only the opening);
  can never go below the opening.

**Reader rendering** is identical to `ai_reply` bubbles — narrative
prose is narrative prose, regardless of authorship. Provenance lives
in metadata, not in styling. No regen icon, no model-name label;
delete is suppressed by the block-delete invariant.

### In-world time tracking

**Decided:** time is modeled as a single non-negative integer
`worldTime` on each entry's metadata, in **physical seconds since
story start**. The base unit is universal — every calendar uses the
same physical-seconds integer. The calendar's role is to map that
integer to its tier-tuple via a `secondsPerBaseUnit` anchor (1 for
Earth, 86400 for Shire's day-grain, 86400 for Mayan kin) plus its
tier rollover stack. See [`calendar-systems/spec.md`](./calendar-systems/spec.md)
for the calendar primitive.

**Invariants split across three layers.** The "monotonically
non-decreasing" claim splits by source:

- **Storage** (hard): `worldTime ≥ 0`. The integer is non-negative;
  the action layer rejects writes outside this range.
- **Classifier** (hard, see
  [`architecture.md → Classifier contract — metadata fields`](./architecture.md#classifier-contract--metadata-fields)):
  per-entry delta `≥ 0`. Flashbacks emit `0`. The classifier is
  structurally incapable of producing a non-monotonic cumulative
  sequence on its own.
- **Cumulative monotonicity** (soft): the sequence is monotonically
  non-decreasing **when written by the classifier alone**. User
  manual `worldTime` edits (via the
  [per-entry world-time footer click](./ui/screens/reader-composer/reader-composer.md#per-entry-world-time-footer))
  may produce non-monotonic sequences. The UI surfaces violations
  with an inline indicator on the offending entry; downstream
  consumers read whatever value is stored and tolerate any
  non-negative `worldTime`.

**User-action `worldTime` initialization.** The classifier doesn't
run on `user_action` entries (see
[`architecture.md → Classifier contract — metadata fields`](./architecture.md#classifier-contract--metadata-fields)).
The action layer writes each new user_action with `metadata.worldTime`
copied from the immediately preceding entry's `worldTime` —
same-transaction inherit at write time, not a render-time derivation.
User-actions consequently render the world-time footer (same label as
the preceding entry) and accept manual edits on the same terms as AI
and opening entries (see
[`entry-card.md → World-time footer`](./ui/patterns/entry-card.md#world-time-footer)).
The classifier's "delta added to prev `worldTime`" rule on the next
AI reply picks up the inherited — or user-edited — base naturally,
which is what enables a future user-triggered time-advance affordance
without a structural exception.

`stories.definition.worldTimeOrigin: TierTuple` — a `Record<string,
number>` keyed by the active calendar's tier names — anchors
`worldTime = 0` to a display moment. Earth's origin is `{ year,
month, day, hour, minute, second }`; Shire's is `{ year, month,
day }`; Stardate's is `{ count }`. Calendar-uniform from v1; no
string-to-tuple migration ever needs to run. Any "creation date
string" UI need is met by rendering the tuple through the calendar's
`displayFormat` template.

**Why universal seconds.** Calendar-specific base units would force
the integer to reinterpret on calendar swap (Earth-86400 = 1 day;
Shire-86400 = 86400 days) and would force per-calendar
classifier-prompt math. Universal seconds keeps the integer
genuinely calendar-agnostic — preserved across swap, classifier
always emits second-deltas, all worldTime arithmetic uniform across
calendars. The precision floor is one second (sub-second narrative
isn't a thing for fiction); int64 holds ~290 billion years.

**Why integer-based.** Free-form "time label" strings ("Day 3,
evening") can't be math'd. Future features (character ageing,
scheduled happenings firing on time, freshness-based retrieval decay)
all want arithmetic. A raw elapsed counter gives us that; the calendar
formatter produces the human-readable string on render.

**Why story-relative, not absolute unix.** Story-relative keeps the
classifier's job tractable — "how many seconds elapsed this turn" is
the question it can actually answer. Absolute unix would require the
classifier to know the setting's calendar from turn 1, and would be
incoherent for fictional worlds against an implicit 1970 epoch.

**Classifier contract.** Each AI reply's classification pass estimates
elapsed seconds and emits a delta for the new entry's
`metadata.worldTime`. The active calendar's vocabulary (tier names,
weekday labels, era names) ships into the classifier's prompt context
so it can convert prose like "two days later" or "next Tuesday" — but
its arithmetic output is always in seconds, regardless of calendar.
For detected flashback/memory framing ("she remembered...", "25 years
earlier..."), the classifier emits `0` — main-timeline clock doesn't
advance during recalled scenes. Estimation errors are unavoidable;
users can manually edit `metadata.worldTime` directly on each entry
via the
[per-entry world-time footer](./ui/screens/reader-composer/reader-composer.md#per-entry-world-time-footer)
(delta-logged like any metadata mutation). Edits are direct
manipulation with no cascade — one user edit writes one delta; the
[monotonicity indicator](./ui/patterns/entry-card.md#world-time-footer)
flags entries whose `worldTime` is less than the most recent
preceding main-timeline entry.

**Editing a flashback entry's `worldTime`** (away from `0`)
effectively promotes it out of flashback framing under the current
convention — the entry becomes indistinguishable from a regular
main-timeline entry at the chosen time. The future `sceneTime` exit
(see below), when it lands, restores the distinction by separating
"scene-depicted time" from "main-timeline elapsed." Until then,
treat manual `worldTime` edits on flashback entries as deliberate
promotion.

**Downstream consumers tolerate any non-negative `worldTime`.**
Happenings derivation, threads, retrieval recency, character ageing,
and scheduled-happening firing checks all read each entry's stored
`worldTime` independently and do NOT assume monotonic order. Edits
that produce out-of-order sequences cause derived values
(happening times via `occurred_at_entry_id`, thread entry refs) to
shift silently on the next read — that is the accepted consequence
of the no-cascade contract. The delta log entry on the edited
entry is the audit trail.

**v1 limitation — non-linear narrative.** Single-`worldTime` cleanly
models linear narrative plus short flashbacks (main clock just
doesn't advance during memory). It does NOT model structural non-
linear narratives (alternating timelines, time travel, parallel
chronologies). In those stories, happenings classified during an
"alternate timeline" chunk inherit the entry's `worldTime` which
reflects render-order rather than in-world order; the knowledge
graph gets fuzzy in those regions. Chapter titles and prose carry
the disambiguation.

Future exit, if demand emerges: add optional `sceneTime: number | null`
to `story_entries.metadata` — null = "same as worldTime," non-null =
"this entry depicts a scene at this historical time." Awareness and
happening logic would consult `sceneTime` when present. Since
metadata is a JSON blob, adding the field later is zero
schema-migration cost; no reason to reserve it now.

**`happenings.temporal` stays free-form.** Out-of-narrative events
("ongoing", "next solstice", "1872 AR") don't math cleanly and exist
as display annotations, not clock values. The burden of matching
temporal strings to the story's calendar rests with the user.

### Era flips

**Decided:** era flips (per [calendar-systems/spec.md → Eras](./calendar-systems/spec.md#eras-hoisted-out-manually-triggered))
live in a dedicated branch-scoped table `branch_era_flips`. Each row
is one user-triggered "Flip era" action: `at_worldtime` (in physical
seconds, taken from the entry's `metadata.worldTime` at trigger time)

- `era_name` (user-chosen or picked from
  `EraDeclaration.presetNames`).

**Why a table, not JSON on `branches`.** Era flips fork with
branches like every other narrative state. Storing them as a JSON
column on `branches` would force adding `branches` to
`deltas.target_table` (currently never delta-logged), break the
"branches is config-shaped, narrative state in dedicated tables"
pattern, and turn per-flip mutations into whole-row JSON updates
with awkward delta payloads. The dedicated table inherits the
standard composite-PK + snapshot-on-fork + per-row delta machinery;
CTRL-Z on a flip reverses one tiny `op=create` delta.

**Why not piggy-back on `happenings`.** Era flips are calendar
configuration events, not narrative events. They don't have
involvements or awareness; the conflation would muddy both domains.

**Constraints:**

- `at_worldtime ≥ 0` — no pre-story flips. Pre-story history belongs
  in `happenings.temporal`. Time is increment-only. Enforced by a
  DB `CHECK (at_worldtime ≥ 0)` (migration `0003`).
- Unique `(branch_id, at_worldtime)` — no two flips at the same
  moment on the same branch. Enforced by a DB
  `uniqueIndex(branch_id, at_worldtime)` (migration `0003`,
  non-deferrable), which doubles as the resolver's range-scan index
  (below). The user has no normal flow to construct conflicting
  writes; single-action writes are collision-free, but a future
  batched reverse-replay touching multiple flips must sequence
  per-row to avoid a transient mid-undo collision.
- A flip at `at_worldtime = 0` overrides the calendar's
  `EraDeclaration.defaultStartName`. The story-creation wizard
  (deferred — not yet drawn; lands with the wizard pass) is the
  intended surface for picking the initial era at story creation;
  if it ships an era-picker that produces a non-default choice, it
  writes a flip at 0. Until the wizard exists, new stories
  inherit `defaultStartName` and the user's first explicit flip is
  whatever they trigger from the reader chrome.

**Resolver convention.** "Active era at worldTime N" = the row with
the largest `at_worldtime ≤ N` for the current branch. Before any
flip (and the calendar isn't constrained to have one at 0), the
active era is the calendar's `EraDeclaration.defaultStartName`.
Served by the same `(branch_id, at_worldtime)` unique index
(above) for O(log n) lookup.

**Calendar swap.** Flips are preserved as-is (`at_worldtime` is in
seconds, calendar-agnostic). If the new calendar has `eras: null`,
the flips become orphaned data — display ignores them, but they're
not deleted; re-enabling era support later re-surfaces them. The
swap UX warns about this case.

### Injection modes — unified enum + structural invariant

**Decided:** `lore`, `entities`, and `threads` all carry an
`injection_mode` column with the same enum:
`always | auto | disabled`.

- `always` — include in every prompt render unconditionally.
- `auto` — let the retrieval pipeline decide via keyword + embedding
  - LLM-fallback. **Default** for new rows. See
    [docs/memory/retrieval.md → Hybrid retrieval per type](./memory/retrieval.md#hybrid-retrieval-per-type).
- `disabled` — never include automatically; only surfaces if
  explicitly referenced.

**Naming history.** `lore.injection_mode` was originally
`always | keyword | manual`; a renaming pass changed it to
`always | keyword_llm | disabled`. The current `auto` rename
collapses the keyword-vs-LLM distinction — retrieval handles both
under the hood (keyword + embedding + LLM-fallback when both miss),
so the user-facing knob doesn't need to expose the implementation
detail. Schema migration: rename enum value across `entities`,
`lore`, `threads`.

**`happenings` deliberately do not carry `injection_mode`.** The
awareness graph (`happening_awareness`) is the injection rule —
structural, not user-toggled. A happening is injected because a POV
character knows about it (per the awareness link, ranked by
`decay_resistance` and `sim_blend`), not because the user set a
mode.

**Structural invariant — active + in-scene entities always
injected.** Regardless of an entity's `injection_mode` setting,
entities with `status='active'` AND presence in the current entry's
`sceneEntities` are ALWAYS injected. The retrieval phase
short-circuits the mode check for this case. Rationale: an active
in-scene entity IS what the current narrative is about; excluding
it on a user-set `disabled` flag would produce broken prompts. The
mode setting is consulted only for entities that are NOT
structurally required — staged, retired, or active-but-off-scene.
Same invariant applies to active threads (must-inject) and to
`injection_mode='always'` rows. See
[docs/memory/retrieval.md → Candidate pools](./memory/retrieval.md#candidate-pools)
for the full structural-floor contract.

### Entry mutability & rollback

**Decided:** everything is an event in the append-only `deltas` log,
regardless of who authored the change — AI classifier, lore-management
agent, chapter close, or direct user edit.
Rollback = reverse every delta with `log_position ≥ N` (refined by the
[survival anchor](#survival-anchor) below, which spares a lagging
background fact about a surviving turn). Entity rows
(and lore / thread / happening / chapter rows) are mutated in place for
fast reads; the delta log is the history of record.

User editing an entry's text does **not** auto-trigger re-classification.
Text edits are separate from state edits; state stays put unless the user
explicitly re-classifies, which appends new deltas at the log head rather
than rewriting history. This keeps the log linear and append-only under
arbitrary editing.

**Text edits are a side-channel, not in the delta log.** Editing
`story_entries.content` mutates the row directly without producing a
delta. Consequences:

- Rollback to entry M still works — entries past M are hard-deleted
  regardless of whether their text was user-edited.
- There is no log-based "undo my text edit" — the original AI output
  isn't preserved. If the user wants editor-local undo for typo-level
  tweaks, that's the editor's responsibility (a transient in-editor
  undo stack), not rollback's.
- When branching from entry N, the new branch copies entry N's _current_
  text (edited or not). The edit propagates through the fork, which is
  the intended behaviour — text edits are user intent, not narrative
  state that needs reversing.

**Wizard creation is exempt from the delta log.** The wizard's commit
transaction writes the `stories` row, the initial `branches` row, the
initial cast (`entities` rows), the world rules (`lore` rows), and
the opening (`story_entries[1]`, kind=`opening`) — all in one atomic
SQLite transaction, **no deltas written**. They are baked in as the
story's initial state. Implications:

- Earliest possible delta in the log is the user's first turn (a
  `user_action` create on the initial branch).
- CTRL-Z in a freshly-wizard-created story is a no-op until the user
  takes a turn (no delta exists to reverse).
- Rollback can target entry 1 (leaves only the opening) but can never
  go below — there's nothing below the opening to roll back to.
- Branching from the opening copies wizard-created rows + the (empty)
  delta log up to that point — clean handoff with no special-case
  branch-copy logic needed.

Subsequent edits to wizard-created rows (text edits on the opening,
field edits on initial entities, body edits on initial lore) follow
**normal delta semantics** — only the wizard's _creation_ is exempt;
update / delete operations on those rows produce deltas as usual.
This is the second delta-scope exemption alongside the
`story_entries.content` text-edit side-channel above; together they
are the only narrative-state mutations that bypass the log.

**`log_position` assignment.** Computed at insert time inside the
same SQLite transaction as the delta row:
`COALESCE(MAX(log_position), 0) + 1 WHERE branch_id = ?`.
Single-writer-per-branch (per the pipeline gate model — see
[`generation-pipeline.md → Concurrency model`](./generation-pipeline.md#concurrency-model))
makes this race-free at the action layer. SQLite has no per-branch
autoincrement primitive (`AUTOINCREMENT` is table-global, not
partitioned), so the assignment lives in the delta-creating
mutator, not as a column default.

Invariant: monotonically increasing within branch. Gaps are fine
(rollback, fork copy, delete deltas — so gaps occur naturally; the
`>=`, `<`, `MAX` operations all tolerate them), but duplicates
within branch break chain-walk ordering. The
`UNIQUE INDEX deltas_log_position_uniq (branch_id, log_position)`
backstop on the deltas table (see Diagram) catches buggy writers
at insert time.

**Delta storage economy.** Each delta stores only **undo** information in
a single `undo_payload` column — no redundant "after" snapshot, since the
live row already holds that. For `op=create` the payload is null (undo =
delete target_id). For `op=update` it's a nested-partial diff of only the
paths that changed, with their pre-change values (see encoding rule below).
For `op=delete` it's the full row JSON (needed to re-insert). This
collapses storage by ~6-7x compared to storing full before+after
snapshots, and prevents large state fields like portraits from polluting
every unrelated update.

**`op=update` encoding rule.** The `undo_payload` mirrors the row's
column structure: top-level keys are column names, values are the
pre-change values of those columns. For nested-object JSON columns
(`entities.state`, `story_entries.metadata`), the value is itself a
nested partial populated only for changed sub-paths — recursive, so
nested objects within nested objects follow the same rule. Flat-array
JSON columns (`tags`, `keywords`) carry the full pre-change array
(arrays go whole; partial encoding inside arrays would re-introduce
absence-sentinel ambiguity at index granularity for no storage win).

**The `null`-as-sentinel rule.** A `null` value in `undo_payload` is
overloaded across three Zod node types, schema-discriminated at apply
time:

- **At a nullable scalar or nullable-object leaf** (e.g.
  `metadata.currentLocationId: string | null`,
  `state.lastSeenAt: {...} | null`) — `null` is a value to restore.
- **At a record-typed dynamic-keyed leaf** (e.g.
  `state.stackables: Record<string, number>`) — `null` means "this
  sub-key was absent pre-change; delete it on apply."
- **At an optional fixed-shape leaf** (e.g. `state.voice?: string`,
  `state.visual.distinguishing?: string[]`) — `null` means "this key
  was absent pre-change; delete it on apply."

**Nullable-object transitions** have three cases. Going from
non-null to non-null is the standard partial-diff case. Going from
`null → non-null`, the `undo_payload` value is `null` (restore the
null pre-state, ignore the new structure). Going from
`non-null → null`, the value is the **full** pre-non-null object
(there's no current shape to merge against on rollback, so the diff
is the entire pre-state).

**Hard schema invariants** the encoding's correctness depends on.
Currently met across all delta-logged tables; any future Zod schema
landing for a delta-logged column must preserve them:

- Record-typed sub-fields must have non-nullable value types
  (preserves the `null = delete-sub-key` unambiguity).
- Sub-fields must not stack `z.optional()` over `z.nullable()` (the
  stacked case would make a `null` payload value ambiguous between
  "key was absent" and "value was null").

**`encoding_version` stamp.** Every delta carries an `encoding_version`
column, stamped at `1` by every writer at v1 and ignored by every
reader at v1 (the apply function always applies v1 semantics). The
column is reserved so a future migration that needs to change
encoding rules — column rename, sub-field type change, encoding rule
revision — can dispatch per-delta without retrofitting a version
into existing rows. Cost is ~4 bytes per delta; the ~200 KB per large
story at the storage ceiling is negligible.

**Delta scope: narrative state only.** Deltas cover the core narrative
tables (`story_entries` row-level changes, `entities` narrative fields,
`lore`, `threads`, `happenings` and their links, `chapters`, `entry_assets`).
UI-only fields (`favorite`, `sort_order`, `ui_color`, etc.) bypass the log
— rollback doesn't revert them, because they aren't story content. The
write layer enforces this distinction: mutations to narrative fields
write a delta + row update in one transaction; mutations to UI fields
just update the row.

**Exception on `story_entries.content`.** The text content of an entry
is the one narrative field deliberately exempted from the delta log
(per the side-channel decision above). Row-level changes to
`story_entries` (creates when an AI reply or user action is added,
`chapter_id` assignment at chapter close, row deletes when a user
manually removes an entry) ARE logged. In-place text edits are NOT.
This is the only per-column exemption inside a delta-scoped table.

**Audit/debug reconstruction** (of "what did delta N do?") comes from
forward-replay against earliest state or comparison to the current live
row. The on-disk delta is lean at the cost of one layer of indirection
for audit tooling. Acceptable trade.

**Log compaction and payload compression** are deferred. Compaction
(collapsing old update chains into coarser snapshots) would trade
fine-grained deep-rollback for storage. Gzipping `undo_payload` is cheap
but makes raw-DB debugging painful. Revisit only if storage becomes a
real concern — current ceiling (~5MB deltas per large story) is fine.

**User-facing undo (CTRL-Z) is built on top of the delta log.** Every
delta carries an `action_id` that groups it with other deltas produced
by the same user-visible operation. Action boundaries:

- **User direct edit** — one delta, one fresh `action_id`. CTRL-Z
  reverses that single delta.
- **AI reply** — the `story_entries` create delta plus the per-turn
  piggyback deltas share one `action_id`. Undoing it is a **positional
  suffix reversal** from the turn's start, not merely its `action_id`
  group, so it also sweeps any **periodic-classifier** deltas that
  landed on top of the turn — those carry their own `action_id` and
  `source = periodic_classifier`, and are never an undo target in their
  own right (see the algorithm). The `story_entries` row is deleted as
  the reversal of its `op=create` delta.
- **Chapter close** — the chapter row insert + `story_entries.chapter_id`
  updates across the range + lore-mgmt writes (the 5 sub-jobs) all
  share one `action_id`. CTRL-Z collapses the entire batch as a
  single unit, because a user who clicks "undo" expects the whole
  "the chapter closed" event to disappear in one press.

Algorithm:

1. **Select the target group** — walk back from the head to the most
   recent _undoable unit_ (a user turn, a user edit, or a chapter close,
   auto or manual), skipping `source = periodic_classifier` deltas.
   Background classifier work is never an undo target; its `action_id`
   exists only for crash recovery, so a classifier commit sitting at the
   literal head is stepped over.
2. **Reverse by group content:**
   - **Prose turn** (the group creates a `story_entries` row) — reverse
     the positional suffix from the turn's first `log_position`
     (`≥ N`), exactly as rollback does. This carries the
     periodic-classifier deltas that piled on top of the turn down with
     it.
   - **Otherwise** (no `story_entries` create — a field edit, a
     chapter-close batch) — reverse just that `action_id` group.
     Periodic-classifier deltas above it describe unrelated turns and
     stay put.
3. Reverse the selected deltas newest-to-oldest via their `undo_payload`,
   move them onto an in-memory redo stack (not persisted), and remove
   them from the `deltas` table.

Redo re-applies from the in-memory stack. The stack clears on any new
action. Redo is runtime-only; no schema support needed. If the app
restarts, redo history is lost (acceptable — this matches editor
conventions).

This co-exists cleanly with entry-level rollback: CTRL-Z is
action-granular ("undo my last thing"), rollback is entry-granular
("take me back to entry 40"). Both use the same reverse-delta mechanism.

#### Survival anchor

The positional suffix (`log_position ≥ N`) assumes commit order matches
narrative order. The lagging periodic classifier breaks that — it commits
facts about old, surviving turns at new tail positions, so a bare suffix
sweep of a later turn would over-reverse valid facts about turns that
aren't being undone (it fires even on regenerate-the-last-reply, when a
catch-up pass landed between the reply and its regenerate).
`deltas.entry_id` is the **survival anchor** that fixes it: _reverse this
delta iff this entry is reversed_. With `B` the earliest entry the
reversal removes (the undone turn for regenerate / CTRL-Z-of-a-turn;
`M+1` for a rollback that keeps `M`) and `N` its first `log_position`,
the sweep reverses

```text
log_position ≥ N  AND  ( entry_id IS NULL OR position(entry_id) ≥ position(B) )
```

where `position()` reads `story_entries.position`. Foreground deltas
anchor to their own turn (≥ B), and `null`-anchor deltas (chapter close,
user edit) always reverse, exactly as before; only a lagging background
delta whose anchor is below `B` is spared. A background delta therefore
survives only if its anchor entry survives — no orphans or dangling
anchors by construction. The same predicate drives the
[fork reverse-apply partition](#branch-model), and is orthogonal to the
in-flight
[classifier barrier](./generation-pipeline.md#prose-reversals-and-the-classifier-barrier),
which guards the racing classifier, not committed deltas.

For this to hold, background-source (`periodic_classifier`) deltas stamp
`entry_id` with per-fact **provenance**, and translation deltas stamp
their target's content-defining-delta anchor — see
[classifier.md → Provenance attribution](./memory/classifier.md#provenance-attribution)
and [Translation](#translation).

The same `B` clamps the per-branch classifier watermark —
`processedThrough ← min(processedThrough, position(B) − 1)`, in the sweep
transaction (see
[classifier.md → Persistence](./memory/classifier.md#persistence)) — so
re-generated or rolled-back turns are re-processed. Because the predicate
already spared every surviving turn's facts, re-processing resumes at `B`
and never re-derives a spared fact: no duplicate happenings on a normal
reversal. (Redo of a classifier-processed turn does not restore
`processedThrough`, so it may re-derive that turn; the duplicate
happenings are cleaned at chapter-close dedup, inside the existing
tolerance.)

### Happenings & character knowledge

**Decided:** plot-progression-as-monolithic-table (the old `story_beats`)
is split into two layers with clean responsibilities:

- **`happenings`** — the atomic unit of "what occurred / exists as a
  knowable fact." Covers scene events during play, pre-story history,
  ongoing states, and scheduled/future happenings. Two link tables
  connect outward:
  - `happening_involvements` — which entities are the subject matter
    (character, location, item, faction; optional free-form `role` label).
  - `happening_awareness` — which characters know about it, with
    `learned_at_entry_id`, `decay_resistance` (per-character pin signal,
    set by classifier severity at extraction; tunable by user toggle
    and lore-mgmt at chapter close — see
    [docs/memory/retrieval.md → Pinning](./memory/retrieval.md#pinning--decay_resistance)),
    `retrieval_count` (delta-logged operational counter the ranker
    increments on injection; drives the high-frequency review at
    chapter-close phase 3d), and a free-form `source` descriptor
    ("overheard in tavern" / "told by Jorin" / "witnessed firsthand")
    that the LLM authors and we use verbatim in prompts. No `relation`
    enum — the source text carries that information more expressively,
    and the LLM wants to write it in natural language anyway. This
    **is** character memory — no separate memory table. "What does
    Aria know?" is just a query against awareness links where
    `character_id = Aria`. Happenings with `common_knowledge=1` skip
    awareness links entirely (no need to write N identical rows for
    "everyone knows the king is dead"). A
    `UNIQUE(branch_id, character_id, happening_id)` constraint ensures
    upsert semantics in the classifier and user-edit paths — duplicate
    awareness rows can't accumulate at the DB level.

    Old `salience REAL` field was dropped — replaced by the
    `sim_blend × recency_factor` model in the retrieval ranker, where
    `recency_factor` integrates `decay_resistance` for the ageing
    story. Old salience was content-blind; the new model is
    content-aware (`sim_blend` recomputes per turn against the current
    scene). See
    [docs/memory/retrieval.md → The ranker](./memory/retrieval.md#the-ranker).

- **`threads`** — the broader view: quest tracker, overarching arcs,
  ambient plot pressures. Freeform `category` + `icon` (string key from a
  preset catalog). Statuses: `pending | active | resolved | failed`.
  Resolved means "done successfully / achieved"; failed is distinct because
  lumping them together loses useful information.

This shape solves the character-omniscience problem (story knowledge ≠
character knowledge; awareness links are the filter) and addresses the
events-vs-beats name collision (events are happenings now; threads don't
have an enum kind anymore).

**On the two time fields on `happenings`:** `occurred_at_entry_id` and
`temporal` look overlapping but measure orthogonal axes.
`occurred_at_entry_id` references the narrative entry the happening
occurred at — present for happenings that occurred during play, used for
rollback ordering (via the entry's `position`) and scene-based retrieval.
The actual in-world time for a narrative happening is **derived** from the
referenced entry's `metadata.worldTime` (see "Entry metadata shape" and
"In-world time tracking" below). No duplication on `happenings`.
`temporal` is only populated when there is no narrative entry to
derive from (pre-story history, scheduled future, ambient backdrop) —
its free-form text is the anchor because out-of-narrative happenings
have no entry to reference. `occurred_at_entry_id`
and `temporal` are **mutually exclusive per row**, enforced both
at the SQLite level (CHECK constraint at table-create time:
`CHECK (occurred_at_entry_id IS NULL OR temporal IS NULL)`) and at
the Zod boundary on form/import. The DB constraint is the floor;
the Zod check is the friendlier validation surface. `threads` don't carry
`temporal` because threads only exist during narrative and always
resolve via entry references (same worldTime-derivation story as
happenings).

**Entry references are IDs, not positions.** `occurred_at_entry_id`,
`learned_at_entry_id`, and the two thread `*_at_entry_id` columns store a
branch-scoped `story_entries.id` (FK-less, resolved via `(branch_id, id)`
like every other entry reference — `deltas.entry_id`,
`chapters.start_entry_id`, `probe_captures.target_entry_id`), not the
`position` integer. Ordering comparisons derive `position(entry_id)` at
query time, exactly as the [survival anchor](#survival-anchor) predicate
does. Positions get reused — after a rollback the next turn reclaims the
freed `position` with a new entry id — so a stored position can silently
re-point to a different entry, whereas a stored id dangles detectably (it
resolves to no row) if its target is ever rolled away. This also aligns
the schema with the Plot screen's entry-ref pickers, which were already
designed around entry ids. **Absent refs are `NULL`, never `''`** — an
empty string would pass the `happenings` mutual-exclusivity CHECK and
break position derivation; the Zod/action layer normalizes empty to null.

**Context-bloat note:** for long-running stories, character awareness
lists grow unbounded — projected scale is thousands of happenings and
tens of thousands of awareness rows on a 30+ chapter story per
[docs/memory/retrieval.md → Scale assumptions](./memory/retrieval.md#scale-assumptions).
This is handled at injection time (per-type budgets with hard
partitions, top-200 pre-filter, MMR-diverse selection,
`sim_blend × recency_factor + kw_boost` scoring with high-similarity
bypass for revival of decayed memories) and by chapter-close lore-mgmt
(awareness pin tuning, happenings consolidation). Schema is mostly
unchanged from the bloat angle; the storage profile remains workable
at v1's projected volumes.

### Translation

**Decided:** translation of LLM-generated user-facing content (narrative,
user action text, entity names/descriptions, lore bodies, thread titles,
happening descriptions — everything the LLM produces) is stored in a
dedicated `translations` table with a polymorphic target, rather than as
per-column `translated_*` fields on each source row.

Rationale: the old app spread `translated_name`, `translated_description`,
`translated_relationship`, etc. across every world-state table — column
proliferation that also hard-coded "one target language" and lost prior
translations if the user reconfigured. Dedicated table fixes all three.

**What is a translation target.** Any user-facing in-story text — AI-
generated world-state and narrative shown to the user (source → target)
and the user's own submitted action text (target → source). The per-kind
field lists (here, and architecture's `display-translation` phase) are
illustrative, not exhaustive: any user-facing column on a target row
(e.g. `chapters.theme`, `entities.retired_reason`, `lore.category`) is a
target by this rule. NOT targets: `stories.definition`
(`genre.promptBody` / `tone.promptBody` / `setting`) — user-typed
source-language authoring input consumed by the AI, never displayed
translated — and structural / id / numeric / provenance fields.

**Shape:**

- `(branch_id, id)` composite PK (translations fork with branches like
  every other branch-scoped table)
- `target_kind` + `target_id` = polymorphic FK (same convention as
  `deltas.target_table` / `target_id`)
- `field` names the translated field on the source row. Supports nested
  paths (e.g. `state.condition` on entities) for kind-specific state JSON
- `language` is an ISO 639-1 code; multiple target languages coexist
- UNIQUE(branch_id, target_kind, target_id, field, language) prevents
  duplicate translations per (source field, language)

**Deltas participate.** `deltas.target_table` includes `translations`.
Translation writes that **succeed** produce deltas under the same
`action_id` as the originating action — so if the classifier creates
a new entity that triggers a translation write, a single CTRL-Z
reverses both the entity and its translation atomically.

**Survival anchor.** A translation delta's `entry_id` (the
[survival anchor](#survival-anchor)) is the anchor of its target's
**current content-defining delta** — the target's top-of-chain delta at
translation time. For an inline translate-on-create this coincides with
the originating action's anchor, so both reverse together (above). A
decoupled re-translation (the `translation-retry` pipeline) commits under
its own `action_id` at a tail position; the content anchor makes a
positional reversal keep the translation exactly as long as the content
it translates survives — never a stale survivor, never an over-reversed
miss.

Translation calls that **fail** (per-call exhaustion in the
`display-translation` phase, see
[`architecture.md → Graceful degradation contract`](./architecture.md#graceful-degradation-contract))
produce no delta — the source write stands without a translation row
and render falls back to source. The promise weakens to **atomic when
present**: rows that land reverse atomically with their source; rows
that didn't land never existed; nothing to reverse.

Retry-created rows from the `translation-retry` pipeline carry the
retry pipeline's own `action_id`, not the originator's. CTRL-Z of
the originating turn does not reverse retry-created translations —
they become orphan rows, harmless under keyed lookup (a lookup
against a reversed target finds nothing). Forward / redo of the
originator restores the target; the orphan becomes a live translation
again. Hard-delete of a source row cleans up via existing branch-
cascade rules and per-row action-layer cleanup writes.

**Runtime:** Zustand loads translations into an index
`Map<(kind, id, field, lang), string>` for O(1) render-time lookup. UI
renders translated text when a translation exists for the current
language + field, else falls back to the source. The
`display-translation` phase writes translation rows via Zustand
actions, same pattern as every other state mutation.

**Scope reminder:** this table handles LLM-authored content only.
Translation of the app's own UI strings (menus, buttons, settings) is a
separate concern — handled by `i18next` at the UI layer, backed by
`locales/*.json` files in the repo.

### Chapters / memory system

**Decided:** chapters are first-class, per-branch, user-visible. They
segment the narrative into named, summarized ranges and provide the
cadence trigger for the chapter-close pipeline.

This section captures the storage / atomic-commit contract; the
pipeline phases, lore-mgmt sub-jobs, and memory architecture more
broadly are designed in [`docs/memory/`](./memory/README.md).

**Open chapter has no row.** Only closed chapters are persisted as
`chapters` rows. Entries in the "open region" (after the latest
closed chapter's end) simply have `chapter_id IS NULL` until a
chapter is created that includes them.

**Boundary trigger.** Per-story token threshold
(`stories.settings.chapterTokenThreshold`, default 24k, user-
configurable). When the open region's accumulated token count crosses
the threshold AND `stories.settings.chapterAutoClose=true`, the
chapter-close pipeline fires. With `chapterAutoClose=false`, the UI
shows a "ready to close" indicator but doesn't auto-fire. User can
also manually trigger chapter-create at any time, picking the ending
entry explicitly.

**Chapter-close is the single cadence trigger** for the 5-phase
pipeline (catch-up classifier, boundary selection, chapter metadata,
lore management with five sub-jobs, lifecycle review). All five
phases share one `action_id` so a single CTRL-Z reverses the entire
chapter-close. See
[docs/memory/chapter-close.md](./memory/chapter-close.md) for the
full pipeline design.

**Chapter summaries become a retrieval candidate pool.** Closed
`chapters` rows feed the chapter-summaries retrieval pool — each
chapter's `summary` (plus `theme` and `keywords`) is embeddable and
ranks against the per-turn query stack. Matched chapters also boost
happenings within their range (chapter-match boost). See
[docs/memory/retrieval.md → Candidate pools](./memory/retrieval.md#candidate-pools).

**Per-branch, forks cleanly.** Each branch has its own `chapters`
rows with its own IDs. On branch creation, chapter rows (and all
other state) are copied to the new branch up to the fork point.
Edits to a chapter's title or summary on one branch don't leak to
siblings. If the fork point is inside what would have been a closed
chapter on the parent, the new branch simply never sees that
chapter's closure events — those deltas happened after the fork
point and aren't copied.

**No chapter-boundary restrictions on rollback or branching** — see
Branch model above. Chapters are user-visible structure, not
gatekeepers.

### Backup & export format

**Decided:** two separate, single-purpose operations. No zip bundling.

1. **Full backup** — produces a `.sqlite` snapshot via `VACUUM INTO`,
   plus a failsafe JSON dump of each story bundled alongside (same file
   or adjacent — packaging shape parked, see
   [`parked.md → Backup / export packaging shape`](./parked.md#backup--export-packaging-shape)).
   Intended for full-app restore. Also copies the assets directory
   since media lives on disk, not in SQLite.

2. **Per-story export** — produces a single self-contained `.avts`
   file for one story, wrapped in the standard
   [Aventuras file envelope](#aventuras-file-format-avts) for
   version-tagged imports. Binary assets are embedded as base64 or
   sidecar files (packaging shape parked, see
   [`parked.md → Backup / export packaging shape`](./parked.md#backup--export-packaging-shape)).
   Intended for sharing / archiving / migration. What it carries is
   settled table by table below.

The two have genuinely different purposes and the old app's conflation
into a single zip produced friction — users invoking "backup" got a
story export they didn't want, and vice versa. Split avoids that.

**What a per-story export carries — the rule.** The strip / travel
split is not ad hoc. It falls out of one invariant: **every
delta-logged table must travel.** `deltas.target_table` enumerates
twelve tables; stripping any of them while keeping the delta log
corrupts reverse-replay (CTRL-Z, rollback, crash-recovery). So the
strip set can only be drawn from **non-delta-logged** tables, and
within those only the **derived** ones — reproducible caches and
diagnostics, never story content. `embeddings` and `probe_captures`
are exactly the non-delta-logged derived tables; both carry explicit
"not delta-logged" schema comments. Stripping them is safe;
stripping anything else is not.

**The table-by-table manifest.** Every table in the schema has a row
below. A schema addition is **incomplete until its export
disposition is added here** — the forcing function that keeps the
manifest exhaustive.

| Table                     | Disposition               | Rationale                                                                                                                                                                   |
| ------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stories`                 | Travels — fields stripped | The story row. `settings.models`, `settings.embedding_provider_id`, `settings.embedding_model_id` omitted (see below). All other `settings` and all of `definition` travel. |
| `branches`                | Travels                   | All branches. Branch container — not delta-logged, but story content.                                                                                                       |
| `story_entries`           | Travels                   | All entries, all branches; `metadata` JSON included.                                                                                                                        |
| `entities`                | Travels                   | `embedding_stale` travels as-is; the post-import re-index reconciles it.                                                                                                    |
| `lore`                    | Travels                   | Delta-logged story content.                                                                                                                                                 |
| `threads`                 | Travels                   | Delta-logged story content.                                                                                                                                                 |
| `happenings`              | Travels                   | Delta-logged story content.                                                                                                                                                 |
| `happening_involvements`  | Travels                   | Delta-logged link table.                                                                                                                                                    |
| `happening_awareness`     | Travels                   | Delta-logged link table; `retrieval_count` travels.                                                                                                                         |
| `character_relationships` | Travels                   | Delta-logged story content.                                                                                                                                                 |
| `chapters`                | Travels                   | Delta-logged story content.                                                                                                                                                 |
| `branch_era_flips`        | Travels                   | Delta-logged narrative state.                                                                                                                                               |
| `translations`            | Travels                   | Paid LLM output; carries no provider or model coupling (see below).                                                                                                         |
| `entry_assets`            | Travels                   | Delta-logged link table.                                                                                                                                                    |
| `deltas`                  | Travels                   | The delta log itself; every other table's integrity depends on it.                                                                                                          |
| `assets`                  | Dependency — carried      | Referenced rows only, collected via `entry_assets` and `stories.cover_asset_id`. Binary embedded.                                                                           |
| `vault_calendars`         | Dependency — carried      | The one referenced custom-calendar row, embedded (see below). Built-ins resolve by id and carry nothing.                                                                    |
| `embeddings` (`vec0`)     | Stripped                  | Reproducible from source content; model-space-bound. Not delta-logged.                                                                                                      |
| `probe_captures`          | Stripped                  | Diagnostic, not story state; not delta-logged; FIFO-evicted; deep-mode vectors model-bound. Branch-forking already drops them.                                              |
| `app_settings`            | Does not travel           | Global singleton; sources the strip list, never itself exported.                                                                                                            |

**Story-internal IDs import verbatim; dependency references
resolve.** Story-scoped IDs — `branch_id`, delta `target_id`, the
id-references buried in `entities.state` JSON — import unchanged,
because the whole story scope imports together. The two
**dependency** rows behave differently: `entry_assets.asset_id`
resolves to the importer's existing asset on a content-hash match,
and a custom `calendarSystemId` may be rewritten on calendar fork
(see below). Dependency-table references resolve against the
importer's rows; story-internal references do not.

**Stripped `app_settings` references.** Three `stories.settings`
fields plus the `vec0` vectors are meaningless on another setup and
are omitted from the envelope: `stories.settings.models[agentId]`
(per-agent model overrides), `stories.settings.embedding_provider_id`
(app*settings provider reference), `stories.settings.embedding_model_id`
(embedding model choice), and `vec0` vectors (reproducible cache,
not source data). On import the stripped slots take the importer's
local defaults (`models = {}`, `embedding*\*`copied from`app_settings`, same path as new-story creation). The re-index
pipeline runs post-insert using the importer's embedder — same
compute as a deliberate
[Model swap UX](./memory/retrieval.md#model-swap-ux) pass; until it
completes, imported embeddable rows have no `vec0`vectors and
retrieval treats them as stale. The import dialog surfaces the
re-index cost up front ("Importing 'Story title'. Will index memory
using your current embedder (~N entries, ~M seconds)."). Imported
stories therefore never carry foreign`app_settings` references in
the first place; the provider / profile deletion-semantics design
has zero interaction with the per-story import flow.

**The calendar dependency.** A story's
[`definition.calendarSystemId`](#story-settings-shape) resolves
against the merged calendar registry — built-ins (in code, present
on every install) or `vault_calendars` rows (local to the
exporter). A built-in id resolves directly on the importer and
carries nothing; this assumes the importer's set of built-in
calendars covers the exporter's, so adding a built-in calendar is
treated as a format-version change, not a silent addition. A
**custom** calendar does not exist on the importer, so the export
embeds it: when `calendarSystemId` resolves to a `vault_calendars`
row, a `calendar` sub-object — `{ id, name, definition }`, the same
shape as the standalone `aventuras-calendar` payload — rides inside
the `aventuras-story` envelope. On import, for that embedded
calendar:

1. **No `vault_calendars` row with that `id`** — insert the embedded
   calendar as a new row (`favorite = 0`). The story points at it.
2. **Row exists and its `definition` structurally equals the
   embedded `definition`** — dedup. The story points at the existing
   row; the embedded copy is discarded. `name` and `favorite`
   differences are ignored — they are per-user library preferences,
   and worldtime display depends only on `definition`.
3. **Row exists but its `definition` differs** — fork. A matching
   `id` does not prove a matching calendar (both sides may have
   edited a shared clone). Allocate a fresh `cal_` id, insert the
   embedded calendar under it, and rewrite the story's
   `calendarSystemId` to the new id. The importer's existing same-id
   row is left untouched — a story import never mutates the
   importer's library.

Fork rather than reuse on divergence because
`definition.worldTimeOrigin` is a `TierTuple` keyed to the
exporter's calendar's tier shape, and `branch_era_flips` were
authored against it; the embedded calendar is the one the story was
authored under, so pointing at it keeps those consistent. Only
`calendarSystemId` is rewritten.

A newly inserted calendar (cases 1 and 3) gets ` (story import)`
appended to its `name` — a one-time, user-editable default label
for Vault transparency, appended only when the name does not already
end with the suffix so the re-export chain cannot accumulate it. The
import dialog notes when a custom calendar is added, worded as a
divergence notice in the fork case. Export can always resolve a
story's `calendarSystemId`: a custom calendar in use by a story
cannot be deleted —
[`calendars.md → Delete safety`](./ui/screens/vault/calendars/calendars.md#delete-safety)
blocks deletion while `usage_count > 0`. When packs ship (post-v1),
`stories.settings.activePackId` and `packVariables` will reference
global pack content and inherit this same dependency-carry pattern;
they are null at v1, so nothing is carried for them yet.

**Translation rows travel in full.** The branch-scoped
[`translations`](#translation) table is exported with the story —
every row, all branches, no language filtering. Translation rows are
paid LLM output, not a reproducible cache: unlike `vec0` vectors
they carry no provider or model reference, so nothing setup-specific
needs stripping. They are also delta-logged (`deltas.target_table`
includes `translations`), so stripping them while keeping the delta
log would corrupt reverse-replay. `stories.settings.translation`
(`enabled`, `targetLanguage`, `granularToggles`) likewise travels
untouched. An imported story is therefore self-consistent — rows and
settings agree, it renders bilingually as authored, and the
outstanding-miss count is zero. New translations on the importer's
side use the importer's default translation agent; pre-existing rows
are backend-agnostic plain text and need no reconciliation.

### Aventuras file format (`.avts`)

**Decided:** `.avts` is the canonical extension for all
Aventuras-flavored import/export content. Every supported content
type — stories, calendars, future packs / scenarios / templates —
serializes as a JSON envelope with a stable header. Same extension
across all kinds; the `format` field inside identifies what the file
contains.

**Envelope shape:**

```json
{
  "format": "aventuras-<kind>",
  "formatVersion": "<major>.<minor>",
  "exportedAt": "<ISO 8601 timestamp>",
  "<kind>": {
    /* the content payload */
  }
}
```

The content key matches the kind (`story` for `aventuras-story`,
`calendar` for `aventuras-calendar`, etc.) — readable both
machine-side and to a human inspecting the JSON.

**Kinds shipped in v1:**

| `format`              | Content                                                                                                                                             | Defined by                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `aventuras-story`     | Single story (branches, entries, world…)                                                                                                            | [Per-story export](#backup--export-format)             |
| `aventuras-calendar`  | Single CalendarSystem definition                                                                                                                    | [calendar-systems/spec.md](./calendar-systems/spec.md) |
| `aventuras-entity`    | Single entity (character / location / item / faction). Payload carries a `kind` discriminator; schema is a discriminated union over the four kinds. | [Diagram → entities](#diagram)                         |
| `aventuras-lore`      | Single lore entry. Separate format from `aventuras-entity` because lore is a distinct kind in the data model.                                       | [Diagram → lore](#diagram)                             |
| `aventuras-thread`    | Single thread (plot strand).                                                                                                                        | [Diagram → threads](#diagram)                          |
| `aventuras-happening` | Single happening (timestamped plot event).                                                                                                          | [Happenings](#happenings--character-knowledge)         |

Per-row formats (`aventuras-entity` / `-lore` / `-thread` /
`-happening`) drive World/Plot per-row import via
[`ImportDialog`](./ui/patterns/import-dialog.md). `aventuras-entity`
consumers in particular must pass a kind-narrowed zod schema to the
dialog so a wrong-kind JSON in a per-kind slot surfaces as a
payload-error rather than emitting a wrong-kind payload — see the
[ImportDialog per-host integration](./ui/patterns/import-dialog.md#world-per-row-entity-import)
for the pattern.

Future kinds (`aventuras-pack`, `aventuras-scenario`, etc.) follow
the same envelope as those features ship.

The `aventuras-story` payload also carries an optional `calendar`
sub-object when the story runs on a user-authored calendar — an
additive, minor-version field; see
[Backup & export format](#backup--export-format).

**Version handling.** `formatVersion` is the load-bearing
compatibility signal. Major bumps signal a hard break; minor bumps
are additive. Importers compare against currently supported versions
and fail clearly:

- File's major < importer-supported → "This file is from an older
  version of Aventuras."
- File's major > importer-supported → "This file is from a newer
  version. Update Aventuras to import."
- Minor mismatches accepted as long as major matches; minor-newer
  fields validated against the schema and ignored if zod doesn't
  recognize them (forward-compatible by zod's default).

**Two import surfaces:**

1. **Per-UI gated** (default in v1). Each surface accepts only its
   matching kind — the Vault calendar editor's `From JSON file…`
   rejects anything that isn't `aventuras-calendar`; story-list's
   `+ Import story` rejects anything that isn't `aventuras-story`.
   Contextual safety: you can't accidentally import a calendar into
   a story slot.
2. **Universal import** (deferred — see
   [parked.md](./parked.md#universal-import-surface)). One
   dispatcher accepts any `.avts`, reads the `format` field, and
   routes to the matching creation flow. Useful for "I have this
   file, just import it." Not blocking v1; per-UI gated covers the
   common cases.

**Legacy `.avt` import** (from the old app) is a separate migration
path with its own format handling, tracked in
[`parked.md`](./parked.md#legacy-avt-migration-import). Not
part of this convention.

**Extension policy.** `.avts` is canonical; UI file pickers
default-filter to it. `.json` is also accepted as input (same
envelope content, different extension) for users who hand-author or
import files from non-Aventuras sources. Output writes always
produce `.avts`.

### Assets (images & future media)

**Decided:** binary assets live **externally on disk**, not as SQLite BLOBs. The DB holds only
metadata (`file_path`, `mime_type`, `size_bytes`, `content_hash`).
Change from the old app, which embedded image data as data-URLs in the
DB — that bloated SQLite files and slowed VACUUM.

**Shared across branches via reference.** The `entry_assets` link table
binds an entry to one or more asset rows. On branch creation, `entry_assets`
rows are copied (tiny), but `assets` rows are NOT — both branches point
at the same asset IDs. This is what keeps the hard-fork branching model
operationally cheap despite image-heavy stories.

**Assets are story/branch-agnostic.** Content-hash keying means identical
content naturally dedups. No benefit to scoping tighter.

**Cleanup on delete — trash-can pattern.** When an `entry_assets`
row is removed (rollback, branch deletion, entry deletion) and the
referenced asset's inbound-reference count drops to 0, the same
action sets `assets.pending_delete_at = now()` and atomically
renames the file from `<appdata>/assets/<asset_id>` to
`<appdata>/.trash/<asset_id>`. The `assets` row stays in place so
rollback can resurrect cleanly. From the user's perspective the
asset is gone immediately (no inbound references means no surface
ever finds it); the deferred unlink is a rollback-safety
implementation detail.

**Rollback restoration.** When a delta-replay reinserts an
`entry_assets` row, the action layer checks the target asset's
flag; if `pending_delete_at IS NOT NULL` and refcount > 0
post-insert, it clears the flag and renames the file back from
trash to live. Files already swept (past retention window) are
gone — rollback degrades to "row restored, bytes missing,"
surfaced to the user as a non-fatal warning.

**Trash sweep.** Boot-time pass:
`SELECT id FROM assets WHERE pending_delete_at IS NOT NULL AND pending_delete_at < (now - retentionSeconds)`;
for each, unlink the trash file and
`DELETE FROM assets WHERE id = ?`. Retention window TBD (lean
toward generous — 24+ hours, or tied to CTRL-Z chain depth bound).

**Orphan GC — separate boot pass.** Enumerate `<appdata>/assets/`
(the live dir, not trash); for each file with no row in `assets`,
unlink. Catches crash-between-disk-write-and-DB-commit and
re-upload-over-existing failure modes.

**Caller discipline.** No SQL filter on `pending_delete_at` is
needed in any v1 query path — trashed assets have no inbound
`entry_assets` rows by definition (that's what triggered the
trash), so existing joins through `entry_assets` already exclude
them. The flag is for the sweeper and rollback paths only.
