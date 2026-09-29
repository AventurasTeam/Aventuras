# Narration Cleaning

What a model reads when a service hands it the story's own text, and how much of the narrator's
markup it is spared.

Narration is written for a reader, not for a model. An entry can carry three kinds of markup:

- **`<pic prompt="…">` tags** of 50–150 words each, when inline images are on.
- **Visual Prose HTML** — `<p>`, coloured `<span>`s, `<style>` blocks, `<div>` wrappers — when
  the story uses it.
- **Layout** — `### Time | Place` headers, `***` / `---` rules, bold heading lines.

A service that sends `entry.content` unchanged sends all of it. The narrator strips `<pic>` from
its own history when inline images are off (`NarrativeService.ts`), and the classifier has its own
helper. Everything else reads raw content.

## Why the Style Reviewer cleans its input

The Style Reviewer judges prose habits, and given raw entries it judges the markup too. Its
findings are injected into the narrator's system prompt as `<style_guidance>`, so a finding about
markup becomes an instruction to the narrator.

An experiment ran the `style-reviewer` template on 32 narration entries of one real story, in five
conditions (plain prose, plus HTML, `<pic>`, layout and layout-with-`stripNarratorMarkup`
overlays), three runs each, on 9 reviewers:

- **No plain-prose finding was contaminated** for any reviewer (0 of 224). Every markup condition
  produced contaminated findings, meaning findings that quote tags, class names or header text,
  or cite text that exists only in the markup.
- **`<pic>` tags did the most damage** to the cheaper models: 19 of 325 findings, in 8 of 24 runs.
  Those models read the image prompts as prose ("dark fantasy art style", "weeping eye motif") and
  reported them as overused. The narrator would then be told to vary words it can only write
  inside `<pic>` tags. `<pic>` also grew the input by 44%.
- **Sonnet treated the markup itself as a habit**: a copy-pasted CSS block, every image prompt
  ending "…dark fantasy … style", `***` used as a structural tic.
- **Header text survives a strip of the marker characters.** With the `###` and `**` gone, Sonnet
  still flagged one-word mid-passage headers ("Bones", "The Backlash") in three of three runs.
- **Real findings were not displaced.** Recall of each reviewer's own plain-prose findings was flat
  across conditions.

The results are directional: one story, model-written overlays, three runs per cell, lexical
scoring (so contamination rates are a lower bound), and no run with the app's default model.

## Benefits

- One tested implementation of what was three partial ones.
- The mode for each kind of markup is chosen per service by a preset, so a service that needs the
  time and place in a header can keep it.
- It runs in code, so it works on every model and needs no prompt-pack migration.
- The functions are pure and live in a plain `.ts` module, so tests can import them.

## Options

`src/lib/utils/narrationClean.ts` exports `cleanNarration(content, options)` and
`narrationCleaner(options)`, which returns a `(content) => string` that fits `recentContent`'s
`transform`. `options` holds one mode per kind of markup:

| Mode     | Meaning                                    |
| -------- | ------------------------------------------ |
| `keep`   | leave it as written                        |
| `unwrap` | drop the markup and keep the text          |
| `remove` | drop the markup and the text it carried    |

| Option           | Modes                        | Acts on                                            |
| ---------------- | ---------------------------- | -------------------------------------------------- |
| `pic`            | `keep`, `remove`             | `<pic>` tags, prompt included                      |
| `html`           | `keep`, `unwrap`             | HTML tags; `<style>` and `<script>` always go whole |
| `headings`       | `keep`, `unwrap`, `remove`   | `### …` lines                                      |
| `boldLines`      | `keep`, `unwrap`, `remove`   | lines that are one `**…**` span end to end         |
| `rules`          | `keep`, `remove`             | `***`, `---`, `___`                                |
| `inlineEmphasis` | `keep`, `unwrap`             | `*italic*` and `**bold**` inside a sentence        |

An option offers only the modes that mean something for it. A `<pic>` prompt and a rule have no
prose to unwrap, and `html: 'remove'` would delete all the text. The keys are in stage order.

Three presets:

| Preset                      | Differs from `CLEAN_NONE`                                                     |
| --------------------------- | ----------------------------------------------------------------------------- |
| `CLEAN_NONE`                | — every option `keep`; returns its input unchanged                            |
| `CLEAN_FOR_REVIEW`          | `pic: remove`, `html: unwrap`, `headings: remove`, `boldLines: remove`, `rules: remove` |
| `CLEAN_FOR_CLASSIFICATION`  | as `CLEAN_FOR_REVIEW`, but `headings` and `boldLines` are `unwrap`            |

`inlineEmphasis: 'unwrap'` is implemented and tested, but no preset uses it yet.

