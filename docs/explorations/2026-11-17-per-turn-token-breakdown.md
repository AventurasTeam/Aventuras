# The per-turn token breakdown

How a turn records what each section of its prompt cost, and how the
reader shows it. Designed 2026-11-17 from the UX followup "Per-turn
token usage breakdown", raised by the developer 2026-10-10.

## Why

An entry keeps only totals (`metadata.tokens`), and the reader shows
only the reply's. A user can't see why a turn cost 30k tokens, what
raising a retrieval budget did, or whether the Places map is outgrowing
the story. The memory probe's Selected tab
([`memory-probe.md`](../ui/screens/memory-probe/memory-probe.md)) lists
the floor and each retrieved row with its cost, but only on captured
turns, behind two toggles that default off, and nothing outside
retrieval: not the instructions, the setup, Places, the ID instructions
or the emission blocks. And no call records its cache reads or writes,
the only measure of whether a cache marker pays. The roadmap scheduled
none of it.

## Decisions

- **For the user, not a diagnostic.** Every turn records it, with no
  gate, and the entry shows it behind a tap.
- **Per entry.** No trend chart across the branch; the numbers sit on
  each entry, so a trend is a later read of entries.
- **The turn's two calls.** The narrative call, and the fallback
  classifier when it ran on the turn (when piggyback isn't firing, or
  as the fallback for a failed parse). A periodic pass and a close are
  not attributed to an entry.
- **The meta line shows the narrative call only.** Its number is that
  call's prompt, never a sum of the turn's calls; the panel groups by
  call, each group headed by its own counts.
- **Sections come from the template.** A `{% section 'id' %}` block tag
  records its rendered text, so the counts are what the model received.
- **A turn's window refusal keeps its sections.** The failure entry's
  Details lists them, the moment a user most needs to know what is big.
- **Every call's cache numbers go to the debug log.** `provider.input_ratio`
  gains them, which covers a close's tool steps with no storage.
- **Placement.** A plan-mode followup, after the override-settings PR
  merges, since both touch `per-turn.ts`, `generate.ts` and
  `locales/en/reader.json`.

## Approaches

**A. A section tag in the template language (chosen).** The pack marks
sections from a closed vocabulary; the engine records each section's
rendered text; text outside any section is Other. The counts are of
what was sent, state lines, `[id]` tags and wrappers included, and the
sum can prime the pre-send check. It keeps formatting in Liquid and
leaves a custom pack able to rebuild the prompt and still mark it.

**B. Price the inputs in code**, the probe's method: retrieved rows from
`tokens_estimated`, floor rows as the probe prices them, the history
from `content_tokens`, the rest as one "Instructions and formatting"
line. No engine or template change, but the numbers miss the wrappers
(the probe calls its floor a lower bound), Places is priced nowhere and
pricing it means formatting it in code, and the leftover line absorbs
every error.

**C. Split the rendered prompt at `# ` headings.** No engine change, but
stored prose can hold a `# ` line, which splits the history wrongly,
and a custom pack's headings give labels the app can't name.

Only A gives numbers the model received, and only A can feed the check;
B and C still need a whole encode beneath them.

## The design

**Sections.** `{% section 'id' %}…{% endsection %}` writes its body
through and adds no bytes. Ids come from a closed vocabulary; a repeated
id sums; the innermost of nested sections wins; an unknown id counts as
Other and warns once per id per session. The vocabulary, over both
calls: `instructions`, `setup`, `roster`, `scene`, `places`,
`entities`, `lore`, `happenings`, `threads`, `chapters`, `history`,
`output`, and the remainder `other`. The memory sections are tagged in
`macro_memory_blocks`, so both calls get them. The fallback's JSON
contract, which the call layer adds, counts under `output`. Other is the
call's estimate less everything named, floored at zero.

**Counting.** Each section is counted through the pre-send check's count
cache, so unchanged text costs nothing. `history` is priced as a close
prices its turns, from the entries' stored `content_tokens` and the
section rendered with every entry blank, guarded as below. The user
half's sum is primed for the exact text sent, so the check reads it
without encoding. The check still compares what it compared; the
call's total is its estimate.

