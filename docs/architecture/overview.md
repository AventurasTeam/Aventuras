# Overview

The shape of the repository, the data the app is built around, and the path a turn takes through it.

## Project Structure

```text
aventuras/
├── src/                     # SvelteKit frontend source
│   ├── routes/              # SvelteKit pages (+page.svelte, +layout.svelte)
│   ├── themes/              # Theme definitions (dark, light, solarized, ...)
│   └── lib/                 # Shared application logic and components
│       ├── components/      # UI components (PascalCase.svelte)
│       ├── services/        # Business logic modules (AI, generation, import/export, etc.)
│       ├── stores/          # Svelte stores (*.svelte.ts for runes) — story, ui, settings, debug
│       ├── hooks/           # Reusable Svelte hooks/composables
│       ├── constants/       # Shared constant values
│       ├── types/           # TypeScript types
│       └── utils/           # Utility functions
├── src-tauri/               # Rust backend (Tauri 2)
│   ├── src/                 # Rust source (main.rs, lib.rs, backup.rs, avt_import.rs, sync/)
│   ├── migrations/          # Numbered SQLite migrations (sqlx)
│   ├── capabilities/        # Tauri ACL/permission definitions
│   ├── icons/               # App icons per platform (incl. iOS)
│   ├── gen/android/         # Android scaffold files (tracked in git — DO NOT OVERWRITE)
│   ├── gen/apple/           # iOS Xcode scaffold (tracked in git — DO NOT OVERWRITE)
│   ├── Cargo.toml           # Rust dependencies
│   └── tauri.conf.json      # Tauri configuration
├── static/                  # Static web assets
├── scripts/                 # Build, release, and Android setup scripts
├── third-party-licenses/    # License texts for bundled third-party code (e.g. Harper)
├── .github/workflows/       # CI/CD (lint/typecheck, release, pre-release)
├── lefthook.yml             # Git hooks configuration
└── package.json             # Node dependencies and scripts
```

### Importing `src/lib`

`package.json` maps `#lib/*` to `./src/lib/*`, and every specifier names the file with its real
extension: `#lib/services/database.ts`, `#lib/stores/settings.svelte.ts`,
`#lib/components/ui/button/index.ts`. The generated `$app/tsconfig` enables
`allowImportingTsExtensions`, so `.ts` is written as `.ts`. There is no `src/lib/index.ts`, so
there is no bare `#lib` entry either.

`aubr check` cannot hold this convention on its own, so `local/lib-import-exists` in
`eslint.config.js` does. Two gaps:

- **TypeScript accepts `.js` for a `.ts` file.** Under `moduleResolution: "bundler"` it maps
  `#lib/x.js` to `x.ts`, and the `lib-alias` task of `sv migrate sveltekit-3` relies on it: it
  gives an extensionless `$lib/…` path the extension of the file it finds, spelled `.js`
  (`ui.svelte` becomes `ui.svelte.js`, `types` becomes `types/index.js`), and leaves a path that
  already has an extension alone. Its output passes `check` with those spellings.
- **TypeScript never sees `vi.mock` paths.** Vitest resolves the string itself. A path that does
  not resolve, including a leftover `$lib/…`, registers a mock that never applies, and the test
  runs against the real module without any error.

The rule requires each `#lib` specifier, in imports, exports, `import()` and the `vi` module
calls, to be an existing file whose path matches case exactly. It reports `$lib` outright. The
case check matters on Windows and macOS, where TypeScript resolves `#lib/Services/…` and Linux CI
does not.

### UI components

`src/lib/components/ui/` began as shadcn-svelte output and is now maintained by hand on bits-ui.
There is no `components.json`. The generator's Tailwind 3 registry can't be reached from a
Tailwind 4 project, and current output fails `check` and `lint` here and doesn't match these
components. Write a new primitive on bits-ui. The evidence, and what bringing the generator back
would take: [shadcn-svelte.md](../development/shadcn-svelte.md).

## Panels and gestures

Two panels flank the story: the world sidebar on the right (`Sidebar.svelte`) and the story
navigation panel on the left (`StoryNavPanel.svelte`). Each opens with a swipe away from its own
edge, and that same direction then keeps carrying the reader further in, while its opposite walks
back out and finally closes the panel.

| Panel                   | Opens with  | Next tab    | Back, then closes |
| ----------------------- | ----------- | ----------- | ----------------- |
| World sidebar (right)   | swipe left  | swipe left  | swipe right       |
| Navigation panel (left) | swipe right | swipe right | swipe left        |

One consequence is easy to undo by accident: **each tab strip is ordered so that the tab nearest
the story is its default and the one a further outward swipe closes from.** The sidebar runs
Characters -> Branches left to right and starts on Characters; the navigation panel runs Timeline ->
Navigation and starts on Navigation. Reversing either list, or moving a tab into it at the wrong
end, leaves the opening swipe with nowhere to go and puts the close on the wrong tab.

Only the _first_ opening uses that default. Both panels keep their current tab in `ui.svelte.ts`
(`sidebarTab`, `navPanelTab`) rather than in the component, so closing and reopening returns the
reader to where they were. Holding it in the panel would reset it on every mount, which reads as
the panel forgetting what you were doing.

## Edge swipes

The edge swipes that open the two side panels live in `AppShell.svelte`, and each listens only
while _neither_ panel is open: a swipe inside an open panel belongs to that panel's tab strip, and
one panel must never open over the other. For the same reason opening either panel closes the
other first wherever the panels overlay the story, and narrowing the window past that width with
both open closes the navigation panel.

