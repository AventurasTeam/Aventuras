# Cross-platform font resolution and bundling

Design session — fixes the desktop-vs-Android reading-font
discrepancy and establishes the font-bundling contract. Output is
the **cross-platform font-resolution contract**: how a font token
resolves to a real typeface identically on web and native, how a
theme bundles a font, and the reinstatement of VT323 for the Fallen
Down theme.

This file is an exploration record. Once integrated, the canonical
home is
[`typography.md → Cross-platform font resolution`](../ui/foundations/typography.md#cross-platform-font-resolution);
that section carries the authoritative contract. This record keeps
the rationale and the trade-offs considered.

## What fails today

The reader prose renders serif on desktop and **sans-serif on
Android** — the same `--font-reading` token, two different
typefaces. Both [`followups.md`](../followups.md) (Custom-font theme
support) and [`typography.md`](../ui/foundations/typography.md)
described this as "both web and native fall through to the system
sans-serif default." That description is **wrong**, and the wrong
description points at the wrong fix.

Traced end to end:

- **Desktop / web (Electron, RN Web).** The browser resolves the
  full CSS stack in `--font-reading`. Linux has Liberation Serif,
  macOS has Charter, Windows has Georgia or Cambria, and the
  trailing generic `serif` keyword renders a serif even when no
  named face resolves. **Desktop renders serif — correctly.**
- **Android / native.** React Native's `fontFamily` style accepts
  exactly **one** family name. NativeWind resolves
  `var(--font-reading)` to the literal stack string
  (`Charter, 'Iowan Old Style', …, serif`) and hands that whole
  comma-joined string to `fontFamily`. Android's `Typeface`
  resolver finds no family by that name and falls back to the
  system default — Roboto, a sans-serif. The trailing `serif`
  keyword, which Android _does_ honor, never gets used because it
  is buried mid-string instead of passed alone.

So the real defect is not "custom fonts aren't bundled." It is
**React Native cannot consume a multi-family CSS stack.** Android
already ships Noto Serif; RN already honors `fontFamily: 'serif'`.
The fix needs zero bundled fonts.

Two corollaries fall out of the same mechanism:

- **`--font-mono` is silently broken on Android too.** Same
  failure — any code or JSON viewer renders sans on Android.
  Unnoticed only because no mono surface has been exercised on
  device.
- **`--font-ui` is broken on Android but invisibly.** Its stack
  ends in `sans-serif`; the broken fallback (Roboto sans) happens
  to equal the intended result. The coincidence is why the bug
  went uncaught — only `--font-reading` exposes it, because
  serif-intent differs from sans-failure.

## Approaches considered

The unfixable reality: web wants a font _stack_, native wants a
single _name_. The token name (`--font-reading`) stays; the
question is how its value bridges that gap.

| Approach                             | Native gets a single name via                                                                                                           | Token shape                            | Cost                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **A — stack token, native resolver** | A JS resolver walks the stack, returns the first entry that is a bundled-registry family or one of `serif` / `sans-serif` / `monospace` | unchanged (one CSS stack)              | smallest; leans on a convention made safe by a validation check                                           |
| **B — per-platform token**           | Theme declares `{ web, native }` explicitly                                                                                             | `FontToken` becomes a two-field object | explicit, type-enforced; duplicates the family name on every theme; overturns the locked stack-token rule |
| **C — semantic role**                | Token is a `serif` / `sans` / `mono` role; a central table expands per platform                                                         | token becomes a role enum              | cleanest model, largest blast radius — Tailwind config, css-generator, types, every theme                 |

**Chosen: A.** A bundled-font registry has to exist regardless —
both the web `@font-face` and the native build-time embed need to
know which file and which family name. Once that registry exists,
native resolution is a cheap deterministic stack-walk with no
duplication. The one convention it leans on (every stack contains
an RN-honored generic keyword) is already CSS best practice; a
validation check turns the original _silent_ failure into a _loud_
one. B pays per-theme duplication to type-enforce what a one-line
audit also catches. C over-engineers three slots.

Approach A also has precedent: `--tint-hover` and `--tint-press`
already carry a web value (a `color-mix` expression) and a native
value (a concrete rgba) under one token name, because NativeWind
on native cannot parse `color-mix`. Fonts follow the same shape —
web gets the stack, native gets the pre-resolved name.

## The design

Rationale here; the contract is canonical in
[`typography.md → Cross-platform font resolution`](../ui/foundations/typography.md#cross-platform-font-resolution).

**Resolution.** Token names and the Tailwind `fontFamily` mapping
are unchanged, so every `font-reading` / `font-ui` / `font-mono`
consumer is untouched. On web, the token resolves to the full CSS
stack (works today). On native, a JS resolver runs at
theme-application — the same hook the accent-derivation already
uses — and the value fed to NativeWind's `vars()` is a single
resolved family name. The resolver walks the stack left to right
and returns the first entry that is either a registered bundled
family or one of exactly `serif` / `sans-serif` / `monospace` (the
three generics Android honors as `fontFamily` values; CSS generics
like `system-ui` and `ui-monospace` are _not_ RN-honored and are
skipped). Well-formed stacks put a bundled font first and a
generic keyword last, so the walk picks the bundled font when one
is present and the generic otherwise. The resolver carries a
per-slot terminal fallback (`serif` / `sans-serif` / `monospace`)
so it never yields an empty value even for a malformed
user-authored stack.

**Bundling.** A central bundled-font registry lists each bundled
font (family name, asset, license). It drives three consumers: the
web `@font-face` blocks, the native `expo-font` config-plugin
entries, and the resolver's known-bundled set. Native embedding
uses the Expo SDK 55 `expo-font` config plugin — fonts embed at
build time, available immediately with no runtime load and no
flicker; the Android object form pins a stable family name so the
name matches web and iOS. Fonts ship in the app bundle under
`assets/fonts/<family>/` with the license text alongside; no CDN —
the app is offline-first and Electron is local. Lazy-loading is
rejected: pointless for a small font, and a network dependency is
wrong for an offline app. This collapses the four open questions
in the old followup — bundle strategy, web loading, per-platform
reconciliation, and first-launch UX — because a build-time embed
plus a bundled file means the font is simply always present.

**VT323 for Fallen Down.** This reverses the session-6 decision
recorded in [`themes.md`](../ui/foundations/themes.md) to drop
VT323. VT323 is SIL Open Font License 1.1 (redistribution and
embedding permitted — no licensing blocker) and the woff2 is
roughly 3 KB, so the "dropped for simplicity / bundle cost"
rationale does not survive the actual numbers. Fallen Down's
`--font-reading` override gains `VT323` at the head of its
existing monospace stack; the system-mono tail stays as the
fallback. It is the registry's first and only v1 entry. Parchment
stays system-serif — it resolves to a real serif on every
platform once the resolver lands, and needs no bundled font.

## Adversarial-pass findings

- **Load-bearing assumption: Android RN honors
  `fontFamily: 'serif' | 'sans-serif' | 'monospace'`.** If false,
  the resolver's output still fails to render a serif. High
  confidence — this is established Android `Typeface` behavior, RN
  passes the string straight through, and RN apps routinely set
  `fontFamily: 'monospace'`. Cheap to confirm on-device as the
  first implementation step. If it were false the fallback would
  be Approach B or bundling a serif; not expected.
- **Resolver terminal fallback (design gap, now closed).** A stack
  with no RN-honored generic and no bundled font would leave the
  resolver with nothing to return. Curated themes are caught by
  the validation check, but user-authored themes (parked, raw CSS)
  bypass the type system and the curated audit. The resolver
  therefore carries a hard per-slot terminal fallback — it never
  returns empty.
- **VT323 is single-weight (400 only).** Narrative prose carries
  inline bold (weight 700); the platform synthesizes a faux-bold
  of the pixel face. Unavoidable — VT323 has no bold variant by
  design — and consistent with its retro-terminal identity
  (terminals have no bold). Accepted, not a blocker.
- **VT323 metrics differ from the system mono stack.** The locked
  `--leading-lg` may read cramped or loose against VT323. The
  `leadingMultiplier` escape valve exists for exactly this; Fallen
  Down is a likely consumer once VT323 renders on device. Not
  pre-decided — the multiplier value is implementation-testing
  work, consistent with the existing
  [`themes.md → leadingMultiplier per theme`](../ui/foundations/themes.md#leadingmultiplier-per-theme)
  note.
- **VT323 covers Latin only.** Non-Latin story content (Cyrillic,
  CJK) under the Fallen Down theme degrades per-glyph to the stack
  or system fallback — mixed-font rendering. A niche combination
  with graceful degradation; accepted and noted in the registry
  contract.
- **iOS gap.** The resolver returns generic keywords, which iOS RN
  does _not_ honor as `fontFamily` values (iOS needs a real font
  name). Bundled fonts resolve fine on iOS (real family name), so
  Fallen Down works; only the system-stack defaults mis-render on
  iOS. iOS is deferred for v1; the gap is documented inline in
  typography.md where the iOS implementer will read it, rather
  than parked separately.
- **Read-site impact: none, by construction.** Token names and
  Tailwind classes are unchanged; only the resolved native value
  changes. Every consumer benefits automatically — no read-site
  edits. This is Approach A's defining strength.
- **No data-model impact.** Fonts live in the theme registry and
  the bundled-font registry (both code) plus the bundled assets.
  `app_settings.appearance` is untouched. Zero schema change.

## Followups

- **Resolved:** Custom-font theme support — all four of its open
  design questions are answered. Removed from
  [`followups.md`](../followups.md).
- **Introduced:** none. The implementation (resolver, config
  plugin, `@font-face`, the VT323 asset, the validation check) is
  ordinary milestone work, tracked wherever font-resolution lands
  as a slice — not a design followup.
- **Parked:** none. The iOS system-stack gap is a consequence of
  the already-deferred iOS target, documented inline in
  typography.md rather than given its own parked entry.

## Integration plan

Canonical files changed:

- **EDIT**
  [`ui/foundations/typography.md`](../ui/foundations/typography.md)
  — (a) reword the **Default font stacks** intro: the three
  defaults are system fonts, but a theme may bundle a font (Fallen
  Down ships VT323); keep the `Default font stacks` heading
  stable (inbound anchors from `tokens.md` and `themes.md`).
  (b) Rename `## Implementation notes` to
  `## Cross-platform font resolution` (no inbound anchor refs —
  verified by grep) and replace its contents with the resolution
  and bundling contract: the web-stack / native-resolved-name
  split, the native resolver and its terminal fallback, the
  bundled-font registry, build-time embedding plus web
  `@font-face`, the iOS gap, and the validation check. Removes the
  false "fall through to platform default on both web and native"
  claim.
- **EDIT** [`ui/foundations/tokens.md`](../ui/foundations/tokens.md)
  — in **Font-family slots**, refine the "declare stacks, not
  single names" rule: the stack is the web value and the
  resolver's input; the rationale is no longer "native fallback
  chain" (native cannot consume a stack). Add a pointer to the
  resolution contract. Keep the `Font-family slots` heading stable
  (inbound anchor from `typography.md`).
- **EDIT** [`ui/foundations/themes.md`](../ui/foundations/themes.md)
  — reverse the VT323-dropped decision in two places: the **Fallen
  Down** roster section and the **Reading-font policy per theme**
  bullet. Fallen Down's `--font-reading` bundles VT323 at the head
  of the monospace stack. Extend the **leadingMultiplier per
  theme** note to name Fallen Down / VT323 as a likely consumer.
- **EDIT** [`ui/foundations/theming.md`](../ui/foundations/theming.md)
  — in **Switching mechanism**, rewrite the custom-font-overrides
  validation-findings bullet: the slot swaps correctly; the defect
  is native stack consumption, now resolved by the resolver. Keep
  the `Switching mechanism` heading stable (many inbound anchors).
- **EDIT** [`ui/foundations/README.md`](../ui/foundations/README.md)
  — amend the session-6 Fallen Down note from "bundled VT323 font
  dropped" to record the 2026-05-21 reinstatement, matching the
  density-toggle "cut … reinstated" precedent in the same list.
- **EDIT** [`followups.md`](../followups.md) — remove the
  **Custom-font theme support** entry (resolution narrative in the
  commit message).

Inbound-anchor repairs (the followup removal breaks two links):

- **EDIT**
  [`explorations/2026-05-01-typography.md`](./2026-05-01-typography.md)
  and
  [`explorations/2026-05-03-phase-2-sketch.md`](./2026-05-03-phase-2-sketch.md)
  — retarget the `followups.md#custom-font-theme-support` anchor
  links to the new canonical section in typography.md. Link
  retarget only; the recorded reasoning is untouched.

Renames: `typography.md` `## Implementation notes` →
`## Cross-platform font resolution` (no inbound refs).

Patterns adopted on a new surface: none.

Followups resolved: Custom-font theme support.

Followups introduced: none.

Wireframes updated: none. `theming.html` could demo VT323 on
Fallen Down once the asset lands, but the font binary is
implementation work outside this design session's scope.

Intentional repeated prose: none.

Exploration record fate: keep as the historical record.
