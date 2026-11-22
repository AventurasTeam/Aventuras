# Slice 6.2 — Branch-scoped reads and per-branch redo

## Metadata

- **Milestone:** [Milestone 6 — Branches + diff cache](../milestone.md)
- **Depends on:** none. Startable on day one.
- **Blocks:** [Slice 6.4](./04-switching-navigator.md) (landing: its
  reader integration reads through the accessor and the redo map) and
  [Slice 6.6](./06-delete-duplicate.md) (branch delete drops a stack on
  the map). The redo map's consumers under C6 are 6.3, 6.4, 6.6 and
  6.8; [Slice 6.3](./03-fork-core.md) and
  [Slice 6.8](./08-per-branch-lead.md) build on it with no landing
  edge. If 6.6 splits into branch delete and story duplicate, the redo
  map stays in this slice, since 6.4 needs it before it lands
  ([milestone → Open questions](../milestone.md#open-questions), Sizes).
- **Order-free meets:** with 6.8 (the three lead lines and the `isLead`
  pair, C5) and with 6.3 (the child's empty redo stack). Each is an
  acceptance criterion here, written as "if the other has landed".

## Goal

Every working-set read answers for one branch, every registered action
handler proves its branch condition against a second branch holding the
same ids, and Redo answers for the branch the reader is on. This
delivers the store factory's two branch reads and the sweep onto them,
a lint rule that keeps an inline branch filter from coming back, the
two database reads that select a branch-scoped row by id alone, a
decision on the two store mirrors nothing hydrates, a two-branch pair
for each of the 55 registered handlers, and the redo store as a map
from a branch to its groups.

## Background

Once a fork or a duplicate copies rows, one id names a row on each
branch, and every read has to say which branch it wants
([`data-model.md → Branch model`](../../../../data-model.md#branch-model),
the composite-key paragraph). The working-set stores hold one branch
keyed by id alone, so consumers filter by `branchId` inline or look a
row up by id and trust the store to hold the right branch; neither
fails until a store holds a sibling with the same id. The redo store is
one array, while canon gives each branch its own stack, cleared only by
writes on that branch and dropped with the branch or its story
([`Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)).
Under R2 a switch replaces the reader, so no route outlives a hydrate
for another branch: the accessor only has to stop wrong-row reads, and
nothing re-hydrates on refocus (C5).

## Required reading

- [`data-model.md → Branch model`](../../../../data-model.md#branch-model),
  the paragraph on composite primary keys
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback),
  from the algorithm through "One redo stack per branch", and
  [`Story deletion`](../../../../data-model.md#story-deletion)
- [`reader-composer.md → Undo and redo`](../../../../ui/screens/reader-composer/reader-composer.md#undo-and-redo):
  the labels and the notice read "the reader branch's redo stack"
- [`code-conventions.md → State placement`](../../../../code-conventions.md#state-placement),
  [`Syncing a store after a write`](../../../../code-conventions.md#syncing-a-store-after-a-write),
  [`Read-view immutability`](../../../../code-conventions.md#read-view-immutability)
  (how a lint rule fences a store member today) and
  [`Type design`](../../../../code-conventions.md#type-design)
- [`testing.md → Coverage: thorough, not exhaustive`](../../../../testing.md#coverage-thorough-not-exhaustive)
- [`milestone.md → C5`](../milestone.md#c5--branch-scoped-store-reads)
  and [`C6`](../milestone.md#c6--one-redo-stack-per-branch), which this
  slice provides
- [`C1`](../milestone.md#c1--delta-rows-on-two-branches) (redo's
  survivor write), [`C10`](../milestone.md#c10--the-leads-surface) (the
  lead lines this slice leaves alone),
  [`C11`](../milestone.md#c11--shared-files) and
  [`C12`](../milestone.md#c12--canon-and-flips), which it follows; the
  [dependency graph](../milestone.md#dependency-graph) for the
  order-free meets; and the milestone's
  [Open questions](../milestone.md#open-questions), Unaudited and Sizes
- Lessons:
  [No harmless id leaks](../../../lessons-learned/no-harmless-id-leaks.md)
  (the redo map drops a branch's entry when it empties),
  [One `exhaustive-deps` suppression opts the whole component out of React Compiler](../../../lessons-learned/exhaustive-deps-suppression-disables-the-compiler.md)
  (the sweep rewrites hooks in about 36 files)

## Scope: in

**The branch reads (C5).** `lib/stores/factory/working-set-store.ts`
gains two reads, each as a getter and a hook. The names below are this
doc's; the plan picks the final ones, and later slices use what ships.

- `getBranchRows(branchId)`: the store's live map when `loadedBranch`
  is that branch, and otherwise one module-level empty map, the same
  reference on every call, typed `ReadonlyMap`.
  `useBranchRows(branchId, selector)` is the same read as a hook. Its
  selector reads `loadedBranch` and `rows` together, so a hydrate for
  another branch re-renders a subscriber, which `useRows` can't do
  today (`working-set-store.ts:56`). That is the reactive loaded branch
  C5 says the stores lack; a standalone `useLoadedBranch` hook ships
  only if a swept site needs one. The selector keeps `useRows`'s
  stability rule: return the map or a primitive, never a fresh array.
- `getRow(branchId, id)` and `useRow(branchId, id)`: the row when that
  branch is loaded and holds the id, else `undefined`.
- Each domain store exposes both under its own naming beside its
  existing members. Its `getById(id)` becomes the read by branch and
  id. The derived getters read through the branch read and take the
  branch (C5): `chaptersStore.getLatest`, `selectLatest` and
  `getBySequenceNumber`; `entitiesStore.getByKind`;
  `happeningInvolvementsStore.getByHappening`;
  `happeningAwarenessStore.getByHappening` and `getByCharacter`
  (`lib/stores/happenings/awareness.ts:12-15`, `involvements.ts:12-13`);
  `translationsStore.getTranslation`; and, if the mirrors stay,
  `entryAssetsStore.getByEntry`. These sit inside `lib/stores/`, where
  the lint rule doesn't look, so the signature is what holds them.
  `characterRelationshipsStore.getRelationships` already takes the
  branch (`character-relationships.ts:19-20`).
- `getLoadedBranch()` stays, and so do the 13 reads of it outside
  `lib/stores/`: `lib/pipeline/definitions/working-set.ts:40`,
  `generation-context.ts:381`, `stores-hold-branch.ts:14`,
  `suggestion-refresh.ts:82`, `lib/actions/story-entries/undo.ts:148,260`,
  `system-entry.ts:85`, `lib/actions/turns/regenerate-turn.ts:144`,
  `components/reader/use-entry-jump.ts:194,230`,
  `hooks/use-memory-run-outcomes.ts:33` and
  `app/reader-composer/[branchId].tsx:1343,1437`. The guards among them
  tell "not loaded" from "loaded and empty", which the branch read
  can't, and a pipeline phase fails on the first.

**The sweep (C5).** Every read of store rows outside `lib/stores/`
moves onto the branch reads. An inventory taken at `8b5da25ac`, a
starting list the plan re-takes at its base:

- 54 inline `branchId` filters over store rows: lib 21, components 19,
  app 9, hooks 5. A grep of raw row reads outside `lib/stores/` at the
  same commit finds 111 in 36 files; the plan works from that one.
- The three helpers, which go: `onBranch`
  (`lib/world/merge-links.ts:179-180`), `branchRows`
  (`lib/actions/world/resolve-collision.ts:115-120`, five call sites)
  and `inBranch` (`components/world/use-collision-resolve.ts:63-68`,
  six call sites).
- About 20 lookups by id alone, among them the History target: four
  `m.get(id)` selectors (`components/history/use-history-target.ts:8-16`)
  take the tab's branch, which `history-tab.tsx:90` holds; that file's
  `useStoreNames` (`:45-50`) drops its inline branch guards for the row
  read. The reader route's two (`app/reader-composer/[branchId].tsx:1366`,
  `:1458`), `chapter-overlays-host.tsx`'s three, `undo-copy.ts:286`,
  `use-entry-jump.ts:192,270`, `story-entries/operational.ts:123` and
  `suggestion-refresh.ts:184`.
- The reader route's three filter lines (`:298`, `:404`, `:708`) and
  `chapter-overlays.ts`'s (`:49`, `:85`), per C11. Those two helpers
  take a map their host passes; once the host passes the branch's rows
  their checks are redundant, and each goes where every caller passes
  them.
- A pure function's filter over an input array that came from a store
  (`lib/world/entity-refs.ts:126-131`, `merge-links.ts:180`) goes only
  once every caller passes the branch's rows, and its input's name says
  so (`branchEntities` already does).
- **Not store rows, and staying:** filters over `txState.runs`, such as
  the reader route's `:326-327` and `:534-535`, which have the same
  shape as a store-row filter; route-state compares; register payload
  guards; seeds.
- **The lead lines (C5, C10).** `lib/world/lead.ts` and the lead logic
  at its callers are 6.8's. Three lead lines hand `resolveLead` a raw
  entity map, which the rule below would flag:
  `lib/pipeline/definitions/generation-context.ts:496`,
  `lib/pipeline/definitions/periodic-classifier.ts:204-205` and the
  reader route's `:356-358`. At those three, 6.2 swaps the map argument
  for the branch read and changes nothing else. If
  [Slice 6.8](./08-per-branch-lead.md) has landed, the lines that
  replaced them take the entity map from the branch read the same way.
- **The review window's lookup (C5).** `reviewOf`
  (`lib/stores/ui/chapter-overlays.ts:101-103`) looks the review's
  chapter up by id alone, and the review request carries no branch
  until [Slice 6.4](./04-switching-navigator.md) gives it one. 6.2
  passes `chaptersStore.getLoadedBranch()` there, the branch today's
  id-only read already assumes, so its own typecheck holds; a null
  branch reads as no chapter. 6.4 replaces it with the request's
  branch.
- **The final rebase.** The last task rebases onto main and sweeps
  every raw read that landed since, which the guard flags in
  `pnpm lint`. A slice that landed first kept the inline form (C5).

**The guard (C5).** A lint rule in `eslint.config.js` that bans the
domain stores' raw row reads outside `lib/stores/`, with tests and
stories exempt. Every inline filter over store rows starts from one of
those reads, so none can come back unnoticed, and a filter over
`txState.runs` isn't one.

- **Where it sits.** Default: `no-restricted-syntax`, a member-expression
  selector over the domain stores' raw members (`useEntities`,
  `getEntities`, `useEntries`, `getEntries` and so on, across the ten
  factory stores, and the two mirrors if they stay), in the base block
  beside `HERMES_BUILTIN_BANS` (`eslint.config.js:123`). Not in
  `SYNTAX_BANS`: the Node override keeps that array for tests and
  scripts (`:382`). One block for `lib/stores/**` sets the rule without
  the new bans. `no-restricted-properties` is the obvious alternative
  and the worse fit: the generationStore owner blocks replace that
  rule's options for their files (`eslint.config.js:317-362`), so each
  would drop the new bans unless it spread them too, and 6.6 adds an
  owner.
- **The pin.** `lib/stores/__tests__/branch-reads-lint.test.ts`, in the
  shape of `generation-mutators-lint.test.ts`, lints fixture text
  through `ESLint.lintText`.
- **Canon.** `code-conventions.md → State placement` gains a sentence:
  a working-set read names its branch, through the factory's branch
  reads, and the lint rule enforces it. It sits beside the
  generationStore owners rule that section already documents.

**Database reads by id alone (C5).**

- `readWideExcerpts` (`lib/entry-refs/read.ts:87-101`) takes the branch
  from `readEntryIndex`, which holds it (`:108`), and adds
  `eq(storyEntries.branchId, branchId)` to each chunk's read. After a
  copy it returns both branches' rows for an id, and the last one wins
  the excerpt map.
- `raiseSystemEntry`'s read (`lib/actions/story-entries/system-entry.ts:86`)
  selects by `args.branchId` and the id. The id is freshly minted, so
  it can't meet a copy; it takes the branch for the same reason C1's
  read-back does.
- The plan re-checks, at its base, every drizzle read of a
  branch-scoped table by `id` outside `deltas` (6.1's), and lists each
  as scoped or as unable to meet a copy. A sweep of those reads at
  `8b5da25ac` found only these two.

**The dead mirrors.** `entryAssetsStore` and `eraFlipsStore` are never
hydrated (`lib/actions/stories/operational.ts:195-204` hydrates ten
stores), so every patch to them is dropped, and nothing outside their
register patchers names them. Default: remove both, with their barrel
exports and resets (`lib/stores/index.ts:8-9,42-43,78-79`), the two
registry patchers (`entry-assets/register.ts:159`,
`era-flips/register.ts:164`; `patcher` is optional on a registry entry)
and the store assertions in those two register suites, whose DB
assertions stay. The first slice that reads either table from the
working set adds its mirror and its hydrate together. The other answer,
hydrating both in `loadAndPublish`, is in
[Open questions](#open-questions).

**Register two-branch tests (C5).** All 55 registered handlers: the 39
the 12 register files define, and the 16 the entities register takes
from `lib/actions/entities/state-patch-actions.ts:273-852`
(`lib/actions/entities/register.ts:409-429`). Thirteen suites carry
them:

- the nine `lib/actions/<domain>/register.test.ts` suites, for
  `chapters`, `entities` (its own three handlers), `entry-assets`,
  `era-flips`, `lore`, `relationships`, `story-entries`, `threads` and
  `translations`;
- `register-happenings`, `register-involvements` and
  `register-awareness`, under `lib/actions/happenings/`;
- `lib/actions/entities/state-patch-actions.test.ts`, for the 16
  state-patch handlers: `updateEntityVisualState`,
  `updateEntityInventory`, `updateEntityStackables`,
  `updateItemPosition`, `updateEntityCondition`,
  `updateEntityLocationTracking`, `promoteStagedEntity`,
  `appendEntityKeywords`, `setEntityKeywords`, `retireEntity`,
  `setCharacterFaction`, `placeLocation`, `renameEntity`,
  `raiseCollisionFlag`, `setFactionStanding` and
  `returnFromRetirement`. Their fixtures already live there.

Each suite gains or extends a `branch scope` block in the shape of
`lib/actions/story-entries/register.test.ts:224-300`.

- **The fixture.** A hand-seeded second `branches` row, with rows under
  the same ids as the first branch's. The two rows of an id differ in
  every column the handler reads or writes, so a read from the wrong
  row shows in the result, not only a write to it. No deltas are
  seeded on it: until 6.1's composite key lands, a delta id can't
  repeat.
- **The pair.** Per handler: its write on one branch lands on that
  branch's row as computed from that row, and leaves the other
  branch's same-id row unchanged; and that write's reversal
  (`reverseReplayDeltas`, as the story-entries block does) restores its
  own branch's row and leaves the other's. A delete with a cascade
  (`entityCascade`, `happeningCascade`) has a captured child on both
  branches, and only its own branch's child goes and comes back.
- **The proof.** Each branch condition the handler holds, removed
  alone, turns a test red: the payload's branch check, each read's and
  each write's `eq(<table>.branchId, …)`, the reads it makes through a
  helper, the registry descriptor's `branchCol` and the cascade's
  branch. `placeLocationHandler` alone reads by branch in its payload
  check, `loadCurrent` twice, `branchPlaces`, `loadStoryPlace` and
  `userWroteSinceProse` (`state-patch-actions.ts:583-624`), so one pair
  won't reach them all. Where the pair can't reach one (a create's
  payload check), a further case does, new or already in the suite. A
  pair that is red against shipped code is a handler bug, fixed in this
  slice and noted in Implementation notes.
- **Existing coverage counts where it already fails.**
  `register-awareness.test.ts:613-639` covers the bump's write; the
  mutation check says what else it covers.
- **The chapter delete's reads.** `resolveChapterDeleteSet`'s chapter
  read and latest read (`lib/actions/chapters/chapter-delete-set.ts:62-75`),
  `ownEntryTokens`' sum (`chapter-delete-preview.ts:57-73`) and the
  preview's `pendingClose.has(branchId)` (`:50`), each with a same-id
  sibling or a sibling's pending close, beside the one lore case
  `chapter-delete-preview.test.ts:246-270` already has.
- At the final rebase, a handler another slice changed since the base
  gets its pair re-checked. If [Slice 6.8](./08-per-branch-lead.md)
  landed first, its `isLead` pair (C10) stays in the entities block.

**The redo map (C6).**

- **The group's branch.** `RedoGroup` (`lib/actions/delta/redo.ts:50-75`)
  gains `readonly branchId`, which `prepareUndo` sets from
  `set.branchId` (`:95-115`), as C6 pins. A group's snapshots can't
  span branches, since `selectReversalSet` refuses that
  (`row-closure.ts:486-493`). `__redoGroupForTest` takes the branch.
- **The store.** `lib/stores/ui/undo-redo.ts` holds a
  `ReadonlyMap<string, readonly RedoGroup[]>` keyed by branch.
  `pushRedoGroup(group)` reads the branch from its group, so the two
  can't disagree. `peekRedoGroup`, `popRedoGroup`, `clear`, `hasRedo`
  and a new `drop` each take a branch; a hook returns a branch's top; a
  test reset serves `resetAllStores` (`lib/stores/index.ts:61`). `clear`
  and `drop` both delete the branch's entry, so the map never keeps an
  empty stack; `drop` is the name a deleted branch's caller uses.
- **The clears**, each naming the branch it wrote:
  `apply-delta-action.ts:213` and `:390` (`branchId`),
  `commit-new-action.ts:24,27` (`set.branchId`),
  `regenerate-turn.ts:199,209` (`ids.branchId`) and `undoRerun`'s
  (`undo.ts:241,247`).
- **Undo and redo.** `undoBracketed` pushes as today (`undo.ts:209,212`).
  `redoLastAction` peeks and pops its own branch (`:263`, `:283`,
  `:293`, `:296`) and keeps the foreign-group guard (`:267-274`) as a
  defense; its comment says why the guard stays, not that the stack is
  global.
- **The reader** reads its own branch's top: `runRedo`'s peek
  (`components/reader/use-reader-undo.tsx:211`), the notice's
  redoable check (`:271`) and `redoTop` (`:373`).
- **Story delete.** `deleteStory` drops each of its branches' stacks
  after the commit, beside `dropBranchRecords`
  (`lib/actions/stories/delete-story.ts:86`), and drops none when the
  delete doesn't commit. Nothing drops a stack on a story delete today.
- **`set-lead.ts` (C6).** If 6.2 lands before
  [Slice 6.8](./08-per-branch-lead.md), its clear
  (`lib/actions/stories/set-lead.ts:69`) clears every branch of the
  story. It reads the story's branch ids with its other reads, before
  the gate check at `:59`, so the gate and the write stay with no await
  between them. If 6.8 landed first the call is gone, and 6.2 builds no
  story-wide clear.
- **The fork's child (order-free with 6.3).** If
  [Slice 6.3](./03-fork-core.md) has landed, its parent-Redo test also
  asserts that the child's stack is empty after the fork, now that the
  child has a stack of its own to read.

**Forward pointers.** Comments that state the single stack as fact:
`lib/actions/story-entries/undo.ts:267-268`, `world-time.ts:68`,
`scene-fields.ts:80` and
`components/compounds/scene-edit-form.stories.tsx:45`. If 6.2 lands
first, `set-lead.ts:67-68` says the clear covers the story's branches.
Any other comment the sweep finds that describes one stack or an
id-only store read as fact goes with it.

## Scope: out

- The switch, the route's `replace`, the reader's keyed body, the
  composer draft and `enterBranch`: [Slice 6.4](./04-switching-navigator.md).
  So is the review request's own branch, which replaces 6.2's interim
  loaded branch in `reviewOf`.
- Re-hydrating a route on refocus: not built (C5, R2).
- `lib/world/lead.ts`, `resolveLead`'s logic, the lead lines at its
  callers (`use-rail-data.ts:86-95`, `app/world/[branchId].tsx:165-168`
  and `:494-510`, the reader route's lead selector beyond its map
  argument), `set-lead.ts`'s write, and deleting its redo clear:
  [Slice 6.8](./08-per-branch-lead.md).
- Branch delete's drop of a stack, `dropBranchRecords` and its lint
  owners: [Slice 6.6](./06-delete-duplicate.md), on this map.
- The composite `deltas` key, the six scoped delta writes, the delta
  read-back at `apply-delta-action.ts:220-223`, redo's survivor write
  at `redo.ts:343-345`, recovery's scoping and the two-branch fixture
  across every table: [Slice 6.1](./01-copy-substrate.md).
- The fork's no-clear and its parent-redo assertion:
  [Slice 6.3](./03-fork-core.md). 6.2 adds only the child half, if 6.3
  is on main.
- The Redo E2E through a real switch ([Slice 6.4](./04-switching-navigator.md))
  and after a fork ([Slice 6.5](./05-fork-from-reader.md)).
- The History host's per-row diff reads (`history-tab.tsx:86-126`):
  [Slice 6.7](./07-diff-cache.md).
- A story-level write that clears every branch's stack, beyond
  `set-lead.ts`'s interim one: M7.2, with the definition save.
- `navigationStore.currentBranchId`, which nothing reads.

## Acceptance criteria

**The branch reads.**

- `lib/stores/factory/working-set-store.test.ts`: with branch A loaded,
  the branch read returns the store's map, the same reference the raw
  getter returns; for B, or before any hydrate, it returns the empty
  map, the same reference on two calls. The row read returns A's row
  for `(A, id)` and `undefined` for `(B, id)`.
- The same file: a `useBranchRows(A, identity)` subscriber re-renders
  and reads the empty map after `hydrate(B, …)` with rows under the
  same ids, and reads A's rows again after `hydrate(A, …)`. A patch for
  B while A is loaded notifies nothing, as today.
- Each derived getter listed under Scope takes a branch and returns
  nothing for a branch the store doesn't hold:
  `lib/stores/happenings/awareness.test.ts` for `getByHappening` and
  `getByCharacter`, `involvements.test.ts` for its `getByHappening`,
  and `chapters.test.ts`, `entities.test.ts` and `translations.test.ts`
  for theirs.
- `components/history/use-history-target.test.tsx` (new): with the
  entities store hydrated for B holding id X, `useHistoryTarget` for
  `('entities', X)` on branch A returns `undefined`; hydrated for A, it
  returns A's row. The same for lore, threads and happenings.

**The sweep and the guard.**

- `lib/stores/__tests__/branch-reads-lint.test.ts` (new):
  - `[...entitiesStore.getEntities().values()].filter((e) => e.branchId === b)`
    in a `components/` fixture path is flagged, and so is
    `entitiesStore.useEntities((m) => m)`.
  - The same text in an owner-block path (`lib/actions/chapters/`,
    `lib/pipeline/runtime/`) is flagged.
  - `[...generationStore.getTxState().runs.values()].some((r) => r.branchId === b)`
    is not; neither is the branch read, nor the raw read in a
    `lib/stores/` path or a `.test.ts` path.
- `pnpm lint` passes with the rule on, at the branch's tip after the
  final rebase.
- This prints nothing:
  `grep -rnE "function (branchRows|inBranch)\b|const onBranch\b" lib components app hooks --exclude='*.test.*'`.
  At `8b5da25ac` it prints exactly the three helpers.
- Each store's `getById` takes a branch and an id, `reviewOf` passes
  `chaptersStore.getLoadedBranch()`, and `pnpm typecheck` passes.

**The lead lines (if Slice 6.8 has landed, or not).**

- If 6.8 hasn't landed: `git diff` of
  `generation-context.ts:496`, `periodic-classifier.ts:204-205` and the
  reader route's `:356-358` against the base changes only the map
  argument each hands `resolveLead`.
- If 6.8 has landed: the lines that replaced those three take the
  entity map from the branch read, `pnpm lint` passes on all three
  files, and the entities `branch scope` block keeps 6.8's `isLead`
  pair, red with its branch condition removed.

**Database reads.**

- `lib/entry-refs/read.test.ts`: two branches hold entry `e1` with
  different long content, each past the short preview's cut.
  `readEntryIndex` on each branch returns that branch's wide excerpt.
  Removing the branch condition from `readWideExcerpts` turns one of
  the two red.
- `system-entry.ts`'s read selects by branch and id, and
  `lib/actions/story-entries/system-entry.test.ts` stays green. No test
  can fail without that condition, since the id is fresh.
- The PR body lists the plan's re-check of id reads on branch-scoped
  tables, each scoped or with its reason.

**The dead mirrors.**

- With the default,
  `grep -rn "entryAssetsStore\|eraFlipsStore" lib components app hooks`
  finds nothing, and the two register suites' DB assertions still pass.
  With hydration instead,
  `lib/actions/stories/load-open-story.test.ts` shows both stores
  holding the opened branch's rows.

**Register tests.**

- Every one of the 55 registered handlers has its pair, against a
  second branch holding the same ids: the 39 in the 12 register suites,
  and the 16 state-patch handlers in
  `lib/actions/entities/state-patch-actions.test.ts`, each in a
  `branch scope` block.
- The PR body carries a table with one row per handler and branch
  condition: the handler, the condition removed alone, and the test
  that turned red. Every row names a red test, and every one of the 55
  handlers has at least one row.
- `lib/actions/chapters/chapter-delete-preview.test.ts`: on branch A,
  with branch B holding a chapter under the same id, a later chapter
  and the same entries under their ids, the preview's
  `chapterNumber`, its latest check and its `after` read A's rows; a
  pending close on B alone leaves A's `after` reading as no manual
  close. Removing each of the four branch conditions turns a case red.

**Redo.**

- `lib/stores/ui/undo-redo.test.ts`: push on A and on B; peek and pop
  on A leave B's top; `clear(A)` and `drop(A)` leave B's stack; after
  either, the map has no entry for A; `hasRedo` and the top hook answer
  per branch.
- `lib/actions/story-entries/undo.test.ts`: undo on A pushes A's group.
  With B hydrated, `redoLastAction(B)` refuses `nothing-to-apply`, and
  a committed write on B leaves A's group. Hydrated for A again,
  `redoLastAction(A)` restores the undone row. This is the unit half of
  the milestone's Redo item.
- The same file: a test group minted for A whose snapshots name B,
  pushed on A, is refused `integrity` by `redoLastAction(A)`.
- Each clear site's existing test gains a group on a second branch that
  survives: `apply-delta-action.test.ts` (`:61`, and the group path),
  `lib/actions/story-entries/operational.test.ts` (an edit and a
  rollback through `commitNewAction`), `remove-chapter.test.ts`,
  `regenerate-turn.test.ts` and `undo-rerun.test.ts`. Making `clear`
  ignore its branch turns each red.
- `components/reader/use-reader-undo.test.tsx`: with A's stack holding
  a group, the hook on B shows no Redo label and its Redo reports
  nothing to redo; on A the label names the group, and the notice after
  an undo on A offers Redo.
- `lib/actions/stories/delete-story.test.ts`: groups on both of the
  story's branches and on another story's branch; after the delete the
  story's two stacks are gone and the other stays; a delete that doesn't
  commit drops neither.
- If Slice 6.8 hasn't landed: `set-lead.test.ts` shows both of the
  story's branches cleared and another story's branch kept. If it has:
  `grep -n "undoRedoStore" lib/actions/stories/set-lead.ts` prints
  nothing.
- If Slice 6.3 has landed: the test holding its parent-Redo criterion
  (`lib/actions/stories/fork-equivalence.test.ts`) also asserts
  `hasRedo(child)` false after the fork, and pushing a group on the
  child's branch inside the fork turns it red.

**Cleanup.**

- `grep -rnE "global (\(cross-branch\) )?redo stack|single global stack" lib components app hooks`
  finds nothing.

**Gates.**

- `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, `pnpm format:check`,
  `pnpm compiler:check` and `pnpm test:run` pass.
- The full desktop E2E suite, `pnpm test:e2e`, passes after
  `pnpm build:web`: the sweep reaches the reader, World, Plot, History,
  the Chapter Timeline and the close overlays, and it should need no
  spec change, since E2E asserts in the database.
- Desktop smoke through the `electron-app` MCP on the seeded hero
  story: the reader, World, Plot and an entity's History render their
  rows; CTRL-Z then CTRL-Shift-Z restores the row. A device check on a
  slot AVD is optional and blocks nothing.

## Tests

- **Unit, `--project unit`.** The factory, the derived getters, the
  lint pin, the History target, `read.test.ts`, the redo store,
  `undo.test.ts`, the clear sites' suites, `use-reader-undo.test.tsx`,
  `delete-story.test.ts`, the 13 suites that carry the register pairs,
  and `chapter-delete-preview.test.ts`. Every `__redoGroupForTest` call
  (41 calls in 14 test files at `8b5da25ac`) and every `hasRedo()`
  assertion gains a branch; an assertion that a clear emptied the stack
  now checks the write's branch, so it can fail.
- **Storybook, browser project.** No new compound. Stories whose
  fixtures hydrate a store keep rendering through the branch reads;
  `pnpm test:run` covers them.
- **E2E.** None new. The full suite is the regression net for the
  sweep; the Redo E2E through a switch is
  [Slice 6.4](./04-switching-navigator.md)'s.
- **Mutation check.** The register pairs are the slice's main risk of
  passing vacuously, since one handler can hold several branch
  conditions and a pair can catch only some. Remove each alone, as the
  table above records. Also break: the branch read returning the map
  for any branch; the hook selecting `rows` without `loadedBranch`; a
  derived getter ignoring its branch; `clear(branch)` clearing every
  branch; `readWideExcerpts`'s condition. Copy a file aside and restore
  it with `cp`; never `git stash`. Never derive an expectation from the
  code under test.

## Open questions

Each has a default this doc builds on; slice planning confirms it.

- **Unaudited contract text.** This doc builds on two pieces of
  contract wording the milestone's
  [Open questions](../milestone.md#open-questions) list as unaudited,
  both added after the contract audit from this slice's first draft:
  C5's raw-read rule (the guard bans raw row reads outside
  `lib/stores/`, and 6.2 swaps the map argument on three lead lines)
  and C6's group branch (a `RedoGroup` carries its branch, and a push
  reads it from the group). The "if the other has landed" criteria are
  unaudited too. Read them against the code at slice planning.
- **The accessor's shape.** Default: the four reads above, the branch
  read returning the live map or one shared empty map, the hook taking
  a selector as `useRows` does. Open: the names, and whether the raw
  members leave the store objects altogether once nothing outside
  `lib/stores/` may call them. Leaving them makes the type system the
  guard, but tests read them heavily, and C5 asks for a lint rule or a
  source-scan test.
- **The rule's placement.** Default: `no-restricted-syntax` beside
  `HERMES_BUILTIN_BANS`, which no generationStore owner block
  overrides. If planning picks `no-restricted-properties`, every owner
  block, 6.6's new one included, has to spread the bans, and the pin
  test has to check a file under each.
- **The dead mirrors.** Default: remove both; the first reader adds its
  mirror and hydrate together. Hydrating them instead costs two reads
  on every open for stores nothing reads, and keeps two patchers and
  their tests alive. Does the developer prefer to keep them for a later
  reader (era flips on display, entry images)?
- **Register coverage.** 55 handlers in 13 suites. The 16 state-patch
  handlers carry the most branch conditions, several through helpers,
  and a pair per handler won't reach them all; the table in the PR
  body is the measure, not the pair count.
- **Size.** Planned at 15, now nearer 17, as the milestone's Sizes item
  says: the sweep is 111 raw reads in 36 files, and the register pairs
  cover 55 handlers, not the 39 first counted. If the plan skeleton
  passes 20, the register two-branch tests split into their own slice:
  nothing waits on them, while 6.4's landing waits on the accessor and
  the redo map.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