They are read off the shell itself, counting only gestures that _start_ within 30px of an edge (20px
above the mobile breakpoint), not from invisible strips over the page. A strip takes every tap that
lands on it, and on a phone the outer halves of the header's panel button and of Send sit within
that band. A gesture that starts in a text field is never a swipe, so placing a caret or selecting
text in the action input cannot open a panel. Because swipes inside a panel bubble up to the shell, a panel must never reach the
opposite edge's band. On a phone neither does: the sidebar is capped at 288px and the navigation
panel at `100vw - 3rem`.

The one swipe inside a panel that may not bubble up is over the Branches panel's tree. When the tree
could still scroll in the swipe's direction as the gesture starts, it stops the `touchend`, so the
swipe scrolls the tree and changes no tab and no panel. At the tree's edge the swipe goes through.

## Drawer swipes, and the one place we reach into `vaul`

A drawer that holds unsaved work has to answer a swipe with a question rather than a close, and
`vaul` offers no veto: it decides inside its own release handler. `createDrawerSwipeGuard`
(`ui/drawer/swipe-guard.ts`) takes the one seam there is — `vaul` calls the content's
`onpointerup` just before it measures the swipe — and, when the caller says the drawer is dirty,
puts the sheet back at rest so that measurement finds nothing to act on, then animates the settle
itself.

**On upgrading `vaul-svelte`**, check three things against the new version, because the guard
copies them rather than importing them (they are internal):

- the release callback still runs before the swipe is measured (`use-drawer-content.svelte.js`),
- `VELOCITY_THRESHOLD` and the settle transition in `internal/constants.js`, mirrored in the
  guard, and
- `closeThreshold`, which the guard reads from `DRAWER_CLOSE_THRESHOLD` and `drawer.svelte`
  passes to `vaul`; the two must stay one constant.

If the seam closes, the fallback still holds: a dirty drawer that closes anyway comes back as a
fresh sheet once the old one has released its scroll lock — slower, but not broken.

Two other `vaul` behaviours the callers have to know: it closes a non-dismissible drawer when its
handle is tapped, and a close driven from our side never reaches its restore, so the scroll lock
is released by hand (see `utils/scrollLock`).

## The soft keyboard

`MainActivity` calls `enableEdgeToEdge()`, which sets `decorFitsSystemWindows = false` and with it
gives up the window resizing `adjustResize` would otherwise do on API 30 and later. Nothing then
shortens the WebView when the keyboard opens, and Chromium is not told either: `innerHeight` and
`visualViewport.height` both stay at the full screen, so the keyboard simply covers whatever was
under it, the focused field included.

So `onWebViewCreate` takes the `ime()` inset for itself and sets it as the WebView's bottom
margin. That shortens the laid-out view, so the layout viewport is shorter, so `vh`, `dvh` and
every fixed surface end at the keyboard instead of running under it. The margin is load-bearing
and padding is not a substitute: a padded WebView keeps its measured height and the page never
relayouts. Below API 30 the window still resizes on its own, the decor consumes the inset before
it reaches the WebView, and the margin stays at zero; `SOFT_INPUT_ADJUST_RESIZE` is set
explicitly so that path does not resolve to panning.

`AndroidBridge.getInsets()` reports the bottom inset net of the keyboard. With the keyboard up the
navigation bar is underneath it and the view already ends at its top edge, so `--sab` goes to zero;
otherwise every surface padded by `--safe-bottom` keeps a bar-height strip of background above the
keyboard. `app.html` refreshes the variables on `resize`, which the margin change fires.

Keyboard geometry has that one owner. Nothing in the page listens to `visualViewport`, and the
bottom drawer's own `repositionInputs` is switched off in `ui/drawer` on Android: it measures the
keyboard as the difference between `innerHeight` and the visual viewport, which there is now always
zero. Elsewhere it stays on, since nothing else shrinks the layout viewport for the keyboard.

The page cannot fix this from its own side. `interactive-widget=resizes-content` in the viewport
meta asks the _browser_ to shrink the layout viewport, and in an embedded WebView that resize can
only come from the embedder's window, which edge-to-edge has opted out of. It was tried, and
changed nothing.

## Focus inside a long dialog

`Dialog.Content` traps focus, and the trap has one fallback: when the element holding focus is
removed from the DOM, it focuses the first tabbable element in the dialog. A long editing dialog
removes focused elements all the time (a card folds, a Clear button vanishes, an overlay's Back
button unmounts), and a fallback that lands on a control at the top scrolls the whole surface up
to it. `TimelineReconciliationModal.svelte` is the worked case.

The rule that makes this a non-problem rather than a list of cases: **the dialog's scroll region
is its first tabbable element** (`tabindex="0"`, `role="region"`), sized to the viewport rather
than to its content. Every fallback then lands on a container already in view, and focusing it
does not scroll. Two things keep that true, and both are structural:

- nothing tabbable is placed before the region in DOM order — in the narrow layout that means
  the title strip above it, in the wide layout the region already wraps the title;
- the region keeps its `min-h-0 flex-1` sizing, so it never grows past the viewport.

`holdFocus` calls remain where a card is about to disappear under an open soft keyboard, so the
keyboard closes before the card does; they are no longer what stops the scroll.

## One way out of a dialog

A dialog has exactly one dismiss control: either the header's X or a Cancel button, never both.
Two controls that do the same thing make the reader wonder how they differ, and a Cancel beside a
confirming action is the clearer of the two wherever the dialog asks for a decision. Such a dialog
passes `closeButton={false}` to `ResponsiveModal.Header`; the X stays for dialogs that only show
something and have no action to cancel. The rule is about controls drawn on the dialog, not the
platform's own gestures: on a phone the dialog is a drawer, and swiping it down stays available
whenever Cancel is (`dismissible`), so it is withheld only while a write is in flight.

