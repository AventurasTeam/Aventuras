# Single-document reader — pivot from per-entry WebView cards

Session record, 2026-07-19. Supersedes the native tail of the
same-day rich-entry design pass: the per-entry isolated-renderer
architecture (WebView per rich entry) is replaced by **one web
document hosting the reader's entire narrative surface** on native.
Canonical spec lands in
[`ui/patterns/reader-document.md`](../ui/patterns/reader-document.md)
(new) and a slimmed
[`ui/patterns/rich-entry-rendering.md`](../ui/patterns/rich-entry-rendering.md)
(platform-neutral core only);
[`reader-composer.md → Scroll behavior`](../ui/screens/reader-composer/reader-composer.md#scroll-behavior)
is revised to match. This file is the frozen reasoning trail.

## Problem

The per-entry rich path shipped and worked, but on-device testing
burned through its failure modes within one day, each fix exposing
the next:

1. **Swap shift.** Every rich card pays one visible height shift
   when the RNRH underlay swaps to the measured WebView — worst
   while scrolling down, where swaps land in-viewport.
2. **Memory.** A WebView costs ~50MB; the mounted window held ~19 →
   1.4GB observed. Visibility-driven residency (viewport ±2 rows,
   teardown after 2s) bounded it to ~700MB reported — still paying
   several renderers for one screen.
3. **Surface fragility.** Detached Android WebViews lose their
   surface (blank cards, reload wobble); renderer kills strand cards
   blank with no JS signal. Each needed dedicated recovery code
   (reload-tolerant nav lock, underlay re-bridge, process-gone
   remount, boot-slot scheduler).

Interim options evaluated and rejected with the user:

- **Direction-aware lookahead buffer** — rejected: "side-steps the
  issue; scroll a little too fast, same issue is back."
- **Shared measurer WebView** (pre-computed exact heights kill the
  shift) — rejected: swap-in of content is still visible, and the
  measurer must replicate the card document's rendering environment
  exactly or heights drift.

## The pivot

The web platform already renders the whole narrative surface as one
DOM — the per-entry problems exist only because native re-hosts that
surface as N micro-documents. Hosting the **existing web reader
surface in one `'use dom'` WebView** retires the entire failing
layer: no swaps, no per-entry renderers, one recovery path.
Everything platform-neutral (detection, rich sanitize, shadow-root
isolation) carries over unchanged and runs inside the document
exactly as on desktop.

## Spike evidence (all device-verified, dev route `/dev/reader-webview`)

- **Rendering parity** — RN-Web + NativeWind CSS compile and run in
  the DOM bundle; chrome/theme pixel-parity confirmed by the user.
  CSS grid, positioned elements, animations, and tables render flat
  in the document — the exact payloads core RNRH drops.
- **Scroll** — `@tanstack/react-virtual` stutters on touch (its
  above-viewport estimate corrections write `scrollTop` mid-fling;
  on wheel this is invisible, on flings it reads as flicker). Plain
  flow + `content-visibility: auto` + `contain-intrinsic-size`
  scrolls natively smooth; engine culling replaces JS windowing.
- **Boot** — ~500–700ms first paint for a 50-entry window (dev
  bundle); within tolerance behind an explicit loading treatment.
- **Memory** — one renderer (~66MB resident) vs N; dev app total
  ~256MB resident on the spike screen. Release-build number is a
  validation item.
- **Bridge hazards** — expo-dom's root is a flex container (block
  children collapse to 0 width; the document must claim the
  viewport); expo-dom **reuses the WebView per source file and
  `$$props` emissions race a booting document's listener** —
  remount-time prop updates are silently lost. The document must be
  long-lived and prop-updated, with a readiness handshake.

## Decisions (user sign-off 2026-07-19)

1. **Edit mode: in-document.** Web parity, one code path. Android
   IME inside the WebView is the top validation item; a native edit
   sheet is the specced fallback if IME fails on device.
2. **Scroll policy: in-document.** The autoscroll machine (pure JS)
   and jump-to-bottom button move into the document; the bridge
   carries no per-frame telemetry. Motivated directly by the
   `$$props` race class.
3. **Doc shape: new pattern + slim.** `reader-document.md` owns
   hosting, bridge, lifecycle, recovery; `rich-entry-rendering.md`
   keeps only the platform-neutral core (detection, rich sanitize,
   shadow isolation), which the document consumes as-is.
4. **Desktop unifies now.** One flow + `content-visibility` list on
   all platforms; both EntryWindow branches and the reader's
   tanstack-virtual usage retire (the dependency stays for other
   surfaces). Virtualization trade-off examined with the user:
   engine culling fully retains the rendering benefit; DOM residency
   is bounded by the loaded-set window instead of the viewport, with
   a designed far-end trim cap if validation shows growth pain.

## Integration plan

Slice-shaped, in dependency order:

1. **Shared entry-list component** (flow + `content-visibility`,
   open-at-bottom, boundary auto-load, browser scroll anchoring) —
   replaces both EntryWindow branches; desktop web adopts it in the
   same slice.
2. **Reader document component** (`'use dom'`): hosts the list +
   EntryCard, theme bridging, in-document autoscroll + jump button,
   inline edit, streaming row; readiness handshake.
3. **Native host integration**: reader-composer mounts the document
   behind a loading treatment; bridge wiring (rows/streaming in,
   entry actions out, imperative jump, `Linking` for foreign URLs);
   renderer-kill recovery = expo-dom auto-reload + handshake
   re-emit.
4. **Retirements**: `rich-entry-content.native.tsx`,
   `rich-entry-dom.tsx`, `rich-entry-visibility.ts` (+ boot
   scheduler), `entry-window.tsx`, reader RNRH usage
   (`lib/markdown/native.ts` styles) and — audit-gated — the
   juice/cheerio native sanitize path and its Metro pin, which no
   Hermes code consumes once entries render only in documents.
5. **On-device validation** per the checklist in
   `reader-document.md` (IME is the go/no-go for decision 1's
   fallback).

The per-entry implementation remains the shipped floor until slice 3
lands; its own validation checklist is superseded except for the
security probes, which transfer to the document checklist.

## Known risks going in

- **Android IME + in-document editing** (named fallback designed).
- **Streaming cadence over the bridge** — accepted by the user
  (model/provider TPS variance dominates; buffer throttling already
  exists).
- **Prepend anchoring via browser scroll anchoring** — replaces
  MVCP (native) and the manual padding dance (web); must be
  validated for all three shift scenarios in
  [`reader-composer.md → Anchor preservation`](../ui/screens/reader-composer/reader-composer.md#anchor-preservation-under-shifts).
- **Fonts inside the document** — app reading fonts must load from
  bundled assets under the document CSP.
