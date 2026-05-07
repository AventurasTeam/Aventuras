# Edge cases and v1 limitations

Orthogonal corners of the design that don't fit cleanly under any
single layer's doc: name collision, staged-entity promotion,
retirement, cutaways, and the v1 limitations the design accepts and
documents rather than chases.

---

## Name collision and disambiguation

Two layers handle the case where the AI invents a character with the
same name as an existing (often staged) entity.

### Layer A — retrieval-time same-name suppression

Before injecting staged entities into the prompt, scan the recent
un-classified buffer prose for names matching staged-entity names. If
a staged entity's name appears in recent prose (signal: AI may have
just used or invented this name), **suppress that staged entity from
this turn's retrieval**.

The reasoning: surfacing a staged-namesake right after the prose used
the name creates collision risk in the LLM's next narrative. Safer to
keep the staged version off-context until the classifier resolves
whether the prose use is intentional (promote) or fresh (create new).

Reuses the entity-name index. Heuristic (text scan), not LLM.

### Layer B — code-side reconciliation at extraction

Per turn the classifier runs, when it extracts a "new character"
mention from prose:

1. **Name lookup** against the entity index. O(1).
2. **No name match** → genuinely novel character; create fresh.
3. **Name match found** → embedding similarity between extracted
   description and existing description.
   - **High** (`sim ≥ τ_high`) → promote staged → active OR treat as
     existing active mention. Update if the extract adds info.
   - **Low** (`sim < τ_low`) → create new entity, set
     `name_collision_flag = true`. Surfaces in the World panel for
     user review.
   - **Ambiguous** (`τ_low ≤ sim < τ_high`) → conservative create-new
     with the flag.

Tunable thresholds; defaults TBD empirically.

### Schema

```
entities {
  ... existing fields ...
  name_collision_flag INTEGER DEFAULT 0   -- 1 = review needed
}
```

Flag clears when the user resolves the collision (merge, rename, or
explicit "keep as distinct").

### Polymorphic naming — v1 limitation