## Data Model

The story is an append-only list of `StoryEntry` rows (`user_action`, `narration`, `system`),
each carrying a `position` and a `branchId`. Almost everything else hangs off that list:

- **Branches** fork at a `forkEntryId`. `story.entries` is the current branch's view, assembled
  from the branch's own rows plus everything inherited from its ancestors; `visibleEntries` is
  that list minus what has been folded into chapters.

  **Editing an entry from before a fork changes that entry for every branch below it — but only
  its text.** Say a branch was forked at entry 30, and entry 12 is then rewritten. Entries are one
  set of rows that branches point into, never copies, so the new branch shows the new wording
  immediately. What it does _not_ show is any consequence of the rewrite: the world state it was
  given when it forked, the change records a rollback would undo, and the clock stored on the
  fork's checkpoint were all derived from the old text and are left as they were. So
  the branch can be reading a passage that no longer mentions a knife while its world state still
  holds one. Nothing detects or reports this.

  `updateEntry` guards the wrong thing here. Its one rule is that the entry must belong to the
  branch you are on, which allows the rewrite above (entry 12 belongs to the branch you are
  standing on) and refuses the reverse case, where you stand on the new branch and edit entry 12
  — the edit that would have had the same effect, from the branch that cares about it. That is
  known, and left alone until we decide what editing shared history should mean.

  An inherited entry carries a lineage marker in the slot the fork marker uses, and shows no Edit
  or Delete: both are refused on it, as are a past checkpoint and a branch from it. Its popover
  names the branch the entry belongs to, where those actions are.

- **Entry numbers** are what a reader sees and types: `position + 1`, every entry type counted,
  so the last entry's number equals the branch's entry count. Numbering is per branch view — a
  branch continues its parent's positions from the fork, so shared history keeps its numbers and
  sibling branches reuse them after the fork. `resolveEntryByNumber` (`utils/storyNavigation.ts`)
  floors to the nearest lower entry, which is what makes a gap left by an import or a reconciliation
  navigable rather than a dead number.
- **Chapters** cover a contiguous run of entries (`startEntryId`/`endEntryId`) and replace them
  in the prompt with a summary. Entries after the last chapter's end are the **un-chapterized
  tail** (`story.getUnchapterizedEntries()`) — the newest material, and the part chapter-oriented
  tools would otherwise be blind to.

  The story view can mark them with banners (`showChapterBanners`, off by default).
  `buildChapterBanners` (`utils/chapterBanners.ts`) places one before each chapter's first entry
  and one before the tail, from `currentBranchChapters`. A chapter needs both its ends in the
  loaded entries, as `getChapterEntries` does, and the tail begins where
  `getUnchapterizedEntries` says it does (`lastResolvedChapterEnd`), so the two cannot disagree.
  The tail banner and its navigation row are unnumbered — the tail is not a chapter yet — and read
  "The Story Continues". Banners link to their neighbours in story order, not `number` order,
  which can disagree after a branch switch. A banner renders inside its entry's `data-entry-id`
  wrapper, so every jump to that entry lands on the banner above it.

  The navigation panel lists the same chapter starts as landmarks whether or not banners are
  shown; with them off, the jump lands on the chapter's first entry. A chapter or tail row
  never switches branch in "Switch to checkpoint branch" mode: its start can lie in an ancestor's
  history while the chapter is in the current branch's view all the same.

  A jump lifts the view so the entry above the landing shows, whole when it is within 30% of the
  viewport and clipped at that height when it is taller, whatever its kind. Part of the gap between
  cards stays above it so its top border is not flush with the edge; that part is kept under the
  whole gap, or the card before it would show (`contextLift`). Where the view cannot scroll that
  far, because the landing is near the end, the lift is reduced by what the landing already gained.
  A jump to the last entry is not a scroll break, so a narration being streamed is still followed.

  The list also carries a **First entry** row on the branch's first entry and a **Last entry** row
  on its last (one row, First entry, when there is a single entry). Both stay on the current
  branch in every navigation mode. The list's filter has three remembered options, one per group
  of rows (`filterLandmarks`): the first and last entry (`nav_show_first_last`), the chapter rows
  and the tail row together (`nav_show_chapters`), and the checkpoint rows together with the origin
  row of a branch, which is named after its fork checkpoint (`nav_show_checkpoints`). The orphaned
  checkpoints section is not filtered: it is where they are cleared out.

