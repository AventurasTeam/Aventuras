# Partial-name collisions and the flag's partner

Resolves two entries in `followups.md → Data-model`, designed together
because the second is what makes the first resolvable:
`Name-collision detection misses partial-name duplicates` and
`The classifier drops why it flagged a row`. The commit that lands this
record replaces both with a one-line implementation entry: the design
is settled, the code is not.

The substrate is Layer B reconciliation
([`classifier.md → Disambiguation on new-character mentions`](../memory/classifier.md#disambiguation-on-new-character-mentions))
and World's collision review
([`world.md → Collision review and entity merge`](../ui/screens/world/world.md#collision-review-and-entity-merge)).
Both carry the spec this record decided; what follows is why.

## What this closes vs. defers

Closes:

- **Partial namesakes.** "Kael" against "Kael Stormborn", and a name
  revealed after a title ("Marta" against "the Innkeeper" through a
  keyword), now reach the embedding comparison.
- **Scene presence as evidence.** The candidate's turn's saved scene
  breaks ties and corroborates partial matches.
- **The flag's reason and partner.** Both are stored, so World pairs a
  flagged row with the row the classifier actually compared and the
  resolve dialog says why it flagged.
- **The classifier's view of each turn's scene.** The prompt shows
  each turn's saved scene and location.
- **Keyword appends to existing rows.** The extraction gains an alias
  list, the first reliable path for canon's "later passes may append
  newly-observed references".

Defers:

- **Implementation**, to a standalone PR (the followups entry).
- **Correcting earlier entries' scene presence after a merge.** Dropped,
  not deferred: canon already decided those entries keep an
  Unknown-entity chip
  ([`world.md → Delete`](../ui/screens/world/world.md#delete)), so this
  would reverse a decision rather than close a gap.
- **Threshold tuning.** `τ_high` and `τ_low` stay canon's starting
  values; the partial-match outcomes inherit them.

Unchanged on purpose: Layer A's retrieval-time suppression and the
rename hint stay exact-name; N-way merge stays out of v1; only
characters are reconciled, because only characters are
machine-created.

## Ground truth that shaped it

- **Layer B is a backstop for a model miss.** The classifier prompt
  lists every entity on the branch, any kind and status, with its
  description (`lib/pipeline/definitions/classifier-context.ts`). A
  "Kael" in `newCharacters` beside a listed "Kael Stormborn" is the
  model missing a row it was shown. So the cheapest defence is in the
  prompt, and the code check is the second line.
- **The name gate only picks candidates.** The embedding comparison
  decides, so widening the gate moves the risk rather than adding
  false-positive flags: the high band absorbs silently, attaching the
  reply's involvements, awareness and relationships to the existing
  row with no review (`lib/classifier/plan.ts`).
- **Every World surface grouped on one exact key.** `namesakeKey`
  drove the strip, the pill, the badge, the orphan clears and the
  resolve check. A partial relation isn't transitive ("Kael" matches
  "Kael Stormborn" and "Kael Brightwater", which don't match each
  other), so key grouping can't express it.
- **Keyword appends to existing rows were accidental.** The only path
  was the promote and known branches, which fire when the model
  re-lists a known character under its exact name, which the prompt
  already told it not to do.
- **"Couldn't compare" is transient.** A story can't be created or take
  a turn without its embedder, so a missing score means a failed call
  or a swap in progress, never a story running without one.

## Decisions

**A partial match never absorbs.** A silent misattribution has no
recovery: there is no split tool, and the facts land on the wrong row
unreviewed. A flag is visible and costs one dialog. So a partial match
flags only with a second signal (descriptions at least partly alike, or
the namesake in the turn's scene), and creates an unflagged row
otherwise.

**The matching rule is containment plus keyword hits.** Contiguous
whole-word containment in either direction catches the short form and
the full name revealed later. A keyword hit catches the name revealed
after a title. Rejected: containment alone, which misses the title
case; and any shared word with a stop list, which pairs "the Red
Knight" with "the Black Knight" and needs a list per language. "Lord
Kael" against "Kael Stormborn" stays an accepted miss, as does "Marta"
against "the Innkeeper" when no keyword links them. Generic shared
keywords ("the guard") can only cost a flag, and generic characters
shouldn't be entities in the first place.

**Scene presence is a tiebreaker.** For an exact name it turns the
ambiguous band into an absorb; for a partial name it turns the low band
into a flag. Rejected: absorbing an exact name in the scene at any
similarity, which overrides both the classifier's roster-informed "new"
and descriptions that actively differ. Giving the scene to the prompt
was adopted as well, not instead. Only the candidate's own source turn
counts, and not when its handle fell back to the window head.

**A missing score never absorbs.** It flags an exact or partial
namesake with the reason `no-signal`, which is the code's existing
"defer to the user" stance. A namesake with a blank description gets no
score either, rather than a similarity against an empty string.

**The partner and reason are stored, not derived.** Three options were
weighed:

- **Stored partner (chosen).** World shows exactly the comparison the
  classifier made, for exact and partial pairs alike, and the 3+
  namesake guess goes away. The cost is lifecycle handling on every
  write that removes, merges or renames a row.
- **Reason only, pairs derived by the new rule.** No id in a column,
  and renames re-pair on their own. But a keyword edit that breaks the
  match leaves a flag nobody can see or clear, the derived partner
  still differs from the compared one, and every grouping site needs a
  pairwise rewrite anyway.
- **Hybrid.** Both machineries for the one corner where a reversal
  removes the partner.

That corner is accepted as a dormant flag: hidden while its partner is
gone, cleared the next time its row is in a resolved pair. Ids are never
reused, so the only way a dead partner id comes back is the same row
returning, and then the pair is real again. The partner column stays
out of the reversal reference registry, so a create naming a deleted
partner isn't refused.

**Resolving clears narrowly.** Canon cleared every flagged row of a
resolved pair, which was safe while pairing went by name. With stored
partners, a flag pointing at a live third row is its own visible
question, so resolving clears only the flags whose partner is the other
row of the pair, or is gone.

**The prompt rule leaves the model room to say "new".** The line telling
the model that a short form or title of a listed character is that
character is itself a merge decision Layer B can't police. Its wording
ends "unless the prose shows it is someone else", and a wrong link costs
a stray keyword and future flags, never a silent Layer B merge.

**No data migration.** Only development databases exist. The schema
migration that adds the columns rebuilds `entities` for the CHECK, so a
development database holding flagged rows needs a reseed.

## Adversarial pass

- **The prompt rule as an unpoliced merge.** Softened wording, above.
  How a model responds to it is unverified.
- **A fallen-back source turn.** `resolveHandle` reports a fallback to
  the window head; scene presence from that turn is ignored, since it
  could trigger an exact-name absorb on the wrong turn's evidence.
- **Blank descriptions.** `reconcile.ts` embedded `description ?? ''`;
  such a namesake now gets no score. What an empty-string embedding
  scores was not measured.
- **Carried-forward scenes.** `sceneEntities` inherits when a turn
  reports nothing, so "in the scene" can mean "as last reported".
  Accepted: it is the scene the user sees and corrects, and it only
  breaks ties.
- **Read sites.** Checked by grep: the reader rail never shows
  collisions, Layer A in `lib/retrieval/pools.ts` keeps its exact rule,
  and the flag mentions in `chapter-close.md` and `probe.md` are
  analogies.
