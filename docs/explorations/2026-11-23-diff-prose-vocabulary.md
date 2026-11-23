# Diff prose vocabulary

How World's and Plot's History tabs word an update's before and after,
per field kind, across the seven tables they list. Designed 2026-11-23
for Slice 6.7 (the diff cache), whose planning paused at this question
(the milestone's and the slice's Open questions on the prose
vocabulary). The cache, the walk and the read are settled at 6.7
planning and not reopened here; this design sits on the entry they
produce.

## What the renderer receives

An entry is `{ old, new }` per update delta
([Walk algorithm](../architecture.md#walk-algorithm)). `old` is the
delta's `undo_payload`; `new` is the row just after the delta, picked by
the payload's top-level column keys. Read against the encoder
(`lib/actions/delta/delta-encoding.ts:84-124`), the shapes that matter:

- **Set from nothing and cleared are visible.** An optional field set
  from absent, or a nullable one set from null, logs `null`. A cleared
  optional field is absent from `new`; a cleared nullable one is `null`
  there.
- **Arrays log whole.** `old.state.traits` is the whole prior list.
- **A record logs per key.** `stackables`: an added key logs `null`, a
  changed or removed key its prior count. The whole column set from
  absent logs `null`; the whole column cleared logs the whole record.
- **A nullable object logs a partial when both sides are non-null.**
  `lastSeenAt` can log `{ worldTime: 120 }` alone while `new` holds the
  whole object; set from null it logs `null`. `changedPaths` descends
  neither it nor `stackables`.
- **`old.state` is never `null` or `{}`.** Both entity write paths diff
  against `current.state ?? emptyEntityState(kind)` and drop an empty
  partial (`lib/actions/entities/register.ts:304-310`,
  `lib/actions/entities/state-patch-actions.ts:217-231`), and every
  survivor rewrite lands at least one level deep without deleting a
  present key. The renderer's fallback for it is a defense only.
- **`$`-prefixed meta keys sit in `old`.** A user's flag clear logs
  `$resolvedPair` (`lib/actions/entities/resolved-pair.ts:7-13`);
  `changedPaths` skips them (`lib/history/humanize.ts:46`).
- **Column groups log their unchanged members too.** The flag clear
  logs all three collision columns, a retire logs an unchanged
  `retiredReason`, a thread status its unchanged entry, and a placement
  rewrite both keys.

## Decisions

- **Canon home: a `Change prose` subsection of
  [`world.md → History tab`](../ui/screens/world/world.md#history-tab).**
  World already holds the link-row wording and the side labels, and
  Plot's History defers to World's. `delta-log-row.md` takes opaque
  strings by contract, and its review-window consumer words values its
  own way; `architecture.md` would hold UI copy.
- **One clause per field, each led by its label:
  `<Label>: <change>`.** The clauses come from the paths `changedPaths`
  reads, so meta keys never make one. The label stays where the
  field-name summary put it, so a cache miss upgrading to prose doesn't
  jump. A relationship row needs it: the target line's raw `kind`
  doesn't say whose view. And a `{{field}}: {{change}}` key never
  inflects the field's name, where `Added "x" to Traits` would need a
  case per field in inflected languages.
- **A column group renders as one clause.** Two groups: a place's
  parent with `unplaced` ("Parent location") and the collision triple
  ("Collision flag"). A status with its reason or entry, and a
  happening's `occurredAtEntryId` against `temporal`, stay separate
  clauses: literally accurate, no per-table rule, about 20 characters
  dearer.
- **Clauses follow the payload's path order,** the order the target
  line lists the raw paths in; a group sits at its first path.
- **Clauses join with `; `; a clause's parts and a list's items with
  `, `,** each from a key.
- **The clamp stays the plain two-line ellipsis.** The target line
  lists every path, so a clamped clause stays signposted. A count rule
  ("+2 more") was rejected: the renderer can't measure lines.
- **Equality is on values, normalized,** never on rendered text. A
  clause whose old and new are equal renders nothing.
- **No clause renders, or a path has no wording: the whole row shows
  the field-name summary** (`Modified <labels>`), the string the miss,
  a failed walk and a gone delta show. It is never an empty row, it is
  what History shows today, and it is the wording summary search
  matches. "Modified" is slightly false for a survivor rewritten into
  restating its value; the delta did write the field, which is why it
  keeps the key.
- **A ref names its row as a link row's other end is named:** the
  working set first, then its stored row, then its latest delete
  payload, within the tab's branch, else `Unknown row`. A merge
  deletes its loser (`lib/world/entity-merge.ts:335`), so a deleted ref
  is routine: the collision flag's partner is the usual case. Working-set
  names alone would read `Unknown row` there.
- **A ref the working set doesn't hold is marked `(deleted)`.** A merge
  re-points every row naming its loser to the canonical in one logged
  write per row (`lib/world/entity-refs.ts:43-87`): a faction, a
  location, carried and equipped items, a place's parent,
  `lastSeenAt`'s place, another row's collision partner. Loser and
  canonical are usually namesakes, so unmarked the prose reads
  `Faction: Iron Pact → Iron Pact`. Marked, it reads
  `Faction: Iron Pact (deleted) → Iron Pact`, and a ref a delete
  cleared stops passing for a live row (`Iron Pact (deleted) → none`).
  The working set holds every entity of the branch at any status
  (`lib/actions/stories/operational.ts:150`), so absence means gone,
  checked when the row renders. Marking by the name's source instead
  (a delete payload) misses a row whose walk ran before the merge: the
  cache keeps its live-read name, since a merge evicts nothing. A row a
  reversal restores is back in the working set and loses the mark.
- **An entry ref the entry index doesn't hold reads `Unknown entry`.**
  The index reads every non-system entry of the branch
  (`lib/entry-refs/read.ts:108-119`), so only a removed entry misses. A
  fork keeps ids and swaps only `branch_id`
  (`lib/db/branch-copy/copier.ts`), so refs on a fork resolve there.
- **Long free text is excerpted around the first difference** (rule
  below). Excerpting from the start fails the common edits, an append
  and a middle edit, by showing two identical openings.
- **History agrees with the close review on format, not code.** Both
  read `old → new`; History quotes free text, diffs lists and words
  `none`, where `close-review-changes.ts` joins lists, stringifies
  objects and concatenates its arrow. Its output stays unchanged
  (Scope: out), so the renderer keeps its own value functions.
- **Numbers render as `String(value)`.** Nothing in the codebase uses
  `Intl` and `en` is the only locale; locale digits arrive with the
  first other locale, for every surface at once. Not filed.
- **Search canon says what matches.** `world.md`'s Search bullet
  ("rendered change-summary text", a summary "typed as shown"),
  `lists.md → Search bar scope` and `plot.md`'s History bullet promise
  the shown summary is searchable. Search matches the field-name
  summary and the pre-change values as stored, JSON-escaped
  (`lib/history/query.ts:58-70`), so a quoted value typed as the prose
  shows it misses. This integration rewrites the three, taking that
  item off 6.7's canon list.

## The vocabulary

Every example is English and literal; a test can take it as written.

### Values

| Kind               | Fields                                                                                                                                                                                        | Renders                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Free text          | `name`, `title`, `description`, `body`, `voice`, `condition`, `standing`, `category`, `icon`, `temporal`, `retiredReason`, the six visual sub-fields, `kind`, `inverseKind`, `role`, `source` | quoted, excerpted when long: `Voice: "low" → "gravelly"`                                                                                                                                                     |
| Empty side         | null, absent or `''`                                                                                                                                                                          | `none`, unquoted: `Voice: none → "gravelly"`, `Category: "omen" → none`                                                                                                                                      |
| Enum               | entity `status`, thread `status`, `injectionMode`                                                                                                                                             | the form's word, unquoted: `Status: Active → Retired`, `Injection: Auto → Always`                                                                                                                            |
| Number             | `priority`, `decayResistance`, `retrievalCount`                                                                                                                                               | `Priority: 0 → 5`, `Decay resistance: 0.5 → 0.8`                                                                                                                                                             |
| Flag               | `commonKnowledge`, any later 0/1 flag                                                                                                                                                         | `Common knowledge: no → yes`                                                                                                                                                                                 |
| Row ref            | `current_location_id`, `faction_id`, `at_location_id`                                                                                                                                         | the row's name, unquoted: `Faction: none → Iron Pact`; deleted: `Faction: Iron Pact (deleted) → Iron Pact`                                                                                                   |
| Entry ref          | `triggeredAtEntryId`, `resolvedAtEntryId`, `occurredAtEntryId`, `learnedAtEntryId`                                                                                                            | `entry #n`: `Resolved at: none → entry #31`; removed: `Occurred at: Unknown entry → entry #12`                                                                                                               |
| Term list          | `tags`, `keywords`, `traits`, `drives`, `agenda`                                                                                                                                              | added, removed, respelled terms: `Traits: added "former soldier", "scarred", removed "loyal"`; `Tags: respelled "iron pact" as "Iron Pact", "eldra" as "Eldra"`                                              |
| Ref list           | `inventory`, `equipped_items`                                                                                                                                                                 | added and removed names: `Carried: added Silver coin, removed Rope (deleted)`                                                                                                                                |
| Record             | `stackables`                                                                                                                                                                                  | per key: `Quantities: gold 250 → 200, arrows none → 12`                                                                                                                                                      |
| Compound           | `lastSeenAt`                                                                                                                                                                                  | `Last seen: entry #40 at The Tavern → entry #47 at Market Square`; with no place, `entry #40`; first sighting, `Last seen: none → entry #3 at The Tavern`                                                    |
| Placement group    | `state.parent_location_id`, `state.unplaced`                                                                                                                                                  | the parent's name, `Top level` (null parent, not unplaced) or `Unknown` (unplaced): `Parent location: Unknown → The Old Quarter`                                                                             |
| Collision group    | `nameCollisionFlag`, `nameCollisionPartnerId`, `nameCollisionReason`                                                                                                                          | the partner's name when flagged, else `none`: `Collision flag: none → Kael` (raised), `Kael (deleted) → none` (cleared by a merge), `Kael (deleted) → Kael` (re-pointed by a merge); the reason doesn't show |
| Relationship views | `kind`, `inverseKind`                                                                                                                                                                         | free text under the side's label: `Your view: "rival" → "ally"` on side a is `Their view: "rival" → "ally"` on side b                                                                                        |

Rules behind the table:

- **Free text** is whitespace-collapsed (`oneLine`) before it is
  compared or shown, so a change to whitespace alone renders nothing.
- **Empty** is null, absent and `''` alike; an absent or null list is
  `[]`, so a list set from nothing reads only `added …`.
- **Term lists** compare through `termChanges` with each list's
  registered match (`tags` and `keywords` normalized, the rest exact),
  as reverse-replay does. Parts in the order added, removed, respelled,
  each named once; terms in their list's order (added and respelled
  from `new`, removed from `old`). A reorder alone renders nothing: a
  list is a set
  ([Reverse-replay](../generation-pipeline.md#reverse-replay)). A term
  over 40 characters is cut as `excerpt` cuts (`lib/text/excerpt.ts`).
- **`stackables`** takes its keys from the old partial, as the
  iteration rule says, except a `null` old (the column was absent),
  which has none: then every key of `new` is an addition. A key reads
  `none` on a side that doesn't hold it, and a key whose two counts
  match renders nothing. The quantity's name is unquoted, a bend of the
  free-text rule for `gold 250 → 200`.
- **`lastSeenAt`** reads `none` on a null side. When both are non-null
  it rebuilds the old value as `{ ...new, ...old }`: a key the partial
  lacks didn't change. Only `entryId` and `locationId` compare and
  show; world time needs the branch's calendar, origin and era flips
  (`lib/calendar/render.ts:57`), which the host doesn't hold, and the
  entry already says when. A change to world time alone renders
  nothing.
- **Groups** rebuild the old side by merging the partial over `new`:
  a member the payload lacks didn't change, and one it logs unchanged
  merges to its own value either way. An `unplaced: null` in the
  partial means the mark was absent. A close's duplicate re-mark, which
  keeps the partner and changes only the reason, renders nothing and
  falls back to `Modified Collision flag`.
- **A ref's name** is unquoted, `(deleted)` when the working set
  doesn't hold its row, `Unknown row` when none reads.
- **Enum words** reuse the forms' select keys with their casing:
  `world:tiers.*` and `plot:tiers.*` for a status (the selects in
  `components/world/tabs/settings-tab.tsx` and
  `components/plot/thread-detail-pane.tsx`), `world:fields.injection.*`
  (entities, lore), `plot:fields.injection.*` (threads),
  `world:connections.placementTopLevel` and `placementUnknown`.
- **`icon`** is free text, the icon's stored name: a summary can't draw
  the glyph.
- **A character's or item's null location reads `none`,** not
  `Unknown`: an item's null means held or unplaced
  ([ItemState shape](../data-model.md#itemstate-shape)).

### Long text

Counted in code points, as `excerpt` counts.

1. Collapse whitespace on both sides.
2. When both sides are 40 characters or fewer, show both whole.
3. Otherwise find the first difference `d`: the first index where the
   two differ, or the shorter side's length when one is a prefix of the
   other. Both sides start at the same index `s`: the earliest word
   start from `d − 16` to `d` (a word start is index 0 or an index
   after a space), or `d − 16` itself when that range holds none, and
   never before 0.
4. A side whose rest from `s` is 40 characters or fewer shows to its
   end. Otherwise it ends at the last word end after `d` and no later
   than `s + 40`, a word end being an index that holds a space, so a
   space exactly at `s + 40` counts. With none, it ends at `s + 40`.
   A side never ends at or before `d`, so the difference always shows.
5. `…` marks a cut at either end.

```
old: A wary ranger from the northern marches who served the crown for a decade before the war.
new: A wary ranger from the northern marches who deserted the crown after a decade before the war.
Description: "…marches who served the crown for a…" → "…marches who deserted the crown after a…"

old: A wary ranger.
new: A wary ranger. He once served the crown before the war.
Description: "A wary ranger." → "A wary ranger. He once served the crown…"
```

At 40 a side, one long clause is about 100 characters: two lines in the
desktop pane. At phone width a single long clause can still lose the
end of its new side; smaller excerpts leave too little to recognize the
passage.

### A row

```
(update)  Kael · description, state.traits, state.voice
          Description: "A wary ranger." → "A wary ranger. He once served the
          crown…"; Traits: added "former soldier"; Voice: "low" → "gravelly"
          user · entry #47 · 2h ago
```

Canon's example (`old.state = { traits: ["brave"] }` against a `new.state`
holding traits, drives and voice) reads `Traits: added "former soldier"`.
The prior list's `; was ["brave", "loyal"]` is dropped: the added and
removed terms already say what changed, and the clamp can't spare it.

### Keys

New, in `history`:

| Key                                       | en                                     |
| ----------------------------------------- | -------------------------------------- |
| `prose.clause`                            | `{{field}}: {{change}}`                |
| `prose.separator`                         | `; `                                   |
| `prose.listSeparator`                     | `, `                                   |
| `prose.changed`                           | `{{old}} → {{new}}`                    |
| `prose.quoted`                            | `"{{text}}"`                           |
| `prose.ellipsis`                          | `…`                                    |
| `prose.none`                              | `none`                                 |
| `prose.yes`, `prose.no`                   | `yes`, `no`                            |
| `prose.added`, `prose.removed`            | `added {{terms}}`, `removed {{terms}}` |
| `prose.respelled`                         | `respelled {{pairs}}`                  |
| `prose.respelledPair`                     | `{{old}} as {{new}}`                   |
| `prose.quantity`                          | `{{name}} {{change}}`                  |
| `prose.lastSeen`, `prose.lastSeenNoPlace` | `{{entry}} at {{place}}`, `{{entry}}`  |
| `prose.deletedName`                       | `{{name}} (deleted)`                   |
| `unknownEntry`                            | `Unknown entry`                        |

`prose.added`, `prose.removed` and `prose.respelled` take `count`, the
number of terms or pairs, so a locale whose verb agrees with it can
plural the key; English needs no `_one`/`_other` split. Reused:
`history:field.*`, `history:unknownTarget`, and the enum and placement
keys above. A locale reorders inside a key or flips the arrow; code
only joins finished fragments with the separator keys. i18next runs
with `escapeValue: false` (`lib/i18n/i18n.ts:55`), so the quotes pass
through. A list's part order (added, removed, respelled) is code's.

## Rejected wordings

- **Unlabelled clauses on a single-path row** (canon's
  `Added "former soldier"`): loses whose view on a relationship row, and
  the miss-to-hit upgrade drops the label.
- **Sentences naming the field** (`Added "x" to Traits`): inflects the
  field's name per locale.
- **Folding a status with its reason** into one clause, the reason in
  brackets after the new status: a per-table rule for 20 characters.
- **The status tags' lowercase `status.*` words,** which rows, peeks
  and the close review show: the prose names a field's value, and the
  select is where it is edited; its capitals match `Auto` and
  `Top level`.
- **Long text last** in the clause order: decouples the clauses from
  the target line's path order; the per-value cap does the work.
- **`set to "x"` / `cleared, was "x"`** instead of the arrow with
  `none`: more keys, and the arrow is the close review's format too.
- **An empty summary, or `Restated Traits`,** when nothing renders: the
  first reads broken, the second is wording search doesn't know.
- **Dropping a ref clause whose sides read the same name,** for a
  merge's re-point: hides that the merge happened. **A merge-specific
  wording** ("re-pointed to the merged Iron Pact"): the renderer would
  guess a merge from a deleted namesake.
- **`Icon: changed`** with no values; **`with Kael`** as the collision
  value; **`Intl.ListFormat`** for terms (Hermes support unverified,
  and quoting keeps terms apart).
- **Collision reason words**: the nine reasons have only the banner's
  sentences (`locales/en/common.json:240-244`), and the target line
  lists the raw path.
- **World time in `Last seen`**: needs data the host doesn't hold.

## Adversarial pass

A fresh agent checked the design against `lib/history`, the encoder,
the handlers and reverse-replay. Folded in above: a first sighting's
`lastSeenAt` read as unchanged; a merge's re-points read
`X → X` (the `(deleted)` mark); search canon promising the shown
summary; the long-text rule undefined with no word start in its window
or a word end before the difference; `$resolvedPair` reaching a
`keys(old)` iteration; a restated quantity; the group rule's stated
reason; Diagnostics' sideless relationship rows; a count for term
verbs. Confirmed sound: every column an update logs on the seven
tables has a row above (`embeddingStale` and `updatedAt` never enter a
payload); the encoder shapes; the term-list registrations; the four
names claims; the reused keys; both worked examples, computed. The
drift pass then found the status keys cited were the tags', not the
selects', and a side review that a mark read from the name's source
misses rows walked before a merge; both are folded in above.

Two states the rules read wrongly and nothing reaches today
([Reverse-replay](../generation-pipeline.md#reverse-replay)): a survivor
rewrite installing a whole prior `stackables` record beside a present
`new`, whose added keys would then miss their `none`; and the walk's
accepted reading of a write with no delta (6.7's Open questions).

## Scope notes for 6.7 planning

- **Names outside the working set cost a read** that 6.7 hasn't sized.
  (a) The walk records them: after its read, `populate` collects the
  ref ids in its entries and reads their names (stored row, then latest
  delete payload, through `link-ends.ts`'s `namesOf` and
  `latestDeletedValues`, made public), and the entry gains a `names`
  map; the renderer takes the working set, then `entry.names`, then
  `Unknown row`. One-phase loading, the host unchanged, the renderer
  pure; it changes the settled entry shape, and a row renamed after the
  walk and then deleted shows its walk-time name. (b) A names query in
  the host keyed on the ids the working set lacks: the entry shape
  holds, loading goes two-phase, and the host, which 6.2 also edits,
  grows. The design leans (a); planning picks.
- **A row whose prose holds an entry ref waits for the entry index.**
  Until its first read lands the index reads `ready: false`, and the
  prose would flash `Unknown entry`; such a row keeps the field-name
  summary until the index is ready, and keeps it after a failed read.
  Rows with no entry ref don't wait.
- **`termChanges`** (`lib/actions/delta/term-list.ts`) isn't on the
  `lib/actions` barrel, and the per-list match lives in each table's
  registration; the renderer needs both.
- **The close review's status maps** (`close-review-changes.ts:135-146`)
  aren't shared: they map to the tags' `status.*` words, and the prose
  reads the selects' `tiers.*` words.
