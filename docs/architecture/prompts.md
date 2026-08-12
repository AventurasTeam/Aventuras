# Prompts

Where prompt text comes from, and the order it is assembled in.

## Prompt Packs and Template Resolution

Every prompt the app sends is a Liquid template. The code baseline lives in
`src/lib/services/prompts/templates/`; at runtime templates are served from a **prompt pack** stored in
SQLite, which the user can edit in the Vault.

Resolution order (`ContextBuilder.resolveTemplate`), first hit wins:

1. the active pack's own row
2. `default-pack`'s row
3. the compiled-in baseline in `PROMPT_TEMPLATES`

A template has a system half (`content`) and an optional user half (`userContent`). The user half is
stored under the id `<template-id>-user`, and `ContextBuilder.render(id)` returns `{ system, user }` by
resolving both. A service that destructures only `system` silently drops the user half — every service
except the two whose templates deliberately have none.

### Which pack is "the active pack"

There is no ambient one. A pack is chosen per story (`stories.pack_id`), and the wizard holds its own
selection until the story it is building exists. A `ContextBuilder` therefore has to be told, and there
are three ways to build one:

| Factory                          | Use when                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| `ContextBuilder.forStory(id)`    | the template also wants story variables (mode, pov, protagonist, …)   |
| `ContextBuilder.forPack(id)`     | the service populates its own context and needs only the pack         |
| `ContextBuilder.forPackId(pack)` | the wizard and the Vault, which hold a pack but no story              |

`forPack` skips `forStory`'s entity loads but still resolves pack variables and per-story overrides, so
a user's custom variable works in any template. Neither factory throws: several callers build their
context outside the `try` guarding the model call, and losing a customization must not cost the turn.

**The `storyId` argument is required, never optional.** `undefined` is a legitimate value — outside a
story — but it has to be passed. This is the whole defence: an optional trailing `storyId?: string` type-
checks when omitted, and every prompt rendered without one silently resolves against `default-pack` while
the user's chosen pack sits unused. Nothing in the output says so. Where the parameter would otherwise
land behind an optional one, it goes **first** rather than becoming optional itself.

Image style templates and the interactive-lorebook tool template are external — raw text, never rendered
through `ContextBuilder` — but they live in a pack and resolve the same way, through
`resolveStylePrompt(storyId, styleId)` / `resolveStylePromptForPack(packId, styleId)` in
`services/ai/image/stylePrompt.ts`. The Vault is global and has no story, so it resolves against
`default-pack` by design.

`PackService.initialize()` does two distinct things on startup, and they are not interchangeable:

- **`refreshDefaultPackTemplates`** updates `default-pack` when the code baseline changes, so shipped
  prompt improvements reach existing installs.
- **`backfillMissingTemplates`** inserts templates _added_ by a later app version into every pack, so the
  user has something to open in the editor. Custom packs are never otherwise auto-updated.

**Never overwrite a user's edit.** `pack_templates` carries both `content_hash` (the hash of what is
stored) and `baseline_hash` (the hash of the baseline it was last written from). They are equal while a
template is untouched and diverge the moment someone saves an edit, and only `PackService` writes
`baseline_hash` — `database.setPackTemplateContent` takes a required `isBaseline` flag to force the
distinction at every call site. The refresh skips any row where the two differ. Comparing the stored
content's own hash against the baseline instead, as it once did, reads every user edit as a stale default
and reverts it on the next app start.

## Prompt Ordering and Prefix Caching

Inference servers reuse the KV cache for the longest prefix a request shares with the previous one, and
reprocess everything after the first differing token. **Prompt templates are therefore ordered by how
often each block changes, not by how the prompt reads.** Stable material first, volatile material last.

This is not cosmetic. On a 40-chapter story the narrator prompt is ~156k characters, of which the chapter
summaries are ~54k and byte-identical between turns; with the per-turn world state in front of them, the
reusable prefix was 3.6% of the request. The same inversion cost the retrieval agent, the classifier and
both Tier 3 selections their entire prefix — two consecutive classifier calls shared 201 characters of
40,000.

Two consequences worth knowing before editing a template:

- The system message is sent before the user message, so a divergence inside the system prompt
  invalidates the user message too, however stable that is on its own.
- Instructions belong at the end anyway, which is also where the volatile content wants to be. The two
  goals rarely conflict.

`src/lib/services/prompts/templates/narrative.test.ts` pins this ordering, since reversing it breaks
nothing visible — it just quietly costs thousands of tokens of reprocessing every turn.

**Ordering is necessary but not sufficient, and on some servers it buys nothing.** "Reuse the
longest shared prefix" is the ideal; a real server may only reuse a prefix it can reach without
_truncating_ a cached state. Measured against `llama-server` with a sliding-window model (Gemma 4):
a prompt that extends a cached one reuses everything, a prompt that diverges a few thousand tokens
from the end still reuses everything, and a prompt that diverges ~8k tokens or more from the end
reuses **nothing at all** — the whole request is reprocessed. `--ctx-checkpoints` /
`--checkpoint-min-step` did not move that boundary.

The consequence for template authoring is stronger than "stable first": the volatile block has to be
_near the end_, not merely after the stable one. The narrator prompt currently diverges at
`</story_history>` — about 37% in — because `[CURRENT STORY TIME]` and the per-turn world state sit
in front of ~30k characters of otherwise byte-identical lorebook and scene material. That 37% is
what the ordering bought; on a truncation-averse server it is also 37% too early to be worth
anything.
