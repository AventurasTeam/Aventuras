# A sliding reader window

How the reader's document stops growing with how far back the user
reads. Designed 2026-11-16 from the UX followup "Native reader rows
rerender per emission", which Slice 5.3's Android measure raised and
which asked for this design pass before an M5 slice plans the build.

## Why

The route sends the store's whole branch window to the document as
`rows`. The store holds a contiguous run from its oldest loaded row to
the branch tail, never trims it, and a jump far above reads every row
between the target and the window into it. So the payload, the
document's commit, the renderer's memory and a landing's mount all grow
with how far back the reader has gone. At 60 chapters of the long seed
(Slice 5.3's Android measure, Galaxy Z Fold, release build):

- 7,941 rows, 14.2 MB per emission, 2,019 ms per commit;
- a streamed reply's longest gap between paints 12,350 ms, against a
  500 ms bar;
- a jump to entry 1 landing in 10,704 ms, near the jump veil's 30 s
  bound on longer stories;
- the renderer at 1,993 MB, against 114 to 142 MB at a fresh open.

Of the 10.7 s landing, the host's read took about 0.4 s; the rest is
the document's side.

## Decisions

The canon is
[`reader-composer.md → Loaded-set model`](../ui/screens/reader-composer/reader-composer.md#loaded-set-model)
and
[`reader-document.md → Bridge contract`](../ui/patterns/reader-document.md#bridge-contract).
In short:

- **Two windows, two owners.** The store's window is unchanged:
  contiguous to the tail, growing by load-older and jumps, never
  trimmed. The document renders a **slice**, a contiguous run of at
  most 50 of the store's rows, whose bounds the host owns.
- **The slice is invisible.** Nothing the user does behaves
  differently because the slice stops short of the tail. Send, streams
  and regenerate behave as today; a reply below a slice short of the
  tail is reached by scrolling or Jump to bottom, as one below the fold
  is today.
- **Cap 50, step 25** (developer decision). 50 is today's open window,
  so no device measure sets it; there is no mid-tier phone to set it
  on. The step is half the cap, so the rows a trim removes are always
  far from the viewport.
- **Changes at scroll rest, on the document's request:** extend up,
  extend down while short of the tail, trim the far end when over 50.
  Extensions come from the store, which holds every row below the slice
  and reads a page of 50 from the DB above its oldest row.
- **Jumps re-slice; Jump to bottom swaps.** A jump whose target and
  row above aren't both in the slice replaces the slice from the row
  above. Jump to bottom short of the tail swaps to the tail's last 50
  and lands at once.
- **A landing waits for its slice.** Each slice carries a monotonic
  `sliceKey`; the landing call names the one it expects, and the
  document lands on the first committed slice at or past it that holds
  the target.
- **Bottom-anchored behaviors act only at the tail.**
- **The editor's draft survives the slice.** The host sends the
  editor's row alongside the slice while that row is in the store but
  not the slice; only a row leaving the store drops the draft.
- **One anchor: the topmost visible row,** recorded at each commit and
  at scroll rest. A commit that adds or removes rows above the viewport
  waits for scroll rest, except a jump's swap.

## Approaches

**What the fix bounds.**

- **Chosen: the document only**, the followup's direction. The store's
  contract stays, so its 25-odd consumers (the turn's working set,
  suggestion refresh, the reader's hooks, the action layer) keep reading
  a contiguous tail window. What stays unbounded is the host's read
  (84 ms at 20 chapters, 372 ms at 60), its memory, and its per-change
  work: the route and three hooks copy and sort the whole store on each
  change, unmeasured at size.
- **Rejected: the host too.** A far jump would read only around its
  target, leaving the store a tail region plus a disconnected reading
  region. It bounds everything, but every consumer assumes contiguity
  (load-older's read above `oldestLoadedPosition`, the world-time
  monotonicity walk, a chapter break at the seam), and an edit's patch
  would have to reach rows outside the tail region.

**Whether the slice shows.**

- **Chosen: invisible.**
- **Rejected: Send takes the reader to the live edge, always.** The
  chat-app convention, but a UX change unrelated to the slice that
  would change today's behavior a little way up.
- **Rejected: Send moves the reader only when the slice is short of
  the tail.** Behavior that depends on a state the user can't see.

**Cap and step.**

- **Chosen: 50 and 25.**
- **Rejected: 50 and 50.** Trimming 50 after loading 50 removes the
  rows in the viewport.
- **Rejected: 100 and 50.** Half as many loads, twice today's payload
  on every emission.

**Ordering a landing after a re-slice.**

- **Chosen: the `sliceKey` hold.** Deterministic on both platforms.
- **Rejected: send the landing from the host's post-commit effect**,
  the remedy the followup floated. It relies on expo-dom injecting the
  call after its props emission, which nothing documents and no one
  ran.

**The editor's draft when its row leaves the slice.**

- **Chosen: the host sends the editor's row beside the slice.** The
  draft already lives at the surface's level (`editingId`, `editDraft`
  in `reader-surface.tsx`), not in the row; only its stored text,
  looked up in `rows`, ties it to the slice.
- **Rejected: never trim the editor's row.** The slice must stay
  contiguous, so a far jump while editing would stretch it back to
  today's grown window.
- **Rejected: ask the unsaved-changes guard before a swap.** A prompt
  that appears or not depending on the slice.

## Adversarial pass

- **Load-bearing: the store stays contiguous to the tail**, so
  downward extensions and Jump to bottom never read. Checked: the
  load-older and jump reads re-read when the window moves under them,
  hydrate and reload replace the store with the newest 50, and only the
  tail's writers insert otherwise.
- **The anchor recorded at the wrong time.** The memo is per commit
  (`reader-surface.tsx`), and the reader can scroll 25 rows with no
  commit, so a trim could remove the remembered row. Fixed: the anchor
  is also recorded at scroll rest, when every request is sent.
- **A slice change landing mid-gesture.** On native the rows arrive a
  bridge round trip after the request, and the anchor rule writes
  `scrollTop` with no gesture check. Today only a prepend can do this;
  the slice adds a compensated write to every downward extension and
  top trim. Fixed: a commit that adds or removes rows above the
  viewport waits for scroll rest, which fixes the prepend too.
- **A landing that never fires.** An exact key match hangs when a new
  turn or a trim bumps the key first. Fixed: monotonic keys, at or
  past.
- **Short rows.** 25 rows can be under a screen. Fixed: a trim never
  removes a row within a screen of the viewport.
- **A document reload short of the tail** would land the recovery on
  the bottom shimmer. Fixed: the host resets the slice to the tail.
- **The single anchor changes two scenarios.** Reasoning expansion and
  a footer re-wrap above the fold become compensated. Canon names this
  extension for when they measure; it is an improvement.
- **Accepted:** a desktop drag-select can't span past the slice, and a
  selection that autoscrolls past an edge loses its far end to a trim.
- **Unverified:** whether TalkBack's linear navigation triggers the
  downward extension at the bottom shimmer, as at today's top. The
  device check covers it.
- **Unaffected, checked:** `reload()` after a failed turn, a retry or a
  cleared system entry resets the slice, as it already drops the older
  rows; undo, redo, rollback, a close's stamp burst, era flip, branch
  switch, fork, the review window's jumps, the rail, the peek drawer and
  the suggestion anchor read the store. No translation side table
  crosses the bridge, by grep.

## Drift pass

Fifteen findings, applied with the developer's go-ahead:

- **Stale rules elsewhere:** `reader-document.md`'s "every row in the
  loaded window", the chapter break's uncompensated height,
  `testing.md`'s "fully in the DOM" reader, `lists.md`'s reader that
  "lands here" with a virtualizer, and the wireframe's fetch-scoped
  boundary toggle.
- **Self-contradictions:** "at most 50" against a slice past 50, the
  top skeleton that "unmounts once", the window "never trimmed" though
  a reload replaces it, a reload that could be either kind, the jump
  button's unqualified "Hidden near-bottom", and "topmost visible"
  against "in-viewport".
- **Boilerplate:** the trim's gating, the landing's rationale and the
  resize trigger were each in both docs; each now lives in one.
- **Ledger:** the not-withdrawn landing kept in the new entry, the
  rest-signal dependency and the old model's code comments added as
  build notes, and the wheel-hold trigger now reads "outside the
  slice".

## Integration plan

- **`reader-composer.md`:**
  - `### Loaded-set model`: the window is the store's; the slice is
    the document's, with its cap, step, rest rule, extensions, trims
    and both shimmers. The forward auto-load becomes the downward
    extension. "No window swap" becomes: the store never swaps, and the
    slice re-slices on a jump and swaps on Jump to bottom. A jump re-
    slices unless the target and its row above are in the slice.
  - `### Autoscroll`: bottom-anchored behaviors act only at the tail.
  - `### Jump buttons`: the swap short of the tail; the button shows
    whenever the slice is short of the tail.
  - `### Anchor preservation under shifts`: the trim as a fifth
    scenario; the topmost visible row is now the anchor for commits;
    scenarios 2 and 3 become compensated; width reflow keeps its
    trigger in M9.5.
  - `### Inline edit session`: jumps may move the slice off the
    editor's row, whose draft survives.
  - **Relevant sections:** the lists pattern bullet's gloss.
- **`reader-document.md`:**
  - `## Entry list`: DOM residency bounded by the slice; the anchor
    rule's new anchor, its rest recording, and commits waiting for rest.
  - `## Bridge contract`: `rows`, the side tables, `streaming`,
    `hasOlder`; new `hasNewer`, `sliceKey`, `editingRow`,
    `onNearBottom`, `onTrim`; the imperative calls' key and hold.
  - `## Edit mode`: the draft survives the slice.
  - `## Failure and recovery`: a reload resets the slice to the tail.
- **`reader-composer.html`:** the window review toggle reads "at tail"
  and "short of tail (post-jump)", showing the bottom shimmer in the
  second; comments updated.
- **`followups.md → UX`:** "Native reader rows rerender per emission"
  is replaced by "The sliding reader window isn't built.", with the
  build notes, the acceptance measure and the landing-loop
  prerequisite.
- **`roadmap.md` M9.5:** the per-emission re-measure on a mid-tier
  phone, and the width-reflow item's anchor.
- **`lessons-learned/expo-dom-bridge-identity-and-rejections.md`:** the
  followup's new name.
- **From the drift pass:** `testing.md`'s selector note and
  `lists.md`'s composing section.