- **World state** (`Character`/`Location`/`Item`/`StoryBeat`) is rewritten by the classifier after
  every turn. A lorebook `Entry` carries no live state of its own: the type has `state` fields
  per entry type, but every creation path initialised them blank and nothing ever wrote one
  (0 of 16 character entries on a measured 41-chapter save), so the four Tier 1 conditions that
  read them never fired and are gone. Presence is `WorldStateInjector`'s claim to make. The
  never-produced `mentionCount`/`firstMentioned`/`lastMentioned` are gone from the model too;
  their columns stay, with their defaults. It is _not_ the Lorebook: `Entry[]` records are
  authored lore that changes only when someone edits them. The two pools never overlap, and
  two different services inject them.

  **A rendered entity line must never be re-readable as a name.** The classifier is shown
  the entities that already exist and writes names back, so `- Eira (claimed as a consort)
[inactive]` came back as the name, missed `sameEntityName`, and created a second
  character — four of thirty-eight on a measured 41-chapter save, two carrying the
  subject's own `relationship` verbatim. Name and attributes are now separate lines
  (`relationship:`, `status:`, `appearance:`), in every list `ClassifierService` renders —
  characters, locations, items, story beats — and in `WorldStateInjector`'s narrator block,
  whose prose the classifier also reads. One name per line also holds names a
  comma-separated list could not: locations and items were CSV until they carried state.

  **State reaches the classifier only where it can act on it.** `appearance:` goes with a
  character in the scene, `description:` with the current location, and an item's
  `quantity`/`equipped`/`location` only when they differ from the default — because each of
  those is a whole-value replacement, and a model cannot rewrite what it was not shown. The
  same rule sizes the prompt: on a large cast the omitted halves are most of it.

  **`scene.currentLocationName` is the only thing that moves the scene.** It creates the
  location if the name is new, marks it `current` and `visited`, and clears the previous
  one. `locationUpdates.changes.current` and `newLocations[].current` did the same job from
  two other places, applied in an order the model could not see, so a response naming two
  places kept whichever ran last — and the merge path set a second `current` without
  clearing the first. Both are gone from the schema.

  **An item's `location` is `'inventory'` or a location id; the classifier speaks names.**
  `utils/itemLocation.ts` converts both ways. On the way in, `inventory`/`carried` is the
  inventory, `worn` the inventory and equipped, `ground`/`here` the scene's location, and a
  name its location by `sameEntityName` (then without a leading article); a name matching
  none is a part of the scene's place, and so is an item worn or carried by a character other
  than the protagonist. With no scene location an update keeps the item where it was and a
  new item goes to the inventory. Only a held item can be equipped. Items are applied after
  the response's locations and scene change, so a place named in the same response resolves
  and `ground` is where the passage ends. The id stored is the root a branch override stands
  in for, which every branch resolves (`overridesId`).

  Every reader (the panels, both prompts, the retrieval tool) goes through
  `readItemPlacement`. Legacy free text is read leniently and not migrated: a location's name
  as that location, a lone `worn` as equipped, a lone `inventory`/`carried` as the inventory,
  anything else as its text. The next classifier update to the item, or a save in the panel,
  rewrites one it can read (`normalizeItemLocation`).

  **Presence is reported, departure is inferred.** The classifier answers one question about the
  cast — `scene.presentCharacterNames`, every _other_ character in the scene at the end of the
  passage; the protagonist is in every scene by definition and is added by the consumers — and
  `resolveCharacterPresence` (`services/generation/characterPresence.ts`) turns the complement into
  `inactive`. Asking a model to name thirty absent characters produces nothing; asking it to name
  the three in front of it is the question the passage answers. The inference is refused whenever
  the list carries no signal: a salvaged or failed classification, or an empty array — which the
  schema defaults, so "the model said nobody" and "the model did not answer" arrive identically.
  `characterUpdates.status` stays for what the scene states outright, `deceased` above all, and
  wins over the inference. `appearance:` is sent to the classifier only for characters in the
  scene, and the template forbids rewriting an appearance it was not shown, so a returning
  character keeps the descriptors it accumulated.

- **State Tracking** (Labs) records every world and lorebook change in `world_state_changes`,
  which is what makes retry, time-travel delete and regenerate reversible (`rollbackService`) and
  lets a checkpoint be rebuilt at a past entry.
  See [state-tracking.md](state-tracking.md).
- **Checkpoints** are full state snapshots; **retry backups** are in-memory only and do not
  survive an app restart or a story switch. With State Tracking on, a retry backup copies no world
  state: the retry rewinds through the records, as a delete does (see
  [state-tracking.md](state-tracking.md)). The backup says which (`throughRecords`), so turning
  the feature on or off between a turn and its retry does not pick the wrong path. With it off,
  the lorebook is left as it is, as before. Either way the entries go through
  `deleteEntriesFromPosition`, so chapters on them are dropped. A checkpoint is anchored to its `lastEntryId` and is
  deleted with that entry - in the same transaction, alongside the chapters and embedded images
  that reference it. It is the fork point a branch would be created from, so an orphaned one
  yields a branch pointing at an entry the database no longer holds. A reader may delete a
  checkpoint directly only until it is used to create a branch; the persistence delete repeats
  that check so stale UI state cannot clear the branch's origin.

  **A checkpoint has no branch column**: it is owned by the branch of the entry it is anchored to,
  which `getCheckpoints` resolves through a LEFT JOIN on `story_entries` and hands to the store as
  `branchId` plus `anchored`. The join is a left one because a checkpoint whose anchor is gone is
  still worth showing - `anchored: false` is what the navigation panel lists as orphaned, and it is
  the only thing distinguishing that from a checkpoint that merely belongs to another branch, since
  both are absent from the loaded entries. Deleting a branch selects its checkpoints by the same
  rule, as a subquery inside the deletion transaction rather than from ids the store supplies, so
  cleanup does not depend on the store's list being complete.

  The store therefore loads every column **except `entries_snapshot`**, which copies the story up
  to that point and so outweighs the story itself several times over once every checkpoint holds
  one. Export, sync and backup take the whole row through `getCheckpointRecords`; the two shapes
  are `Checkpoint` and `CheckpointRecord`, and the split is what stops an export quietly shipping
  without the snapshots an import expects. A retry backup is scoped to
  a **branch** as well as a story: it records the branch it was taken on, is offered only there,
  and is refused on any other. Positions are reused by sibling branches after a fork, so a
  snapshot applied to the wrong branch deletes rows that merely share a number - and the
  world-state restore deletes the active branch's rows and **re-inserts only the snapshot rows
  belonging to that branch**. The delete is branch-scoped, so the insert has to be: a snapshot
  taken on a branch that resolves its world state through the lineage carries ancestor rows too,
  with their own `branch_id`, which the delete never touched. Re-inserting one collides on the
  primary key — and since these statements cannot share a transaction (see
  [persistence.md](persistence.md)), the deletes have already committed by then, so the branch
  loses its entries _and_ its own world state and the restore dies with nothing put back.
  Filtering makes the two halves symmetric whatever shape the branch is, which matters because
  `snapshot_complete` no longer reliably says which shape that is. An override the undone
  generation created is absent from the snapshot, so it is deleted and not restored — correct,
  because the inherited row it stood in for shows through again.

  That the branch ends up with nothing is not an experimental-settings matter: the per-branch
  entity queries match `branch_id` exactly and never fall back to inherited rows, main included
  when the snapshot came from a branch. Lightweight branches only decide how total it is — a
  pre-snapshot COW branch still resolves its ancestors' entities, while snapshot isolation and
  the legacy per-branch load both leave the panels empty.

