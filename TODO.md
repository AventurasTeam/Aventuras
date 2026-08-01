# TODO — Narrator prompt reordering (4.3)

Move the volatile blocks out of the narrator's **system** message so the system message is
byte-identical between consecutive turns, and reshape the tail of the **user** message so the
prose that leads into the player's action is not interrupted.

Nothing here is started. Everything below is the plan, the reasoning, and the measurements it
rests on.

---

## 1. Why

### The measurement

Two consecutive narrator turns from a real 39-chapter save (`logs/aventura-debug-*`), diffed byte
by byte:

| message | size         | common prefix      |
| ------- | ------------ | ------------------ |
| system  | 91,921 chars | **60,004 (65%)**   |
| user    | 68,010 chars | 67,886 (**99.8%**) |

The system message diverges at `</story_history>` → `[CURRENT STORY TIME]`. Because the system
message is sent first, **that divergence invalidates the user message too** — all 68,010 chars of
it, 99.8% identical, reprocessed every turn.

The actual differences inside the system message are tiny: one clock line, one rewritten character
description, one story beat, three deleted beats, and the `[Retrieved Context]` block. Roughly
93,000 characters (~21,000 tokens) of byte-identical text is reprocessed every turn because it sits
behind them.

### What it costs on a real backend

Measured against `llama-server` (Gemma 4 31B, `-c 49152 -cram 40960`), replaying the two real
prompts through `/v1/chat/completions`:

|                                                | prompt tokens | cached     | wall       |
| ---------------------------------------------- | ------------- | ---------- | ---------- |
| turn 1 (cold)                                  | 36,655        | 0          | 44.3 s     |
| **turn 2, as the app sends it today**          | 37,104        | **0**      | 46.2 s     |
| **turn 2 with the system message made stable** | 37,104        | **13,872** | **28.9 s** |

So the change is worth **~13,900 tokens and ~17 seconds per narrator turn** on that setup.

### Why the gain stops at 13,872 there, and is larger elsewhere

`llama-server` on a sliding-window model does not reuse an arbitrary common prefix. It reuses only
back to the nearest **context checkpoint** at or before the divergence point, and if there is none
it resets `n_past` to 0 and reprocesses everything (`tools/server/server-context.cpp:3330-3364`).
Checkpoints are created only at user-message starts and at the tail of a completed prompt — never
mid-message.

Consequences worth knowing before optimising further:

- With one system + one user message there is exactly **one** usable checkpoint, at the start of the
  user message (~13.9k tokens in). That is the 13,872 above, and it does not move however much
  further down the real divergence lands.
- Splitting the user message into several consecutive `user` messages does **not** help: Gemma's
  chat template merges them, so no extra delimiter exists. Measured: identical 13,872.
- On a provider with ordinary prefix caching (Anthropic, OpenAI, Gemini) the full shared prefix
  counts, so the same change is worth roughly **twice** as much there (~29,800 tokens).
- `--swa-full` removes the rule entirely, but on this model it would need ~20 GiB of KV at
  `-c 49152`. Not viable on 24 GB; would require dropping to `-c 8192`–`12288`. **Not the plan.**

---

## 2. What moves

### Current shape

```
system:  [role · style · POV/tense · DM principles · lore adherence]   stable
         [visualProseInstructions] [inlineImageInstructions]           stable
         {{ chapterSummaries }}   <story_history>                      stable until a new chapter
         [CURRENT STORY TIME] {{ storyTime }}                          VOLATILE every turn
         {{ tieredContextBlock }}                                      VOLATILE every turn
         {{ styleGuidance }}                                           volatile every ~6 turns

user:    {primingMessage}
         ## Recent Story:      (all entries except the last action)    append-only
         ## Current Action:    (the last action)                       volatile
         Continue the narrative:
```

`tieredContextBlock` is one variable holding three concatenated blocks, assembled in
`aiService.streamNarrative` as `joinPromptBlocks(worldStateBlock, retrievedChapterContext)`, where
`retrievedChapterContext` is itself `joinPromptBlocks(chapterContext, lorebookContext)` from
`RetrievalPhase`. In prompt order: **world state → retrieved chapter context → lorebook context**.

### Target shape

