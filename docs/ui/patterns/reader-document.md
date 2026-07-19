# Reader document pattern

The reader's narrative surface — entry list, entry-card chrome, and
everything that scrolls — is **one web document on every platform**.
Web and desktop render it directly in the page; native hosts the
same surface in a single `'use dom'` WebView. There are no per-entry
isolated renderers: rich entries render inside the document through
the shadow-root path exactly as they do on desktop
([`rich-entry-rendering.md`](./rich-entry-rendering.md) — detection,
rich sanitize, isolation — is consumed unchanged).

Used by:

- [`reader-composer.md`](../screens/reader-composer/reader-composer.md)
  — the only consumer. Screen chrome around the surface stays
  native; this doc owns the boundary.

Decision rationale and the retirement of the per-entry WebView
architecture: exploration record `2026-07-19-single-document-reader`
(explorations are disposable; this doc is canonical).

## Surface boundary

**Inside the document** — everything within the scrolling viewport:

- The entry list and every entry card in full: header, action
  cluster, reasoning region, content slot (plain and rich paths),
  world-time footer, inline edit mode, the streaming card.
- Scroll policy: the autoscroll state machine, near-bottom
  tracking, and the floating jump-to-bottom button. Scroll state
  never crosses the bridge at scroll frequency.
- Next-turn suggestion chips if they overlay the scroll viewport
  per the screen doc; the suggestion panel itself is composer
  chrome (native).

**Native chrome** — everything outside the scroll viewport:

- Screen shell: top bar (chapter navigation, time chip, status
  pill, actions menu), browse rail, composer + suggestion panel.
- All modals and sheets (rollback confirm, flip-era, regenerate
  confirmation, alert dialogs) and toasts. Entry actions inside the
  document **request**; native chrome **confirms and executes**.

## Entry list: fully rendered flow layout

The list is plain document flow — no JS virtualizer, and no engine
culling: every row in the loaded window is fully laid out. Real
heights are what keep open-at-bottom, prepend compensation, and
scrolling exact — validation retired `content-visibility` culling
because its placeholder estimates settle to real sizes as rows
first render, shifting content under the user's finger
(device-observed, worst on rich rows). One implementation serves
all platforms; the reader's `@tanstack/react-virtual` usage and
both `EntryWindow` branches are retired (the tanstack dependency
remains for non-reader surfaces; [`lists.md`](./lists.md) still
governs those).

Why not a JS virtualizer: its estimate corrections write scroll
position mid-gesture — imperceptible on wheel input, visible
stutter on touch flings (device-verified). The same rule governs
the whole surface: **no programmatic scroll write may land
mid-gesture.**