- **Removing an entry a branch forks from is refused**, and the check runs before anything else
  the operation would rewind - a rollback, or the lorebook activation a retry restores - because
  a refusal raised afterwards would leave that half applied. Editing and deleting are refused the
  same way while a generation or a retry restore is running: the store throws, and the caller is
  expected to say so rather than treat the untouched story as a completed edit. **Switching
  branches is refused on the same grounds**, for as long as a generation holds the branch.

## Generation Pipeline

A narrator turn is a sequence of phases under `src/lib/services/generation/phases/`, each an async
generator that yields typed events and returns a result. Dependencies are injected, which is what makes
them testable without a provider.

`Retrieval → Narrative → Classification → Translation → Image / BackgroundImage → PostGeneration`, with
`PreGeneration` preparing the retry backup first.

Only the narrative phase is fatal on failure — there is no turn without a narration. Every other phase
degrades: a failed classification leaves world state untouched, a failed translation keeps the original
text, failed images leave the entry without one.

`RetrievalPhase` runs in two stages on purpose. Stage A (world state + lorebook selection) must finish
before stage B (memory retrieval), because the memory step is told what the narrator's prompt already
contains, and a _partial_ list of that is worse than none — it is read as a statement, so naming half of
it invites work on the other half.

Phases are wired by `GenerationPipeline`, but the dependency objects are built in
`src/lib/components/story/ActionInput.svelte` (`buildPipelineDependencies`). That is where the
store, the settings and `aiService` are bound together; the phases themselves import none of them,
which is what keeps them testable.

Alongside the pipeline, `BackgroundTaskRunner` handles what happens _after_ a turn — the chapter
threshold check, lore management and the style review — on its own dependency object.

### The generation lease

A generation is bound to the branch it started on, by a lease the initiating handler takes before
its first read or write and gives up after its last one. There are four such handlers, all in
`ActionInput.svelte`: `handleSubmit`, `handleRetryLastMessage`, `handleRegenerateNarration` and
`handleRetry`. `generateResponse` takes the lease as a required parameter, so a fifth cannot be
added without acquiring one.

Leaving the story is refused for the same reason, and so is opening another one: the
classification that follows a narration writes through whatever story and branch are live, so
swapping either out from under a generation sends its remaining writes to the wrong place. The
Library button and the Android back press both report the refusal rather than navigating.

The lease and a branch switch are mutually exclusive in both directions: acquiring is refused while
a switch is queued but unsettled, and `performBranchSwitch` refuses while a lease is held. That
second check sits inside the queued body rather than at `switchBranch`'s entrance, because a switch
accepted while idle reaches the front of the queue _after_ a generation may have begun.

Two moments are distinct. **Drained** is when the turn's own writes have settled; **finished**
is when a rewind deferred by Stop has run too, and only then is the branch given up.

The lease does **not** cover the post-turn background tasks — chapter creation and lore
management are started un-awaited and outlive it. Lore management refuses a write whose branch
has moved (`loreCallbacks.assertScope`), and does not start at all once its branch is no longer
open: the session's input thunk checks first, so it never reasons over another branch's lorebook.
Chapter creation numbers the chapter from the chapters captured with the turn and passes its
scope to `story.addChapter`, which always writes the row but adds it to the loaded list only while
that branch is open. Analyzed images outlive it too; a
generated portrait is saved only if its story and branch are still open and the character has no
portrait yet (`story.saveGeneratedPortrait`), and the write — including any copy-on-write
override — lands on the captured branch and reaches the in-memory list only while that branch is
still the open one. Stop registers
its rewind on the lease and waits for it rather than releasing — aborting the request to the model
is not the completion of the generation's writes, and an `applyClassificationResult` already entered
keeps going regardless. One release owner throughout, so the rewind cannot race the writes it
exists to reverse. Once the narration is saved, Stop is refused outright — the button dims and a tap
explains — since nothing after the narration observes the abort. "Generate a different response"
refuses it throughout, as its own rewind of the previous turn is already running.

**Why the switch is refused rather than the writes redirected.** `applyClassificationResult` reads
the active branch and mutates the in-memory `characters`/`locations`/`items`/`storyBeats` arrays,
which hold _that_ branch's view. Pointing it at another branch means decoupling "the branch being
written" from "the branch loaded in memory" — an architectural change, not a parameter. Redirecting
only the entries would be worse than redirecting nothing: the narration would land on the branch
that asked for it while the classification accounting for it did not, leaving that branch holding an
entry its world state does not know about.

