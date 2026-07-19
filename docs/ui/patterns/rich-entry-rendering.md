# Rich-entry rendering pattern

The platform-neutral core of narrative-entry rendering: **detection**
(which entries exceed the plainly-translatable subset), the **rich
sanitize path**, and **shadow-root isolation** for rich content.
Plain-markdown entries keep the juice-inlined `narrative-html` path;
entries whose HTML exceeds it render through a shadow-root host with
their stylesheets intact. This is what makes the "LLM authors visual
elements" use case (layouting, coloring, animated elements) actually
render instead of silently degrading.

Where this runs is owned by
[`reader-document.md`](./reader-document.md): the reader's narrative
surface is one web document on every platform, so both the plain and
rich paths here execute in a real DOM everywhere — directly in the
page on web/desktop, inside the hosted document on native.

Used by:

- [`entry-card.md`](./entry-card.md) — the main content slot is
  the **only** fork point. Reasoning bodies and system entries
  always render plain (see [Scope gates](#scope-gates)).

Baseline pipeline being extended:
[`tech-stack.md → Markdown rendering + HTML sanitization`](../../tech-stack.md#9-markdown-rendering--html-sanitization).

## Why

- **The plain path has a ceiling.** The juice pre-pass inlines
  provider `<style>` blocks into attributes, and DOMPurify's
  default allowlist strips the `<style>` tag — so non-inlinable
  CSS (`@media`, `@keyframes`, pseudo-selectors) is silently
  dropped, and layout-level authoring (grid, positioned elements,
  animations) degrades to unstyled text.
- **Historical note.** The detection oracle below was designed
  against `react-native-render-html`'s CSS engine when native
  rendered entries through RNRH. RNRH retires with the
  single-document pivot, but the oracle remains the right
  translatability boundary: it cleanly separates "survives
  attribute inlining" from "needs a real stylesheet", tracks an
  installed engine rather than a hand-pinned list, and catches
  value-level failures (`background: red` inlines;
  `background: linear-gradient(…)` needs the rich path).

## Detection: the engine is the oracle

An entry goes rich when its HTML contains anything the CSS oracle
(`CSSProcessor.compileInlineCSS` from `@native-html/css-processor`)
cannot translate to inline-safe declarations. There is **no
hand-pinned property list** — the answer tracks the installed
engine automatically, including **value-level** failures a
property-name list can never catch.

Detector input is the **marked output, pre-juice**. Signals, in
order:

1. A `<style>` element containing `@media`, `@keyframes`,
   `@import`, or pseudo-selectors → rich.
2. Every remaining declaration (style attributes and plain
   `<style>` rules), run through the oracle one declaration at a
   time: any declaration yielding **zero native props** — or
   props landing only in the engine's web-compat bucket, like
   `position` — → rich.
3. Any tag without an RNRH element model → rich — plus `<table>`,
   pinned explicitly: the engine _does_ ship a table element
   model, but core RNRH has no tabular renderer (the official
   table plugin is itself WebView-based), so GFM pipe tables take
   the rich path and render as real tables.

Invalid values of supported properties (`color: notacolor`) are
_not_ dropped by the oracle — they compile to native props and stay
on the plain path, where the value is inert. The false-positive
class is narrower than originally budgeted: only genuinely
untranslatable declarations flag rich, and the cost is always an
unnecessary shadow-root host, never a wrong rendering.

The verdict is computed at render, memoized per entry alongside the
existing HTML memo — **not persisted** on the entry row. Detector
improvements reclassify old entries retroactively; streaming needs
no flag written at commit.

## Rich sanitize path

A second sanitize path in `lib/markdown`, used only by the rich
renderer. It **skips juice entirely** (real stylesheets work in the
isolated host) and runs DOMPurify with `<style>` added to the
allowlist, plus a CSS scrub applied uniformly to stylesheet content
and style attributes:

- strip any declaration containing `url(`, `expression(`, or
  `behavior` — the existing attribute-level exfiltration policy,
  now also enforced inside `@media` and `@keyframes` blocks;
- strip `@import` and `@font-face` at-rules entirely (external
  fetch vectors), and any at-rule not explicitly kept
  (default-deny; `@media` and `@keyframes` are the kept set);
- keep `@media`, `@keyframes`, and pseudo-selectors — the payload
  this pattern exists for;
- strip navigation attributes (`href`, `xlink:href`, `target`,
  `action`/`formaction`, `ping`) — shared policy with the plain
  path: entry links render as plain text everywhere, and the
  document/Electron navigation locks are regression backstops, not
  the policy (see
  [`reader-document.md → Isolation and security`](./reader-document.md#isolation-and-security)).

The scrub uses a real CSS parser (postcss, juice's own parser
dependency), not regex filtering — comment-obfuscated forms like
`url(/**/…)` must not slip through. `</style>` breakout is
neutralized by CSS-escaping `<` in serialized stylesheet text, and
`FORCE_BODY` keeps a leading `<style>` from being hoisted into
`<head>` and silently dropped.

## Isolation

`<style>` scoping is the load-bearing safety property — a
provider-authored `p { … }` or `body { … }` selector must never
touch the surrounding document.

The entry HTML and its `<style>` mount inside a **shadow root**.
Selectors cannot escape; `@keyframes` are scoped to the root; theme
CSS variables inherit _through_ the shadow boundary, so the
[theme baseline](../../implementation/lessons-learned/raw-html-island-theme-baseline.md)
keeps working without re-bridging. The scrub — not any CSP — is the
primary guarantee (there is no per-entry document boundary);
[`reader-document.md → Isolation and security`](./reader-document.md#isolation-and-security)
adds the document-level CSP and navigation lock as defense in depth
on native.

## Scope gates

- **Only the main content slot forks.** Reasoning bodies are
  chain-of-thought provenance, not an authoring surface — always
  the plain path (muted italic), the detector never runs on them.
  System entries likewise. The streaming card renders plain and
  incremental; at commit the detector runs on the final HTML and
  the committed entry takes whichever path it earns — inside the
  shared document pipeline the promote carries no reframe.
- **Content-based, not kind-based.** A user who pastes styled
  HTML into their own entry gets the rich path too.
- **Card chrome never enters the shadow root.** Header, action
  cluster, world-time footer, and edit mode surround the content
  slot; edit mode unmounts the content region entirely, so editing
  a rich entry is unchanged.

## What this design defers

- **Persisted rich-verdict or height caches** — nothing is
  persisted; the document architecture removed the need.
