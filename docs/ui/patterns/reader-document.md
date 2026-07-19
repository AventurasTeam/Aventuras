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

## Entry list: flow layout + engine culling

The list is plain document flow — no JS virtualizer. Rows carry
`content-visibility: auto` with a `contain-intrinsic-size`
placeholder, so the engine skips layout/paint for off-screen rows
and preserves scrollbar geometry. One implementation serves all
platforms; the reader's `@tanstack/react-virtual` usage and both
`EntryWindow` branches retire (the tanstack dependency remains for
non-reader surfaces; [`lists.md`](./lists.md) still governs those).

Why not a JS virtualizer: its estimate corrections write scroll
position mid-gesture — imperceptible on wheel input, visible
stutter on touch flings (device-verified). Engine culling does the
same rendering elision natively and cooperates with browser scroll
anchoring instead of fighting it.

DOM residency is bounded by the
[loaded-set window](../screens/reader-composer/reader-composer.md#loaded-set-model),
not the viewport: ~50 entries at open, growing by boundary
auto-load. If a long backwards-reading session makes window growth
measurable (React commit time or document memory), the designed
lever is a **far-end trim cap** on the loaded set — windowing at
the data layer, never in the scroll layer.

Open-at-bottom is a document concern: land on the last entry before
first paint (no visible pre-scroll frame), then reveal.

## Native hosting

- One `'use dom'` component instance per reader screen,
  **long-lived**: branch switches, entry updates, and streaming all
  arrive as prop updates. The component is never remounted to force
  state — expo-dom reuses the WebView per source file and
  boot-racing prop emissions are silently lost (device-verified).
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
- `editBlocked`, `showJumpToBottom`, theme id + token values, and
  other settings-derived flags.
- `syncNonce` — bumped by the host whenever it must force a full
  prop re-emission (see handshake).

Async function props out (document → native):

- Entry actions: edit commit, regenerate, branch, delete, flip era,
  system-entry retry/dismiss/fix. The document requests; native
  confirms (modals) and executes (action layer); results flow back
  as `rows` updates.
- `onNearTop` — boundary auto-load request (older entries).
- `onLinkTap(url)` — foreign `http(s)` URLs route to the system
  browser via native `Linking`.
- `onReady` — the readiness handshake (below).

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
  per-entry path). Foreign `http(s)` navigations route to the
  system browser; everything else is dropped. The wider anchor
  `href` policy across platforms (desktop web still navigates the
  Electron window) remains the pre-existing triage item.

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

## What this retires

Once the host integration lands, the per-entry native tail is
deleted: `rich-entry-content.native.tsx`, `rich-entry-dom.tsx`,
`rich-entry-visibility.ts`, the boot-slot scheduler, and
`entry-window.tsx` (both platform branches, replaced by the shared
flow list). Reader RNRH usage retires with them; the juice/cheerio
native sanitize path and its Metro pin are deletion candidates
pending an audit that no Hermes code still renders entry HTML.

## Validation checklist

Empirical pass on real low-end Android hardware, seeded rich-heavy
story (`/dev/reseed`):

1. **Inline edit + IME** — focus, keyboard, cursor, selection,
   commit/cancel; coexistence with the native composer's keyboard
   handling. Go/no-go for the native-edit-sheet fallback.
2. **Streaming** — live stream renders in-document at acceptable
   cadence; commit swap without reframe; autoscroll pin holds.
3. **Boot + loading treatment** — cold reader open, loading state
   visible, no flash; time-to-content on low-end hardware.
4. **Prepend anchoring** — browser scroll anchoring holds for all
   three
   [shift scenarios](../screens/reader-composer/reader-composer.md#anchor-preservation-under-shifts),
   on Android and desktop.
5. **Renderer-kill recovery** — kill the WebView renderer under
   memory pressure; surface recovers to bottom with current data.
6. **Security probes** — the seeded PROBE entries render inert
   in-document: no fetches, no navigation, no script execution.
7. **Fonts** — reading font renders in-document under the CSP.
8. **Memory (release build)** — the honest number the dev-build
   measurements couldn't give.
9. **Accessibility** — TalkBack pass over the document surface.
10. **`expo export --platform android` passes** — the DOM bundle
    ships and boots from the exported bundle, not just Metro dev.
