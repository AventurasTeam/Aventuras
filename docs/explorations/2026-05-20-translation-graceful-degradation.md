# 2026-05-20 — Translation graceful degradation

Resolves the [`Translation graceful degradation`](../followups.md)
followup by pinning the failure policy for translation work,
splitting the translation phase into pre- and post-narrative
positions, and adding an explicit `translation-retry` pipeline kind
for user-driven fills. Surfaces missed translations through a
toast at completion plus a sticky pill in the existing
[`generation-status-pill`](../ui/patterns/generation-status-pill.md)
machine.

## Outcome

Translation work splits across **two declared phases** in the per-turn
pipeline:

- `user-action-translation` runs **pre-narrative**, translates the
  user's submitted action `target → source` so the LLM-facing log
  stays monolingual. **Fatal on failure** — the turn aborts via the
  existing transaction semantics; user retries the turn.
- `display-translation` runs **post-narrative** (in the existing
  translation slot relative to classifier-piggyback work). Translates
  every other source field `source → target` for display. **Degrades
  per-call** — each translation succeeds or fails independently;
  the phase always returns `completed`; missing rows fall back to
  source at render.

Translation failures surface via a one-shot **toast** at run
completion ("Translation: N rows missing — Retry") plus a sticky
**status pill** error state (`error: translation-misses`,
priority below `error: memory-error`). Both invoke a new
`translation-retry` pipeline kind that re-runs the
`display-translation` phase against the outstanding-miss set. The
retry pipeline uses `hard-gate` and the same `blockedBy` shape as
`per-turn` — full parity with main pipelines on user-edit gating
and concurrency.

Outstanding misses are tracked as a Zustand-derived set computed
on story-open from a SQL join of translatable source content
against the `translations` table for the current branch and
target language; maintained incrementally via subscription to
`delta_emitted` events. No schema delta.

The previously-implicit "atomic with originator" promise on
translation rows weakens to **atomic when present**: rows that
land share `action_id` with their source write; rows that fail to
land never existed; retry-created rows have their own `action_id`
and are orphan-on-undo (harmless under keyed lookup).

## Locked answers (clarifying)

| Question                                                     | Answer                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Does graceful degradation apply to user-action translation?  | No — critical-path, pre-narrative, fatal on failure. Monolingual-log invariant preserved.                                                   |
| What's the unit of partial success in `display-translation`? | Per-call. Each `(target_kind, target_id, field, language)` tuple succeeds or fails independently.                                           |
| When does the app try again for missing rows?                | Explicit user action via toast Retry or pill tap. No auto-retry; no render-time lazy retry.                                                 |
| Where does "this turn ended with misses" surface?            | Toast at run completion (ephemeral) plus sticky status pill (persistent until cleared by successful retry).                                 |
| How does canonical prose refer to the two phases?            | By their specific names — `user-action-translation` and `display-translation`. "The translation phase" retired as ambiguous shorthand.      |
| Does retry block user edits while running?                   | Yes — `gateBehavior: 'hard-gate'`, same as `per-turn` and `chapter-close`. User can cancel via the pill's existing click-to-cancel popover. |

## Phase split