**Storage.** `tokens` gains `cacheRead?` and `cacheWrite?`.
`promptSections?` holds the narrative call's sections;
`classifierCall?` holds the fallback's `tokens` and `promptSections`;
`systemFailure.promptSections?` holds a turn's window refusal's. All are
authored, never inherited, untouched by an edit, carried by export and
by a fork. A call records the attempt the turn kept. Cache fields are
read from `usage.raw` and set only when the provider sent them.

**Display.** The meta line reads `12,340 → 840 (+1,200 reasoning)`, the
provider's prompt count first, or `~11,900 → ~840` with sections and
no provider counts, the reply from its stored `content_tokens`. The token text toggles an inline panel under the
world-state panel, pressable only when the entry has sections. The
panel groups by call; each group's header carries that call's provider
counts, then the cache lines when reported, then "Estimated by section"
with the sections' sum, then the sections in vocabulary order with a
proportional bar, zero sections left out. Labels use the app's nouns.

## Adversarial pass

**Load-bearing: the tag must be invisible to static analysis's
consumers.** Verified: `generation-context.ts:378` skips reading the
prompt buffer and the scene when `templateReads` doesn't list `entries`
or a scene variable, and LiquidJS's static analysis sees inside a
custom block tag only when the tag implements `* children()` (the
library's static-analysis tutorial). A tag without it would send a
narrative prompt with no history and no error. The tag implements
`children()` and pushes no scope, so an `assign` inside a section stays
visible after it; acceptance holds `templateReads` identical with and
without the tags, and both bundled templates byte-identical. The
include validator matches by regex (`validate-includes.ts`), so the tag
doesn't affect it.

**Custom packs and priming.** Roadmap item "M7.2 — The close's count
priming assumes the system half holds each turn's prose once" names the
risk: an edited pack that truncates, moves or doubles
`{{ entry.content }}` makes a primed count silently wrong, and the check
has no margin. The turn's `history` has the same exposure, so it takes
that item's guard: price from stored counts only when the rendered
history's length less its blank render's equals the summed prose
lengths, else encode. One helper; the close adopts it in the same
build, which closes the M7.2 item.

**A missing figure reads as 0.** Verified in
`@ai-sdk/openai-compatible` 2.0.49
(`convertOpenAICompatibleChatUsage`): a usage block without
`prompt_tokens_details` reports `cacheRead: 0`, and one without
`completion_tokens_details` reports `reasoning: 0`. Hence the raw read.
The same trap likely shows today: `per-turn.ts` keeps a reasoning of 0
(`!= null`), and `entry-card.tsx` would render "(+0 reasoning)" on
every reply from a server that sends no reasoning figure. Read from the
code, not run; the build fixes it with the same helper. The dev
llama.cpp router does send `cached_tokens` on a stream (verified: 0,
then 52 of 57 on a repeat, its prompt time 503 ms to 28 ms).

**The tag's collector.** Macros with section tags render inside
templates nobody measures (none today; a later template could). The
collector is per render, so a render outside the turn's two calls
records into nothing and two renders never share one.

**Lean.** Priming inherits the close's accepted lean: high on a stored
block an older reply still carries, low where o200k merges across a
section's edge. Other floors at zero, so the sections can exceed the
estimate by a few tokens; the panel shows their own sum.

**Assumed, not measured.** That a turn's count gets cheaper: today the
whole user half, history included, is one changing string, encoded each
call, while the design encodes only changed sections and prices the
history from stored counts. It adds a second render of the user half
for the blank history. The plan measures `provider.prompt_estimate`'s
`ms` on a long story before and after, in English and in a CJK story.

**Left out on purpose.**

- A pass's window refusal gets no sections: the periodic classifier's
  template isn't tagged, and its remedies (a larger window, another
  model) don't depend on the split.
- A failed fallback records nothing; its failure is in `stateReport`.
- Failed attempts aren't added: the panel describes the prompt, the
  same on every attempt, not the bill.
- No money: providers price cache reads and writes differently, and the
  app knows no prices.
- The fallback's contract count: how the phase learns the size of the
  contract the call layer adds is the plan's to settle (count the
  contract text the call layer builds, or take `output` as the estimate
  less everything else).

