# Typography

The typography contract for v1. Sister to [`tokens.md`](./tokens.md)
(font slot inventory + structural type-scale slot family),
[`theming.md`](./theming.md) (theme runtime, persistence shape), and
[`color.md`](./color.md) (color contract). This file commits the
**values** font slots take by default, the type scale + weights,
the per-font leading multiplier escape valve, and the reader
font-size user setting.

## Default font stacks

The three default slots use system fonts — no bundled assets.
Individual themes may bundle a font (Fallen Down ships VT323);
bundling and cross-platform resolution are specified in
[Cross-platform font resolution](#cross-platform-font-resolution).
Per the
[`tokens.md → Font-family slots`](./tokens.md#font-family-slots)
rule, a font token's value is a CSS stack; the native resolver
derives the single family name native requires from it.

### `--font-reading` — serif default

```
"Charter", "Iowan Old Style", "Source Serif 4", "Source Serif Pro",
Georgia, Cambria, "Liberation Serif", "Noto Serif", serif
```

- **Charter** — bundled with iOS / macOS; the modern Apple reading
  face. Excellent at body sizes.
- **Iowan Old Style** — older iOS / macOS fallback for pre-Charter
  systems.
- **Source Serif 4 / Source Serif Pro** — bundled in modern macOS,
  available on some Linux distros, well-supported open-source serif.
- **Georgia / Cambria** — Windows reading-face fallbacks.
- **Liberation Serif** — Linux distros (Fedora, Debian, Ubuntu).
- **Noto Serif** — Android.
- **`serif`** — generic CSS keyword, ultimate fallback.

Serif is chosen for the reading default: reading-heavy app, prose
body, traditional reading typography reads better at length than
sans for most users. Themes that prefer a sans reading face (a
hypothetical "Notebook" theme) override `--font-reading` with their
chosen sans + this same chain as fallback.

### `--font-ui` — UI sans default

```
system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
Arial, "Noto Sans", sans-serif
```

`system-ui` resolves to the platform's UI face (San Francisco /
Segoe UI Variable / Roboto). `-apple-system` is the older
Apple-specific keyword for older macOS / Safari support.

### `--font-mono` — monospace default

```
ui-monospace, "SF Mono", Menlo, Monaco, Consolas,
"Liberation Mono", "Courier New", monospace
```

`ui-monospace` is the platform-mono CSS keyword (modern). Concrete
names cover platform fallbacks.

## Type scale + weights

Calibrated against the default stacks at 16 px base. Tailwind-aligned
defaults so NativeWind / Tailwind utilities map naturally. The scale
is **structurally locked** — sizes / line-heights / weights don't
vary per theme; only the font _family_ varies (per the
[token-class taxonomy](./tokens.md#three-classes)).

### Sizes + line-heights

| Token         | Size  | Line-height | Use                                                    |
| ------------- | ----- | ----------- | ------------------------------------------------------ |
| `--text-xs`   | 12 px | 16 px       | small chrome — meta, timestamps, badge text            |
| `--text-sm`   | 14 px | 20 px       | UI labels, list-row meta, secondary text               |
| `--text-base` | 16 px | 24 px       | **UI body default** — chrome, buttons, form fields     |
| `--text-lg`   | 18 px | 28 px       | **reading body default** — prose at one step above UI  |
| `--text-xl`   | 20 px | 28 px       | medium-emphasis chrome — panel titles, card story-name |
| `--text-2xl`  | 24 px | 32 px       | section heads, larger emphasis chrome                  |
| `--text-3xl`  | 30 px | 36 px       | large heads — settings panel root, screen titles       |

**Reading body uses `--text-lg`, not `--text-base`.** Deliberate
"prose is one step bigger than UI" choice. Reading is the
load-bearing user activity; the user sees this size most. The
[reader font-size setting](#reader-font-size-setting) scales from
this baseline.

UI body uses `--text-base`. The visual hierarchy in the reader maps:

- Entry title → `--text-xl` or `--text-2xl` (depends on density of
  meta around the title).
- Prose body → `--text-lg`.
- Meta / timestamps / chrome around entries → `--text-sm`.

Paired `--leading-*` tokens carry the line-height values:
`--leading-xs` (16 px), `--leading-sm` (20 px), `--leading-base`
(24 px), `--leading-lg` (28 px), `--leading-xl` (28 px),
`--leading-2xl` (32 px), `--leading-3xl` (36 px). Use sites
reference both size and leading tokens directly; the
[per-font leading multiplier](#per-font-leading-multiplier)
scales `--leading-*` for reading-text only.

### Weights

| Token                    | Value | Use                                             |
| ------------------------ | ----- | ----------------------------------------------- |
| `--font-weight-normal`   | 400   | body text default                               |
| `--font-weight-medium`   | 500   | emphasis, label text                            |
| `--font-weight-semibold` | 600   | headings, button text                           |
| `--font-weight-bold`     | 700   | strong inline emphasis (rare; mostly call-outs) |

No `--font-weight-light` / `300` — system fonts don't all support
light weights cleanly across platforms (Linux fallbacks especially),
and the "flat, nothing flashy" identity doesn't need the dramatic
light end.

### What this commits

- Seven size steps, four weights — covers everything v1 wireframes
  need (chrome through screen-title) without a `--font-display`
  slot.
- Type scale is structurally locked; only the _family_ varies per
  theme.
- Default line-heights work for the system-stack defaults; themes
  swapping `--font-reading` to a custom face use the
  [leading multiplier](#per-font-leading-multiplier) for
  per-font tuning.

## Per-font leading multiplier

The escape valve flagged in session 1's adversarial pass. Serif
faces typically want different line-height than sans at the same
locked size; bundled-font themes can tune leading without forking
the type scale.

### Shape

The `Theme` interface gains one optional field (per
[`theming.md → Theme data shape`](./theming.md#theme-data-shape)):

```ts
leadingMultiplier?: number  // default 1.0; affects reading-text only
```

Default `1.0` — themes that don't declare it inherit the locked
line-heights as-is.

### Multiplier cascade

At theme-application time, the value is set as a CSS custom
property at the document root:

```css
--leading-reading-multiplier: <theme value or 1.0>;
```

Reading-text use sites (anything rendering `--font-reading`)
compute their line-height with the multiplier:

```css
font-size: var(--text-lg);
line-height: calc(var(--leading-lg) * var(--leading-reading-multiplier));
```

UI text (`--font-ui`) and mono (`--font-mono`) use sites reference
`--leading-*` tokens directly, no multiplier. UI/mono leading is
fairly font-agnostic at small sizes; the multiplier specifically
tunes prose comfort.

### Example

A hypothetical Parchment theme bundling Lora finds its prose feels
cramped at the locked `--text-lg` line-height of 28 px. The theme
declares:

```ts
{ id: 'parchment', mode: 'light', leadingMultiplier: 1.07, /* ... */ }
```

Reading-text line-height becomes `28 px * 1.07 = ~30 px` — a 7%
relaxation that breathes Lora's slightly tighter cap heights.

### Why scoped to reading

- **Reading is the load-bearing font-swap target.** Themes most
  likely to override `--font-reading` (Parchment, Notebook) are the
  ones whose leading might want adjustment.
- **UI text rarely changes face.** UI sans is system-ui across most
  themes; locked leading works.
- **Mono is mono.** No leading drama at code-display sizes.

## Reader font-size setting

User-orthogonal axis (per the
[token-class taxonomy](./tokens.md#three-classes)): varies per
user, theme-independent. Lives because the reader is the
long-form reading activity and individual eyesight varies widely.

### Persistence

`app_settings.appearance` gains the `readerFontScale` field; the
full persistence shape (the canonical copy) lives in
[`theming.md → Persistence`](./theming.md#persistence):

```ts
readerFontScale: 'sm' | 'md' | 'lg' | 'xl' // reader prose scaling
```

String-keyed (semantic, stable across step-set evolution) rather
than number-keyed. First-launch + malformed-fallback both seed
`'md'` per `theming.md`'s existing invalid-blob behavior.

### Steps

| Key  | Multiplier | Reading body (`--text-lg`) renders at |
| ---- | ---------- | ------------------------------------- |
| `sm` | 0.85       | ~15.3 px                              |
| `md` | 1.0        | 18 px (default)                       |
| `lg` | 1.2        | ~21.6 px                              |
| `xl` | 1.4        | ~25.2 px                              |

Range from 15 to 25 px covers most accessibility-driven preferences
without inviting click-target chaos at extremes. Step ratios
(`0.85 / 1.0 / 1.2 / 1.4`) give noticeable progressions — small
steps risk "did anything change?" UX.

### Scale cascade

Set as a CSS custom property at the document root, updated
reactively from `app_settings`:

```css
:root {
  --reader-font-scale: 1; /* reflects active step */
}
```

Reading-text use sites in the reader compute size as:

```css
font-size: calc(var(--text-lg) * var(--reader-font-scale));
line-height: calc(var(--leading-lg) * var(--leading-reading-multiplier) * var(--reader-font-scale));
```

Three terms multiply for reading-body line-height: locked leading
× theme multiplier × user reader scale. All three default to 1.0;
the calc collapses to the locked value when nothing's customized.

### Scope

Applies to **reader entry content only**:

- Prose body (the narrative text).
- Entry titles (in-flow heads, not chrome).
- Entry meta line (timestamps, visible-stats adjacent to prose).

Out of scope:

- Reader-side chrome (top-bar, action buttons, toolbar) — stays at
  chrome-default sizes; click targets don't shift.
- Browse rail content — short-form chrome.
- Lore detail panes, entity descriptions, peek drawer prose, wizard
  prose — short-form prose elsewhere. Generalization deferred (see
  [`../../parked.md → Reader font-size scaling generalized to all body prose`](../../parked.md#reader-font-size-scaling-generalized-to-all-body-prose)).

Implementation note: the reader's component tree opts in by
referencing `--reader-font-scale` in the size calc. Surfaces that
don't reference it are unaffected. No CSS-scope-wrapper magic;
explicit at component level.

### UI surface

[`App Settings · Appearance`](../screens/app-settings/app-settings.md#app--appearance)
gains a stepped picker for reader font size. Order on the
Appearance panel: **Theme → Reader font size →
(conditional) Accent override.** Control shape: 4-state segmented
control labeled `S` / `M` / `L` / `XL`. Live preview is the
reader itself; the Settings panel doesn't embed a sample
paragraph.

## Cross-platform font resolution

A font token names one slot; web and native consume it
differently, so the slot resolves to a different value shape on
each platform. This mirrors the `--tint-hover` / `--tint-press`
precedent — web gets a rich expression, native gets a pre-resolved
concrete value, under one token name.

### Web and native diverge

- **Web / Electron (RN Web).** The token resolves to the full CSS
  stack. The browser walks it against the platform font registry,
  rendering the first available face and falling through to the
  trailing generic keyword (`serif` etc.) if no named face
  resolves. No `@font-face` is needed for the system-stack
  defaults.
- **Native (Expo).** React Native's `fontFamily` style takes a
  single family name, never a comma-separated stack. Handed a
  stack string it matches nothing and falls back to the system
  default. So on native the token resolves to a single
  pre-computed family name.

### Native resolver

At theme-application — the hook the
[accent derivation](./theming.md#accent-override-opt-in) already
runs in — a resolver computes the single native family name for
each slot and feeds it to NativeWind's `vars()`. The resolver
walks the slot's stack left to right and returns the first entry
that is either:

1. a family in the [bundled-font registry](#bundled-fonts), or
2. one of exactly `serif`, `sans-serif`, `monospace` — the three
   generic families React Native honors as `fontFamily` values on
   Android. CSS generics such as `system-ui` and `ui-monospace`
   are not RN-honored and are skipped.

Well-formed stacks place a bundled font first and a generic
keyword last, so the walk yields the bundled font when present and
the generic family otherwise. If the walk matches neither, the
resolver returns a per-slot terminal fallback — `--font-reading` →
`serif`, `--font-ui` → `sans-serif`, `--font-mono` → `monospace` —
so it never yields an empty value, even for a malformed
user-authored stack.

The three default slots therefore resolve correctly on Android
with zero bundled fonts: each default stack ends in its generic
keyword, and Android maps `serif` to Noto Serif, `sans-serif` to
Roboto, `monospace` to Roboto Mono.

### Bundled fonts

A theme may bundle a font. A central bundled-font registry records
each one — family name, asset, license — and drives three
consumers: the web `@font-face` declarations, the native
build-time embed, and the resolver's known-bundled set.

- **Native embedding** uses the `expo-font` config plugin
  (`app.json` → `plugins`). Fonts embed at build time and are
  available immediately — no runtime load, no first-render
  flicker. The Android object form pins an explicit family name so
  it matches web and iOS; without it Android derives the name from
  the filename.
- **Web** declares `@font-face` against the bundled file. No CDN —
  the app is offline-first and Electron loads from the local
  bundle.
- **Assets** ship under `assets/fonts/<family>/` with the font
  file and the license text. A bundled font must carry a
  redistribution-permitting license (SIL Open Font License or
  equivalent).

Lazy or on-demand font loading is rejected: it buys nothing for a
small font, and a network dependency contradicts offline-first.
Bundled fonts always ship in the binary.

A bundled font with partial Unicode coverage degrades per-glyph —
glyphs it lacks fall through to the stack on web and to the system
font on native. A theme bundling a Latin-only display face accepts
mixed rendering on non-Latin story content.

Fallen Down is the v1 registry's only entry — VT323, per
[`themes.md → Reading-font policy per theme`](./themes.md#reading-font-policy-per-theme).

### iOS

The resolver's generic-keyword output is correct on Android but
not on iOS — iOS does not honor `serif` / `sans-serif` /
`monospace` as `fontFamily` values and needs a concrete font name.
Bundled fonts resolve correctly on iOS (they carry a real family
name), so a theme like Fallen Down works; only the system-stack
defaults mis-render. iOS is deferred for v1; system-stack
resolution on iOS lands with the iOS bring-up, by extending the
resolver with iOS-specific concrete names per slot.

### Validation

A check folded into
[`pnpm themes:audit`](./color.md#theme-audit-utility) asserts
every font stack in the registry resolves to a non-empty native
family — each stack must contain an RN-honored generic keyword or
a registered bundled font. The cross-platform reading-font defect
shipped because nothing checked this; the check makes the failure
build-time-visible.