Genuinely distinct same-name characters (multiple "Roberts" in a
story where both are intentional) require **manual user rename** of
one in the World panel. No schema-level support for two distinct
entities to coexist with the same name. Documented in
[`data-model.md → World-state storage`](../data-model.md#world-state-storage)
when this lands.

### The narrative-weirdness residual

Layer A suppresses most prompt-time collisions; Layer B cleans up
post-fact. The residual case where the AI sees both versions in the
same turn (rare with Layer A in place) and morphs one into the other
results in classifier-side reconciliation either promoting the staged
version (descriptions converge) or keeping them as distinct entities
with the flag for review. The narrative may have a brief inconsistency
("tavern keeper Eldrin became a noble Eldrin across two turns") but
the data layer stays consistent. User can rollback or merge to
resolve.

---

## Staged-entity promotion

Two paths to staged → active. Both converge on the same end state.

### Fast path — piggyback ID emission

When piggyback's `sceneEntities` includes an entity ID currently at
`status='staged'`, that's a strong signal of intentional introduction.
Piggyback processing auto-promotes inline:

1. Detect staged-ID in emitted `sceneEntities`.
2. Issue `UPDATE entities SET status='active'` with the same
   `action_id` as the turn's other writes.
3. Update `lastSeenAt` for the now-introduced character.

The wizard-authored description survives unchanged — first-introduction
description authorship is at the wizard, not the classifier.
[`data-model.md → Authorship contract`](../data-model.md#authorship-contract)
is preserved.

### Slow path — periodic classifier prose extraction

When prose introduces a character without piggyback emitting their
staged ID (model didn't pick up the available-staged hint, or the
user wrote the action introducing them):

1. Periodic classifier extracts the character mention from buffered
   prose.
2. Code-side reconciliation runs (see
   [Layer B](#layer-b--code-side-reconciliation-at-extraction)).
3. If the description matches a staged entity, classifier promotes via
   the standard status-flip path.

### Prompt framing

The retrieval inject for staged entities surfaces them with bracketed
ID handles:

```
Staged characters (introduce when narratively appropriate):
- [ent_lord_eldrin] Lord Eldrin: noble exiled to the marshes after political coup, seeks to reclaim his rightful place.
- [ent_queen_morwen] Queen Morwen: ruler of the eastern principality, secretly allied with the rebellion.
```

The narrative prompt instructs: "If you introduce any staged character,
include their bracketed ID in the trailing `<scene_entities>` block."
This gives the LLM the handle to drive the fast-path promotion.

---

## Retirement

### Hard signals only — periodic classifier

The periodic classifier retires `active → retired` only on
unambiguous prose evidence:

- Death (clearly final — "Kael's lifeless body" rather than "Kael was
  hurt").
- Explicit exile / banishment with no return-arc setup.
- Faction-disbanded / structural finality.

Conservative bias. Single-line ambiguous prose ("Kael wandered off")
does **not** trigger retirement.

### "Wandered off" stays active

Off-screen-but-alive characters stay `status='active'` with stale
`lastSeenAt`. Retrieval naturally deprioritizes them (off-scene means
subject to ranker, not structurally injected). World panel can dim
them at the display layer if desired. No fourth `inactive` status.

The `retired_reason` example list in
[`data-model.md → World-state storage`](../data-model.md#world-state-storage)
should be tightened to drop "wandered off" — that example contradicts
the hard-finality model and would mislead the design.

### Chapter-close lore-mgmt — deeper review

Across the closed range, can demote `active → retired` on chapter-scope
evidence ("character mentioned once in 50 turns; last seen leaving the
kingdom permanently") that single-prose-line periodic classifier would
(correctly) skip.

### Retired → active is user-only in v1

Resurrection / fake-death-reveal / return-from-exile are
story-significant moments where the user explicitly toggles via the
World panel. Agent-driven `retired → active` is parked-until-signal:
auto-resurrecting on weak prose has a much worse failure mode than
requiring a user click.

---

## Cutaways and multi-scene entries

A single entry whose prose includes a scene transition to a different
cast and location ("Meanwhile, in the throne room…") is a **v1
limitation**, not a feature.

The data shape carries one `currentLocationId` and one `sceneEntities`
per entry. The computed-location pattern assumes single-scene entries.
A meanwhile-cutaway entry produces:

- All off-scene characters retain prior `lastSeenAt` (they're not in
  this entry's `sceneEntities`), even though prose just placed them
  somewhere new.
- The new scene's location is captured in `currentLocationId` only if
  the model judges that the second scene is the entry's "primary"
  scene; otherwise the cutaway is invisible to the structural model.

Stories that lean heavily on cutaway can't fully use the
location / awareness graph regardless. Documented limitation; not
chased in v1.

For state changes inside a short cutaway: piggyback should guard
against state mutations from cutaway content. If the model emits
different `sceneEntities` for the cutaway portion, the piggyback rule
"compute lastSeenAt from scene-presence delta" applies cleanly. If the
cutaway is brief enough not to flip `sceneEntities`, treat it as
narrative texture without state implications.

---

## v1 limitations

Known limitations the design accepts and documents rather than chases:

- **Polymorphic naming** — two distinct same-name characters require
  manual rename.
- **Multi-scene / cutaway entries** — not first-class; meanwhile-style
  prose degrades the structural model gracefully.
- **Auto retired → active** — user-only in v1; agent-driven path is
  parked-until-signal.
- **Single-axis `decay_resistance`** — one number can't capture
  orthogonal relevance dimensions ("emotionally resonant" vs.
  "plot-relevant" vs. "character-defining"). v1 floor; multi-axis is
  the signal that drives a v1.x revisit.
- **Pin contradiction reconciliation** — manual user un-pin in v1;
  lore-mgmt eventually catches at chapter close.
- **Memory probe affordance** — debug UI to inspect "what did
  retrieval surface this turn and why" is parked.
- **Mode-3 (LLM-only retrieval)** — story-creation regime, no
  mid-story switch.
