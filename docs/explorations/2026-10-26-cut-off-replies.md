# Cut-off replies

A reply the server stops at its length limit is now seen as one. A
structured reply cut off is refused instead of repaired; a narrative
reply cut off in its prose commits with a mark and a notice; a reply
with no text fails its turn. The capability-mismatch hint gets current
canon on the way. Designed 2026-10-26, after the
[context window check](./2026-10-26-context-window-check.md); closes
the followup "Nothing reads a reply's `finish_reason`" and the triage
item on `possibleCapabilityMismatch`.

## Why

The followup said a structured reply cut short fails as a parse
failure. It doesn't: `parseStructured` falls back to `jsonrepair`
(3.15.0), which closes truncated JSON. Probed: a reply cut inside an id
(`"happening":"h`) repairs to the string `"h"`, one cut at a list
(`"threads":[`) to an empty list. The pass's schema is tolerant by
design (`tolerantList` defaults a list to `[]` and drops a bad entry),
so a pass whose reply stops at `length` parses, succeeds, advances the
watermark, and loses the facts at the reply's end for good: the silent
memory loss the pass failure policy rules out. It needs only an agent
profile with a modest `maxOutput` and a busy window.

The narrative side commits a cut reply as whole, and a reply cut
before any prose, a reasoning model spending its whole allowance on
thinking, commits a blank entry. So does a reply with no text at all.

## Ground truth that shaped it

- **Nothing reads `finishReason`** in `lib/`.
- **The SDK normalizes it.** Anthropic's `max_tokens` and
  `model_context_window_exceeded`, and OpenAI-compatible `length`, all
  map to `'length'` (`@ai-sdk/anthropic` 3.0.81,
  `@ai-sdk/openai-compatible` 2.0.49).
- **A cut `<state>` is already handled**: it fails the `state` field and
  the fallback rereads the prose
  ([`memory/piggyback.md → Parse strategy and failure recovery`](../memory/piggyback.md#parse-strategy-and-failure-recovery)).
- **The fallback's failure keeps the turn**, recording it in the state
  report's `failedFields` (`per-turn-piggyback.ts`).
- **`generateStructured` flattens a failure to a string**, and
  suggestion refresh relabels it `provider/unknown`.
- **Entry metadata inheritance is an allow-list** of the scene fields
  (`inheritedEntryMetadata`), so a new field can't leak forward.
- **The parse-rate probe goes through `generateStructured`**, so a
  repaired cut reply counts as a first-attempt parse. Its 2026-10-26 run
  set no max output on a 65k window, so a cut was unlikely, but nothing
  shows it.
- **The capability hint is canon without code**, and its canon is
  stale: its keywords (`tool_use`, `vision`, `streaming`) name nothing
  the app sends, miss reasoning and structured output, and its copy
  routes to Story Settings · Models, which holds model overrides, not
  capabilities.

## Decisions

**A cut structured reply is refused, not repaired.** On `length` the
reply is accepted only if it parses strictly, with no repair: a
complete document that happened to end at the limit. Otherwise the call
fails, not retried, since the same prompt and limit cut again.
`jsonrepair` keeps its job on replies the model finished.

**A cut narrative reply commits with a mark (A).** Rejected: _a
Continue action_ (B), the fix users want but a new turn kind, with
piggyback and suggestions over the joined text and its own regenerate
and undo rules, parked; _failing the turn_ (C), which discards a mostly
good reply for its last sentences. The mark is recorded only when the
cut falls in the prose, before any trailing block began; a cut inside
the block leaves whole prose, and the block's own handling covers it.

**An edit clears the mark.** Once the user has edited the text it's
theirs. Rejected: a dismiss control, one more element for a typo case.

**No text fails the turn.** A cut reply with no prose fails as a
cut-off; a reply with no text at all and a normal stop fails as an
empty reply. A reply that is only a trailing block keeps its raw text,
as before.

**The cause is attributed, not guessed**: `max-output` when the
profile's limit was reached, `window` when the prompt estimate and the
output reach a known window, `unknown` otherwise, which on hosted
servers is usually their own default `max_tokens`.

**The hint is typed and routed to where capabilities live**: the
profile's setting and the model's badge in App Settings.

**Cut-off handling ships first,** ahead of the window check: it closes
a live data-loss path, and it builds the typed failure arm in
`generateStructured` the window check needs.

## The design

Canonical in
[`generation-pipeline.md → Cut-off replies`](../generation-pipeline.md#cut-off-replies)
(detection, structured refusal, the narrative rule, the cause, the
failure type) and
[`→ Fatal error categories`](../generation-pipeline.md#fatal-error-categories)
(the `reply-cut-off` kind, the refreshed capability hint). The entry
mark in
[`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape),
the notice in
[`entry-card.md → Cut-off notice`](../ui/patterns/entry-card.md#cut-off-notice),
the failure rows in
[`reader-composer.md → Transient pipeline failures`](../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat).

## Adversarial pass

- **A complete reply at the limit** would be refused without the
  strict-parse rule; with it, accepted.
- **A cut in the trailing block** would mark whole prose as cut; the
  mark is limited to cuts in the prose.
- **Undo**: the edit clears the mark in the same delta as the content,
  so CTRL-Z restores both.
- **Cause on hosted servers**: `unknown` is common there, so its copy
  says a profile max output overrides the server's default.
- **The fallback** now applies nothing from a cut reply where
  `jsonrepair` may have applied a partly right state, truncated ids
  included; the failure shows in the state report.
- **Holds**: inheritance (allow-list); reasoning counts toward output
  tokens on both providers, so one cause test covers thinking;
  regenerate, branch and translation paths are unaffected.
- **Not covered**: a future plain-text call (M8's translation) reads
  `finishReason` itself; canon says so. A `content-filter` stop commits
  as today.
- **Assumed**: every server sets `finish_reason: length` at its limit;
  one that reports nothing stays undetected, as today.

## Integration plan

- `generation-pipeline.md`: a `### Cut-off replies` section under
  Error, cancel, and retry; the `reply-cut-off` arm on `CallRetryError`
  and `PipelineError`; Fatal error categories gains the kind and the
  rewritten `possibleCapabilityMismatch` paragraph and type.
- `data-model.md → Entry metadata shape`: `cutOff`.
- `memory/classifier.md → Failure policy`: a cut reply is a failure,
  never repaired.
- `architecture.md → The pre-send check`: a reply that then fills the
  window is a cut-off reply.
- `ui/patterns/entry-card.md`: the notice slot in Per-kind structure, a
  `## Cut-off notice` section, the edit clearing it.
- `ui/screens/reader-composer/reader-composer.md` and `.html`: the
  **Reply cut off before any text** row, the empty reply and the cut
  pass on existing rows, the hint's copy; wireframe states for the
  notice, the cut-off row, the cut pass and the hint.
- `ui/screens/app-settings/app-settings.md → Override semantic`: the
  hint's keywords and routing.
- `followups.md`: the `finish_reason` followup replaced by "Implement
  cut-off reply handling", ahead of the window check; that entry
  gains the capability hint and the dependency.
- `implementation/triage.md`: the `possibleCapabilityMismatch` item
  removed.
- `parked.md`: continuing a cut-off reply, parked until signal.
