# System and user prompt halves

Resolves the developer's note "Agent prompts only defined with user
prompt, should be split into system and user". Every model call
rendered one Liquid template into one string and sent it as the only
user message; nothing set a system role, and canon never mentioned
roles. The commit that lands this record files the implementation and
the deferrals below in the ledgers.

The spec lives in
[`architecture.md → System and user halves`](../architecture.md#system-and-user-halves)
and the sections it links; what follows is why.

## What this closes vs. defers

Closes:

- **The message shape.** A template has a system half and a user half,
  sent as a system message and a user message.
- **The placement rule.** What may go in the system half, and why it
  must render the same from call to call.
- **Today's content in the new shape.** Each bundled template's blocks
  are assigned a half, with no prompt rewrites.
- **One Anthropic cache marker.** On the system prefix of the calls
  that recur at a turn's pace.

Defers:

- **Prompt content.** The narrator's standing instructions and the
  wizard's contract and grounding split, to a prompt content pass in
  `followups.md`. The narrative person (`definition.narration`), which
  no bundled template renders, goes to `triage.md` so it doesn't wait
  for that pass.
- **Cache optimization.** Caching the history, more markers, a longer
  TTL and per-provider measurements, parked until the prompt shapes
  settle and there's data to measure against.
- **Recording cache tokens.** To the per-turn token breakdown followup.

## Ground truth that shaped it

- **Purpose.** The developer named two goals: instruction adherence
  (standing instructions in the system message, which chat-tuned and
  local models expect) and caching. Pack parity with legacy v1's
  per-story custom system prompt and its reinforcement levels was not
  wanted.
- **Legacy v1 split every template.** A system half and an optional
  user half, with prefix-caching notes measured on its own prompts:
  stable blocks first, and the system message, sent first, must not
  vary. Its users ran a system message on every call with no reports
  of a model rejecting the role.
- **Caching works two ways.** Most OpenAI-compatible servers reuse the
  longest token prefix of the serialized request, so ordering is
  enough and message boundaries don't matter. Anthropic caches only at
  explicit `cache_control` breakpoints on a content block, silently
  ignores one with too short a prefix, and charges extra to write the
  cache.
- **The default buffer slides every turn.** With `fullChapterInBuffer`
  off and a window of 10 entries
  ([`cadence.md → Composition rule`](../memory/cadence.md#composition-rule)),
  each turn's pair pushes the oldest two out, so nothing from the
  history on is reusable on any provider. Only the prefix in front of
  it can cache, which made this a design about the system half rather
  than about history caching.
- **Packs ship post-v1.** The only pack is the bundled one, held in
  code, so changing the template shape migrates nothing.

## Decisions

**Two named halves, not a parts list or a Liquid tag.** A template is
`{ group, system, user }`. An ordered list of role-tagged parts would
leave room for several cached system blocks, an assistant prefill or
the history as alternating turns, but each needs ordering and
alternation rules, and no planned call wants them: the narrative is
one system and one user message, tool-loop agents append their steps
after the opening pair, and only the conversational assistant
alternates, from its own history. A block tag in one source keeps one
file per template but makes the split exist only after rendering, which
the include validator and the read analysis would have to learn.

**The system half is stable or it is wrong.** Providers send the system
message first, so one byte that changes per call moves the prefix every
provider caches from. The rule is an author contract, as the
empty-bucket rule is; a pack-validator warning for a system half that
reads a per-call variable is filed with the deferred validator.

**Split what exists, don't rewrite it.** A block moves to the system
half only if it is stable for the story and doesn't point at user-half
content by position ("above", "the LAST entry"); everything else stays
in the user half in today's order. The only wording edits fix
references the move broke: three in the periodic classifier's rules
("the list above", "the lists above", "its line above"), which name
the Known lists they mean instead. The wizard's system halves stay empty, since its
shared macros mix the output contract with grounding that changes as
the user fills the wizard in; splitting them is prompt-content work.

**The JSON contract is split too.** The lead-in and the
`interface Response` block go at the end of the system message, where
they cache and where they are standing instructions; the closing
"Output ONLY the JSON object" line stays at the end of the user
message, for the weaker models that take the prompt-injection path and
follow format instructions best near where they generate. Every schema
is static, so the contract is the same on every call of a call site;
the fallback classifier's two shapes, with and without suggestions,
make two cache entries.

**The marker only where calls recur.** From Anthropic's pricing as
recalled, not checked in this session, a cache write costs about a
quarter more than plain input and a read about a tenth, with a
5-minute lifetime, so a marker pays only when calls of one call site
follow each other closely. The narrative call gets it; the fallback
classifier gets it only when it is the turn's regular classifier,
because piggyback isn't firing. The periodic classifier, often more
than 5 minutes between passes, suggestion refresh and the wizard get
none. Agentic loops, which resend the whole prompt every step, will
want whole-prompt caching; that is part of the parked entry.

**The marker sits on the last system block as sent.** The middleware
adds the JSON contract after the call layer builds the messages, and
creates the system message when a template's system half is blank, so
a marker placed earlier would miss the contract, the largest stable
block.

## Adversarial pass

- **Stable system halves.** Checked: the periodic classifier's rules
  carry no Liquid, every structured schema is static
  (`lib/classifier/schema.ts`, `per-turn-piggyback.ts`), and
  `piggybackFires` depends only on the story's mode and the model's
  capability.
- **The mock LLM's schema extraction.** It brackets the block between
  the lead-in and the closing line (`scripts/mock-llm/routing.ts`),
  which the split moves into different messages; the end delimiter
  becomes the end of the system message.
- **Models that reject a system message.** Some older chat templates
  (Gemma 2's, under `llama-server --jinja`, from memory) refuse the
  role, and every call now sends one. Accepted on legacy v1's record
  and parked; the fix would be a user-overridable model capability that
  folds the system half into the user message.
- **Reading order.** The periodic classifier now reads its rules before
  the data, and the narrator's output-format line leaves the end of the
  prompt. Neither is measured; the real-provider classifier smoke spec
  is the cheapest check before and after.
- **Token accounting.** `usage.inputTokens` is the total with cached
  tokens included (AI SDK docs), so entry metadata keeps its meaning.
  Whether Diagnostics' HTTP capture keeps the usage events of a
  streamed response, which would show the marker working, was not
  checked.
