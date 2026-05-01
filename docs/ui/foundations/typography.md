# Typography

The typography contract for v1. Sister to [`tokens.md`](./tokens.md)
(font slot inventory + structural type-scale slot family),
[`theming.md`](./theming.md) (theme runtime, persistence shape), and
[`color.md`](./color.md) (color contract). This file commits the
**values** font slots take by default, the type scale + weights,
the per-font leading multiplier escape valve, and the reader
font-size user setting.

## Default font stacks

System-fonts only for v1 — zero bundled fonts. Themes that need
custom typography (Parchment with Lora, etc.) bundle their own
assets at theme-author time and prepend their bundled name to the
relevant stack; the system fallbacks below remain as the chain
tail. Per the locked
[`tokens.md → Font-family slots`](./tokens.md#font-family-slots)
rule, font tokens declare stacks, never single names.

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

`app_settings.appearance` gains a new field (per
[`theming.md → Persistence`](./theming.md#persistence)):

```ts
app_settings.appearance: {
  themeId: string
  readerFontScale: 'sm' | 'md' | 'lg' | 'xl'   // reader prose scaling
  accentOverride?: string
}
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

## Implementation notes

### Web / Electron (RN Web)

Default font stacks are CSS custom property values; the browser
handles font lookup against the platform's font registry. No
`@font-face` declarations for v1 — system fonts only. Stacks fall
through to the generic family keyword if no platform font resolves.

### Native (Expo)

RN's `fontFamily` style takes a single name, not a CSS-style stack.
NativeWind 4's runtime font-token handling needs validation —
already covered by the existing
[NativeWind runtime theme-swap parity validation](../../followups.md#nativewind-runtime-theme-swap-parity-validation)
followup, which explicitly mentions "Font-family token swap behaves
equivalently to color-token swap."

If NativeWind doesn't parse stacks: implementation falls back to a
small JS helper that picks the first system-font name available on
the platform from the stack at theme-application. Cross-platform
parity preserved; small implementation cost.

### Future bundled-font themes

When an opinionated theme (Parchment-with-Lora, etc.) ships with
bundled fonts: the theme module declares fonts via `expo-font`'s
`loadAsync` at theme registration; the bundled family name goes at
the head of the stack; system fallback remains. No contract change
needed; theme-author work.
