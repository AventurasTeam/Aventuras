# Dialogue Detection and TTS

`src/lib/utils/dialogue.ts` is the only definition of "this text is a spoken line",
and two unrelated-looking features read it: the story renderer colours dialogue, and
the TTS pipeline can speak it in a second voice. Written as two regexes they would
drift apart at the first edge case, so both go through `matchDialogueAt`.

It recognises `"…"`, `“…”` and `«…»` — the guillemets are not decoration, translated
narration comes back with them. Single quotes are excluded (`don't`, `l'uomo`), as is
an unterminated quote, which is also what keeps a streaming line neutral until its
closing quote arrives instead of flickering.

**A dialogue span never crosses a blank line.** On the renderer side that is free —
marked's inline lexer works per block — but the TTS path segments the whole entry at
once, where one unterminated quote would otherwise swallow half a scene into the
character's voice. The rule lives in the shared core so the two paths agree by
construction rather than by coincidence.

**An HTML tag is stepped over whole, and this is not the renderer's protection.** The
`marked` extension runs at tokenizer level, which is often described as making it
immune to a quote inside an attribute — but that only ever covered the quote that
_opens_ a span. The extension runs before marked's `tag` tokenizer, so an unterminated
quote in prose would close on the next `class="`, splitting the tag: half escaped into
text, half left as a stray end tag, and a `<pic prompt="…">` mangled that way is no
longer recognised, so its image vanishes from the entry. Meanwhile the two _scanners_
(`dialogueSpans`, `segmentDialogue`) have no tokenizer in front of them at all and will
happily open a span on `class="x"`, which is a well-formed pair read on its own — that
is how an attribute value reaches the dialogue voice, and why Visual Prose forces tag
removal below. `matchDialogueAt` therefore skips tags rather than stopping at them, so
raw HTML _inside_ a quote still renders as HTML while attribute quotes stop being
candidates everywhere at once.

Colouring is emitted unconditionally as `<span class="dialogue-line">` and gated
entirely in CSS (`data-dialogue-highlight` plus `--dialogue-color` on the root), so
flipping the toggle or dragging the colour picker repaints without re-rendering a
single story entry. The per-entry `.dialogue-highlight` class carries the story's
`visualProseMode`, which is what keeps the feature off there — including for player
actions, which are plain markdown even in a Visual Prose story.

**An embedded image marker and a quote can overlap, and the image pipeline has to
give ground.** `processUnified` lifts each agentic marker's text out of the content
before rendering and splices it back afterwards, so text inside a marker never
reached the renderer at all — markdown in there stayed literal, and a quote stayed
uncoloured. Two consequences, both fixed in `ImageEmbeddingService`:

- Marker text is now rendered rather than spliced back raw, through a renderer the
  caller supplies — inline story markdown for the markdown path, and identity for
  Visual Prose, whose marker text is already HTML.
- `snapMarkersToDialogue` widens any marker that would end mid-quote. Half a quote is
  an unterminated one, which is deliberately not dialogue, so the line lost its
  colour with nothing on screen to explain why. It widens rather than trims because a
  `sourceText` is often mostly dialogue and trimming can cut an image's anchor down to
  a few words. A marker that cannot grow without colliding with another is left
  untouched: overlapping markers corrupt both replacements, which is worse. Checking
  the grown marker against the _original_ others is enough, and not by luck: the
  widening loop runs to a fixed point, so a marker ends up closed under every span it
  touches — which makes it impossible for two grown markers to overlap without at
  least one also reaching an original.
- Snapping is off for Visual Prose and for `getPlacedImageIds`, via `snapToDialogue`.
  Visual Prose content is generated HTML where dialogue is not a concept, and widening
  cannot change _which_ images are placed, only where.

The colour yields inside an image marker whose status is not `complete`. Those markers
say _generating_, _pending_ or _failed_ in their colour, and a widened marker is mostly
quote by design, so the dialogue colour would repaint away the only signal the status
has.

For TTS the voice is a property of each **chunk**, not of the call
(`TTSSegment` in `TTSService.ts`). Playing narrator and dialogue as separate
`streamAndPlay` calls would restart the producer/consumer queue at every quote — an
audible gap per line — and would leave `stopAudio` able to stop only the segment
currently sounding. As chunks, the existing pipeline, retry and progress are unchanged.

Two order-dependent rules, both silent when broken and both covered by
`ttsText.test.ts`:

- **Sanitize, then split, then drop excluded characters.** Adding `"` to
  `excludedCharacters` is a legitimate way to silence the quote marks; run that filter
  before the split and it erases the very marks the split reads, collapsing playback
  to one voice with no error anywhere.
- **Visual Prose forces tag removal**, whatever `removeHtmlTags` says. That content is
  generated HTML with a `<style>` block, and the toggle defaults to false — so the
  reader otherwise hears markup read aloud.

`excludedCharacters` is compiled into a regex character class, which needs a stricter
escape than the shared `escapeRegex`: that one does not touch `-`, so a hyphen listed
between two other characters becomes a **range**. `'*, -, ~'` — an entirely reasonable
thing to exclude — compiled to `[\*-~]`, every printable ASCII character from `*` to
`~`, and erased the whole entry. It cannot be fixed in `escapeRegex` itself, whose
output also feeds unicode-mode patterns where `\-` outside a class is a SyntaxError.
An entry that comes out with nothing left to say now reports that rather than leaving
the play button to do nothing.

The Google Translate provider is excluded: its "voice" is a language code, so a second
one would read the dialogue in another language. `supportsDialogueVoice` is a single
predicate shared by the settings UI that hides the control and the playback path that
ignores the setting.
