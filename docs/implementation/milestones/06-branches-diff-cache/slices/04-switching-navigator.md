# Slice 6.4 — Switching and the navigator

## Metadata

- **Milestone:** [Milestone 6 — Branches + diff cache](../milestone.md)
- **Depends on:** none to start. Lands after
  [Slice 6.2](./02-scoped-reads-redo.md): the reader's integration uses
  its accessor and its redo map
  ([C5](../milestone.md#c5--branch-scoped-store-reads),
  [C6](../milestone.md#c6--one-redo-stack-per-branch)), and the E2E's
  Redo check needs the map. The switch's tasks start once R2's canon
  pass lands ([C12](../milestone.md#c12--canon-and-flips)); the branch
  read, the navigator in Storybook and rename don't wait for it.
- **Blocks:** [Slice 6.5](./05-fork-from-reader.md) (the show-branch
  tail, the reader hold, the stack-replace helper, the branch store's
  refresh) and [Slice 6.6](./06-delete-duplicate.md) (the branch read,
  the navigator's row and its delete slot)

## Goal

The reader shows which branch it is on and moves between branches. This
slice delivers a story's branch read and the store the reader reads it
through, `switchBranch` and the tail that shows a branch already
current, the hold that keeps the reader still while either runs, a
fresh reader instance per branch, the branch chip on every tier, the
navigator with its paused and single-branch states, inline rename, and
`Browse branches…`. It provides
[C8](../milestone.md#c8--the-branch-list-the-switch-and-the-navigators-row).
It runs on the seed's second branch and forks nothing.

## Background

Only story creation writes `stories.current_branch_id`
(`lib/actions/stories/create-story.ts:117`), no store or query holds a
story's branch rows for a surface, and nothing changes `branchId`
under a mounted reader, though the route's branch-change effects are
written as if something could. R2 makes a switch a navigation: the
pointer moves, the branch is published through the load every open
shares, and a fresh reader instance keyed on its branch replaces the old
one, so its refs, composer and mount effects start over. The working-set
stores hold one branch keyed by id alone, so a route left showing the
old branch renders empty and never re-hydrates
(`app/reader-composer/[branchId].tsx:631-660`,
`hooks/use-cold-open-story.ts:22-48`): a switch must leave no such route
in the stack, and the old reader must never render a commit over the
new branch's rows. The navigator is reader-only chrome, a Popover on
desktop and tablet and a short Sheet on phone, opened from the chip or
from `Browse branches…`.

## Required reading

- [`branch-navigator.md → Navigator — popover (desktop)`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#navigator--popover-desktop),
  [`Per-row anatomy`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#per-row-anatomy),
  [`Sort order`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#sort-order),
  [`During generation`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#during-generation--switch--delete--create-blocked),
  [`Inline rename`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#inline-rename),
  [`Name uniqueness`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#name-uniqueness),
  [`Single-branch state`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#single-branch-state),
  [`Mobile expression`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#mobile-expression)
  and
  [`Data-model touchpoints`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#data-model-touchpoints)
  — the surfaces this slice builds, as R2's canon pass leaves them.
- [`reader-composer.md → Layout`](../../../../ui/screens/reader-composer/reader-composer.md#layout),
  [`Loaded-set model`](../../../../ui/screens/reader-composer/reader-composer.md#loaded-set-model)
  (Branch switch),
  [`Inline edit session`](../../../../ui/screens/reader-composer/reader-composer.md#inline-edit-session),
  [`Undo and redo`](../../../../ui/screens/reader-composer/reader-composer.md#undo-and-redo),
  [`State model — manual + viewport, decoupled`](../../../../ui/screens/reader-composer/reader-composer.md#state-model--manual--viewport-decoupled)
  and
  [`Mobile expression`](../../../../ui/screens/reader-composer/reader-composer.md#mobile-expression)
  — what a switch resets and what guards it.
- [`actions-menu.md → Contextual zone`](../../../../ui/patterns/actions-menu.md#contextual-zone)
  — `Browse branches…`, always present and never gated.
- [`principles.md → Top-bar design rule`](../../../../ui/principles.md#top-bar-design-rule)
  (the right-cluster reading of the chip's place),
  [`Reader-only chrome`](../../../../ui/principles.md#reader-only-chrome),
  [`Edit restrictions during in-flight generation`](../../../../ui/principles.md#edit-restrictions-during-in-flight-generation),
  [`What's gated`](../../../../ui/principles.md#whats-gated),
  [`What's not gated`](../../../../ui/principles.md#whats-not-gated)
  and
  [`Affordance loci`](../../../../ui/principles.md#affordance-loci)
  — the chip's rule, the pause, and the commit banner's done state.
- [`generation-pipeline.md → Gate derivation as a selector`](../../../../generation-pipeline.md#gate-derivation-as-a-selector)
  — what closes the gate the switch reads.
- [`chapter-close.md → Re-running a close`](../../../../memory/chapter-close.md#re-running-a-close)
  — why the tail keeps the route and the pointer on a forked branch
  whose load fails.
- [`navigation.md → Reader chip strip (phone-only)`](../../../../ui/foundations/mobile/navigation.md#reader-chip-strip-phone-only)
  and
  [`Tablet`](../../../../ui/foundations/mobile/navigation.md#tablet-6401023-px);
  [`layout.md → Stacking`](../../../../ui/foundations/mobile/layout.md#stacking),
  [`Sheet behavior`](../../../../ui/foundations/mobile/layout.md#sheet-behavior--additional-rules)
  and
  [`Surface bindings`](../../../../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
- [`icon-actions.md → Visibility`](../../../../ui/patterns/icon-actions.md#visibility--always-rendered-color-tiered-brighten-on-hover)
  and
  [`Disabled vs hidden`](../../../../ui/patterns/icon-actions.md#disabled-vs-hidden);
  [`iconography.md → Top-bar / chrome`](../../../../ui/foundations/iconography.md#top-bar--chrome).
- [`overlays.md → Sheet — Keyboard handling`](../../../../ui/patterns/overlays.md#sheet--keyboard-handling)
  — the rename input inside the phone Sheet.
- [`retrieval.md → The story-open upgrade prompt`](../../../../memory/retrieval.md#the-story-open-upgrade-prompt)
  — why a switch must not count as an open.
- [`data-model.md → Branch model`](../../../../data-model.md#branch-model)
  and
  [`Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  (one redo stack per branch).
- [`code-conventions.md → Action layer`](../../../../code-conventions.md#action-layer),
  [`Syncing a store after a write`](../../../../code-conventions.md#syncing-a-store-after-a-write)
  and [`i18n discipline`](../../../../code-conventions.md#i18n-discipline).
- [`testing.md → E2E target: desktop only`](../../../../testing.md#e2e-target-desktop-only),
  [`Fixture + seed contract`](../../../../testing.md#fixture--seed-contract),
  [`Embedder in E2E`](../../../../testing.md#embedder-in-e2e),
  [`Mock LLM`](../../../../testing.md#mock-llm) and
  [`Selector strategy`](../../../../testing.md#selector-strategy).
- [`parked.md → A write that commits while a story opens is lost from its stores`](../../../../parked.md#a-write-that-commits-while-a-story-opens-is-lost-from-its-stores)
  — it stays parked only while the switch waits on the gate.
- [`roadmap.md → M6`](../../../roadmap.md#m6--branches--diff-cache) —
  the three reader deferrals R2 dissolves.
- The milestone's
  [C5](../milestone.md#c5--branch-scoped-store-reads),
  [C6](../milestone.md#c6--one-redo-stack-per-branch),
  [C7](../milestone.md#c7--fork) (the seed rule),
  [C8](../milestone.md#c8--the-branch-list-the-switch-and-the-navigators-row),
  [C11](../milestone.md#c11--shared-files),
  [C12](../milestone.md#c12--canon-and-flips) and
  [Open questions](../milestone.md#open-questions) (Unaudited).
- Lessons:
  [overlays and focus](../../../lessons-learned/portaled-overlay-outlives-screen-focus.md#how-to-apply),
  [gorhom present during dismiss](../../../lessons-learned/gorhom-present-during-dismiss.md#gorhom-drops-a-present-sent-while-its-modal-dismisses),
  [controlled input in a portal](../../../lessons-learned/portal-controlled-textinput-caret.md#how-to-apply),
  [Portal context](../../../lessons-learned/rn-primitives-portal-context.md#how-to-apply),
  [Storybook viewport and `useTier`](../../../lessons-learned/storybook-viewport-usetier-async.md#how-to-apply).

## Scope: in

**First tasks: two facts the switch rests on.** Each runs before the
code that leans on it. The result, the build and the device go in
Implementation notes.

- What the stack-replace helper below mounts when the route it replaces
  is a reader on the same pattern, `/reader-composer/[branchId]`, called
  from the reader and from the root overlay host, on desktop and on the
  Android slot AVD: whether the router reuses the old screen is the
  milestone's unverified point. The keyed body keeps the instance fresh
  either way; a second mount of the new reader per switch is a defect
  to fix, not a fact to record. The same task checks whether a stack
  transition keeps the old reader on screen after the publish, over
  stores that hold the new branch, where its rows filter to nothing. If
  it paints its empty state there, the switch navigates without the
  transition, or the old reader holds its last render until it
  unmounts.
- Whether a gorhom Sheet presents while another gorhom modal dismisses,
  in Storybook on web and on the AVD. `Browse branches…` on phone asks
  for the navigator Sheet while the Actions Sheet leaves, since a row's
  activation closes the overlay and runs the entry in one call
  (`components/ui/searchable-overlay-list.tsx:1185-1192`). If the
  present is dropped, the reader holds the navigator's open until the
  Actions Sheet's exit, as `useHeldUntilDismissed` holds the chapter
  popover's actions, which needs an exit callback out of `ActionsMenu`.
  The slice waits for the exit whatever the result (Implementation notes).

**The branch read and its store (C8).**

- A read of one story's `branches` rows
  (`lib/db/stories/stories.table.ts:39-49`): id, name, parent, fork
  entry and `created_at`, ordered by `created_at` then id. It takes a
  story id and a `db`, so it runs with no story open; 6.6's Duplicate
  dialog calls it from the story list. It lives in
  `lib/stores/branches/`.
- A store holding the open story's rows and the id of the story they
  belong to. Its rows for any other story are an empty list, as C5's
  accessor answers for another branch. A refresh re-reads one story's
  rows and drops a result that lands after a newer refresh's.
- The refresh never rejects: a failed read is logged and the last rows
  stay, as `rehydrateStories` keeps its store
  (`lib/stores/stories/stories.ts:70-79`). Its failure is never surfaced
  to the user (C8).
- Who refreshes it: rename, after its commit; the reader, on mount for
  its story, which is the refresh after a switch's or a fork's
  navigation that C8 asks for; delete in 6.6 and the fork's callers in
  6.5. `resetAllStores` (`lib/stores/index.ts`) resets it.

**The reader hold (C8).** A switch or a fork holds the reader from its
start to its navigation, so no Send starts a turn on the old branch
while the new one publishes, and no way out leaves a half-switched
stack.

- A hold in `lib/stores/ui/`, keyed by the reader's branch, which
  whatever starts a switch or a fork takes: the navigator row's press
  here, and 6.5's creation modal confirm and re-run path, which take it
  from outside the reader. The re-run path's confirm is hosted at the
  root, outside every route, so the hold can't live in the reader's
  own state.
- It ends at the navigation, in the switch's or the tail's synchronous
  block, and on every path that ends with none: a refusal, a failed
  load, an abandoned switch, a fork that refused. The reader's unmount
  clears any hold left on its branch.
- While it holds, the reader treats its gated controls as blocked, as a
  dispatch does (`dispatchInFlight`, `app/reader-composer/[branchId].tsx:781-795`),
  and closes its ways out: the Actions menu (`blocked`, `:1910`), ⛭
  (`:1900-1902`), and every link that leaves through `navigateGuarded`
  or `guardEdit` (the chapter popover's `Manage chapters →`, the Browse
  chip's and the peek drawer's links, the pill's Memory link). The
  navigator's rows pause. Back and hardware back stay live: leaving
  through them abandons a switch.
- With the action's gate check, the hold keeps any write on the branch
  from landing between the check and the publish, which is what keeps
  the parked open race parked.

**`switchBranch` and the show-branch tail (C8, R2).** In
`lib/actions/stories/`, beside the load they publish through
(`lib/actions/stories/operational.ts:105-224`).

- Typed refusals, each before any write:
  - the gate without the branch's hold: `isUserEditBlocked(txState)`
    with no branch (`lib/stores/generation/generation.ts:89-93`), which
    a hard-gate run, a pending turn or a reversal closes. A branch in
    `heldBranches` blocks neither leaving it nor entering it;
  - a branch that is missing or belongs to another story;
  - a switch already running;
  - a story that is busy, or a turn body still active on the branch
    left.

  The current branch is no switch: its row closes the navigator and
  nothing runs.

- The steps: write `stories.current_branch_id`; read the branch's rows,
  the read half of the load every open shares; re-read the stories store
  (`rehydrateStories`); then, in one synchronous block, navigate through
  the stack-replace helper below and read the stack back, and only if
  the reset took fill the working-set stores, publish the branch with
  `currentStoryStore.set`, never `open`, drop the overlays store's close
  result and release the hold. C8 lists the navigation last; the reset
  goes first because a prevented reset can't be undone after the fill
  (Implementation notes). `navigationStore`'s branch follows, as
  `openStory` sets it.
- The load comes apart. `loadAndPublish` reads every table, then fills
  the working-set stores and publishes in one synchronous tail
  (`operational.ts:107-214`). Here its reads run at the read step and
  its fill moves into the synchronous block: the old reader's rows
  filter to nothing the moment the stores hold the new branch, so a
  fill before the awaited stories re-read would let it commit a render
  over them, empty. Nothing is awaited between the reset, the fill
  and the publish. The load's other success effects stay, in its
  order: `storiesStore.clearOpenFailure` before the publish, then
  `kickStoryDrain` and the token encoder's warm-up after it
  (`operational.ts:194,208,212`). The drain kick is the one that
  matters: the drain warms the open branch only
  (`lib/embedder-swap/app-deps.ts:749-752`), so without it the new
  branch's stale rows wait for the first Send's sync stage. `openStory`
  and `loadOpenStory` keep their behavior.
- A failed load puts `stories.current_branch_id` back on the branch the
  reader still shows, fills and publishes nothing, navigates nothing,
  and returns a typed failure it logs (C8). A pointer left on a branch
  that can't load would fail every later open of the story from the
  list.
- A reset that doesn't take counts as a failed load, whether a
  `beforeRemove` prevention swallowed it or the helper refused it.
- A failed stories re-read counts as a failed load. `rehydrateStories`
  logs and returns `false`, never throws, and keeps a store that still
  names the old branch; publishing over it would let Story Settings'
  breadcrumb, which reads that store
  (`app/story-settings/[storyId].tsx:201,325`), push a reader for the
  old branch over the new one.
- An abandoned switch puts the pointer back as a failed load does, and
  re-reads the stories store (C8). It is abandoned when the reader that
  started it lost focus or unmounted before the publish: its
  `isCurrentRequest`, as `loadOpenStory` takes one, answers false from
  then on. It fills, publishes and navigates nothing, and releases the
  hold.
- A switch is not a story open (C8). `openSeq` stays, so the embedding
  upgrade prompt isn't raised again
  (`lib/embedder-swap/upgrade-prompt.ts:37-44`). The close result is
  dropped by the action itself, not left to the root host's
  render-time prune (`components/chapters/chapter-overlays-host.tsx:162`),
  so its done state ends however fast the user comes back.
- The show-branch tail, for a caller whose own transaction moved the
  pointer (6.5, after `forkBranch`, on the create path and the re-run
  path): the same read, re-read and block, with no gate check and no
  pointer write, since its caller's own refusal read the gate. It
  releases its caller's hold at the navigation. A reset that doesn't
  take fills and publishes nothing and leaves the pointer on the new
  branch.
  - It never moves the pointer back (C8). If its load fails it fills
    and publishes nothing and still navigates, and the new reader's own
    load (`app/reader-composer/[branchId].tsx:631-660`) handles the
    failure, leaving for the Story List with its toast if that load
    fails too: once a fork has committed, canon keeps the route and the
    pointer on the new branch.
  - A failed stories re-read is logged and the tail goes on. Story
    Settings re-reads the stories store on its own mount
    (`app/story-settings/[storyId].tsx:190`).
  - It takes no abandon check: its caller's reader may already be
    gone, as on the re-run path, and the fork has committed.
  - It navigates through the stack-replace helper, as every switch
    does.
- The navigation passes the story-leave guard as idle
  (`hooks/use-story-leave-guard.ts`): the gate check and the hold rule
  out every state that arms its abort-confirm, so a switch never raises
  it.

**Navigation.**

- A helper that replaces the in-story stack with the reader for a
  branch in one navigation, leaving `[Story List, Reader(B)]` whatever
  stood above the Story List, the new reader mounting once. It answers
  whether the reset took, and dispatches nothing while any route in the
  app Stack holds an armed unsaved-changes guard. It is
  callable from the root overlay host (`app/_layout.tsx:117`), where
  6.5's re-run confirm lives, as well as from a screen. The stack it
  builds is computed by a pure function beside `routePathname`
  (`hooks/use-surface-navigate.ts`).
- Every switch navigates through it, and so do 6.5's create and re-run
  paths through the tail: Back after any switch lands on the Story List
  (C8, pinned). A `replace` of the top route alone would leave an
  in-story route of the old branch under the new reader on a stack the
  app reaches: Story List, its card's Settings (`app/index.tsx:108`), Go
  to World, then Go to reader, which pushes a reader because none sits
  below. Back from Reader(B) would land on a World(A) that renders empty
  and never re-hydrates.

**The reader.** Its lines per C11: the hydration, the branch effects,
the keyed body, the Actions group and the shell's chip. Elsewhere C11
gives this slice the review window's branch in
`components/chapters/chapter-overlays-host.tsx`, beside 6.2's raw reads
and 6.5's re-run confirm host, and `e2e/harness/seed.ts` to read only.

- The route component reads `branchId` and renders its body keyed on it
  (`app/reader-composer/[branchId].tsx:261-283`), so refs, the composer
  and every mount effect are new for each branch, whatever the router
  reuses. The composer's draft doesn't carry and nothing prompts (R2).
- The branch-change effects stay as a backstop: the stream buffer and
  `lastSubmission` reset (`:506-515`), the refresh abort on leaving
  (`:517-527`), the strip error (`:453`) and `enterBranch` (`:1797`).
  The comments that describe a branch changing under a mounted reader
  are reworded for the keyed body, the refresh abort's among them, which
  cites the reader doc line R2's pass removes:
  `[branchId].tsx:452,506-510,517-520,1071,1549`,
  `components/reader/use-load-older-entries.ts:46`,
  `components/reader/reader-surface.tsx:848`,
  `components/reader/scene-editing.ts:120` and
  `components/reader/world-time-editing.ts:98`.
- A row press closes the navigator, then runs the reader's inline-edit
  guard (`guardEdit`; a branch switch is a guarded leave), then takes
  the hold and starts the switch. On phone it waits for the Sheet's
  exit first, as a full-screen route from a Sheet does.
- The reader reads the hold for its branch into `actionsBlocked`, the
  Actions menu's `blocked`, ⛭ and its guarded links, as the hold's
  bullets above list.
- The reader refreshes the branch store on mount for its story.
- `Browse branches…` joins the contextual group after `Jump to bottom`
  (`:1722-1777`): always present, a single-branch story included, never
  gated by a run and not held by an open editor. The reader hold closes
  the Actions menu as a whole, this entry with it.
- Any store-row read this slice adds goes through C5's accessor.

**The review window's branch.** A fork copies the chapter's id and its
report's `actionId`, so neither tells two branches apart
(`lib/stores/ui/chapter-overlays.ts:55-62`,
`components/chapters/chapter-overlays-host.tsx:139-143`). It is latent
today, reachable through a review reopened after a switch.

- `ReviewRequest` (`chapter-overlays.ts:15`) gains the branch it opened
  on. `openReviewWindow` takes it from its caller, which holds it: the
  Timeline route's own branch (`app/chapter-timeline/[branchId].tsx:188`)
  and the close result's (`components/compounds/use-memory-run-banner.ts:122`).
  `closeRerunConfirm({ reopen: true })` takes the re-run request's.
- `reviewOf` (`chapter-overlays.ts:101-103`) reads the chapter by
  branch and id through C5's getter. 6.2 lands first and passes the
  store's loaded branch there so its own typecheck holds (C5); this
  slice replaces that with the request's branch.
- The host closes a review whose branch isn't the open one.

**The chip.**

- `GitBranch` and a count badge, shown only when the story holds more
  than one branch, and absent while the store holds no rows for the
  story, so it never flashes. Its web tooltip and its accessible name
  carry the current branch's name and the count. A press opens the
  navigator; nothing gates it.
- The chip is a view of two props, the count and the current branch's
  name, which the reader derives from the branch store in one place.
  That derivation is where 6.6's latch sits: it holds the count while
  the navigator is open, so deleting the second of two branches doesn't
  unmount the chip the open desktop Popover is anchored to, and the
  count updates when the navigator closes. The navigator's header
  reads the store live, so it drops at once. This slice ships no
  latch: nothing it builds changes the count while the navigator is
  open.
- Its place rides `centerExtras`
  beside the chapter and time chips
  (`components/reader/reader-chapter-chips.tsx`,
  `components/shells/screen-shell.tsx:28-34`): beside the title on
  desktop and tablet, `[Chapter ▾] [<time chip>] [⎇N]` in the phone
  chip strip.

**The navigator.**

- A Popover on desktop and tablet, about 360 px wide, anchored to the
  chip, closed by `Esc` or an outside press; on phone a short bottom
  Sheet with its drag handle, which hardware back dismisses. One
  component switches arms by tier, as `ChapterPopover` does
  (`components/reader/chapter-popover.tsx:101-110`), and
  `Browse branches…` opens it through a handle, as the progress strip
  opens the chapter popover. On a single-branch story, which has no
  chip, the Popover anchors to an inert trigger in the chip's slot.
- The header reads `Branches · N`, with a close affordance on desktop
  and tablet. A row holds `✓` on the current branch or a muted `○`, the
  name, then `✎`. The current branch comes first, the rest by
  `created_at`.
- The row's delete slot (C8): the row renders `×` only when its host
  passes a delete handler, and never on the current branch. This slice
  passes none.
- Paused: while the gate without the branch's hold is closed, or the
  reader's dispatch is in flight, or the reader hold is up, the rows
  render at reduced opacity, a press does nothing, and the banner reads
  `Generation in progress — switching paused.` `✎` stays live. When the
  gate opens the rows come back, with the navigator still open.
- Single-branch: one row, rename only, header `Branches · 1`.
- It closes with the route: gated on `isFocused`, and closed when the
  reader loses focus, as `ReaderChapterChips` closes its popover
  (`components/reader/reader-chapter-chips.tsx:88-91`).
- A long name truncates. A long list scrolls inside the Popover's
  bounded list and inside the short Sheet.

**Inline rename.**

- A new compound for the row's rename. `InlineEditableName`
  (`components/ui/inline-editable-name.tsx:77-171`) doesn't fit: it
  enters edit on a name press, which switches here; it streams each
  keystroke to `onChange`; it has no Enter commit and no empty refusal;
  and it handles no Esc on native. Rename starts from `✎` only: the
  name swaps for an input prefilled, focused and selected, the marker
  stays and the icons collapse. Enter or blur saves, Esc cancels, and
  an empty or whitespace-only name shows the input's invalid state and saves
  nothing until the user fixes or cancels it. The input is `Input`,
  never a raw `TextInput`, since it sits in a portal on every tier.
- `renameBranch`: one unlogged update of `branches.name` in a
  transaction, with no delta, no redo clear and no gate, since canon
  keeps rename live through a run. It stores the name trimmed, as 6.5's
  creation modal does (C8), refuses an empty or whitespace-only name,
  checks no uniqueness, and refreshes the branch store after its
  commit.

**Stories, inventory and canon.**

- Storybook stories for the chip, the navigator and the rename compound
  at desktop, tablet and phone, with the plays the acceptance criteria
  name. The navigator's row slot gets its story here, with a stub
  delete handler; the delete flow's stories are 6.6's.
- `docs/ui/component-inventory.md` rows for the chip, the navigator and
  the rename compound.
- Canon edits the PR makes, in `branch-navigator.md` unless named:
  - the chip's place, in `reader-composer.md → Layout`, the navigator's
    Layout sketch and `reader-composer.html`, in the same commit;
  - the Popover's anchor on a single-branch story;
  - the pending, refused and failed states of a switch and a rename,
    and rename's write path;
  - Back after a switch landing on the Story List, on the row press,
    unless R2's pass already says it;
  - the navigator wireframe for any state that changes.

  `branch-navigator.md → During generation` says generation depends on
  the `stories.current_branch_id` mutation, while runs read
  `currentStoryStore` and their own `branchId`; the PR corrects the line
  if R2's pass leaves it.

## Scope: out

- `⎇ Branch from this entry`, the creation modal,
  `Re-run on new branch`, taking the reader hold on those paths, and
  the fork's own branch store refresh
  ([Slice 6.5](./05-fork-from-reader.md)), which calls this slice's
  hold, tail and helper.
- The `×`'s handler and its hiding during generation and under a
  pending swap, the delete action and confirm and their stories, the
  chip's count latch until the navigator closes after a delete, and the
  refresh after a delete ([Slice 6.6](./06-delete-duplicate.md)). So is
  the Duplicate dialog's Branch Select, which reads this slice's branch
  read.
- The accessor and its sweep, the redo map and the reader reading its
  own branch's Redo top ([Slice 6.2](./02-scoped-reads-redo.md)). This
  slice's E2E proves the last across a real switch.
- `forkBranch`, its current-branch write and the seed's real fork
  ([Slice 6.3](./03-fork-core.md)).
- R2's canon pass: the navigator's row press, During generation and
  After confirm, the reader doc's branch switch, its line that a
  refresh aborts on a switch, and the composer draft (C12). It lands
  before the switch's tasks.
- Re-hydrating a route on refocus: not built (C5).
- Dissolved by R2, recorded here and not built: the composer draft's
  carry across a switch (the keyed body drops it), `documentPainted` and
  the stale native document handle (each branch mounts a new document
  and ref), and `enterBranch` keyed on focus (no reader of another branch
  stays under the top one).
- A branch count on story cards and branch-aware URLs, dropped with the
  roadmap's M6.5.
- A tree view and a branch detail view, which canon leaves open.
- The per-branch lead ([Slice 6.8](./08-per-branch-lead.md)) and Story
  Settings' lead field (M7.2).

## Acceptance criteria

**Facts.**

- Implementation notes record what the stack-replace helper mounts over
  a reader on the same pattern, from the reader and from the root
  overlay host, on desktop and on the Android slot AVD, and whether a
  gorhom Sheet presents during another's dismiss, each with its build.
  One switch mounts the new reader once on both platforms, shown by a
  mount log on desktop and on the AVD.
- The reader being left never paints its empty state during a switch.
  On desktop, `e2e/tests/branch-navigator.spec.ts` installs a
  `MutationObserver` through `page.evaluate` before a switch, recording
  any insertion of the `reader:emptyTitle` text, resolved through i18n,
  and asserts none was recorded. On the AVD, a dev log line written
  when a reader renders its placeholder after having had rows is absent
  from logcat across a switch.

**The read and the store.** `lib/stores/branches/branches.test.ts`, or
the file the read's home puts it beside:

- On `createTestDb`, the read returns only the story's rows, ordered by
  `created_at` then id, with no story open.
- The store answers an empty list for a story it doesn't hold; a
  refresh that resolves after a newer one is dropped; a refresh whose
  read throws resolves, logs, and keeps the last rows; `resetAllStores`
  empties it.

**The hold.** `lib/stores/ui/reader-hold.test.ts`, or the file the
hold's module puts it beside: a hold taken for a branch reads as held
for that branch only, its release clears it, a release from an older
take leaves a newer one in place and a second release of one take
changes nothing, and `clear` ends every take on its branch.

**The switch.** `lib/actions/stories/switch-branch.test.ts`, on
`createTestDb`:

- A hard-gate run, a pending turn and a reversal each refuse with
  nothing written, as does a run that holds no gate while the story is
  busy and a turn body still active on the branch left. A
  `heldBranches` entry on the branch left or on the branch entered
  refuses nothing. A branch of another story, a missing branch and a
  second switch while one runs each refuse. Each refusal releases the
  hold.
- On success `stories.current_branch_id` names the new branch, the
  stories store's row names it before the publish, `currentStoryStore`
  holds it with `openSeq` unchanged, the close result is cleared, the
  navigation runs once through the stack-replace helper, ahead of the
  fill, the hold is released with the publish, and `kickStoryDrain` is
  called for the story after the publish.
- While the stories re-read runs, the working-set stores and
  `currentStoryStore` still hold the branch left. A microtask queued
  from the reset or the fill finds the fill, the publish and the
  release done.
- A failed read, a read that throws and a stories re-read that returns
  `false`, each put the pointer back on the branch left, leave
  `currentStoryStore` and the stores on it, navigate nothing, release
  the hold, and return the failure.
- A stack reset that doesn't take, or throws, puts the pointer back,
  re-reads the stories store, fills and publishes nothing, releases the
  hold and returns a failure. With an armed buried route refusing the
  reset, nothing is left for a guard to replay.
- An `isCurrentRequest` that turns false after the pointer write puts
  the pointer back, re-reads the stories store so its row names the
  branch left, fills, publishes and navigates nothing, and releases the
  hold.
- A switch writes no `deltas` row and leaves every branch's redo stack
  as it was.
- The tail reads, re-reads the stories store, navigates, fills,
  publishes and clears the close result, and writes no pointer. When
  its read fails it fills and publishes nothing, still navigates, and
  leaves `stories.current_branch_id` on the branch its caller wrote. A
  stories re-read that returns `false` is logged and the tail still
  publishes and navigates. A reset that doesn't take fills nothing,
  releases the hold and leaves the pointer.
- `lib/actions/stories/load-open-story.test.ts` and
  `lib/actions/stories/operational.test.ts` pass unchanged.

**Rename.** `lib/actions/stories/rename-branch.test.ts`:

- It writes the name, and `'  The trap  '` is stored as `'The trap'`;
  `''` and `'   '` refuse with nothing written; it succeeds while a
  hard-gate run is registered; it writes no `deltas` row and clears no
  redo stack; the branch store holds the new name once it returns.

**Navigation.** `hooks/use-replace-story-stack.test.ts`, on the pure
stack builder:

- From `[List, Reader(A)]`, `[List, Settings, World(A), Reader(A)]`,
  `[List, Reader(A), Timeline(A)]` and a cold `[Reader(A)]`, it gives
  `[List, Reader(B)]`.
- The hook answers `true` when its one reset took, and `false` when the
  reset is prevented or lands elsewhere. It dispatches nothing while the
  top route or a buried one holds an armed unsaved guard.

**The review window.**

- `lib/stores/ui/chapter-overlays.test.ts`: `openReviewWindow` records
  the branch its caller passes, and `closeRerunConfirm({ reopen: true })`
  restores the re-run request's. With the chapters store holding another
  branch whose chapter has the same id, the request reads no report
  action, since `reviewOf` reads by the request's branch and id.
- `components/chapters/chapter-overlays-host.test.tsx`: a review whose
  branch isn't the open one closes while the open branch holds a chapter
  with the same id and `actionId`.

**Surfaces, in Storybook's browser project.**

- `components/reader/branch-chip.stories.tsx`, driving the chip by its
  count and name props alone: absent at one branch, `⎇ 3` at three,
  its accessible name carrying the current branch's name and the count;
  at phone width it sits in the chip strip after the time chip.
- `components/reader/branch-navigator.stories.tsx`, at desktop, tablet
  and phone:
  - the current branch first, the rest by `created_at`;
  - a row press calls the switch with that branch and closes; the
    current row's press closes and calls nothing;
  - paused: the banner shows, the rows dim, a press calls nothing, and
    `✎` still opens rename;
  - single-branch: one row, `Branches · 1`, no `×`;
  - the row slot, with a stub delete handler: `×` renders on every row
    but the current one, and with no handler on none;
  - a long name truncates and a long list scrolls;
  - phone renders the short Sheet with its drag handle.
- The rename compound's stories (`components/reader/branch-rename-input.stories.tsx`
  by default): open prefilled and selected; Enter and blur save; Esc
  restores the name and saves nothing; an empty and a whitespace-only
  name show the invalid state and save nothing.
- The reader's connected navigator closes when the reader loses focus,
  and stays shut on refocus, under jsdom beside
  `components/reader/reader-chapter-chips.test.tsx`.

**E2E.** `e2e/tests/branch-navigator.spec.ts`, by
`pnpm test:e2e -- branch-navigator` after `pnpm build:web`, on the
seeded hero story's two branches. It reads the fork's id, name and
entries from the DB and takes no turn on it (C7's seed rule).

- The chip shows `2` and names the current branch; the navigator lists
  it, then the fork, each name read from the DB.
- Edit an entry's text on `Main` and undo it from the Actions menu, then
  switch to the fork: `stories.current_branch_id` is the fork, the
  reader shows the fork's tail entry, and the Actions menu has no Redo.
  Switch back: Redo is present and names the edit.
- Text typed in the composer on one branch is gone from the composer
  after a switch, and nothing prompted.
- With an entry's inline editor dirty, a row press raises the unsaved
  guard before anything moves: Cancel leaves `stories.current_branch_id`
  and the editor as they were, and Discard switches.
- Rename the fork with Enter: `branches.name` holds the new name, and
  the navigator shows it. Esc during a second rename leaves it.
- With a run on `Main` held by the mock, `Browse branches…` still opens
  the navigator, which shows the paused banner; a row press leaves
  `stories.current_branch_id` as it was, and rename still writes. Once
  released, the press switches.
- After a switch, Story Settings' breadcrumb returns to the reader on
  the branch switched to, Back from that reader lands on the Story
  List, and opening the story from the list opens that branch.
- On a single-branch story, found by SQL, no chip shows, and
  `Browse branches…` opens the navigator with one row under
  `Branches · 1`.

**Device, never blocking.** On the slot AVD: a switch from the phone
chip and one from `Browse branches…` each land one fresh reader at the
new branch's tail, hardware back dismisses the Sheet, and the rename
input keeps its caret through a mid-string edit.

**Docs and gates.**

- `branch-navigator.md`, `reader-composer.md` and the wireframes carry
  the canon edits above, and `component-inventory.md` lists the chip,
  the navigator and the rename compound.
- `pnpm lint`, `pnpm format:check`, `pnpm compiler:check`,
  `pnpm typecheck`, `pnpm lint:docs` and `pnpm test:run` pass.

## Tests

- **Vitest, `--project unit`:** the read, the store, the hold,
  `switchBranch`, the tail and `renameBranch` on `createTestDb`, as
  `lib/actions/stories/load-open-story.test.ts` runs the load; the
  stack builder as a pure function; the overlays store and host under
  jsdom, extending their suites. File names above are defaults: if
  planning moves a module, its test moves with it.
- **Storybook, `--project storybook`:** the chip, the navigator and the
  rename compound, three tiers each, with plays for the criteria above.
  The viewport reaches `useTier` a tick late, so a play waits for the
  tier's arm before it asserts.
- **E2E:** `e2e/tests/branch-navigator.spec.ts` with
  `e2e/locators/branch-navigator.ts`, desktop only. It proves what
  nothing cheaper reaches: a real switch through the router, the fresh
  instance, the old reader never painting empty, the per-branch Redo
  top across a switch, the pointer's readers (Story Settings, the story
  list's open) and the pause under a live run. The held run is the
  mock's `holdNextNarrative` or `holdNextStructured`; a held turn needs
  the embedder installed, as `e2e/tests/reader-undo-redo.spec.ts`
  installs it. Selectors are by role and name through i18n; assertions
  read the DB.
- **Mutation check.** Break each once and see its test fail: the gate
  read's hold exclusion (pass the branch), the review's branch
  comparison, `reviewOf`'s branch (read by the loaded branch), the
  fill's place (fill before the stories re-read), the pointer's restore
  on a failed load, on a `false` stories re-read and on an abandoned
  switch, the hold's release, the drain kick, the stale-refresh drop,
  and the current-first sort. Write expected strings as literals, never
  from the constant under test.
- **Manual:** the AVD pass above, and a desktop smoke through the
  `electron-app` MCP of the chip, a switch, a rename and
  `Browse branches…` on a single-branch story.

## Open questions

None open.

## Implementation notes

**Facts.** Taken through a dev-only probe that called the stack-replace
helper from the root overlay host's position (since removed), and
through the reader's `reader.mounted` and `reader.empty_after_rows`
debug lines, which stay. On Android: the slot AVD (`Aventuras_Slot_4`,
Android 16, x86_64) with a debug build and diagnostics debug on.

- The stack-replace helper called from the root host, over a reader on
  the same pattern, mounts the new reader once: one `reader.mounted`
  line, the pathname moves to the fork and Back lands on the Story List
  (`2fbb430b9`, desktop, Electron 41).
- The same call on Android mounts the new reader once and hardware back
  lands on the Story List. The platform default push shows the new
  reader sliding in from the right while fading over the old one (one
  mid-transition frame, settled within 60 ms); no empty-state frame of
  the old reader was seen (`2fbb430b9`, AVD, Android 16). The new
  reader showed `Loading story…` for about a second: inferred to be
  the reader's own load, since the probe filled no store, plus its
  document's boot.
- A real switch shows `Loading story…` for about 0.6 s after the
  mount: the new reader instance boots its own document and covers it
  until first paint, with the composer and the chapter and time chips
  already hydrated. At 10 frames a second the old reader fades out,
  the placeholder shows for six to seven frames, then the fork's
  entries paint; the reader's empty state never showed (`69f73e320`,
  AVD). The one-commit hydration placeholder before it isn't what is
  seen. `reader.mounted` fires from the mount effect, so the veil
  rule's press-to-mount hold doesn't include the document boot.
- A switch from the phone chip and one from `Browse branches…` each
  mount one fresh reader, `reader.mounted` once, with no
  `reader.empty_after_rows`; the screen shows the new branch's tail.
  Hardware back closes the navigator Sheet and leaves the reader
  (`69f73e320`, AVD). No `reader.empty_after_rows` appeared across
  eleven switches, so the reader route keeps its default animation.
- With an entry's inline editor open and unchanged, a row press
  switches at once: one `reader.mounted`, no
  `action_layer.branch_switch_navigation_blocked`. With the editor
  dirty the unsaved-changes guard asks; Cancel leaves the pointer and
  mounts nothing, Discard switches and mounts once (`69f73e320`, AVD).
  Rerun with logcat kept running, each switch is one
  `reader.branch_switch_started` and one `reader.mounted`; opening the
  story from the Story List logs one `reader.mounted` with no
  `reader.branch_switch_started`; Back from the new reader lands on the
  Story List, so no second instance sits under it (`09f786926`, AVD).
- The rename input keeps its caret through a mid-string edit (`X` typed
  six characters from the end lands as `The road notX taken`) and sits
  above the on-screen keyboard (`69f73e320`, AVD).
- With the inline editor's keyboard up, the phone Sheet doesn't lift:
  its rows sit under the keyboard and a tap lands on a key. Back hides
  the keyboard and leaves the Sheet open (`69f73e320`, AVD). The
  composer's keyboard doesn't do this: opening the Sheet from the chip
  with a draft typed dismisses that keyboard and the rows show
  (`09f786926`, AVD). The inline editor lives in the reader's WebView,
  which keeps its own keyboard.
- A Sheet that presents while another dismisses: B presents, and after B
  closes A stays closed, on web (`97b013990`, Storybook, Chromium) and on
  Android (`97b013990`, AVD, two runs).
- Desktop: the chip reads `On Main · 2 branches` beside the title after
  the chapter and time chips; a row switches to
  `/reader-composer/br_hero_fork`; a rename round trip works; on a
  single-branch story there is no chip, and `Browse branches…` opens
  `Branches · 1` with one row and no delete button (`69f73e320`,
  desktop, slot 4, Electron 41).
- One switch from the desktop chip mounts the new reader once: each of
  two switches logged one `reader.branch_switch_started` and one
  `reader.mounted`, no `reader.empty_after_rows`, and Back from the new
  reader lands on the Story List (`09f786926`, desktop, slot 4,
  Electron 41, diagnostics debug on).

**Decisions** (developer, 2026-11-23, unless marked).

- The switch navigates first. C8 lists the fill, the publish, the
  close result's drop and the navigation in that order; `switchBranch`
  dispatches the stack reset first, in the same synchronous block, and
  reads the stack back, then fills, publishes, drops the close result
  and releases the hold only when the reset took. A reset fires
  `beforeRemove` on every route it removes and any prevention swallows
  it, and on native an open inline editor, dirty or not, prevents it;
  a check after the fill couldn't undo the fill. A reset that doesn't
  take is a failed switch: the pointer goes back, the stories store is
  re-read, the hold is released, and the reader toasts
  `Couldn't switch branches.` While its branch is held, the reader's
  inline-edit guard is disarmed, since the press already asked.
  `showBranch` makes the same check and leaves the pointer on the new
  branch.
- The stack reset doesn't dispatch into an armed guard (developer,
  2026-11-24, extending the decision above): `replaceStoryStack`
  refuses and answers `false` while any route in the app Stack has an
  armed unsaved-changes guard (`isUnsavedPopArmed`), so no guard holds
  the prevented reset to replay after the switch has failed. A dirty
  buried route fails the switch without opening a guard on a hidden
  screen. The post-dispatch read-back stays the backstop.
- The chip sits beside the title on every tier: it rides
  `centerExtras` after the chapter and time chips, inline on desktop
  and tablet and last in the phone chip strip.
  [`reader-composer.md → Layout`](../../../../ui/screens/reader-composer/reader-composer.md#layout),
  [`branch-navigator.md → Layout`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#layout)
  and both wireframes moved to match.
- On a single-branch story the desktop and tablet Popover anchors to
  `BranchNavigatorAnchor`, a zero-width, inert, accessibility-hidden
  trigger in the chip's slot, and `Browse branches…` opens the
  navigator through one handle on every story. The phone Sheet takes
  no trigger.
- Switch and rename states, as
  [`branch-navigator.md → Per-row anatomy`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#per-row-anatomy)
  and
  [Inline rename](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#inline-rename)
  now say: nothing pending beyond the held reader; a refusal under the
  gate toasts the gate's reason; a failure toasts
  `Couldn't switch branches.`; an abandoned switch and a press during a
  switch show nothing; a rename holds its input until the write
  returns, and a failed one toasts `Couldn't rename the branch.` On the
  seeded two-branch story, `The Veilstone Courier`, the slot AVD held a
  switch for a median of 171 ms from the press to the new reader's
  mount, so no veil shipped. That hold ends at the mount effect and
  doesn't see the new document's boot, which keeps `Loading story…` up
  for about 0.6 s more. The dataset's played story, _Treasure Island_,
  has one branch, so a long story's hold wasn't measured.
- Undo and redo across a switch. `useReaderUndo` keeps a mounted flag
  whose cleanup dismisses its notice; after unmount nothing posts but a
  `closeUndone` warning, and the route's `branchUnchanged` and the
  hook's `stale()` read the flag. Undo and Redo are disabled with
  `Loading story…` while the route hydrates, and a menu Undo or Redo
  refused `branch-not-loaded` toasts it.
- The branch read and its store live in `lib/stores/branches/`:
  `readStoryBranches(db, storyId)`, `branchesStore` and the free
  `refreshBranches(db, storyId)`, all from the `lib/stores` root, which
  [Slice 6.6](./06-delete-duplicate.md)'s Duplicate dialog imports. A
  store that value-imported `lib/actions` would close a cycle.
- `switchBranch` takes its navigation and its staleness from its
  caller, `replaceStack` and `isCurrentRequest`, since `lib/actions`
  can't import `hooks/`; [Slice 6.5](./05-fork-from-reader.md)'s root
  host passes its own `useReplaceStoryStack()`. Beyond C8's refusals it
  refuses while a turn body is still active on the branch left (a
  failed regenerate between its run and its sweep, with the gate
  open). It publishes the live story with the new branch when the live
  story is this one, so a settings write that landed during the read
  survives.
- The embedder swap's `refreshStores` reads the open story after its
  settings read, so a switch publishing inside that await keeps its
  branch.
- The reader's refresh abort on unmount stays: Back from a reader
  pushed above World, and a dismiss over an unfocused reader, still
  reach it, both on the same branch.
- The phone `Browse branches…` waits for the Actions Sheet's exit
  (plan review): `SearchableOverlayList` rows take `opensSheet`, as
  `OverflowMenu`'s entries do, since gorhom restores a Sheet another
  one covered. The gorhom fact above no longer gates it.
- `openStory` waits for a running switch before it reads the pointer,
  so the story opened from the list during an abandoned switch opens
  the branch the restore leaves.
- `ReviewRequest` carries its branch, and the root host closes a review
  whose branch isn't the open one.
- The held re-run's error toast reads "until then, this branch can't
  be changed", as R2's canon does.
- The unaudited C8 text was walked against `operational.ts`, the reader
  route and the story-leave guard at planning; the reset-first order,
  the abandon rule and the hold's span above are what it became.
- The reader hold is `lib/stores/ui/reader-hold.ts`, a set of tokens per
  branch, so a caller outside the reader, as 6.5's root host is, takes
  and releases its own. The reader's unmount calls `clear`, which ends
  every token on its branch.
- The navigator pauses on every closed gate under canon's one banner
  line, `Generation in progress — switching paused.`, a pending turn and
  a reversal included.
- Rename is an unlogged write with no undo and no History row, as
  [`branch-navigator.md → Inline rename`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#inline-rename)
  says; `branches` sits above the delta log.
- The switch's read and fill carry `eraFlipsStore` with the other ten
  working-set stores, through the shared read in `operational.ts`.
- Planned and run as 22 tasks, one PR: the navigator's surfaces, the
  switch, the hold and the reader's fresh instance meet in one E2E, and
  none ships usefully alone.
- Carried to [Slice 6.5](./05-fork-from-reader.md#open-questions): the
  tail takes no abandon check, so a caller's reader that is gone still
  has its stack reset; the reader's unmount clears a root-host hold.

**Deviations from the plan.**

- `useReportedOpen` is one hook, `hooks/use-reported-open.ts`, shared
  by the branch navigator and the chapter popover, where the plan
  copied it into the navigator.
- The navigator's Esc guard prevents the Popover's close only when Esc
  targets the rename input: Esc cancels the rename there and closes the
  navigator anywhere else, as the rename's canon says.
- The invalid rename input shows `Input`'s danger border through
  `aria-invalid`; canon and the wireframe now name the invalid state,
  resolving the earlier warn/danger mismatch (provisional: the developer
  hasn't confirmed it).
- The probe stays out of the tree (removed with this note); git history
  keeps it.
