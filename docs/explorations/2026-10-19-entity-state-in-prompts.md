# Entity state in prompts

Resolves "Entity state in the narrator's prompt" in
`followups.md → Data-model`, raised by the factions design. The commit
that lands this record adds an implementation entry: the design is
settled, the code is not.

The spec lives in
[`architecture.md → Entity state on the template surface`](../architecture.md#entity-state-on-the-template-surface)
(the view, its references, the bundled macro),
[`memory/retrieval.md`](../memory/retrieval.md) (the floor's new seats,
the measured text, the oversized-candidate warning) and
[`memory/piggyback.md`](../memory/piggyback.md) (what the writer sees,
the visual and stackable writes). What follows is why.

## What this closes vs. defers

Closes:

- **State in the generation prompts.** Every entity the narrator, the
  fallback and suggestion refresh show with a description now shows
  its state, and so do the items a character holds and the items lying
  at the current location.
- **Blind writes.** A visual change or a stackable transfer can name
  any character the prompt brackets; each of them now shows the values
  the write replaces.
- **State on the template surface**, for built-in and custom packs.
- **An in-scene character's faction**, which the followup left open:
  seated on the floor.
- **The triage entry on held and loose items rendered as elsewhere.**

Defers:

- **Implementation**, to a standalone PR (the followups entry).
- **Budget defaults**, a new followup: the entity budget is a
  placeholder, a fully described character can outgrow it, and nothing
  checks a prompt against the model's window.
- **The periodic classifier's and the wizard's contexts**, unchanged:
  the classifier writes only `faction_id` and already sees it, and the
  wizard's `cast` already exposes state.

## Ground truth that shaped it

- **Every bracketed character is a write target.** A visual change's
  id and a transfer's holders resolve against the whole branch
  (`lib/piggyback/substitute.ts`), and the apply step checks only that
  the target is a character (`lib/piggyback/apply.ts`). Pinned and
  ranked characters carry ids whenever piggyback fires, in the narrator
  and the fallback alike.
- **The writes were blind.** The writer emitted a visual change as the
  full new value without seeing the current one
  (`lib/prompts/bundled/state-emission.ts`), so the wizard's or the
  user's text for a category was lost on the first change, and moved
  stackables without seeing a balance.
- **An over-long visual value was cut silently.** At 500 UTF-16 units,
  mid-word, unlogged, and the writer was never told the limit.
- **A stackable shortfall created money.** The payer clamps at zero
  while the payee gains the full amount.
- **The user-authored fields reached no generation prompt.**
  `PROMPT_ENTITY_FIELDS` kept `state` off the template surface, so
  `traits`, `drives`, `voice`, `condition`, `standing` and `agenda` were
  written by the wizard and the user and read by nothing.
- **Out of scene, `current_location_id` is the last-seen place**
  (`lib/piggyback/scene-tracking.ts`), and `heldItems` covers in-scene
  holders only, so an elsewhere character had no location or holdings
  in any variable.
- **A held item's description never reached the prompt.** The floor
  seats it when it is in the scene, and the in-scene loop skips it
  because its holder's `Holds:` line names it, by name only. One
  outside `sceneEntities` stays poolable, and can be ranked as
  "currently elsewhere" while `Holds:` shows it in hand
  (`lib/retrieval/pools.ts`).
- **Canon keeps formatting in Liquid.**
  [`architecture.md → Macros`](../architecture.md#macros--reusable-liquid-snippets-not-code-side-formatters)
  rules out code-side formatters, while a ranked row printed a
  code-built string.
- **`entityRenderedText` feeds the ranker and keyword injection, not
  embeddings**, so state in it leaves "state is excluded from
  embeddings" true.
- **Budget fill skips a candidate larger than its whole type budget
  permanently.**
- **Nothing compares a generation prompt against the model's window.**
  `maxInputTokens` is read by the embedder only.

## Decisions

**A correctness fix.** Writes replaced and moved values their writer
couldn't see; the user-authored fields fed nothing. Rejected: treating
it as prompt enrichment to tune later.

**State reaches every template, built-in and custom, as a view.** A
custom pack may format entity data its own way; the app doesn't dictate
the display. The surface stays a projection: per kind, references
resolved, caches left out. Rejected: the raw column, which carries
`lastSeenAt.entryId` (a raw entry id ID substitution doesn't cover),
bare id arrays and caches, and makes every future state field part of
the surface.

**One reference shape, `{ id, name, status }`.** A faction's members
too: their names are narrative context, and a template wanting a
member's whole character finds it in `entities` with one `find`.
Rejected: full characters embedded in members, which splits the rule
into deep and shallow references and breaks the measurement premise
below for factions, where a template printing full members renders
thousands of tokens against a measured fifty.

**An entity shows its whole view wherever the prompt shows its
description.** A retrieved entity is as verbose as an in-scene one, so
a narrator bringing it on stage has its look, voice and holdings. This
also settles the writes: with every bracketed character showing its
values, nothing needs to restrict which characters a write may name.
Holdings and loose items expand the same way. Rejected: visuals only on
elsewhere rows; restricting writes to in-scene characters, which drops
an arriving character's change.

**Disabled means absent.** A disabled entity doesn't exist narratively:
it's left out of every other entity's references, unless the
active+in-scene invariant seats it, where the prose already put it on
stage. Contradictions a disabling creates are the user's call.
Rejected: a disabled reference by name, which leaks a disabled faction
through every member; disabled winning over the invariant, which hides
an item the reply just put in the scene.

**Measure a code mirror of the bundled row (approach 1).** A ranked
row renders through the macro from its view; its measured text is
built in code to mirror that row; a test pins the two exactly. Most of
a row's tokens are the entity data any rendering prints, so a custom
pack's formatting is a small difference the pack owns. Rejected: code
rendering the block for the bundled templates to print, exact but
taking the built-in format out of the pack against canon's formatting
rule; the ranker rendering the active pack's macro, exact for custom
packs but making retrieval depend on the template engine and on a
user's macro rendering.

**The floor stays unbudgeted, and seats more.** It takes what the scene
structurally needs and the per-type budgets apply to what's left. It
now also seats in-scene characters' factions and the items it renders
under holders and as lying here.

**Seat in-scene characters' factions.** A character's agenda shapes
how they act now, and the ranker would weigh their faction against
full character rows. Bounded by the distinct factions in the scene.
Rejected: leaving them to the ranker. An active faction also loses its
"currently elsewhere" framing, meaningless for something never in a
scene.

**The writer restates; an overflow is cut at a clause and logged.**
Shown the current value, the writer writes the category as it is now
in about 60 words, about 360 characters: a margin under the 500 limit
that 80 words, the first figure, didn't leave. Rejected: raising the
cap, which takes a character's worst case from about 750 tokens to
about 3000 and still needs the instruction; rejecting an over-long
change, which leaves the stored look contradicting the prose.

**A stackable shortfall keeps the prose true for the payee.** The payer
clamps at zero, the payee gains the full amount, the shortfall is
logged. Rejected: conserving, which gives the payee less than the prose
did; dropping the transfer.

**Suggestion refresh follows the rule.** Holdings, stackables and
drives make better chips, and one macro serves every generation prompt.
Rejected: keeping its thin block, a second entity rendering to
maintain.

## Adversarial pass

- **Load-bearing: the pin test.** If the mirror and the macro drift, a
  type overruns its partition silently. The test renders every kind and
  edge (empty fields, holdings, members, disabled and retired
  references) and requires exact equality.
- **Measured and rendered views.** The ranker reads the floor's scene,
  the generation context the entry's metadata. A ranked row carries the
  view it was measured with, so the two can't diverge.
- **Oversized rows vanish.** At the 1200 default a fully described
  character can outgrow the entity budget and be skipped permanently:
  the characters the user invested in most. The warning makes it
  visible; the budget followup carries it.
- **No window check.** A heavier floor makes overflow likelier on a
  small-window model. How a provider's overflow error surfaces is
  unverified.
- **Double rendering.** Seating held and loose items closes the triage
  entry and keeps an `always` held item from rendering twice, since the
  pinned-row pass skips a seated row.
- **Retrieval failure.** With no floor, the in-scene block still
  renders from `entities` with views; seated factions and `Here:` are
  absent, as the current location is today.
- **Large factions.** Seated, a faction's member names cost unmeasured
  tokens; ranked, they're measured.
- **Model behaviour, unverified.** Nobody has played this. Three
  assumptions ride on the model: it restates rather than appends, it
  keeps to the word bound, and full elsewhere rows don't pull those
  characters on stage. The cut and shortfall warnings measure the first
  two; the third has no signal but play.
