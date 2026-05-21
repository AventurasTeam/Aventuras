# Translation rows in per-story export / import

Status: draft exploration. Resolves the
[`followups.md`](../followups.md) UX item "Translation rows in
per-story export / import". Canonical text lands in
[`data-model.md → Backup & export format`](../data-model.md#backup--export-format);
this record keeps the rationale.

## The question

Per-story export strips references to the exporter's `app_settings`
(`stories.settings.models`, `embedding_provider_id`,
`embedding_model_id`) and the reproducible `vec0` vectors. Cached
[`translations`](../data-model.md#translation) rows were never
addressed: do they travel inside an `.avts` per-story export, and how
do they reconcile with the importer's translation backend and
language settings?

## Decision

Translation rows travel in full — every row, all branches, no
stripping, no language filtering — exactly as the export already
ships `deltas`, `entities`, and the rest of the branch-scoped story
content. `settings.translation` (`enabled`, `targetLanguage`,
`granularToggles`) also travels untouched; it was never in the strip
list and stays out of it.

The reconciliation question dissolves rather than getting answered:
there is nothing backend-specific to reconcile.

## Why rows are content, not cache

The followup grouped translation rows with the stripped items. They
sit on the opposite side of the strip line:

- **`vec0` is stripped** because embeddings are both deterministically
  reproducible from source content and model-space-bound — a vector
  from one embedding model is meaningless to another.
- **Translation rows are neither.** They are non-deterministic paid
  LLM output, and the
  [`translations` schema](../data-model.md#translation) carries no
  provider or model column (`id`, `branch_id`, `target_kind`,
  `target_id`, `field`, `language`, `translated_text`, timestamps).
  Nothing ties a row to the exporter's setup.

Two further forces make travel mandatory rather than merely nice:

- **Delta-log integrity.** `deltas.target_table` includes
  `translations`, and the delta log travels with the export.
  Stripping the rows while keeping their deltas would corrupt
  reverse-replay — CTRL-Z, rollback, and the crash-recovery startup
  pass would hit `update` / `delete` deltas pointing at rows that
  were never imported.
- **Re-translation cost.** The outstanding-miss machinery is a SQL
  join of translatable source content against the `translations`
  table. Strip the rows and every translatable field flags as a
  miss, so the importer pays to re-translate the whole story.
  Travel means the importer inherits paid work for free, and the
  per-field-per-language translation-memory lookup lights the rows
  up with zero calls.

## Settings and reconciliation

Because `settings.translation` travels intact, an imported story is
self-consistent: rows and settings agree, it renders bilingually as
the author saw it, and the outstanding-miss count is 0.

- **Backend.** Nothing to reconcile. Translation rows are
  backend-agnostic plain text. New translations the importer makes
  use the importer's default translation agent — `settings.models`
  is stripped, so the `translation` slot resolves through the
  importer's `assignments` like any other new story.
- **Language mismatch.** If the importer later changes
  `targetLanguage`, imported rows in the old language go inert by
  key — harmless, identical to the orphan-by-key behavior already
  documented for retry-created and CTRL-Z'd rows in
  [`data-model.md → Translation`](../data-model.md#translation). The
  new language fills through the outstanding-miss retry path.
- **Safety.** The
  [display-only invariant](../architecture.md#display-only-invariant--translations-never-feed-back-into-prompts)
  means imported rows can never reach the LLM. A stale or mismatched
  row degrades a display string at worst; generation is untouched.

The full backup carries translations trivially — `VACUUM INTO`
copies the whole database — and the failsafe per-story JSON dump
inherits the per-story-export content shape, so translations are in
that dump too.

## Adversarial pass

- **Load-bearing assumption** — translation rows carry no provider /
  model coupling. Verified against the schema, not assumed.
- **ID handling** — per-story import is ID-preserving: prefix-tagged
  UUIDs are kept verbatim and there is
  [no FK rewriting](../data-model.md#placeholder-substitution-llm-facing-handles).
  Translation rows' `id` / `branch_id` / `target_id` import verbatim,
  identically to `deltas`. The decision adds no new ID-rewriting
  obligation.
- **Snapshot consistency** — the "rows must travel with deltas"
  argument depends on the export being a single consistent snapshot.
  Verified: backup / export is gated against in-flight transactions,
  so rows and deltas come from the same transactional state.
- **Edge cases** — all benign. Empty or translation-disabled story:
  empty set, no-op import. Partial translations at export time: the
  importer sees the outstanding-miss pill and retries — the designed
  behavior. Orphan retry-created rows: travel as-is, inert by key on
  import exactly as on the exporter. Re-import UUID collision: a
  whole-story concern the schema already accepts as astronomically
  improbable, not translation-specific.
- **Inbound-anchor cascade** — found during integration, not in the
  first pass: removing the resolved `followups.md` entry breaks two
  anchored links into it
  ([`ui/patterns/entity.md`](../ui/patterns/entity.md) and the
  2026-05-20 search-scope exploration). Both cite the entry as a
  deferral marker for translation-aware search, not for export /
  import itself — that work was parasitically tracked on this
  followup. Handled in integration below.

Nothing found that breaks the decision.

## Integration

- [`data-model.md → Backup & export format`](../data-model.md#backup--export-format):
  add `translations` to the per-story-export inclusion and a short
  paragraph carrying the rationale above (content not cache,
  delta-log integrity, settings travel intact). No `architecture.md`
  change — export format is data-model's surface.
- [`followups.md`](../followups.md): remove the resolved UX entry;
  add the export-format-scope entry below.
- [`parked.md`](../parked.md): translation-aware search — until now
  tracked only by reference from the removed followup — gets its own
  "Parked until signal → UX" entry.
- [`patterns/entity.md`](../ui/patterns/entity.md) and the
  [search-scope exploration](./2026-05-20-search-scope-state-fields.md):
  retarget the translation-aware-search reference from the removed
  followup to the new `parked.md` entry.

## Followup surfaced

The per-story export spec lists what it includes and what it strips,
but neither list is exhaustive — `probe_captures` (diagnostic data
that branch-forking already drops) is never mentioned, and the
inclusion enumeration omits tables like `character_relationships` and
`branch_era_flips`. Rather than patch table by table, the export
format's scope wants a short dedicated session that settles, table
by table, what an `.avts` per-story export should carry. Added to
[`followups.md`](../followups.md) under UX.