```
system:  [role · style · POV/tense · DM principles · lore adherence]
         [visualProseInstructions] [inlineImageInstructions]
         {{ chapterSummaries }}                                        ← ends here, fully stable

user:    {primingMessage}
         ## Recent Story:      (all entries except the last N + 1)     append-only
         {{ lorebookContext }}
         {{ worldStateBlock }}
         [CURRENT STORY TIME] {{ storyTime }}
         {{ retrievedChapterContext }}
         {{ styleGuidance }}
         ## Continuing scene:  (the last N entries)                    ← unbroken prose
         ## Current Action:    (the last action)
         Continue the narrative:
```

### Why the lorebook goes to the user message too (A, not B)

The alternative was to keep the lorebook block in the system message, as the canonical material the
instructions refer to (_"When [LOREBOOK CONTEXT] is provided, treat it as canonical"_).

Rejected, because the lorebook block is **structurally unstable**: `EntryRetrievalService`
reselects it every turn, and its Tier 3 is an LLM call — not deterministic even on identical input.
Keeping it in the system message means the system diverges whenever selection changes, and the loss
is then the entire user message. Putting it in the user tail makes the system message _always_
stable and the divergence point _always_ the same. Never worse, usually better.

It goes **first** inside the volatile tail: it is the most canonical and the most nearly stable of
the group, so it is already in the right place if it ever becomes cacheable.

### Why `styleGuidance` moves as well

`triggerInterval` defaults to 6, so it is byte-identical 5 turns out of 6. Leaving it in the system
message therefore buys nothing in those 5 turns and loses the whole prefix in the sixth. In the
volatile tail it costs nothing, ever.

### Why the last N entries are detached

Placing lorebook, world state, memory and style _between_ the recent prose and the player's action
interrupts the flow exactly where the model has to pick it up, and risks more schematic narration.
Detaching the last N entries and putting them **after** the volatile block means the prompt ends
with unbroken prose leading into the action.

`N = 3`, which reading back from the end of Recent Story is **narration, action, narration** — two
narrator entries and one player entry.

**Cost:** the divergence point moves earlier by the size of those 3 entries. On the measured save,
entries average 2,688 chars → ~8,000 chars ≈ 1,900 tokens. Shared prefix drops from ~79% to ~74%.

**On `llama-server` this costs literally nothing**, because reuse is quantised to the user-start
checkpoint either way. On a cloud provider it costs ~1,900 tokens of prefill per turn. Worth it.

Start with a named constant. A slider is possible later if it proves worth tuning.

---

## 3. Still to be decided

**Whether to keep `Recent Story` as it is today** — a single `## Recent Story:` block followed by
`## Current Action:` and `Continue the narrative:`, with no `## Continuing scene:` split.

That is the cheaper option: the volatile blocks still move out of the system message (all of §2's
cache gain), but the prose keeps its current shape and nothing is detached. It gives up the prose
continuity argument in exchange for ~1,900 tokens per turn on cloud providers and a simpler
`buildUserPrompt`.

Both variants should be tried on real generations before committing to one — the prose effect is
the kind of thing that only shows up in the output.

---

## 4. Implementation

### 4.1 Split the three blocks apart, without breaking prompt packs

`tieredContextBlock` is an **advertised template variable** (`services/templates/variables.ts`,
`components/vault/prompts/TestVariablesModal.svelte`, `sampleContext.ts`), so custom packs
reference it. And `PackService.refreshDefaultPackTemplates` only ever updates `default-pack` —
**custom packs are never auto-updated**.

Therefore:

- **`tieredContextBlock` must keep containing all three blocks, exactly as today.** A custom pack
  that renders it keeps working unchanged; it simply does not get the reordering.
- The new variables are **added**, not substituted: `lorebookContext`, `worldStateBlock`,
  `retrievedChapterContext` (this last one already exists and is already advertised).
- Only the **baseline** templates in `templates/narrative.ts` switch to the new variables. No
  duplication results, because a given template renders one set or the other.
- Register the new variables in `services/templates/variables.ts` and in the Vault test-variables
  modal, or they will not appear in the editor's variable list.

Wiring needed: `RetrievalPhase` already returns `worldStateBlock`, `chapterContext` and
`lorebookContext` separately in `RetrievalResult`; it is `aiService.streamNarrative` that joins them
into one string. Stop joining for the new path; keep producing `tieredContextBlock` alongside for
the old one.