DOM residency is bounded by the
[loaded-set window](../screens/reader-composer/reader-composer.md#loaded-set-model),
not the viewport: ~50 entries at open, growing by boundary
auto-load — fired **only at scroll rest**. The boundary signal
latches during the gesture and fires once scroll events quiesce
with no finger down, so the prepend and its compensating scroll
write never fight compositor-owned scrolling. While older entries
may exist (`hasOlder`), a **boundary skeleton** permanently
occupies the slot above the oldest loaded row — an indicator that
mounted mid-scroll would itself shift content — and unmounts once,
compensated, when a short load proves the branch top. If a long
backwards-reading session makes window growth measurable (React
commit time or document memory), the designed lever is a **far-end
trim cap** on the loaded set — windowing at the data layer, never
in the scroll layer.

**Anchor preservation is deterministic, not engine-delegated.**
Chrome's scroll anchoring does not fire for this tree (measured;
synthetic DOM anchors fine), so the scroller opts out via
`overflow-anchor: none` and one rule is the sole authority: each
commit the surface memoizes the leading row's content offset, and
the next commit applies that same row's offset delta to the scroll
position — covering a prepended block, the boundary skeleton
mounting or unmounting, or both in one commit. A short frame-loop
hold absorbs late layout; split per-cause compensations are
forbidden (they fought each other — a hold target captured before
a sibling compensation re-asserted the stale position). Height
changes _between_ the leading row and the viewport (reasoning
expansion, footer re-wrap above the fold) are deliberately
uncompensated — [validated acceptable](#validation-record) as
felt on device; the rule extends naturally (anchor to the topmost
in-viewport row instead) if they ever measure.

Open-at-bottom is a document concern: land on the last entry
before first paint and re-assert per frame until layout settles —
late layout lands a one-shot write short of the true bottom. The
user's first gesture breaks the pin.

## Native hosting

- One `'use dom'` component instance per reader screen,
  **long-lived within a branch**: entry updates and streaming
  arrive as prop updates into the mounted instance. Opening a
  different branch is a screen navigation — a fresh instance and
  boot, which is the correct treatment (the new branch lands at its
  own bottom). Within a branch the component is never remounted to
  force state — expo-dom reuses the WebView per source file and
  boot-racing prop emissions are silently lost (device-verified);
  the host bumps `syncNonce` instead.
- The document claims its viewport explicitly (`position: fixed;
inset: 0` root) — expo-dom's mount root is a flex container in
  which plain block elements collapse to zero width.
- The WebView's own scrolling is disabled; the document's scroller
  owns all scrolling.
- **Boot treatment:** first paint for a 50-entry window is
  ~500–700ms (dev). The host shows an explicit loading state
  (skeleton or spinner in the card region) until the readiness
  handshake completes and first rows have painted; the document
  stays hidden until then. A blank or top-anchored flash never
  shows.
- **Fonts:** the document loads the app's reading/UI/mono fonts
  from bundled assets so `--font-*` tokens resolve identically to
  desktop. Font delivery must satisfy the document CSP (below) —
  validation item.

## Bridge contract

Serializable props in (native → document):

- `rows` — the loaded entry window (entries with metadata), plus
  the host-formatted world-time labels (calendar rendering stays
  native).
- `streaming` — the live stream row (`content`, `reasoning`,
  `phase`) or null. Buffer throttling stays native; cadence
  variance is accepted.
- `hasOlder` — older entries may exist above the loaded window.
  Host-derived from window-size math (a full first window means
  maybe-more; any short load proves the branch top is in the
  window). Drives the boundary skeleton and gates `onNearTop`.
- `editBlocked`, `showJumpToBottom`, theme id + token values, and
  other settings-derived flags.
- `syncNonce` — bumped by the host whenever it must force a full
  prop re-emission (see handshake).

Async function props out (document → native):

- Entry actions: edit commit, regenerate, branch, delete, flip era,
  system-entry retry/dismiss/fix. The document requests; native
  confirms (modals) and executes (action layer); results flow back
  as `rows` updates.
- `onNearTop` — boundary auto-load request (older entries). Fired
  only at scroll rest and only while `hasOlder` holds.
- `onReady` — the readiness handshake (below).
- `onFirstPaint` — once per boot, after the first non-empty rows
  paint (double-rAF); the host drops the loading veil on it.

Imperative native → document: `jumpToBottom` (End key, actions-menu
entry). Carried via the DOM imperative handle, not a prop.

**Readiness handshake.** Prop emissions into a document that isn't
listening yet are lost. The document calls `onReady` once its
listener is live (first boot _and_ every reload); the host responds
by bumping `syncNonce`, forcing a fresh emission of current state.
Native never assumes delivery before the first `onReady`.

## Streaming

Stream chunks update the `streaming` prop through the existing
native buffer cadence. Inside the document, the streaming card and
commit swap follow
[`entry-card.md`](./entry-card.md#per-kind-structure) unchanged —
the committed entry replaces the streaming row in the same render,
and since plain and rich entries share the document pipeline, the
promote is structurally a no-op (no underlay state, no reframe).
Bottom-pinned autoscroll runs in-document and absorbs tail growth
synchronously.

## Edit mode

Inline, inside the document — exact web parity, one code path. The
draft lives in document state; commit/cancel cross the bridge with
the final text only.

**Android IME inside a WebView is this pattern's top validation
item.** The designed fallback, if focus/keyboard handling fails on
device: entry editing hoists to a **native edit sheet** (native
Textarea over the reader, prefilled, commit routes through the same
action). The fallback changes edit-surface UX only — card chrome
and every other behavior stay in-document.

## Isolation and security

- The sanitize story is unchanged:
  [`rich-entry-rendering.md`](./rich-entry-rendering.md) — plain
  path (juice-inlined, DOMPurify allowlist) and rich path
  (stylesheet-preserving scrub) both run inside the document, with
  rich entries isolated in shadow roots.
- **Document CSP** (native, defense in depth behind the scrub):
  `default-src 'none'` shape — inline styles, `data:` images, and
  bundled fonts only. Dev builds exempt (Metro/HMR).
- **Navigation lock.** The document's own URL is always allowed —
  Android WebViews reload their document after surface loss, and
  blocking the recovery load freezes the surface (learned on the
  per-entry path). The own-URL latch only ever accepts a
  document-shaped URL (Metro in dev, bundled `file:`/`about:`
  otherwise): Android fires no request callback for the initial
  `loadUrl`, so an unguarded latch records the first foreign
  navigation as "own URL" and allows it (device-caught: a
  shadow-root PROBE anchor navigated the WebView). All foreign
  navigation is dropped.
- **Anchor policy: stripped at sanitize.** Entry HTML never
  carries a navigation vector — `href`, `target`,
  `action`/`formaction`, and `ping` are forbidden on both sanitize
  paths, so links render as plain text on every platform. The
  document's `composedPath` click interceptor and the navigation
  locks (this WebView lock on native; `will-navigate` +
  `setWindowOpenHandler: deny` in the Electron main process on
  desktop) stay as regression backstops behind the strip, not as
  the policy.

## Failure and recovery

A renderer kill now blanks the whole surface, not one card — the
recovery path is singular and must be boring:

1. expo-dom auto-reloads the WebView on render-process termination
   (upstream behavior).
2. The reloaded document re-runs and calls `onReady`.
3. The host bumps `syncNonce`; the document re-renders from current
   props and lands at bottom.

Cost: scroll position within the window is lost on recovery
(reload-to-bottom). Accepted for v1; revisit only if renderer kills
are observed outside memory-pressure extremes.

## What this retired

Deleted with the validated host integration (2026-07-19):
`rich-entry-content.native.tsx`, `rich-entry-dom.tsx`,
`rich-entry-visibility.ts`, the boot-slot scheduler,
`entry-window.tsx` (both platform branches, replaced by the shared
flow list), the `/dev/reader-webview` spike, and all reader RNRH
usage with the `react-native-render-html` dependency. The audit
confirmed no Hermes code renders entry HTML, so the juice/cheerio
native sanitize path and its Metro cheerio pin went too —
`sanitize.native.ts` is now a passthrough resolution stub that
exists only so the `lib/markdown` root resolves on native (the
host route imports the stream buffer from it). The
[detection oracle](./rich-entry-rendering.md#detection-the-engine-is-the-oracle)'s
`@native-html/*` packages stay — they are the translatability
boundary, independent of the retired renderer.

## Validation record

Empirical pass completed 2026-07-19 on real Android hardware
(SM-F966B), seeded rich-heavy story (`/dev/reseed`), dev build plus
a release (`--variant release`) install:

1. **Inline edit + IME** — verified: focus, keyboard, cursor,
   selection, commit/cancel through the bridge to SQLite.
   **Go: no native-edit-sheet fallback.**
2. **Streaming** — verified on a live provider turn: in-document
   cadence, commit swap without reframe, autoscroll pin.
3. **Boot + loading treatment** — verified: veil-covered cold open
   lands at bottom; ~4s end-to-end warm dev boot; release boot
   from the embedded bundle.
4. **Anchor preservation** — the deterministic anchor rule holds
   for boundary loads (prepend + skeleton swap, leading row
   pixel-stable at the hard stop). The uncompensated
   [shift scenarios](../screens/reader-composer/reader-composer.md#anchor-preservation-under-shifts)
   (reasoning expansion, footer re-wrap above the fold) were
   observed acceptable without compensation; the topmost-in-viewport
   anchor extension stays parked unless they start to measure.
5. **Renderer-kill recovery** — verified: forced renderer crash
   auto-reloads through the handshake back to bottom.
6. **Security probes** — verified: seeded PROBE entries inert (no
   fetches, no navigation, no script execution); the anchor-tap
   escape found mid-validation drove the `composedPath()` +
   nav-lock-latch fixes now in the contract.
7. **Fonts** — verified in release with the CSP meta active: the
   reading serif and rich styling render in-document. Structural
   note: every font stack is system fonts — no `@font-face` ships,
   so `font-src` is never consulted.
8. **Memory (release build)** — app process 253–268 MB PSS plus
   WebView renderer 114–142 MB PSS (plain story at open → rich
   story with a boundary-load-grown window); ~370–410 MB combined
   vs ~610 MB in the dev build. Window growth cost ~9 MB per six
   boundary loads in the renderer.
9. **Accessibility** — with TalkBack bound, the full web document
   materializes in the accessibility tree (~600 nodes): narrative
   text in reading order, labeled entry controls, table content
   cell-by-cell. Gesture traversal walks chrome into the surface;
   explore-by-touch and double-tap activation work. Spoken output
   itself was not audited (needs ears on device).
10. **`expo export --platform android`** — verified: the DOM
    bundle ships in `www.bundle/` and the release build boots the
    reader from the exported bundle with no Metro.
