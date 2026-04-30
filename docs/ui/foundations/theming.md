# Theming

How themes are shaped, applied, and persisted. Companion to
[`tokens.md`](./tokens.md) (the slot contract); this file covers
the runtime — what a theme is as a data shape, how the active
theme reaches a rendered surface, where the user's selection
lives.

**Wireframe:** [`theming.html`](./theming.html) — interactive
demo with three placeholder palettes (Default Light, Default
Dark, Parchment) and the density toggle.

## Theme data shape

A theme is a TS module exporting:

```ts
export interface Theme {
  id: string // stable identifier, persisted in app_settings
  name: string // canonical display name (verbatim default)
  nameKey?: string // optional i18n key; when set, picker resolves via i18next
  mode: 'light' | 'dark' // declared; drives `data-theme-mode` for platform-native CSS
  description?: string // optional one-liner shown in picker
  family?: string // optional grouping ("Default", "Slate") for picker UX
  accentOverridable?: boolean // when true, user accent override applies; default false
  tokens: {
    colors: Record<ColorToken, string>
    fonts?: Partial<Record<FontToken, string>> // omit to inherit defaults
  }
}
```

`ColorToken` and `FontToken` are TS string-literal unions matching
the slot inventory in [`tokens.md`](./tokens.md). Type-level
guarantee: themes provide every required color slot or they fail
to compile.

