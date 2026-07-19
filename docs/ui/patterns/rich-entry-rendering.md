# Rich-entry rendering pattern

Hybrid rendering for narrative entry content. Plain-markdown
entries keep the existing platform tails (web `narrative-html`
div, native `react-native-render-html`); entries whose HTML
exceeds what native can translate render through an **isolated
document renderer** — a Shadow DOM host on web, an Expo DOM
component (WebView) on native. This is what makes the "LLM
authors visual elements" use case (layouting, coloring, animated
elements) actually render on Android instead of silently
degrading, and it fixes web's own silent gap (see
[Why](#why) below).

Used by:

- [`entry-card.md`](./entry-card.md) — the main content slot is
  the **only** fork point. Reasoning bodies, system entries, and
  the streaming card always render native (see
  [Scope gates](#scope-gates)).

Baseline pipeline being extended:
[`tech-stack.md → Markdown rendering + HTML sanitization`](../../tech-stack.md#9-markdown-rendering--html-sanitization).

## Why

- **Native ceiling.** `react-native-render-html` translates a
  fixed CSS subset (~76 native-compatible properties). Grid,
  positioned layouts, shadows, gradients, animations,
  pseudo-elements, and media queries are silently dropped on
  Android while web renders (some of) them.
- **Web has a silent gap too.** The web pipeline inlines styles
  with juice, then DOMPurify's default allowlist strips the
  `<style>` tag — so the non-inlinable residue (`@media`,
  `@keyframes`, pseudo-selectors) is dropped on **both**
  platforms today. The rich path repairs this on web as a side
  effect.

## Detection: the engine is the oracle

An entry goes rich when its HTML contains anything the installed
RNRH engine cannot translate. There is **no hand-pinned property
list** — the detector asks RNRH's own CSS engine
(`CSSProcessor.compileInlineCSS` from `@native-html/css-processor`,
already in the tree as an RNRH dependency), so the answer tracks
the installed version automatically, including **value-level**
failures a property-name list can never catch (`background: red`
translates; `background: linear-gradient(…)` is dropped).

Detector input is the **marked output, pre-juice**. Signals, in
order:

1. A `<style>` element containing `@media`, `@keyframes`,
   `@import`, or pseudo-selectors → rich.
2. Every remaining declaration (style attributes and plain
   `<style>` rules), run through the oracle one declaration at a
   time: any declaration yielding **zero native props** — or
   props landing only in the engine's web-compat bucket, like
   `position` — → rich.
3. Any tag without an RNRH element model → rich. This
   deliberately includes `<table>`: GFM pipe tables compile to
   `<table>`, core RNRH cannot render them (the official table
   plugin is itself WebView-based), so unstyled markdown-table
   entries take the rich card and finally render properly on
   Android.
4. Otherwise → the plain native path.

Known false-positive class, accepted: a supported property with
an _invalid_ value (`color: notacolor`) is dropped by the oracle
and flags rich; the WebView drops it too. Cost is an unnecessary
WebView, never a wrong rendering.

The verdict is computed at render, memoized per entry alongside
the existing HTML memo — **not persisted** on the entry row.
Detector improvements reclassify old entries retroactively;
streaming needs no flag written at commit.

## Render paths

|        | plain entry                      | rich entry                   |
| ------ | -------------------------------- | ---------------------------- |
| web    | `narrative-html` div (unchanged) | Shadow DOM host              |
| native | RNRH path (unchanged)            | Expo DOM component (WebView) |

The detector is platform-neutral and shared; only the tails
differ.

## Rich sanitize path

A second sanitize path in `lib/markdown`, used only by the rich
renderers. It **skips juice entirely** (real stylesheets work in
both isolated documents) and runs DOMPurify with `<style>` added
to the allowlist, plus a CSS scrub applied uniformly to
stylesheet content and style attributes:

- strip any declaration containing `url(`, `expression(`, or
  `behavior` — the existing attribute-level exfiltration policy,
  now also enforced inside `@media` and `@keyframes` blocks;
- strip `@import` and `@font-face` at-rules entirely (external
  fetch vectors);
- keep `@media`, `@keyframes`, and pseudo-selectors — the payload
  this pattern exists for.

The scrub uses a real CSS parser (juice's own parser dependency
is already bundled), not regex filtering — comment-obfuscated
forms like `url(/**/…)` must not slip through.
Implementation-time verification items: DOMPurify's handling of
`</style>` breakout text inside CSS, and that the scrub survives
the streaming buffer contract (rich entries never stream, but the
sanitize entry points are shared).

## Isolation

`<style>` scoping is the load-bearing safety property — a
provider-authored `p { … }` or `body { … }` selector must never
touch the app document.

- **Native**: the DOM component is its own WebView document;
  isolation is inherent. Defense in depth: the card document
  carries a strict CSP (`default-src 'none'` shape, inline styles
  and `data:` images only) so a scrub gap still cannot make a
  network request.
- **Web**: the entry HTML and its `<style>` mount inside a
  **shadow root**. Selectors cannot escape; `@keyframes` are
  scoped to the root; theme CSS variables inherit _through_ the
  shadow boundary, so the
  [theme baseline](../../implementation/lessons-learned/raw-html-island-theme-baseline.md)
  keeps working without re-bridging. No per-entry CSP is possible
  here (no document boundary), which is why the scrub — not the
  CSP — is the primary guarantee on both platforms.

Theme bridging into the native card: token values pass as
serializable props into the DOM component and are applied as CSS
variables on its root; font scale rides the same props. Prop
updates re-render the card in place — live theme switches must
not remount it (validation item 8).

## Native card lifecycle: underlay + single swap

A WebView row has no synchronous height: it mounts empty, boots
(hundreds of ms on weak hardware), then `matchContents` resizes
it asynchronously. Every timing problem — blank cards mid-scroll,
prepend jitter, commit-swap reframe — is downstream of that. One
mechanism covers all of them:

**A rich card never mounts empty.** It mounts rendering the RNRH
degraded version immediately (today's floor — cheap, synchronous,
approximately right-sized) with the DOM component booting
alongside, invisible. The DOM component calls an async `onReady`
function prop once painted; visibility swaps, the row settles to
measured height. One shift, content visible throughout.

- `dom={{ matchContents: true, scrollEnabled: false }}` sizes the
  card; a session-scoped height cache keyed by
  `(entryId, contentWidth, fontScale)` lets remounting cards
  claim their measured height instantly, with the underlay
  bridging only WebView boot. Persisting the cache is deferred
  until validation shows re-measure pain.
- **Prepend anchoring**: prepended older entries mount underlay
  first, so the post-measure correction is small and
  `maintainVisibleContentPosition` absorbs it (see
  [reader anchor preservation](../screens/reader-composer/reader-composer.md#anchor-preservation-under-shifts)).
  MVCP's behavior for _above-viewport_ async resizes is assumed,
  not verified — validation item 5.
- **Streaming promote**: streaming always renders native and
  incremental (running the detector per chunk or booting a
  WebView mid-stream is a non-starter). At commit the detector
  runs on the final HTML; a rich verdict mounts the committed
  card in underlay state — which _is_ the streaming rendering —
  so the promote is visually a no-op until the ready-swap,
  honoring the
  [no-reframe commit-swap contract](./entry-card.md#per-kind-structure).
  Bottom-pinned autoscroll absorbs the tail height change.

Stated cost: every rich row pays a double render (RNRH and
WebView) during its boot window. The underlay unmounts after the
swap; validation watches the boot-window cost on low-end
hardware.

## Navigation lock

Provider-authored HTML can contain `<a href>`; a tap inside the
WebView would navigate the card's document away. The card blocks
all navigation after the initial load
(`onShouldStartLoadWithRequest` via the `dom` prop); `http(s)`
taps route to the system browser via `Linking`; everything else
is dropped. The wider anchor-`href` policy question (strip vs
keep-and-intercept, across _all_ render paths — web's plain path
navigates the Electron window today) is a separate triage item,
predates this pattern, and is not resolved here.

## Scope gates

- **Only the main content slot forks.** Reasoning bodies are
  chain-of-thought provenance, not an authoring surface — always
  RNRH (muted italic), the detector never runs on them. System
  entries likewise. The streaming card is always native by the
  lifecycle above.
- **Content-based, not kind-based.** A user who pastes styled
  HTML into their own entry gets the rich card too.
- **Chrome stays native.** Header, action cluster, world-time
  footer, and edit mode are RN views around the content slot and
  never enter the WebView; edit mode unmounts the content region
  entirely, so editing a rich entry is unchanged.
- **Selection asymmetry, accepted.** WebView text is natively
  selectable; RNRH text on Android currently is not. Rich cards
  therefore gain selection plain cards lack — an improvement
  inconsistency. Making RNRH selectable is a separate triage
  item.

## Validation checklist

Empirical pass on real low-end Android hardware with a seeded
rich-heavy story. Gated on the prerequisite install (below).

1. **Boot latency** — mount → `onReady` timing; the underlay
   bridges it invisibly.
2. **Memory** — FlatList's default window keeps ~10 viewports of
   rows alive; count concurrent WebViews on a rich-heavy story,
   watch for OOM, tune `windowSize` down if needed.
3. **Scroll fps** through a rich-heavy stretch, including with
   running keyframe animations.
4. **Touch capture** — a drag starting on a rich card must scroll
   the list; Android WebViews can swallow drag gestures even with
   `scrollEnabled: false`.
5. **Prepend and above-viewport resize** — MVCP compensation
   quality when a prepended batch contains rich entries.
6. **Single-swap discipline** — no double shift on first measure;
   height-cache remounts are instant.
7. **Security probes** — deliberate `url()` / `@import` / link
   payloads: scrub strips, CSP blocks what slips, navigation lock
   holds.
8. **Live theme switch and font scale** — bridged CSS vars update
   without remounting cards.
9. **`expo export --platform android` passes** — web green means
   nothing for native bundles
   ([Metro browser-builds lesson](../../implementation/lessons-learned/metro-native-ignores-browser-builds.md)).

Worst-case fallback if touch capture proves unfixable:
`pointerEvents: 'none'` on the card wrapper — costs in-card
selection and links but keeps rendering. Named so validation has
a floor, not a cliff.

## Prerequisite

`react-native-webview` install plus a dev-client rebuild before
first import
([native-dep lesson](../../implementation/lessons-learned/native-dep-expo-link.md)).
Not yet installed.

## What this design defers

- **Persisted height cache** — session-scoped Map first; persist
  only if validation shows re-measure pain.
- **Anchor `href` policy across all render paths** — triage item;
  the card's navigation lock covers only the rich path.
- **RNRH text selection on native** — triage item; orthogonal to
  this pattern.
- **RNRH-selectability parity inside the fallback** — if the
  touch-capture fallback ever ships, in-card selection dies with
  it; revisit alongside the selection triage item.
