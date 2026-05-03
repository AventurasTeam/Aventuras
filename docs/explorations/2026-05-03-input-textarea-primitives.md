# 2026-05-03 — Input + Textarea primitives

Phase 2 Group C per [`phase-2-sketch.md`](./2026-05-03-phase-2-sketch.md#group-c--text-input-primitives-input--textarea).
Single-line and multi-line text inputs, the thinnest primitives in
the phase 2 set. v1 wireframes show the full surface area; no
overlay or portal infrastructure required.

## Scope

In:

- `<Input>` — single-line text input. Maps to RN's `TextInput`,
  wrapped with leading / trailing adornment slots when used.
- `<Textarea>` — multi-line text input. Same upstream primitive
  with `multiline`, but split for clarity and to keep multiline-
  specific props (rows, auto-grow) off the single-line surface.
- **Adornment slots on Input.** `leading` and `trailing` props
  taking arbitrary nodes. Concrete v1 consumers: search inputs
  (leading magnifying-glass, trailing info-popover trigger) and
  the App Settings API-key field (trailing show/hide eye). Tab to
  details below.
- **Native auto-grow on Textarea.** Web auto-grow is free via
  `field-sizing-content`; native uses `onContentSizeChange` to
  track measured height and grow up to a max. Tab below.

Out:

- **`chip-input-typer`** (typer inside `.chip-row`). Owned by the
  chip-row primitive when it ships, not by `<Input>`. Followup.
- **Autocomplete (`ac-input`)** — own primitive per
  [`forms.md`](../ui/patterns/forms.md#autocomplete-with-create-primitive).
  Phase 2 ships Select's contract; Autocomplete's implementation
  pass lands later.
- **Label / helper text composition.** Stays external. Wireframes
  use `.label-row` + `.field-help` as siblings of the input, not
  parent-child. Matches the rest of the project's compose-don't-
  encapsulate principle.
- **Adornments on Textarea.** Multiline content doesn't compose
  visually with leading/trailing slots — the icon would float
  weirdly against scrolling text. No wireframes need them.

## Approach — scaffold + reshape (same as Button, Sheet, Select)

The rn-reusables baselines for Input and Textarea look like thin
TextInput wrappers at first glance, but they ship a few decisions
worth keeping rather than rediscovering:

- **`placeholder:` Tailwind variant on both platforms.**
  NativeWind 4's TextInput cssInterop bridges this to
  `placeholderTextColor` on RN. No `placeholderTextColor`
  ceremony needed at the call site or in the primitive.
- **Selection color** via `selection:bg-* selection:text-*`
  (web).
- **`aria-invalid` styling.** NativeWind 4 supports the `aria-`
  variant; the baseline uses it to drive error border + ring.
  This is cleaner than a `state="error"` prop because the
  consumer can drive validity from the form library directly
  via `aria-invalid={hasError}`.
- **`field-sizing: content` for free web auto-grow on Textarea.**
  Modern CSS handles content-driven height with no JS — just a
  Tailwind class on the baseline.
- **`textAlignVertical="top"` on Textarea** — Android fix to
  avoid vertically-centered placeholder text.

Reshape covers tokens (the baseline reads from shadcn's
`--input` / `--background` / `--ring` / `--destructive` slots; our
slots are different), drops the dark-mode opacity dance the
baseline does (our themes don't have a `dark:` mode — themes are
explicit), drops the subtle shadow (Aventuras controls are flat),
and swaps fixed heights for our density-driven `h-control-*`
tokens.

## API

### `<Input>`

```tsx
type InputSize = 'sm' | 'md' | 'lg'

type InputProps = TextInputProps & {
  size?: InputSize // default: 'md'
  leading?: React.ReactNode
  trailing?: React.ReactNode
  className?: string
}
```

- `size` resolves to `h-control-{sm|md|lg}` (density-driven, same
  as Button).
- **No `state` prop.** Error styling fires off `aria-invalid` —
  consumers pass `aria-invalid={hasError}`, primitive's classes
  do the rest. Matches form-library conventions (react-hook-form,
  TanStack Form both surface validity through ARIA already).
- `leading` and `trailing` accept arbitrary nodes. Typical
  contents: a non-interactive `<Icon>` for `leading` (search,
  lock); a `<Pressable>` or icon-button for `trailing` (eye toggle,
  clear-x, info-popover trigger).
- All other props (`value`, `onChangeText`, `placeholder`,
  `secureTextEntry`, `keyboardType`, `autoCapitalize`, etc.) pass
  through to `TextInput`.

#### Adornment layout

When `leading` or `trailing` are present, the rendered tree
becomes a `View` row wrapping the `TextInput`:

```
<View row, h-control-md, border, rounded, bg, focus-ring on web>
  {leading && <View ps-3 pe-2>{leading}</View>}
  <TextInput flex-1, no border, no bg, ps-{leading ? 0 : 3}
             pe-{trailing ? 0 : 3}>
  {trailing && <View ps-2 pe-2>{trailing}</View>}
</View>
```

When neither slot is set, the TextInput is rendered standalone (no
wrapper View) so the bare case stays a single node — keeps the
DOM/native tree minimal for the most common case. Selectable via
the `leading || trailing` discriminator at render time.

**Focus ring with adornments.** The border + ring move to the
wrapper View. On web, NativeWind's `:focus-within` variant fires
the same `border-accent ring-focus-ring/50` styles when the inner
TextInput is focused. On native, the wrapper subscribes to the
TextInput's `onFocus`/`onBlur` via React state, applying the
focus class conditionally. Cost: one `useState` per Input that
uses adornments. Worth it.

**Adornment hit area.** Trailing slot consumers commonly want a
button (eye, clear). The slot's wrapping View has `pe-2 ps-2`
spacing only — interactive children own their own padding /
press-state. Use `<Button variant="ghost" size="icon">` or a
plain `<Pressable>` inside the slot.

#### Type mapping

Wireframes use `type="text"` and `type="password"`. RN-Web maps
RN's `secureTextEntry` to `<input type="password">` on web; that's
the bridge we use. There's no top-level `type` prop on `<Input>` —
consumers pass `secureTextEntry` directly when they need it,
matching RN's vocabulary.

For numeric inputs (wizard year fields, story-creation calendar
fields), consumers pass `keyboardType="numeric"` (RN-Web maps to
`<input inputmode="numeric">`) and constrain width with explicit
`className="w-24"` or `style={{ maxWidth: 100 }}`. **There is no
`narrow` size.** The wireframe's `.input-narrow` is a width
override on the same Input — width is a layout decision, not a
primitive variant. Adding a `narrow` size would conflate height
(density) with width (layout).

### `<Textarea>`

```tsx
type TextareaProps = TextInputProps & {
  rows?: number // default: 3 — initial / min visible lines
  maxRows?: number // default: 10 — max lines before scroll-within
  className?: string
}
```

- Always `multiline`.
- `rows` and `maxRows` define the visible-height envelope.
- **Auto-grow on web** is free via `field-sizing-content`
  (modern CSS, no JS). The baseline's class stays as-is; web
  textarea grows with content from `rows` up to the container.
- **Auto-grow on native** uses `onContentSizeChange` to track
  the measured content height and applies it as inline `height`
  bounded by `[minHeight, maxHeight]`, derived from `rows` ×
  line-height + padding and `maxRows` × line-height + padding
  respectively. Past `maxRows` the textarea scrolls within. ~10
  lines of code; sketched in the implementation contract below.
- Web also gets `resize-y` (user can drag the corner). Native has
  no resize handle.
- **No `state` prop.** Error driven via `aria-invalid`, same as
  Input.

#### Native auto-grow contract

```tsx
// Sketch — actual implementation lives in textarea.tsx.
const lineHeight = 20  // text-sm
const padY = 16        // py-row-y-md × 2
const minHeight = rows * lineHeight + padY
const maxHeight = maxRows * lineHeight + padY
const [measured, setMeasured] = useState(minHeight)

<TextInput
  multiline
  onContentSizeChange={(e) => setMeasured(e.nativeEvent.contentSize.height)}
  style={Platform.select({
    native: { height: clamp(measured, minHeight, maxHeight) },
  })}
/>
```

Inline `style` height on native composes cleanly with NativeWind
classes; web uses the CSS-driven path and ignores the height in
the inline style (Platform.select returns undefined on web).
Padding-token line-height match: `--row-py-md` is the row vertical
padding token already defined in the density system; reading the
literal pixel value at runtime is fine because density tokens
resolve to fixed strings per resolved density.

## Tokens

| Slot                  | Resolved value                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Input height          | `h-control-{sm\|md\|lg}` (density-driven)                                                                       |
| Input padding-x       | `px-3` (sm), `px-3` (md), `px-4` (lg) — match Button                                                            |
| Textarea padding      | `py-row-y-md px-row-x-md` (row-style)                                                                           |
| Border                | `border border-border`                                                                                          |
| Border (focused, web) | `focus-visible:border-accent focus-visible:ring-focus-ring/50 focus-visible:ring-[3px]`                         |
| Border (error)        | `aria-invalid:border-danger aria-invalid:ring-danger/20`                                                        |
| Background            | `bg-bg-base`                                                                                                    |
| Text                  | `text-fg-primary` (uses our `text-sm` size)                                                                     |
| Placeholder           | `placeholder:text-fg-muted` — NativeWind 4 bridges the variant to `placeholderTextColor` on RN, no extra wiring |
| Selection (web)       | `selection:bg-accent selection:text-accent-fg`                                                                  |
| Disabled              | `opacity-50` + `editable={false}` (web also gets `disabled:cursor-not-allowed`)                                 |

## Adversarial pass

**Load-bearing assumptions.**

- `secureTextEntry` is the right vocabulary for password fields.
  If we ever need email-keyboard-but-not-password, OTP, or similar
  cases that don't map cleanly to a single RN prop, we'd want a
  higher-level `type` prop. Wireframes don't show those; defer.
- **NativeWind 4 supports the `placeholder:` and `aria-` variants
  on RN's TextInput.** Both error styling (aria-invalid) and
  placeholder color rely on this. Verify in the dev page on a real
  device before declaring Group C done — if either fails, the
  fallback is `placeholderTextColor` prop + a manual `state` prop
  driving classNames. Documented in this section so the failure
  mode isn't silent.

**Edge cases.**

- **Numeric input on iOS without keyboard-done button.** `keyboardType="numeric"` opens an iOS numpad with no return key. Consumers wanting commit-on-blur are fine (default); consumers wanting commit-on-submit need a custom done button. Out of scope for the primitive.
- **Multi-line + secureTextEntry.** RN warns that combining the two is undefined. Textarea never sets secureTextEntry (it isn't in TextareaProps' relevant subset). Won't happen by accident.
- **Tall Textarea on phone with keyboard up.** `KeyboardAvoidingView` is a screen-level concern — Textarea takes a `style`/`className` and otherwise behaves as a normal view. Out of scope.
- **Disabled state on web doesn't disable click-through to underlying.** RN-Web TextInput with `editable={false}` renders as `<input disabled>`; click events are blocked correctly.
- **Adornment focus on native.** The wrapper-View focus-class trick depends on TextInput firing `onFocus`/`onBlur` reliably. Verified RN behavior; both fire on iOS and Android. The state-based approach also won't conflict with consumers passing their own `onFocus` — we wrap, not replace, by composing.
- **Trailing-button tap stealing focus.** A `Pressable` inside `trailing` capturing tap events would normally pull focus from the TextInput; on the password-eye case we want the input to keep focus through the toggle. RN's TextInput doesn't auto-blur on sibling press, so this is a non-issue by default. Documented so consumers don't add manual `blurOnSubmit`-style workarounds.
- **Content-size feedback loop on native auto-grow.** Setting inline `height` from `onContentSizeChange` could in theory trigger another resize event. RN suppresses the cycle by only firing `onContentSizeChange` when content (text) changes, not when the container size changes. Verified across versions; not load-bearing fragility.
- **Auto-grow with very long single line.** When a user pastes a 5000-char line, the measured height jumps to one tall line wrapped. Capped by `maxRows` × line-height + padding via `clamp` — past that the textarea scrolls. Tested via the Storybook auto-grow story before declaring done.

**Read-site impact.** Every wireframe Input swap is a
class-rename: `class="input"` → `<Input />`, `class="input
input-narrow"` → `<Input className="w-24" />`,
`class="textarea" rows={5}` → `<Textarea rows={5} />`. Search and
API-key surfaces also gain adornment props once their consumer
screens get implemented. No domain-shape changes; safe.

**Doc-integration cascades.** `forms.md` doesn't currently have an
Input section — it's been Select-only. Adding an Input section is
additive; doesn't touch existing Select prose. `components.md`
augmentation precedents grow by one.

**Missing perspective.**

- **Cross-platform autofill / password manager integration.** RN's
  `textContentType` and `autoComplete` props pass through —
  consumers handle this per-field (App Settings API key field
  benefits from autofill suppression). Documented at consumer
  level; primitive doesn't reshape these.
- **Web-specific clear button (`type="search"`).** Browsers render
  a built-in clear-X for `<input type="search">`. RN-Web's bridge
  doesn't surface a `type="search"` directly. Not load-bearing for
  v1; Autocomplete will own typeahead concerns.

## Storybook

Stories per
[`components.md → Storybook story conventions`](../ui/components.md#storybook-story-conventions):

- **Default** — uncontrolled input with placeholder.
- **Controlled** — useState wrapper for the realistic case.
- **Sizes** (Input only — sm/md/lg).
- **States** — default, disabled, error (`aria-invalid`).
- **Adornments** — leading icon only, trailing button only,
  both. Concrete cases: search-with-info-popover, password
  show/hide.
- **Density** — coverage demo (Density toolbar already global).
- **Textarea — rows** (3 / 5 / 10).
- **Textarea — auto-grow** — single story showing the textarea
  growing as content accumulates, capping at `maxRows`. Behavior
  parity across web (`field-sizing-content`) and native
  (`onContentSizeChange`).
- **Theme matrix** — small grid demoing focus ring color across
  themes.

No `Shapes` story — Input/Textarea don't have shape variants.

## Integration plan

**Files touched:**

- New: `components/ui/input.tsx`, `components/ui/input.stories.tsx`,
  `components/ui/textarea.tsx`, `components/ui/textarea.stories.tsx`.
- New: `app/dev/input.tsx` — dev page exercising both primitives
  with the density picker (sister to `select.tsx`, `button.tsx`).
- Modified: `docs/ui/patterns/forms.md` — add `Input primitive`
  and `Textarea primitive` sections after the Select primitive
  section, before Autocomplete. Add to the file-top `Used by` list.
- Modified: `docs/ui/components.md` — augmentation precedents gain
  an Input entry noting the `aria-invalid`-driven error state
  (no `state` prop) and the size-vs-width separation (no
  `narrow` size).
- Modified: `docs/followups.md` — add two entries: (1) Input
  adornment slots when first consumer needs them, (2) Textarea
  auto-grow when first consumer needs it.

**Renames:** none.

**Patterns adopted on a new surface:** Input + Textarea sections
added to the existing forms.md pattern doc. The pattern doc
already lists every per-screen consumer; Input adoption is
co-extensive with that list (every wireframe with `<input>` or
`<textarea>` consumes the new primitive). No per-screen doc edit
needed; the existing forms.md `Used by` list covers it because
those screens already cite forms.md for Select.

**Followups resolved:** none directly. Phase 2 sketch's Group C
checkbox can flip after the implementation lands.

**Followups introduced:** none. Adornments and native auto-grow
both ship in this group.

**Wireframes updated:** none. Wireframes are unchanged; the
implementation matches them.

**Intentional repeated prose:** none.