### 4.2 Move the blocks in the baseline templates

Both `adventure` and `creative-writing` in `services/prompts/templates/narrative.ts`.

- Remove `[CURRENT STORY TIME]`, `{{ tieredContextBlock }}` and `{{ styleGuidance }}` from the end
  of `content` (the system half). `content` then ends with `{{ chapterSummaries }}`.
- These templates have **no `userContent` today** — the user message is built in code by
  `NarrativeService.buildUserPrompt`, not by Liquid. Decide one of:
  - **(a)** build the tail in `buildUserPrompt` as today, appending the blocks as plain strings; or
  - **(b)** give the templates a `userContent` half and render the user message through Liquid too.

  (b) is more consistent with the rest of the app and makes the user half editable in the Vault like
  every other prompt, but it is a larger change and `ContextBuilder.render(id)` returning
  `{ system, user }` means every caller of these two templates must stop destructuring only
  `system`. (a) is smaller and lower-risk. **Prefer (a) for this task.**

Note the existing `{% comment %}` block at the top of the system half explains the _previous_
reordering and explicitly says the next step is "the volatile block moved out of the system prompt
altogether, which is a larger change and worth doing only if this one shows the reuse actually
materialising". It has, so that comment needs rewriting rather than deleting.

### 4.3 Reshape `buildUserPrompt`

`NarrativeService.buildUserPrompt(entries, mode, inlineImageMode)` currently emits:

```
## Recent Story:\n<historyParts.slice(0, -1) joined>\n\n## Current Action:\n<last action>\n\nContinue the narrative:
```

New signature takes the volatile blocks and emits Recent Story minus the last `N`, the volatile
blocks, `## Continuing scene:` with the last `N`, then Current Action.

Edge cases that must not regress:

- Fewer than `N + 2` entries (a new story): `## Continuing scene:` must not appear with nothing in
  it, and Recent Story must not appear empty. Today the guard is `historyParts.length > 1`.
- `stripPicTags` is applied per entry when not in inline-image mode — keep it applied to the
  detached entries too.
- The last user action is found with `[...entries].reverse().find(e => e.type === 'user_action')`,
  not by position. Detaching entries must not change which entry becomes Current Action.

### 4.4 Keep the last action's format as it is

Considered and rejected: making the current action render as `[ACTION] <text>` like every other
historical action, so the shared prefix extends past it. The gain is ~200 characters; the cost is
losing the `## Current Action:` header, which is the explicit signal for what the model must respond
to. Not worth it.

### 4.5 Tests

`services/prompts/templates/narrative.test.ts` already pins the system-half ordering and that
optional blocks vanish when empty _and_ when absent. Extend it:

- the system half no longer contains `[CURRENT STORY TIME]`, the world-state block or the style
  block, under any variable values;
- the system half still ends with the chapter summaries;
- a new test for `buildUserPrompt` covering: block order in the tail, the short-story edge case, and
  that the entry chosen as Current Action is unchanged by the detachment.

The reason to pin all of this is the one already written in that file: reversing the order breaks
nothing visible, it just quietly costs thousands of tokens of reprocessing every turn.

### 4.6 Verify against the real backend

Reproduce the measurement in §1 after the change: export a debug log with two consecutive narrator
turns, replay both through `/v1/chat/completions` with `max_tokens: 1`, and read
`usage.prompt_tokens_details.cached_tokens`. Expected: 0 → ~13,900 on `llama-server`.

---

## 5. Out of scope, recorded so it is not lost

- **Real `user`/`assistant` turns for Recent Story.** Would put a checkpoint at every turn boundary
  and lift `llama-server` reuse from ~14k to ~30k tokens. Rejected for now: it changes the message
  shape the model sees, which is a narrative-quality change that has to be measured on its own, and
  it interacts with `stripPicTags`, the `[ACTION]`/`[NARRATIVE]` prefixes and the priming message.
- **Feeding the previous turn's reasoning back in.** There is no third channel: the modern shape is
  a reasoning content part on an `assistant` message. Blocked on the point above (the app sends no
  assistant messages at all), and on the fact that providers requiring verbatim round-trip
  (Anthropic's signed `thinking` blocks) cannot accept the plain text stored in
  `story_entries.reasoning`.