**When the restriction can be lifted.** This covers the story guard too — it is the same
stand-in, for the same reason. Once world-state application takes the branch to write to as
an argument instead of reading the active one, **and** `addEntry` redirects to the bound branch
rather than asserting against it. Both, not either — the entry half alone produces exactly the
mismatch described above. Branch-scoping `isGenerating`, so Stop and the streaming placeholder
follow the generating branch, belongs to that work too; while the restriction stands the reader
cannot reach another branch to see them. `addEntry`'s assertion is the tripwire in the meantime: if
the exclusion is ever holed, a write lands as a thrown error rather than as a row on the wrong
branch.

### Activity reporting

A turn records what it is doing as a tree of timed steps, so the wait before the first token is
readable rather than a three-dot animation. `services/activity/` holds the record and the reading
views over it — nesting, the deepest running step, durations, retention — all plain TypeScript;
`stores/activity.svelte.ts` is the reactive shell.

The phases reach it through an `ActivityReporter` on `PipelineDependencies`, bound in
`buildPipelineDependencies` alongside everything else. They do not import the store: that is the same
rule that keeps them testable without a provider, and `NO_ACTIVITY` stands in wherever no reporter was
injected. Services under `services/ai/` write to the store directly instead, following the debug
store's precedent — their tests mock it the same way.

Nesting is by explicit parent id, threaded through the options objects that already reach those
services (`activityParentId`). An implicit stack would not survive Stage A's two concurrent branches
or the parallel post-narrative phases.

Retrieval reports through the record it already keeps: `retrievalSteps.ts` translates `RetrievalEvent`
into steps as `AgenticRetrievalService` records them, and chapter queries carry the `durationMs` the
budget already measured. Phases with several completion paths are wrapped by `trackPhase` rather than
instrumented one exit at a time.

Each request is its own step, opened by the caller that knows what it is for and passed down as
`activityParentId`. Below that, `sdk/generate.ts` puts `activityMiddleware` directly inside
`retryOn429Middleware`: a request that needs a second attempt gets one step per attempt (the first
backfilled) and one per wait the retry middleware schedules. The SDK's own retries re-enter the
chain and show as attempts; the waits between them are the library's and are not reported. The
agents, retrieval and lore management, build their model elsewhere (`sdk/agents/factory.ts`) and
have no attempt rows.

A failed step carries its reason, worded once by `describeActivityError` (status and provider
message for an API error). Services that absorb a failure into a fallback — translation,
suggestions, action choices, timeline fill, scene analysis, the background image, the classifier's
`_error` — return the fallback as before, with the reason as `failure`. Whoever opened the step
closes it: `trackStep` fails a step on a returned `failure` as on a throw. A service closes only
the steps it opened itself. A cancellation is never absorbed: the `AbortError` is rethrown
(`isAbortError`), and whoever catches it closes the step as skipped.
A turn ends with an outcome (`turnOutcome`): only `halted` puts "Failed" on the collapsed line, and
a turn halts only when it produced no narration. A narrator stream that fails after text has arrived
keeps that text as the narration and reports the failure; one that fails before any text is passed
again, like an empty answer, unless the request itself was refused.

The narrator's empty-answer loop reports _passes_, kept apart from the transport _attempts_ inside
them: a single pass has no container, and is grouped into `Pass 1` (`groupChildren`) only once a
second follows. An empty pass is a failure. The work the consumer does with a phase's result —
`Updating world`, `Saving translation` — is a step the consumer opens around that work. A phase
switched off in settings is not reported at all; one switched on but missing its profile is struck
through with that reason. A step recorded after the fact without a duration (`untimed`) shows no
time rather than `0s`.

Reporting never alters a turn. Every write is guarded, the display sits inside a boundary, and the
narrative retry loop is reported but unchanged. Records are session-only, bounded by `RETAINED_TURNS`,
and never persisted or exported.

`activityReporting` defaults to `line`, so an install that has never touched the setting reports the
running step rather than the ellipsis. `activity_reporting` is written only by `setActivityReporting`
and the interface reset, so a stored `off` is a choice and is read back as one — the default reaches
absent keys only.

A turn's timeline opens by default while it is the latest turn in `tree` mode, and in either
mode for any turn in which a step failed, a recovered attempt included, or finished with an error it
worked around, such as a salvaged classification. A reader's own choice wins until a step fails
after it: each record counts its failures, and a choice is kept only while that count is unchanged.

The recorder holds several records open at once. A step goes to the record of its parent, or to
the record named by `recordId`, or else to the newest open turn, which is where every
generation-path step without a parent has always gone. A parent in an ended record refuses the
step, so work unwinding from one record cannot land in another. There are two kinds of record:
`turn`, keyed by the narration entry and bounded by `RETAINED_TURNS`, and `chapter`, keyed by a
chapter creation card and kept as long as the card.