`accentOverridable: boolean` controls whether the user's accent
override applies. Default false (locked). Themes whose identity
is "neutrals plus a color" (likely Default Light / Default Dark)
opt in by declaring `accentOverridable: true`. Opinionated themes
(Parchment, Catppuccin Mocha, Tokyo Night, etc.) leave the flag
off — their accent is part of the personality and free
customization would damage identity. See
[Accent override (opt-in)](#accent-override-opt-in) below for
runtime behavior.

## Theme registry

Curated themes ship as TS modules under `lib/themes/<id>/<id>.ts`
(exact path is implementation detail). A registry file (e.g.
`lib/themes/index.ts`) imports all curated themes and exports
them as an array. Theme picker UI reads from the registry.

Future user-authored themes (parked-until-signal per
[`../../parked.md`](../../parked.md#user-authored-themes)): same
shape, loaded from a known location at runtime — most likely a
directory under the OS app-data path, format raw CSS declaring
var values. The registry parses + validates against the same
`ColorToken` / `FontToken` shape; malformed themes are skipped,
not crashed on.

## Translation of theme names

`name` is the canonical display string, rendered verbatim by
default. `nameKey` is optional; when set, it is treated as an
i18next key and resolves to the localized override per the user's
UI language.

The two surfaces map intuitively:

- **Established-system themes** — Catppuccin Latte, Catppuccin
  Mocha, Tokyo Night, Solarized Dark, Gruvbox, Nord — omit
  `nameKey`. Their identity is the proper noun; localization
  would damage recognition.
- **Descriptive themes** — Default Light, Default Dark, Parchment,
  Slate Dark — declare `nameKey` (e.g.
  `'foundations.themes.defaultLight'`) so i18next can localize.

## Switching mechanism

Active theme's `tokens.colors` and `tokens.fonts` populate CSS
vars at the document root on web/Electron (RN Web). On native
(Expo), NativeWind 4's runtime theming applies the same values
via its context provider. Theme swap is reactive — token-set
mutation, no page reload. The `mode` field drives a
`data-theme-mode` attribute on the root for platform-native CSS
that wants to react (e.g. an embedded WebView styling its own
scrollbars).

The contract describes the **mechanism**; implementation picks
the platform glue.

**Implementation-validation gate.** NativeWind 4's runtime
theme-swap parity with web is **assumed, not verified** at this
design pass. The implementation pass MUST validate that theme
swap on native iOS / Android / Linux Electron / Web works without
remount (or with acceptable remount UX) before locking consumer
code. Tracked as the
[NativeWind runtime theme-swap parity validation](../../followups.md#nativewind-runtime-theme-swap-parity-validation)
followup.

## Persistence

The `app_settings.appearance` JSON column (per
[`../../data-model.md → App settings storage`](../../data-model.md#app-settings-storage))
carries:

```ts
app_settings.appearance: {
  themeId: string                          // into the theme registry
  density: 'comfortable' | 'compact'        // user-orthogonal toggle
  accentOverride?: string                   // hex; honored only when active theme has accentOverridable: true
}
```

App boot reads `appearance`, applies tokens on first render. User
changes in
[`App Settings · Appearance`](../screens/app-settings/app-settings.md#app--appearance)
write through immediately.

### First-launch defaults

Default `themeId` is one of the curated gallery's entries (TBD at
session 6). Default `density` is `'comfortable'`. The
implementation seeds `appearance` to these defaults on first boot
or after a wipe.

### Backup / restore + invalid `themeId`

`app_settings.appearance` is part of the SQLite full-DB backup. A
restore on a different device, on a different release, or from a
corrupted backup can yield an `appearance.themeId` that doesn't
resolve in the local registry, or a malformed `appearance` blob
overall.

**Behavior:** silently fall back to first-launch defaults
(default `themeId` + `'comfortable'` density) for the entire
`appearance` object whenever it is malformed or contains a
`themeId` that the registry cannot resolve. No toast, no banner.
The user is treated as if the appearance setting hadn't been
chosen yet.

## Accent override (opt-in)

When the active theme has `accentOverridable: true` AND the user
has set `accentOverride`, the user-supplied color drives the
accent token group. Five tokens cascade from one input:

- `--accent` — direct from user input.
- `--accent-hover` — derived: HSL lightness delta, mode-aware
  (darken for `mode: 'light'`, lighten for `mode: 'dark'`).
- `--accent-fg` — derived: WCAG contrast auto-flip. White if
  accent is dark enough, near-black otherwise. Preserves
  readability if the user picks a low-contrast accent.
- `--focus-ring` — derived: direct passthrough from `accent`.
- `--selection-bg` — derived: RGB linear mix of accent toward
  `--bg-base` (mode-aware ratio).

**Derivation runs in JS at theme-application time**, not via CSS
`color-mix()`. The reason is cross-platform parity — NativeWind's
runtime CSS-var support on native is better-tested for static
hex values than for `color-mix()` expressions, and computing
derived values once at apply-time produces identical output on
web and native.

Concrete constants (hover delta magnitude, contrast threshold,
mix ratios) and the per-output algorithm live in
[`color.md → Accent-derivation algorithm`](./color.md#accent-derivation-algorithm).
The contract here: **one user input cascades to five
accent-family tokens — one direct passthrough plus four via
deterministic JS derivation.**

**When the active theme is not accent-overridable**,
`accentOverride` is ignored — the theme's hand-authored accent
group applies as-is. The override stays persisted across theme
switches; switching from an accent-overridable theme to a locked
one silently dormant-states the override; switching back re-
applies it. No prompt, no migration.

**Default accent on accent-overridable themes.** Each accent-
overridable theme declares its own default accent in
`tokens.colors` just like any other theme. Users who never
customize see the default. The picker UI shows "Default" as a
special selection alongside any custom hue.

### UI surface

[`App Settings · Appearance`](../screens/app-settings/app-settings.md#app--appearance)
shows the accent picker **conditionally** — only when the active
theme has `accentOverridable: true`. When the user switches to an
opinionated theme (Parchment, etc.), the picker disappears;
switching back to Default Light / Dark restores it. The override
remains in `app_settings.appearance` regardless of whether it's
currently being honored.

## Density-token policy

Density toggle (`comfortable` / `compact`) persists at
`app_settings.appearance.density`. Density-aware spacing tokens
carry two variants tied to the toggle (per
[`tokens.md → Density-aware spacing`](./tokens.md#density-aware-spacing)).

Final slot list and values are session 4's problem (the dedicated
density / spacing design pass). Session 1 commits the architecture:
two-level support, per-component-padding scope.

**Cut path.** If session 4 decides density-as-toggle isn't worth
the cross-platform implementation cost, density variants collapse
to one set, the toggle UI is removed from
[`App Settings · Appearance`](../screens/app-settings/app-settings.md#app--appearance),
and `appearance.density` is dropped from the persistence shape.
Session 1 doesn't lock anything that prevents the cut.

## Demo

[`theming.html`](./theming.html) renders the contract end-to-end:

- Review-controls bar with theme dropdown + density toggle.
- Three placeholder palettes (Default Light, Default Dark,
  Parchment) — clearly temporary; the curated gallery lands at
  session 6.
- Sample surfaces consuming token slots: body prose paragraph,
  button row (primary / secondary / disabled + focus ring), input
  field, list rows with accent indicator + density-aware padding,
  system-entry chrome strip, semantic-state pills.
- Visible token snapshot grid — swatches re-render on theme swap,
  proving the runtime cascade is live.

The demo's job is **proving the architecture**, not proving any
specific palette. Vanilla JS, no framework, no build — same
conventions as the rest of the project's wireframes (with the
[foundations wireframe-exemption](./README.md#wireframe-convention-exemption)
on monochrome).
