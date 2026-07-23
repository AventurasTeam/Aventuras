# Piggyback contract

The narrative model emits a structured trailing block alongside its
prose, in the same generation call. This block carries the per-turn
fast-mutating subset of state mutations.

## What piggyback writes

| Surface                                                      | Source       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `story_entries.metadata.sceneEntities`                       | LLM-emitted  | Entity IDs present in this entry's scene (characters, items). Bracketed-ID prompt format gives the LLM stable handles.                                                                                                                                                                                                                                                                                                                                                |
| `story_entries.metadata.currentLocationId`                   | LLM-emitted  | The singleton location entity that IS the current scene. Only ever an _existing_ entity's id — a location introduced this turn that doesn't exist yet as an entity leaves this field unchanged (stale/null) until the periodic classifier creates it; retrieval for that location is degraded for a few turns, same accepted tolerance as [new-character introduction](../parked.md#early-classifier-trigger-on-new-entity-introduction-introducednewrelevantentity). |
| `story_entries.metadata.worldTime`                           | LLM-emitted  | Seconds delta added to previous entry's `worldTime`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `story_entries.metadata.summary`                             | LLM-emitted  | Optional one-sentence enrichment for the next turn's Q2 structural digest; absent on parse failure or restart is fine.                                                                                                                                                                                                                                                                                                                                                |
| `entities.state.visual.*`                                    | LLM-emitted  | One full-replace value per visual category (`physique` / `face` / `hair` / `eyes` / `attire` / `distinguishing`) — never a partial edit of the category's existing text.                                                                                                                                                                                                                                                                                              |
| `entities.state.equipped_items` / `inventory` / `stackables` | LLM-emitted  | Structured item / stackable transfers between holders — see the tagged format below, not free text.                                                                                                                                                                                                                                                                                                                                                                   |
| `entities.state.current_location_id` (per-character)         | **Computed** | If character ∈ `sceneEntities`, set to scene's `currentLocationId`. Otherwise preserve `lastSeenAt.locationId`. No LLM extraction needed.                                                                                                                                                                                                                                                                                                                             |
| `entities.state.lastSeenAt`                                  | **Computed** | When a character was in `sceneEntities` last turn but isn't this turn, update `lastSeenAt` from the previous entry's metadata.                                                                                                                                                                                                                                                                                                                                        |

State that doesn't need an LLM to compute, shouldn't. Per-character
`current_location_id` and `lastSeenAt` derive cleanly from
scene-presence deltas.

## Trailing block format

A tagged block at the END of the narrative output, not interleaved.
Tagging beats raw JSON for parse robustness across models that don't
have a strict structured-output mode. Reference shape — IDs in the
emission are **placeholders**, not the underlying UUIDs (the
substitution layer swaps both directions; see
[`generation-pipeline.md → ID placeholder substitution`](../generation-pipeline.md#id-placeholder-substitution)):

```xml
<state>
  <scene_entities>c1, c2</scene_entities>
  <current_location>l1</current_location>
  <world_time_delta>120</world_time_delta>
  <visual_changes>
    <entity id="c2" type="attire">cloak now muddied to the waist</entity>
  </visual_changes>
  <transfers>
    <item id="i1" to="c1" from="c3" slot="inventory" />
    <stackable key="gold" amount="50" to="c1" from="c3" />
  </transfers>
  <summary>Aria pushed into the marshes; met an exiled noble who recognized House Eldrin's sigil.</summary>
</state>
```

`c1`, `c2`, `c3` are placeholders for characters; `l1` for a
location; `i1` for an item. The prompt's structured entity list maps
each placeholder to a name in the LLM's view; the LLM emits the
placeholder verbatim, and parse swaps it back to the underlying
`char_<uuid>` / `loc_<uuid>` / `item_<uuid>` before the action layer
fires.

**`visual_changes` is full-replace, one entry per changed category.**
`type` is one of the `visual.*` keys (`physique` / `face` / `hair` /
`eyes` / `attire` / `distinguishing`); the tag's text wholesale
replaces that category's current value — never a partial edit, and
never an array (see
[`data-model.md → CharacterState shape`](../data-model.md#characterstate-shape)
for why `distinguishing` is a single string here too, not a list).

**`transfers` is structured, not free text** — both sub-tags only
ever reference **already-existing** entities (piggyback creates no
rows, so an item mentioned for the first time can't be transferred
until the classifier has created it as an entity):

- `<item id="..." to="..." from="..." slot="equipped_items | inventory" />`
  moves a unique item between character inventories. `from` is
  optional (omitted = no specific prior holder tracked, e.g. picked
  up loose).
- `<stackable key="..." amount="..." to="..." from="..." />` moves a
  quantity (gold, arrows, supplies) between characters' `stackables`
  records. Either `to` or `from` may be omitted (gained from
  nowhere tracked / spent on nobody tracked).

This grammar is pinned (Slice 3.2 planning, 2026-07-20); the
principle behind it is "tagged-block alongside prose, parsed
best-effort per top-level tag, code-template fallback per field on
parse failure."

## Parse strategy and failure recovery

The trailing block is parsed by isolating each top-level tag's inner
text independently (segment isolation, not a general XML parser) —
tolerant by construction, since a missing or unterminated tag simply
yields whatever text is present rather than failing the whole block.
`jsonrepair` is used narrowly, only to coerce a single scalar field's
decorated text (e.g. `<world_time_delta>`) into a valid number; it is
not a document-level repair pass, and the block is XML-shaped, not
JSON.

If a top-level tag parses, its fields are used. If a tag is missing
or its content doesn't parse, that field is skipped for this turn —
per-field best-effort, one failing tag never blocks another.

**On any parse failure** — the whole `<state>` tag missing, or any
field inside it failing — the same synchronous per-turn classifier
pass described in [Capability gate](#capability-gate) fires for this
turn, in the same pipeline run as the narrative call that produced
the malformed block (same `action_id`, same hard gate — never a
separate background pass). This replaces an earlier draft of this
doc's claim that "the periodic classifier eventually picks up the
prose mention": the periodic classifier never writes any of
piggyback's fields (disjoint write-set, see
[`cadence.md → Concurrency`](./cadence.md#concurrency)), so it could
never have recovered them — a parse failure needs the per-turn
classifier, not the periodic one, exactly like a `piggybackMode='off'`
turn does.

## Auto-promote on staged-ID emission

When piggyback's `sceneEntities` contains an entity ID currently at
`status='staged'`, that's a strong signal of intentional introduction.
Piggyback processing auto-promotes the entity to `status='active'`
inline, in the same `action_id` as the turn's other writes. Single
delta, fully reversible if the user rolls back the turn.

This is the **fast path** to staged promotion. The
[slow path](./edge-cases.md#staged-entity-promotion) via the periodic
classifier covers cases where prose introduces a character without an
explicit ID emission.

## Capability gate

Piggyback's gate is the narrative model's **empirical reliability
emitting tagged trailing blocks at narrative-generation
temperatures** — not its structured-output capability. Forcing a
strict structured-output mode would lock the entire response to a
JSON schema and conflict with the prose narrative the same call
must produce; it can't be the mechanism here. The actual signal
is whether the model reliably appends a parseable tagged block
after the prose without breaking the narrative flow.

We track this via the standard provider-capability path:
`app_settings.providers[].cachedModels[].capabilities` carries a
flag for tagged-block reliability, populated from our curation +
detection and overridable by the user (capabilities are always
user-overridable — providers report inconsistently, and custom
endpoints may run models the provider's metadata doesn't
recognize). Story Settings exposes a
`piggybackMode: 'on' | 'off'` toggle — on by default when the
narrative model's capability flag is set.

The per-turn classifier pass fires whenever piggyback didn't
successfully write its subset this turn — two triggers, same
mechanism:

- `piggybackMode='off'` or the capability flag is unset — fires
  every turn, since piggyback never attempts to fire at all.
- `piggybackMode='on'` and the flag is set, but this turn's trailing
  block fails to parse — fires for that turn only, synchronously, in
  the same pipeline run (see
  [Parse strategy and failure recovery](#parse-strategy-and-failure-recovery)).

No curation/detection pipeline for the capability flag exists yet —
until one does, every model resolves to the first bullet.

**Delta provenance distinguishes the two paths.** The direct
tagged-block path stamps its deltas `source = piggyback_tagged_block`;
the per-turn fallback classifier stamps `source = per_turn_classifier` —
a distinct value from the periodic (background) classifier's
`source = periodic_classifier`, since it's neither the narrative
model's own inline emission nor a lagging background pass. It always
shares the triggering turn's `action_id`, so CTRL-Z sweeps it with
the rest of the turn like any foreground delta (see
[`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)).

**worldTime re-roll only applies to the classifier paths, not the
direct tagged-block path.** Both the periodic classifier and this
slice's per-turn fallback classifier are isolated structured-output
calls, so on a negative `worldTimeDelta` they re-roll the whole call
once before falling back to clamp-and-warn
([`architecture.md → Classifier contract — metadata fields`](../architecture.md#classifier-contract--metadata-fields)).
The direct tagged-block path can't do this cheaply — the delta rides
the same call as the narrative prose — so it clamps immediately on a
negative delta, no re-roll.

## Mode-mixing across a story

Switching `piggybackMode` mid-story is fine. The data shape is
identical; only the agent that writes which fields differs. Going
piggyback → split rights itself in one turn (next turn's classifier
pass writes the subset piggyback would have). Inverse path is similarly
clean. No retroactive re-extraction.