A turn's record stays open past its narration while its background work runs: **After the turn**
holds the style review and the chapter check (`BackgroundTaskCoordinator`), and the record ends
when both have settled. The input is free as soon as the narration is in. A check or review that
is not due is not recorded, and an empty **After the turn** is dropped. Until a later turn starts,
the spinner under the latest entry names them ("Checking for a new chapter...",
`ui.chapterCheckActiveFor`, and the style review's own loading flag). When the check cuts a
chapter it records a hand-off and the card starts at once, without waiting for the style
review; the summary and lore management go to the chapter creation card's own record instead:
lore management's model calls, each named for why the loop makes it (`loreModelCallReason`), each
followed by its tool calls at the same level, and **Saving changes**, one step per lorebook write,
after the last call. The agent only approves changes into its ledger; `saveLoreSession` writes
them once it has finished.

### Chapter creation cards

A chapter cut automatically after a turn is reported by a card in the story, right after the
narration of the turn that cut it (`ChapterCreationCard.svelte`). The card is virtual: never a
story entry, never sent to a model or counted, held for the session only
(`services/chapterCreation/`, wrapped by `stores/chapterCards.svelte.ts`), and shown only on its
own story and branch. It carries its record with the same line and tree as an entry's report,
following the reporting setting.

It finishes when lore management finishes: with banners on it names the chapter and offers
**Go to Chapter N**, landing on the banner, and **Dismiss**; with banners off it reads that
chapter creation is finished. A failed summary leaves no chapter and offers **Retry**, while
the span is still the first one no chapter covers, and **Dismiss**; a later turn cuts the span
again. A retry runs outside the turn's background tasks, so it is put off while another chapter
check, card or lore management run on the branch is in progress (`cutState`), and `createManualChapter` refuses while a
card on the branch is pending, as it does during a turn's background tasks. Lore management that fails, or is refused by the branch lock,
leaves a chapter without its lore, so the card offers **Restart lore management**, recorded as a
further run in the same record (`reopenRecord`), and **Delete incomplete chapter**. Delete, here and
in the Memory view, is offered only for the branch's last chapter, and `story.deleteChapter`
refuses any other, and any while `chapterCards.busy`: the next chapter starts where the last ends,
so an earlier one's entries, or the one a running cut started after, would stay uncut. Deleting a
chapter, from anywhere, removes its card. A card whose narration a retry or a delete removed is shown after the last entry. Both kinds of
failure also raise a toast, since the reader may already be on the next turn or another branch.

While a chapter check on a branch is asking the model, a card on it is summarizing or running lore
management, or any lore management run holds it, a turn on it starts no chapter check
(`chapterCards.busy`): a second chapter cut meanwhile would cover the same entries, or have
its own lore management refused.

## Images

Nine backends live under `src/lib/services/ai/image/providers/` — NanoGPT, OpenAI, OpenAI Compatible,
OpenRouter, Google, Z.AI, Pollinations, plus local ComfyUI (workflow-based) and A1111. All of them
generate through the AI SDK's `generateImage` (`sdkImage.ts`), so retry, abort and the result shape
are the same everywhere. OpenAI, OpenAI Compatible (a user-supplied proxy), OpenRouter and Google use
their SDK providers; Pollinations and Z.AI speak the OpenAI image API and reuse the OpenAI
Compatible helper. Three backends have no usable SDK provider and get a small custom
`ImageModelV4` each:

- **NanoGPT** (`nanogptImage.ts`): its unified `/images` endpoint covers text-to-image and edits in
  one request and is not the OpenAI shape.
- **A1111** (`a1111Image.ts`, also Forge, SD.Next and KoboldCpp): no maintained SDK provider speaks
  its API, and the community package cannot use the app's HTTP transport.
- **ComfyUI** (`comfyImage.ts`): ComfyUI only announces a finished job over a WebSocket, so the app
  submits the workflow and checks on the job over plain HTTP instead. That keeps it on the same
  transport as every other backend. If the user cancels, or the app gives up on a job it has
  already queued, it tells ComfyUI to cancel that job so the server is not left generating an
  image nobody will see.

**Supported ComfyUI: 0.26.0 and later** (`MIN_COMFYUI_VERSION` in `comfyImage.ts`). That is the first
release with a single job-status route and a cancel that can only stop the app's own job, never
someone else's. Older servers are refused with a message asking the user to update; a server that
cannot be asked its version is let through.

Resolution is chosen as an **intent** — orientation (1:1 / 16:9 / 9:16) plus one of four size
steps — and each adapter turns it into what its backend accepts: an aspect ratio for Google, a
ratio plus a resolution tier for OpenRouter, the model's own published resolution list for NanoGPT,
real dimensions for ComfyUI/A1111/Pollinations, and a snapped-to-grid size inside Z.AI's limits
(`src/lib/utils/image.ts`). A backend that is handed pixel dimensions it does not offer answers
with the nearest thing it does, which is not the same picture.

Only a 429 is retried, because any other failure may already have been billed. The same rule has
one sharp edge: when a reply gives a URL and the SDK downloads the image itself, a 429 from the
image host makes the whole generation run again, and it is billed again. The key is sent only to
the API's own origin, and redirects are checked rather than followed blindly.

Each adapter keeps its own model discovery and size handling; discovery throws on a failed request
rather than substituting a list. Whether a provider takes an API key or a base URL is declared per
provider in the registry (`PROVIDER_API_KEY`, `PROVIDER_BASE_URL`), and the settings form and
`hasRequiredCredentials` read those tables. Migration `042` moved image settings that still named an
API profile into image profiles, moved proxy-style `openai` profiles and every `chutes` profile
(that provider is gone) to OpenAI Compatible, and pinned `zhipu` profiles with an empty base URL to
`open.bigmodel.cn`, which they used before the default became `api.z.ai`.

Every cloud provider except Z.AI takes reference images. A1111 takes them only with its profile
switch on, and ComfyUI only through a custom workflow's selected nodes. The registry holds each
provider's reference limit (`PROVIDER_REFERENCE_LIMIT`), downloads nothing for a limit of 0, and
otherwise cuts the references to the smaller of that limit and the model's `maxReferenceImages`
before fetching `http(s)` ones to base64, so every adapter receives raw base64. A reference URL can
come from a discovery card, so it is fetched only from a public host and each redirect is checked
the same way (`fetchPublicImageBase64`); a name that merely resolves to a private address is not
caught. A NanoGPT reply that carries a URL instead of base64 gets the same public-host check, and
that download is not redirected. A reference that cannot be fetched is dropped and the image is
generated without it. Google takes them on every image model it lists.

Two local backends take them differently. A1111 sends them as `extra_images` on the `txt2img`
request; `init_images` is not used, because that is a canvas to denoise, not a reference. Only
sd.cpp documents `extra_images` on `txt2img`, and KoboldCpp, built on it, most likely follows;
stock A1111 and Forge ignore the field. The profile's "Model takes reference images" switch
(`takesReferences`, off by default) is therefore the only thing that makes the registry send them,
and keeps the `edit_image` refusal in place for a server that would drop them.

ComfyUI uploads each reference to the server's `temp/aventuras/` folder and writes the file names
(`… [temp]`) into the custom workflow's selected `LoadImage` nodes in node-id order. Unselected
nodes keep their saved image. The registry sends at most one reference per selected node, so the
adapter's drop-with-a-warning only matters to a direct caller. Which nodes are selected is the
profile's `referenceInputPaths`; when absent, `suggestReferenceInputs` walks the graph downstream
from each `LoadImage` and de-selects one whose picture reaches a ControlNet, IP-Adapter,
preprocessor, mask or inpaint node, or is VAE-encoded into a sampler's `latent_image`, unless
another path reaches a reference consumer (`ReferenceLatent`, `TextEncodeQwenImage*`).
The server reports node types, not intent, so this is only the default: the picker under the
workflow summary in the image settings is the authority, and it is pre-filled from the probe when a
workflow is loaded. Names are a hash of the bytes, so an image reused across scenes is stored once,
and concurrent generations share a pending upload. ComfyUI empties `temp` on restart; a per-profile
switch (`inputReferences`) uploads to `input/aventuras/` instead, which it never clears. The
built-in basic, LoRA and UNet workflows take none, so the registry downloads nothing for them
(`comfyReferenceLimit`).

Images are stored as base64 in SQLite. Export and import of a story with images (`.avt`) is
handled natively in Rust so the payloads never enter the WebView heap — see
[persistence.md](persistence.md).

### Local image servers on iOS

App Transport Security blocks the WebView's `fetch` to plaintext `http://` hosts outside the
local-network exception, and it does so silently. Local backends therefore make every HTTP call
through Tauri's HTTP plugin (`imageGetFetch` for discovery, `createSdkFetch` for generation), on
every platform.

## Network transport

Remote HTTP goes through `@tauri-apps/plugin-http`, not the WebView's `fetch`: the endpoints are
user-configured, so CORS, Android's cleartext block and iOS ATS (above) would each break some of
them. `httpFetch` (`utils/http.ts`) is the only way into the plugin, and an ESLint rule rejects
any other import of its `fetch`. Prefer the existing helpers built on it: `createTimeoutFetch` for
AI SDK providers, `createSdkFetch` for SDK image models (Tauri transport, request guard and
debug logging; Google, OpenAI, OpenAI Compatible, Pollinations, Z.AI, OpenRouter, NanoGPT, A1111 and
ComfyUI use it; ComfyUI polls through `createPollSdkFetch`, which keeps them in one entry so they
do not push the generation POST out of the debug store's last 100 entries),
`imageGetFetch` / `fetchPublicImageBase64` for model
discovery and reference fetching, `corsFetch` for discovery.

What the plugin changes for the server on the other end:

- No `Origin` is sent unless the caller sets one. The plugin would otherwise send the webview
  origin (`http://tauri.localhost` on Windows and Android, `tauri://localhost` elsewhere, the
  dev-server URL in dev), which local servers reject. `httpFetch` sets `Origin: ''`, which the
  plugin drops under `unsafe-headers`. A caller's `Origin` and `Referer` are sent as set.
- `unsafe-headers` lifts the plugin's whole forbidden-header filter, not just `Origin`. `Host`,
  `Cookie`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Sec-*` and `Proxy-*` reach
  reqwest exactly as callers set them. Every caller is app code, so nothing sets these today. If
  untrusted input ever feeds request headers, `httpFetch` is where to filter them.
- Certificates are checked against the bundled webpki roots and, on Windows and Linux, the OS trust
  store. macOS, Android and iOS use the bundled roots only. The OS roots are only added as extra
  anchors, so a CA the OS distrusts or revokes is still accepted if the bundled set has it;
  plugin-http 3's platform verifier replaces this.
- `Accept-Encoding: gzip, br, zstd` is sent and responses are decoded in Rust before the WebView
  sees them.

Stock Ollama and ComfyUI on loopback work without `OLLAMA_ORIGINS` or `--enable-cors-header`,
because the helpers send no `Origin`.

## Environment

There are no required `.env` files for local development or the built app:

- `import.meta.env.DEV` is set automatically by Vite and only gates debug logging
  (`src/lib/log.ts`) — nothing to configure.
- **API Keys**: for AI providers, configured at runtime via the UI (Settings -> API Settings), not via
  environment variables.
- Android builds read `ANDROID_HOME` (or `ANDROID_SDK_ROOT`), `NDK_HOME`, and `JAVA_HOME` from the shell
  environment. `scripts/android-setup.sh` and `compileApk.sh` will auto-detect these from common install
  locations if unset.