The current canonical text in
[`architecture.md → Translation as a pipeline concern`](../architecture.md#translation-as-a-pipeline-concern)
describes one translation phase running post-narrative, with
user-action target → source noted as an exception ("Same
`translations` table, same phase, different direction"). The
exception is incoherent under the locked critical-path semantics:
user-action translation must complete **before** narrative
generation (the LLM must see source-language input), and it can't
share an identity with a phase that returns `completed` on
per-call failure. Two phases resolve both points.

### `user-action-translation` (pre-narrative)

Position: **first phase** in the per-turn pipeline, before retrieval.

Direction: `target → source`. Input is the raw user-action text in
the story's target language; output is the source-language version
that gets written to `story_entries.content` via the action layer.
Same `action_id` as the originating user-submit binds the source
row and the translation row together (CTRL-Z reverses both).

Same-language short-circuit: if
`settings.translation.targetLanguage === settings.translation.sourceLanguage`,
the phase skips the LLM call entirely. No translation row needed;
the typed text goes directly to `content` and render falls back to
source.

Failure semantics: `callWithRetry` exhaustion → phase returns
`{ status: 'failed' }` → existing transaction-abort path reverses
any partial writes → run emits `outcome: 'failed'`. User sees the
standard pipeline-failed error UI. Composer keeps the typed text;
user can retry the submission.

### `display-translation` (post-narrative)

Position: the existing post-narrative translation slot — runs after
the narrative phase finishes, alongside classifier-piggyback
parsing per the existing
[`architecture.md`](../architecture.md#translation-as-a-pipeline-concern)
positioning. Exact parallel-group vs sequential placement falls
out of the broader per-turn-pipeline phase-list design (currently
underspecified in canonical text); both placements are compatible
with this contract.

Direction: `source → target`. Translates the narrative content
plus every entity / lore / thread / happening / suggestion-chip
field changed or created this turn. Same `translations` table, same
call code as `user-action-translation` — different direction,
different position, different failure semantics.

Failure semantics: per-call independent (see next section).

### Phase reuse across pipeline kinds

`display-translation` is reused unchanged by three pipeline kinds:

| Pipeline kind       | Work derivation                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `per-turn`          | From `narrativeResult`, `classificationResult`, and other intermediates of the same run (entities created or updated, lore changes, thread / happening changes, suggestion chips). |
| `chapter-close`     | From the chapter title and summary just generated.                                                                                                                                 |
| `translation-retry` | From `intermediates.intendedTranslations` populated by the orchestrator at run-start from the outstanding-miss selector.                                                           |

Each context type populates `intendedTranslations` differently at
phase entry; the phase body iterates that single shape. No
behavioral divergence in the phase itself.

## Per-call degradation contract

The `display-translation` phase enumerates the
`(target_kind, target_id, field, target_language)` tuples that
need translating, then iterates:

1. Look up the existing translation row; skip if present (already
   translated in a prior run).
2. Call the translation provider via the existing
   [`callWithRetry`](../generation-pipeline.md#two-retry-tiers-both-at-phase-level)
   helper.
3. **On success**: dispatch the action-layer write. Translation row
   plus delta land under the originator's `action_id`.
4. **On `callWithRetry` exhaustion** (provider down, parse-irrecoverable,
   etc.): catch, append to `translationResult.failures`,
   continue the loop.

Phase return is always `{ status: 'completed' }`. The phase emits a
single rollup `display_translation_partial_completion`
event at completion when failures occurred — not one
`recoverable_error` per call (per-call form has no diagnostic value
the `failures` array doesn't already carry).

### Result shape

```ts
type TranslationResult = {
  written: ReadonlyArray<TranslationTuple>
  failures: ReadonlyArray<TranslationFailure>
}

type TranslationFailure = {
  targetKind: string
  targetId: string
  field: string
  language: string
  errorKind:
    | 'provider-auth'
    | 'provider-network'
    | 'provider-timeout'
    | 'provider-unknown'
    | 'phase-logic'
  errorDetail?: string
  attemptedAt: number
}

type TranslationTuple = {
  targetKind: string
  targetId: string
  field: string
  language: string
}
```

### Atomicity contract change

Today's
[`data-model.md → Translation → Deltas participate`](../data-model.md#translation)
reads: _"Translation writes produce deltas under the same action_id
as the originating action — so if the classifier creates a new
entity that triggers a translation write, a single CTRL-Z reverses
both the entity and its translation."_

Rewrites to: _"Translation writes that **succeed** produce deltas
under the same `action_id` as the originating action — a single
CTRL-Z atomically reverses any translation rows that landed
alongside their source. Translation calls that fail produce no
delta; the source write stands without a translation row, and
render-time falls back to source. Retry-created translation rows
carry the retry pipeline's own `action_id`, not the originator's
— CTRL-Z of the originating turn does not reverse retry-created
translations (they become orphan rows, harmless because keyed
lookup on the deleted target returns nothing)."_

### Orphan-row visibility

Translation rows are read only via
`(target_kind, target_id, field, language)` lookup. If the target
row was reversed, lookup returns nothing; the orphan never
affects rendering. Forward (redo) of the originator restores the
target — the orphan becomes a live translation again, "magically"
present. This is intentional, not a bug.

Hard-delete of a source row (branch delete, chapter rewrite) is
covered by existing cascade rules: `translations.branch_id` FK
cascades on branch delete; per-row source deletion at the action
layer dispatches a cleanup write to matching translation rows
under the same `action_id`. No new cascade machinery required.

## Retry pipeline

### Declaration

```ts
const translationRetryPipeline: Pipeline = {
  kind: 'translation-retry',
  gateBehavior: 'hard-gate',
  concurrencyPolicy: {
    blockedBy: ['per-turn', 'chapter-close', 'translation-retry'],
  },
  // phases: [displayTranslationPhase]
}
```

**`hard-gate`** matches `per-turn` and `chapter-close`: user-source
writes (entity edits, action submission, lore edits, etc.) are
blocked at the action-layer gate-check for the duration of the
retry. The race between retry's enumeration snapshot and concurrent
source-row mutations collapses — there are no concurrent source
mutations.

**`blockedBy`** prevents retry from racing with the other
translation-row writers. Self-blocked so a pill double-tap can't
stack a duplicate retry on top of the running one. The classifier
pipeline isn't in `blockedBy` because it doesn't write
translation rows.

No `yieldsTo` declared — the framework's `yieldsTo` is not yet
used in V1 per
[`generation-pipeline.md → V1 declarations`](../generation-pipeline.md#v1-declarations);
no need to be the first user. `hard-gate` plus blockedBy
covers the race surface.

### Inputs

```ts
type TranslationRetryContext = BaseContext & {
  inputs: { branchId: string; targetLanguage: string }
  intermediates: {
    intendedTranslations: ReadonlyArray<TranslationTuple>
    translationResult?: TranslationResult
  }
}
```

The orchestrator computes `intendedTranslations` at run-start by
calling the shared
[outstanding-miss selector](#outstanding-miss-tracking) for the
current branch + target language and writes the array onto
intermediates before the phase starts. The phase iterates that
list directly — no derivation from other intermediates.

### Action-id ownership

Each `translation-retry` run has its own `action_id`. Translation
rows it writes carry that `action_id`, not the originating turn's.
Consequences:

- CTRL-Z on the originator's turn reverses only what shared its
  `action_id` at the time. Retry-written rows for that turn's
  entities stay; the orphan-row visibility rule above applies.
- CTRL-Z on a retry run reverses the translation writes that
  landed during that retry. Restores the prior "missing" state;
  pill count goes back up.
- Same `action_id` semantics as every other pipeline run — no
  special-case undo machinery for retries.

### Cancellation during retry

The pill enters `active` state for the retry's duration. The
existing
[`generation-status-pill` click-to-cancel](../ui/patterns/generation-status-pill.md)
popover applies. Tapping pill while retry runs → cancel-current-pipeline
→ abort signal → reverse-replay → user UI unblocks. Pill returns
to `error: translation-misses` with whatever count remains. Same
affordance the user already has during `per-turn`.

### Wizard policy (not a pipeline)

The wizard isn't a pipeline run
([`generation-pipeline.md`:1151](../generation-pipeline.md)); it
commits in a single SQLite transaction outside the orchestrator,
so the per-call degradation contract doesn't apply. **Wizard rule:
opening-generation and its translation both succeed or the entire
wizard rolls back.** Story isn't created on partial success. Same
atomicity discipline as `user-action-translation`, just at a
different transactional boundary. If the translation provider is
down at wizard time, story creation fails and the user restarts
the wizard. No graceful degradation for wizard translation. This
goes into the wizard's canonical documentation as a one-liner, not
a deferred design item.

## Outstanding-miss tracking

### Selector

```ts
selectOutstandingTranslations(
  state: AppState,
  branchId: string,
  targetLanguage: string,
): ReadonlyArray<TranslationTuple>
```

Returns the full tuple array. Consumers take `.length` for pill
count or pass the whole array as `intendedTranslations` to a retry
run. Same selector serves both surfaces; no derived count exists
separately from the array.

Short-circuits to `[]` when
`settings.translation.targetLanguage === settings.translation.sourceLanguage`
— feature is dormant for same-language stories.

### Translatable source enumeration

A single constant maps target kinds to their translatable fields:

| `target_kind`      | Translatable fields                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `story_entries`    | `content` (both AI-narrative and user-action)                                                                          |
| `entities`         | `name`, `description`, kind-specific state fields per [`entity → Search scope`](../ui/patterns/entity.md#search-scope) |
| `lore`             | `title`, `body`                                                                                                        |
| `threads`          | `title`, `description`                                                                                                 |
| `happenings`       | `title`, `description`                                                                                                 |
| `chapters`         | `title`, `summary`                                                                                                     |
| `suggestion_chips` | `text`                                                                                                                 |

This map is the single source of truth used by both the selector
and the phase work-derivation code — no drift between "what we
translate" and "what we count as missing."

### Compute strategy

Hybrid: **load-time bootstrap** plus **delta-driven incremental
updates**.

**Bootstrap** on story-open and on
`settings.translation.targetLanguage` change. One SQL pass —
UNION ALL across translatable kinds with `NOT EXISTS` against
`translations` filtered by branch and language — populates a
Zustand `Set<TranslationKey>` keyed
`"${kind}:${id}:${field}:${language}"`. Bounded by the size of the
branch's source content; sub-100ms expected on v1 story sizes.
Runs in `whenIdle` so it doesn't block first render — pill is
empty for the first frames after open, which reads as correct
("we don't yet know of any misses").

**Incremental** via Zustand subscription to `delta_emitted` events
at the action layer:

| Delta target                                                     | Effect on outstanding set                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Translatable source row create or update of a translatable field | Add tuples for new or changed fields not yet present in translations. |
| Translatable source row delete                                   | Remove all tuples for that row.                                       |
| `translations` row create                                        | Remove matching tuple.                                                |
| `translations` row delete (e.g., reverse-replay)                 | Re-add tuple if the source row still exists.                          |

Bootstrap and incremental paths share `enumerateTranslatableFieldsFor(row, kind)`
so the field rules can't drift.

### Persistence

The set isn't persisted. It's recomputed on each story-open. This
is cheap (bootstrap query) and self-healing — any prior-session
bookkeeping bug auto-corrects. Sub-followup parked for
"translation-miss persistence" if real-device data shows the
bootstrap pause hurts.

### Branch and story switch

Bootstrap re-runs against the new (branch, target_language) pair on
branch switch or story switch. Outstanding set is implicitly
scoped to the current pair via the bootstrap filter; no
multi-branch caching.

## UX surfaces

### Toast (ephemeral)

| Trait             | Decision                                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fires on          | `run_complete` for `per-turn` or `chapter-close` runs where `translationResult.failures.length > 0`. Does **not** fire on `translation-retry` completion (the pill update is sufficient; double-toast feels like the app yelling). |
| Severity          | `warning` — narrative committed; translation degraded but not broken.                                                                                                                                                              |
| Copy              | `Translation: {n} row{s} missing — Retry?`. Count is the **delta from this run only**, not the running total. A turn that adds 3 misses on top of 247 pre-existing reads as "3 missing." The pill carries the running total.       |
| Action            | `Retry` button fires `runPipeline('translation-retry', ...)` against **all** outstanding misses (not just this run's delta). Single mental model: one retry, one set.                                                              |
| Dismissal         | Existing [`toast`](../ui/patterns/toast.md) pattern — auto-dismiss on TTL plus swipe-up and ×. No persistence.                                                                                                                     |
| Queue interaction | Existing toast queue cap collapses back-to-back failures. No special-case behavior.                                                                                                                                                |

### Pill (persistent)

| Trait        | Decision                                                                                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New state    | `translation-misses` joins the `error` tier of the [`generation-status-pill`](../ui/patterns/generation-status-pill.md) priority machine.                                                                                                             |
| Priority     | `active > error: memory-error > error: translation-misses > hidden`. Memory error wins when both present (retrieval degradation has greater downstream impact than display degradation).                                                              |
| Copy         | `error: translation-misses` maps to `Translation: {n} missing`. Singular collapses naturally.                                                                                                                                                         |
| Tone         | `warning` (matches toast severity). Visually differentiable from `memory-error` which uses `destructive`.                                                                                                                                             |
| Tap          | Direct retry — fires `runPipeline('translation-retry', ...)` against all outstanding misses. No popover, no confirmation. Pill transitions to `active` for the retry's duration; on completion resolves to either `hidden` or back to the error tier. |
| During retry | Standard pipeline-running behavior. The existing click-to-cancel popover applies; cancel returns the pill to the error tier with whatever count remains.                                                                                              |
| Visibility   | Sticky as long as `selectOutstandingTranslations(...).length > 0` for the current branch and target language. No user-driven dismiss — the only path to clearing is filling the misses (or switching to a language where there are none).             |

### Retry-completion silence

No toast or banner fires when `translation-retry` completes — the
pill state change communicates the outcome (count went down or
hid entirely). Orchestrator-level pipeline failure (the retry
itself fatals on framework grounds) surfaces via the existing
pipeline-failed error UI; no translation-specific channel for
that case.

## Adversarial findings

Tried to break the design after the section-by-section pass felt
right. Two real corrections folded into the design above; remaining
findings either confirmed locked decisions or became parked items.

**Provider downtime blocks user writes.** `user-action-translation`
is critical-path; if the provider is down, the turn aborts and
the user can't continue writing. Verified — accepted consequence
of the Q1 locked choice. Workaround for an outage: user sets
`target_lang = source_lang` to bypass the phase. Sub-followup
parked.

**Race: retry vs concurrent writes.** The original design had
retry as `no-gate`, opening multiple race shapes (stale-source-text
writes, per-turn-mid-retry collisions, chained-chapter-close-mid-retry
collisions). Resolved by flipping `gateBehavior` to `hard-gate`:
all races collapse because no other writer can be active. The
user can interrupt a long retry via the pill's click-to-cancel
popover; not permanently blocked.

**Event-bus volume under high failure rate.** Initially proposed
per-call `recoverable_error` events; at 5000-call language-switch
fills with provider down, the per-call form floods the event bus
without diagnostic gain. Folded into a single rollup
`display_translation_partial_completion` event at phase end;
per-call detail stays in `translationResult.failures`.

**Per-turn-pipeline ordering ambiguity.** `architecture.md`:454-456
says translation is parallel with classifier-piggyback parsing; a
trace bullet in line 775 ("Pre → Retrieval → Narrative →
Piggyback-parse → Translation → Post") sits in a "future sessions"
section so it isn't authoritative. Design doesn't try to resolve
this — `display-translation` is post-narrative; parallel-group
vs sequential placement is decided by the per-turn-pipeline
phase-list design.

**Outstanding-miss bootstrap cost.** Sub-100ms expected on v1
story sizes. Sub-followup parked for "translation-miss persistence"
if real-device data shows the bootstrap pause hurts.

**Translation vs narrative provider coupling.** This design assumes
the translation provider is independent of the narrative provider.
Provider B down while provider A up: narrative continues,
translation degrades — matches design intent. Inverse case
(narrative down, translation up) degrades cleanly too: narrative
fatals first; turn aborts. No silent failure between coupled but
different providers.

## Doc integration

| Canonical file                                                                                                | Change                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`architecture.md → Translation as a pipeline concern`](../architecture.md#translation-as-a-pipeline-concern) | Rewrite to lead with the two-phase structure. Promote user-action target → source from a trailing bullet to a co-equal phase description. Replace "Same `translations` table, same phase, different direction" wording. Add a "Graceful degradation contract" subsection summarizing the per-call independence rule and pointing at the retry pipeline. |
| [`data-model.md → Translation → Deltas participate`](../data-model.md#translation)                            | Rewrite atomicity contract per the new "atomic when present" wording. Document retry-created action_id and orphan-row behavior. Replace one stray "Pipeline translation phase" reference with "Pipeline display-translation phase."                                                                                                                     |
| [`generation-pipeline.md → V1 declarations`](../generation-pipeline.md#v1-declarations)                       | Add `translationRetryPipeline` declaration. Add resolution-table rows for translation-retry interactions with per-turn, chapter-close, and itself.                                                                                                                                                                                                      |
| [`generation-pipeline.md → Open / deferred`](../generation-pipeline.md#open--deferred)                        | Remove the "Translation graceful degradation" bullet — design is now spec.                                                                                                                                                                                                                                                                              |
| [`patterns/generation-status-pill.md`](../ui/patterns/generation-status-pill.md)                              | Add `translation-misses` to the error states. Update the priority list. Update the phase / error → copy mapping. Extend the tap-action description ("tap-to-route OR tap-to-retry depending on error kind").                                                                                                                                            |
| [`patterns/toast.md`](../ui/patterns/toast.md)                                                                | Add a usage example for the translation-failure shape (severity=warning, Retry action, count-in-copy).                                                                                                                                                                                                                                                  |
| [`followups.md`](../followups.md)                                                                             | Remove the "Translation graceful degradation" entry.                                                                                                                                                                                                                                                                                                    |

No wireframe changes — pill and toast are existing chrome.

## Followups in/out

**Resolved by this exploration:**

- [`Translation graceful degradation`](../followups.md) — entry
  removed; design landed in canonical docs per the integration
  table above.

**Newly parked (`parked.md → Parked until signal`):**

- **Outage-mode fallback for user-action-translation.** Currently
  fatal; explore degradation paths if outage UX bites (e.g., write
  user input in target language directly, breaking the monolingual-log
  invariant; recover later via background re-translate). Lands if
  outage friction shows in real use.
- **Translation-miss persistence or registry table.** On-load
  bootstrap acceptable for v1; revisit if mega-story devices show
  bootstrap pause.

**Untouched (still active):**

- [`Translation rows in per-story export / import`](../followups.md)
  remains open — separate concern from per-turn failure semantics.
  This design doesn't address how outstanding-misses or translation
  rows reconcile across an import boundary.