**Missing perspectives checked.** Translation: the labels go through
`t()`, the numbers don't depend on language, and the prompt is English
source either way. Accessibility: the token text carries a spoken label
naming all three numbers, the bars are decorative, the rows are text.
RTL: the arrow sits inside the translated string. The reader document's
sliding window already handles a row that grows when a panel opens.
Undo: the fallback's numbers ride its metadata delta, so undoing that
write removes them; undoing the turn removes the entry.

## Drift pass

The drift pass found the streaming card still in the old format
(`— / N →`, `M / N →`), its trailing `→` the in-flight marker, which the
new committed line's middle arrow made ambiguous, and the
no-provider-counts line `~11,900 →` putting that marker on a committed
entry. Developer decisions: the streaming card shows its live counts in
the new shape with a trailing `…` (`840 (+1,200 reasoning)…`), the
prompt figure arriving on commit; the estimated line becomes
`~11,900 → ~840`. The shipped card shows "Thinking" or "Generating" with
no counts, which predates this design and stays out of it. Mechanical
fixes: restated rules trimmed to their owners, the wireframe's
fallback group given its Calendar setup, the EntryCard's Storybook list
and per-kind top line updated, and the AI SDK v7 entry told that cache
and reasoning figures now come from raw usage.

## Integration plan

**Canonical files:**

- `docs/architecture.md`
  - A new `### Prompt sections` under Prompt templates and authoring,
    after `### System and user halves`: the tag, the vocabulary with
    the bundled pack's mapping, Other, repeats, nesting, unknown ids,
    no bytes and no change to the variables a template reads.
  - `### The pre-send check`: a paragraph on a turn's calls counting
    by section, the history priced from stored counts under the guard,
    and the user half primed with the sum.
  - `### Truncation cross-check`: the debug ratio log carries the
    provider's cache reads and writes when reported.
- `docs/data-model.md → Entry metadata shape`: `tokens` gains
  `cacheRead?`/`cacheWrite?`; `promptSections?`, `classifierCall?`,
  `systemFailure.promptSections?`; a `**Prompt sections.**` paragraph
  with the rules.
- `docs/observability.md`: `input_ratio`'s fields gain `cacheRead` and
  `cacheWrite`, when the provider reported them.
- `docs/ui/patterns/entry-card.md`: the Compound API's `meta` widens
  and the system kind gains `promptSections`; the per-kind table gains
  a Token panel row; a new `## Token panel` section; `## System entry`
  lists the sections under a window refusal's Details.
- `docs/ui/screens/reader-composer/reader-composer.md`: the meta line
  format in "Reasoning expansion + token metadata on AI entries"
  (heading kept), the token toggle; the window entry paragraph gains
  the sections in Details.
- `docs/ui/screens/memory-probe/memory-probe.md`: one sentence under
  the Selected tab on how it relates to the token panel.
- `docs/parked.md → Pack validation contract`: the validator also
  checks section ids against the vocabulary.
- `docs/implementation/roadmap.md`: the M7.2 close-priming item notes
  that the breakdown's build ships the guard and adopts it for the
  close.
- `docs/followups.md → UX`: "Per-turn token usage breakdown" becomes
  "**The per-turn token breakdown isn't built.**" with build notes.

**Renames:** the followup's title changes; nothing links to it by
anchor (verified: the Tuning section links `#ux`). No heading renames.

**Patterns adopted on a new surface:** none. The panel is part of the
EntryCard pattern, which reader-composer already cites.

**Followups resolved:** none removed; the design part of "Per-turn
token usage breakdown" is done and the entry becomes a build entry.

**Followups introduced:** none. The close's cache numbers go to the
log; the M7.2 priming item is closed by the build, not by this commit.

**Wireframes:** `docs/ui/screens/reader-composer/reader-composer.html`:
an AI entry's meta line in the new format with its token panel open,
the narrative group and the classifier group; the context-window
entries' Details listing the sections.

**Intentional repeated prose:** the vocabulary's labels appear in both
`architecture.md` (ids and mapping) and `entry-card.md` (display
order and labels); the first owns what a section holds, the second how
it reads.