| Service        | Preset             |
| -------------- | ------------------ |
| Style Reviewer | `CLEAN_FOR_REVIEW` |

The Style Reviewer's passages come from `buildReviewPassages`
(`services/ai/generation/styleReviewPassages.ts`), which cleans each entry, skips one that cleans
to nothing, and numbers the rest.

## The Clean Input toggle

Advanced Settings has one switch for the Style Reviewer, **Clean Input**
(`systemServicesSettings.styleReviewer.cleanInput`, default on). It is there so a regression in the
cleaner can be routed around without a release. Off means `CLEAN_NONE`, which runs through the same
`buildReviewPassages` path rather than a second branch. The individual stages are not exposed.

- **Default and load.** The loader merges the saved block over the defaults, so a save from before
  the field existed reads as on. It needs no migration.
- **Reading it.** `createStyleReviewerService` in `ai/core/factory.ts` passes the value into the
  service's constructor, as it does for the classifier's window, and a service is built per call,
  so a change applies to the next review.
- **It can be reset.** `applyDefaultsIfUnchanged` replaces the whole system-services block with
  defaults after a default-profile change, when the model, temperature and reasoning effort still
  match the defaults. A user who turned the switch off and kept default models is put back on by
  that. Every other field in the block behaves the same way.
- **Only the Style Reviewer has one.** The other consumers have no evidence behind them yet.

## Constraints

- **Keep it a plain `.ts` module.** A `*.svelte.ts` file cannot be imported by a test
  ([testing.md](../development/testing.md)), and the strip is exactly the kind of logic that
  needs one.
- **Stage order is fixed**: `<pic>`, HTML, headings / bold lines / rules, inline emphasis,
  whitespace. `<pic>` goes first because a prompt can contain `<` and `>`. HTML goes before
  layout, so `<p>### Header</p>` becomes a real line start. Inline emphasis goes after bold-line
  detection, or it would erase the `**` that marks a bold heading.
- **The HTML strip matches real element names only.** Visual Prose may emit any element, so the
  list is the full HTML set, but `<Kael>` in prose is text and stays. A tag is also never allowed
  to swallow a stray `<` up to a later `>`.
- **Entities are decoded once, last**, after all tag matching, so a decoded `&lt;b&gt;` stays
  literal text.
- **Idempotence is not universal.** It holds for the tested fixtures, but text that contains
  entity-encoded markup changes again on a second pass (`&amp;lt;` decodes to `&lt;`, which
  decodes again). Clean once, from the raw content.
- **A new consumer picks its preset deliberately.** The reviewer does not want header text; the
  classifier does, because the hour and place are what its scene fields are for.

## Non-obvious effects

- **Header text is content, not markup.** That is why the reviewer's preset removes headings
  instead of unwrapping them: removing only the `###` characters still left the reviewer a line
  to criticise.
- **In-world HTML text is prose.** A sign written as `<div><h2>The Rusty Anchor</h2>…</div>` is
  something a character reads. Only its tags go.
- **A short, unpunctuated bold line is a heading; anything else is emphasis.** With
  `boldLines: 'remove'`, a bold line goes only if it is eight words or fewer and does not end in
  `.`, `!`, `?`, `…` or a quote. `**The Backlash**` goes; `**NO.**` is kept, with its `**`
  removed. `unwrap` never removes a line.
- **`<em>` / `<strong>` become `*` / `**`, and italics are kept.** Emphasis overuse is a real
  style finding, so `CLEAN_FOR_REVIEW` leaves inline emphasis alone.
- **An entry that cleans to nothing is skipped before the window is taken.** A `<pic>`-only
  entry does not use up one of the reviewer's `recentEntriesCount` slots, so the passage count and
  `reviewedEntryCount` can be lower than the entries fetched, and the numbering follows the
  passages actually sent.
- **The cleaning also protects the narrator.** The review feeds `<style_guidance>`, and a
  degenerate review (one run returned 120 findings, padded with near-synonyms) puts every finding
  into the narrator's system prompt. Cleaning removes one trigger of that; it does not cap it.

## Using it in another service

1. Pick one of the presets, or define a new options object next to them.
2. Pass `narrationCleaner(preset)` as `recentContent`'s `transform`, or map entries through
   `cleanNarration` directly.
3. Add a test that the passage the model receives has the markup you meant to drop.

## Not done yet

- **Other consumers.** Suggestions, Action Choices, Memory and the `recentContent()` callers
  (tier 3, agentic retrieval) still send raw content. Only the Style Reviewer has evidence.
  `pic: 'remove'` is the likely safe default for all of them; whether they should drop headers
  needs deciding per service, since Memory and timeline filling read the time and place.
- **A cap on injected phrases.** `formatForPromptInjection` injects every phrase a review
  returns. Capping or de-duplicating them would bound a degenerate review.
