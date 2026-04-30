# Visual identity — foundations (session 1)

Session 1 of a multi-session visual-identity design pass. Output is
the **foundations contract** — doc home, token classes + naming,
theme data shape, switching mechanism + persistence, density-token
policy, demo scope. Specific palettes, type families, motion
durations, etc. land in subsequent sessions.

This file is an exploration record. Once integrated, the canonical
home is `docs/ui/foundations/` (split into `README.md` + `tokens.md`

- `theming.md` + `theming.html`).

## Decisions locked entering this session

- **Curated theme gallery (5–10+) at v1.** User-authored themes
  parked-until-signal (raw CSS edit, no UI).
- **Themeable axes:** color (every theme) + font family (opinionated
  themes; most inherit defaults).
- **User-orthogonal axes:** density toggle (`comfortable | compact`),
  not theme-bound.
- **Each theme is one palette, mode-locked** (`mode: 'light' |
'dark'`). Flat gallery; no app-level "mode" concept distinct from
  theme.
- **OS dark/light follow:** parked-until-signal.
- **Standalone universal accent setting:** dropped — opinionated
  themes define their accent; user picks the theme. **Per-theme
  opt-in to user-overridable accent** retained, so themes whose
  identity is "neutrals + a color" (likely Default Light / Default
  Dark in session 6) can expose an accent picker without bloating
  the gallery into accent variants.
- **Theme name translation:** selective — themes carry a canonical
  `name` (verbatim default) and an optional `nameKey` (i18n key)
  that overrides per-locale when set. Established-system names
  (Catppuccin Latte, Tokyo Night, Solarized Dark, etc.) omit
  `nameKey` and render verbatim across all locales.

## Doc home — `docs/ui/foundations/`

New subdir under `docs/ui/`, sibling to `principles.md`,
`patterns/`, and `screens/`. Per the
[`docs/conventions.md → Where files live`](../conventions.md#where-files-live)
fan-out rule, a domain that fans out gets a subdir from the start.
Visual identity will fan out across five more sessions; subdir from
day one.

Session 1 lands four files:

```
docs/ui/foundations/
├── README.md          — index only (per README-as-index rule)
├── tokens.md          — token contract: classes, naming, slot inventory
├── theming.md         — theme data shape, switching, persistence
└── theming.html       — interactive demo (placeholder palettes)
```

Subsequent sessions add `color.md`, `typography.md`, `density.md`,
`motion.md`, `iconography.md`, `themes.md` (or `themes/` if it
fans out further).

**Boundary with `principles.md` and `patterns/`.** Foundations cover
the **visual identity contract** — what tokens exist, how themes
declare values, how those values reach a rendered surface.
`principles.md` covers cross-cutting **design philosophy** (top-bar
rule, settings architecture, mode/lead/narration, etc.).
`patterns/` covers **reusable component primitives** (entity rows,
icon-actions, save-sessions, etc.). The three are orthogonal: a
pattern consumes token slots from foundations and obeys principles
from `principles.md`. The foundations `README.md` records this
boundary so the split stays clear as the tree grows.

**Foundations wireframe convention.** Per
[`docs/conventions.md → Wireframe authoring`](../conventions.md#wireframe-authoring)
wireframes are monochrome by rule, because pixel-fidelity decisions
are deferred to visual identity. Foundations wireframes are the
**explicit exception** — they exist precisely to demonstrate
palette swap, so they render real (placeholder) palettes. The
foundations `README.md` calls this out.

## Token contract

### Three classes

Tokens fall into three classes, distinguished by who/what varies
them:

- **Themeable.** Vary per active theme. Two sub-categories: color
  tokens (every theme overrides) and font-family tokens (most
  themes inherit defaults; opinionated themes override).
- **User-orthogonal.** Vary per user setting, independent of theme.
  Today: density-aware spacing tokens.
- **Structurally locked.** Constant across themes and user
  settings. Type scale (sizes / weights / line-heights), radii,
  motion durations + easing, iconography sizing, z-index strata.

The classification is what matters most architecturally — it
governs which authoring surface owns the value, and what migrates
when when a theme or user setting changes.

### Naming convention

Semantic, not literal. `--bg-base` not `--slate-50`. CSS-var idiom
(kebab-case, `--` prefix). The same name is used in the runtime
CSS-var application at the document root, in NativeWind 4's runtime
theming, and in the Tailwind config that exposes utility classes
backed by these vars.

The reason for semantic naming: each theme defines its own color
literals and binds them to the same semantic slots. A component
reads `var(--bg-base)`; what color shows up depends on the active
theme. This is the standard shadcn-style pattern; the project's
stack note in [`docs/tech-stack.md`](../tech-stack.md) already
commits to "shadcn-style theme CSS vars."

### Color slots

V1 contract — final inventory firmed in session 2 (color system
design pass):

- **Backgrounds.** `--bg-base` (canvas), `--bg-raised`
  (cards / inputs / dialogs above canvas), `--bg-sunken` (input
  wells, code blocks, system-entry chrome), `--bg-overlay`
  (modal / popover surfaces; usually slightly tinted vs raised).
- **Foregrounds.** `--fg-primary` (default text), `--fg-secondary`
  (less-emphasized text), `--fg-muted` (placeholders, disabled
  text, low-emphasis labels), `--fg-on-accent` (text rendered on
  accent backgrounds).
- **Accent.** `--accent` (primary action / selection / brand),
  `--accent-hover` (interactive hover state),
  `--accent-fg` (text rendered on accent backgrounds; alias of
  `--fg-on-accent` for slot symmetry, may consolidate in session
  2). When the active theme has `accentOverridable: true` and the
  user has customized accent, the entire accent group is **derived
  from one input** — see
  [Accent override (opt-in)](#accent-override-opt-in).
- **Semantic states.** `--success`, `--warning`, `--danger`,
  `--info`, each with its own `-fg` pair for text-on-state.
- **Borders.** `--border` (default), `--border-strong` (emphasis;
  hover, focus surrounds, table heads).
- **Focus.** `--focus-ring` (the ring color for keyboard focus
  surrounds; usually a tint of `--accent`).
- **Selection.** `--selection-bg` (text-selection background;
  load-bearing for a reading-heavy app where users will spend long
  sessions selecting prose).

Approximate count: 18–22 slots in v1. Session 2 will firm the
final list, including any decay-pair slots needed by patterns
(e.g. `--recently-classified-bg` per
[`patterns/entity.md`](../ui/patterns/entity.md)). The contract is
open-ended; growing the slot inventory across sessions is the
expected mode.

### Font-family slots

Three slots:

- `--font-reading` — body prose. **Load-bearing for the primary
  reading activity.** Default stack favors readable serif or
  humanist sans across platforms.
- `--font-ui` — chrome, labels, buttons, list rows. Default stack
  favors a system-default sans for platform-native feel.
- `--font-mono` — code, system-entry chrome, technical readouts
  (raw JSON viewer, delta log). Default stack favors a system mono.

**Font tokens declare stacks, not single names.** A theme that
introduces a custom font for `--font-reading` declares it as
`"Lora", Georgia, serif` — never as `"Lora"` alone. This guards
against font-load failures (the custom font is missing or hasn't
loaded yet) and platform variance (mobile native may not have the
font bundled).

A `--font-display` slot (for headers / hero typography) may be
added at session 3. For session 1, three slots cover everything
session 1's demo HTML renders.

### Structural slots — open inventories deferred

The following slot families exist in the contract but their
contents are deferred to the relevant session:

- **Type scale** (`--text-xs` / `-sm` / `-base` / `-lg` /
  `-xl` / `-2xl` / `-3xl`, with corresponding line-heights and
  weight tokens). Final scale firmed at session 3 (typography).
- **Radii** (`--radius-sm`, `--radius-md`, `--radius-lg`,
  `--radius-full`). Session 4.
- **Motion** (`--duration-fast`, `--duration-base`,
  `--duration-slow`, `--easing-standard`, `--easing-emphasis`).
  Session 5.
- **Iconography sizing** (`--icon-sm`, `--icon-md`, `--icon-lg`).
  Session 5.
- **Z-index strata.** Fixed scale (banner, sticky-header, popover,
  modal, toast). Session 1 reserves the names; final values can
  ship as session-1-time guesses, refined as components are built.

Session 1 commits the slot families exist; sessions that own them
fill in the values.

## Theme data shape

### TypeScript module

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
the slot inventory. Type-level guarantee: themes provide every
required color slot or they fail to compile.

**`accentOverridable: boolean` controls whether the user's accent
override applies.** Default false (locked). Themes whose identity
is "neutrals plus a color" (likely Default Light / Default Dark)
opt in by declaring `accentOverridable: true`. Opinionated themes
(Parchment, Catppuccin Mocha, Tokyo Night, etc.) leave the flag
off — their accent is part of the personality and free
customization would damage identity. See
[Accent override (opt-in)](#accent-override-opt-in) below for the
runtime behavior.

### Theme registry

Curated themes ship as TS modules under `lib/themes/<id>/<id>.ts`
(exact path is implementation detail). A registry file
(`lib/themes/index.ts` or similar) imports all curated themes and
exports them as an array. Theme picker UI reads from the registry.

Future user-authored themes (parked-until-signal): same shape,
loaded from a known location at runtime — most likely a directory
under the OS app-data path, format raw CSS declaring var values.
The registry parses + validates against the same `ColorToken` /
`FontToken` shape; malformed themes are skipped, not crashed on.

### Translation of theme names

`name` is the canonical display string, rendered verbatim by
default. `nameKey` is optional; when set, it is treated as an
i18next key and resolves to the localized override per the user's
UI language.

The two surfaces map intuitively:

- **Established-system themes** — Catppuccin Latte, Catppuccin
  Mocha, Tokyo Night, Solarized Dark, Gruvbox, Nord — omit
  `nameKey`. Their identity is the proper noun; localization would
  damage recognition.
- **Descriptive themes** — Default Light, Default Dark, Parchment,
  Slate Dark — declare `nameKey` (e.g.
  `'foundations.themes.defaultLight'`) so i18next can localize.

## Switching mechanism + persistence

### Mechanism

Active theme's `tokens.colors` and `tokens.fonts` populate CSS vars
at the document root on web/Electron (RN Web). On native (Expo),
NativeWind 4's runtime theming applies the same values via its
context provider. Theme swap is reactive — token-set mutation, no
page reload. The `mode` field drives a `data-theme-mode` attribute
on the root for platform-native CSS that wants to react (e.g. an
embedded WebView styling its own scrollbars).

The spec describes the **contract**; implementation picks the
platform glue.

**Implementation-validation gate (followup).** NativeWind 4's
runtime theme-swap parity with web is **assumed, not verified** at
this design pass. The implementation pass MUST validate that theme
swap on native iOS / Android / Linux Electron / Web works without
remount (or with acceptable remount UX) before locking consumer
code. If full parity isn't achievable, the contract still works —
behavior just degrades to a brief flash on theme change. The
followup is recorded as
[`followups.md → NativeWind runtime theme-swap parity`](../followups.md).

### Persistence

The existing `app_settings.appearance` JSON column gets a refined
shape:

```ts
app_settings.appearance: {
  themeId: string                          // into the theme registry
  density: 'comfortable' | 'compact'        // user-orthogonal toggle
  accentOverride?: string                   // hex; honored only when active theme has accentOverridable: true
}
```

This replaces the old "theme, density, accent preference" prose
description. The `accentOverride` field is optional and only
consulted when the active theme has opted into overridability;
otherwise the theme's hand-authored accent applies and the field
is silently dormant.

App boot reads `appearance`, applies tokens on first render. User
changes in App Settings · Appearance write through immediately.

### Accent override (opt-in)

When the active theme has `accentOverridable: true` AND the user
has set `accentOverride`, the user-supplied color drives the
accent token group. Five tokens cascade from one input:

- `--accent` — direct from user input.
- `--accent-hover` — derived: lighten/darken by a mode-aware delta
  (darken for `mode: 'light'`, lighten for `mode: 'dark'`).
- `--accent-fg` — derived: WCAG contrast pick. White if accent is
  dark enough, near-black otherwise. Auto-flips to preserve
  readability if the user picks a low-contrast accent.
- `--focus-ring` — likely aliased to `--accent` (final call at
  session 2; may carry reduced opacity for outline use).
- `--selection-bg` — derived: accent tinted toward `--bg-base`
  (significantly lightened on light themes, darkened on dark).

**Derivation runs in JS at theme-application time**, not via CSS
`color-mix()`. The reason is cross-platform parity — NativeWind's
runtime CSS-var support on native is better-tested for static
hex values than for `color-mix()` expressions, and computing
derived values once at apply-time produces identical output on
web and native. The function shape is roughly:

```ts
deriveAccent(accent: string, mode: 'light' | 'dark', bgBase: string): {
  hover: string
  fg: string
  focus: string
  selection: string
}
```

Session 2 (color system design) firms the deltas, contrast targets,
and the precise auto-flip rules. Session 1 commits the contract:
**one user input cascades to five accent-family tokens via
deterministic JS derivation.**

**When the active theme is not accent-overridable**, `accentOverride`
is ignored — the theme's hand-authored accent group applies as-is.
The override stays persisted across theme switches; switching from
an accent-overridable theme to a locked one silently dormant-states
the override; switching back re-applies it. No prompt, no migration.

**Default accent on accent-overridable themes.** Each accent-
overridable theme declares its own default accent in `tokens.colors`
just like any other theme. Users who never customize see the
default. The picker UI shows "Default" as a special selection
alongside any custom hue.

### UI surface

App Settings · Appearance shows the accent picker **conditionally**
— only when the active theme has `accentOverridable: true`. When
the user switches to an opinionated theme (Parchment, etc.), the
picker disappears; switching back to Default Light / Dark restores
it. The override remains in `app_settings.appearance` regardless
of whether it's currently being honored.

Per-screen detail in
[`app-settings.md → APP · Appearance`](../ui/screens/app-settings/app-settings.md#app--appearance).

### First-launch defaults

Default `themeId` is one of the curated gallery's entries (TBD at
session 6 when palettes are authored). Default `density` is
`'comfortable'`. The implementation seeds `appearance` to these
defaults on first boot or after a wipe.

### Backup / restore + invalid `themeId`

`app_settings.appearance` is part of the SQLite full-DB backup per
[`data-model.md → App settings storage`](../data-model.md#app-settings-storage).
A restore on a different device, on a different release, or from a
corrupted backup can yield an `appearance.themeId` that doesn't
resolve in the local registry.

**Behavior:** silently fall back to first-launch defaults
(default `themeId` + `'comfortable'` density) for the entire
`appearance` object whenever it is malformed or contains a
`themeId` that the registry cannot resolve. No toast, no banner.
The user is treated as if the appearance setting hadn't been
chosen yet.

The same rule applies to a corrupted-overall-DB recovery path —
not specifically the appearance domain's responsibility, but the
behavior is consistent.

## Density-token policy (placeholder; eval at session 4)

Token contract reserves density-aware spacing slots from session 1
— component-internal padding tokens (`--row-pad-y`, `--row-pad-x`,
`--input-pad-y`, etc.) carry two variants tied to the density
toggle. Specific slot list and values are session 4's problem.

Session 4 will decide:

- Which specific tokens are density-aware (probably
  component-internal padding only — not type scale, not radii, not
  motion).
- The actual values for `comfortable` and `compact`.
- Whether the toggle ships in v1 or gets cut.

**Cut path.** If session 4 decides density-as-toggle isn't worth
the cross-platform implementation cost, density variants collapse
to one set, the toggle UI is removed from App Settings ·
Appearance, and `appearance.density` is dropped from the
persistence shape. Session 1 doesn't lock anything that prevents
the cut.

## Interactive HTML demo

Single colocated `theming.html` (canonical home:
`docs/ui/foundations/theming.html`). Per the foundations
wireframe-exemption, the demo renders real placeholder palettes —
not monochrome.

Review-controls bar at top:

- Theme dropdown (3 placeholder palettes: `Default Light`,
  `Default Dark`, `Parchment`).
- Density toggle (`comfortable` / `compact`).

Sample surfaces below the controls, all consuming CSS vars:

- Body prose paragraph (long enough to show `--selection-bg` on
  highlight; exercises `--bg-base`, `--fg-primary`,
  `--font-reading`).
- Button row (primary, secondary, disabled; exercises `--accent`,
  `--accent-hover`, `--accent-fg`, `--focus-ring`).
- Input field with focus state (exercises `--bg-raised`,
  `--border`, `--border-strong`, `--fg-muted` placeholder).
- List row with text + accent indicator + small icon (exercises
  `--fg-secondary`, `--fg-muted`, density-aware padding).
- System-entry chrome strip (exercises `--bg-sunken`,
  `--font-mono`).
- Semantic-state row (exercises `--success`, `--warning`,
  `--danger`, `--info` with `-fg` pairs).

Vanilla JS. Live CSS-var swap on selection. No framework, no
build, no real data — same conventions as existing wireframes
otherwise.

The demo's job is **proving the architecture** — theme swap is
live, density swap is live, every token class is exercised. Not
proving any specific palette is good. Placeholder palettes use
clearly-temporary colors so reviewers don't read them as real
curated themes; session 6 authors the actual gallery.

## Adversarial-pass findings (recorded)

Run during this session before drafting; full discussion preserved
in the conversation record. Material findings:

- **NativeWind 4 runtime parity assumed, not verified.** Captured
  as an implementation followup (above). Biggest single risk.
- **Type-family swap may pressure the locked type scale.** Serif
  body faces typically want different leading than sans. Session 3
  may need a per-font leading multiplier in the type-scale tokens.
  Not a session-1 concern; flagged for session 3.
- **Per-theme contrast is the author's burden.** The contract
  supports any color values; nothing prevents an AA-failing pair.
  Session 2 will specify contrast targets and ideally a CI check
  that runs over the registry.
- **Stale `themeId` from backup/restore handled silently** —
  resolution above (fall back to first-launch defaults).
- **Font tokens must declare stacks, not single names** —
  resolution above (spec'd into the token contract).
- **Per-story theme override** is not in v1's contract. Adding
  `stories.settings.themeId?: string` later is a one-field
  migration; parked-until-signal.
- **Accent-override edge cases.** Persisted but dormant when the
  active theme isn't accent-overridable (silently re-applies on
  switch back); WCAG contrast preserved by auto-flipping
  `--accent-fg` rather than blocking the user's choice; per-theme
  accent constraints (a Default Light wanting to disallow neon
  pastels) deferred until session 6 surfaces a real problem.

## Followups generated

- **NativeWind runtime theme-swap parity validation** — active
  followup; lands at implementation; blocks foundations consumer
  code. Goes to `followups.md` (v1 work needs it answered).

## Parked items added

- **User-authored themes (raw CSS, no UI)** — parked-until-signal.
  Same Theme shape as curated; loaded from OS app-data path at
  runtime. Validation + skip-on-malformed already covered in spec.
- **Per-story theme override** (`stories.settings.themeId?:
string`) — parked-until-signal. One-field migration if added
  later.
- **OS dark/light follow** — parked-until-signal (decided this
  session). Settings UI ships explicit-pick only; OS-follow lands
  if real demand surfaces.

## Integration plan

Files changed:

- **NEW** `docs/ui/foundations/README.md` — index, fan-out rule
  reference, foundations-wireframe-exemption note.
- **NEW** `docs/ui/foundations/tokens.md` — token contract content
  from this exploration's [Token contract](#token-contract)
  section (classes + naming + color slots + font slots + structural
  inventory deferrals).
- **NEW** `docs/ui/foundations/theming.md` — theme data shape +
  switching mechanism + persistence + density policy + demo
  reference, from this exploration's
  [Theme data shape](#theme-data-shape) and
  [Switching mechanism + persistence](#switching-mechanism--persistence)
  sections.
- **NEW** `docs/ui/foundations/theming.html` — interactive demo
  per the [Interactive HTML demo](#interactive-html-demo) scope.
- **EDIT** `docs/ui/README.md` — add `foundations/` entry to the
  Layout list (between `principles.md` and `patterns/`).
- **EDIT** `docs/ui/screens/app-settings/app-settings.md` —
  rewrite `## APP · Appearance` body. Drop the
  `light / dark / system` framing. Replace standalone accent
  setting with **conditional accent picker** that only renders
  when the active theme is `accentOverridable`. New body
  describes: theme dropdown listing the curated gallery (link to
  `foundations/`), density toggle, conditional accent picker.
  Final styling reference to foundations replaces "lands with
  visual identity" placeholder.
- **EDIT** `docs/ui/screens/app-settings/app-settings.html` —
  replace standalone accent picker with the conditional accent
  picker (visible on accent-overridable theme selection, hidden on
  opinionated themes); update theme dropdown labels to placeholder
  gallery entries; same commit per the wireframe-bundling rule.
- **EDIT** `docs/data-model.md → App settings storage` — revise
  `app_settings.appearance` schema description to
  `{ themeId: string, density: 'comfortable' | 'compact', accentOverride?: string }`.
  ER diagram comment update accordingly.
- **EDIT** `docs/followups.md` — add the **NativeWind runtime
  theme-swap parity validation** followup under `## UX` (it's
  implementation-blocking, v1-relevant).
- **EDIT** `docs/parked.md` — add three new entries under
  appropriate `## Parked until signal` subsection:
  - User-authored themes (raw CSS, no UI)
  - Per-story theme override (`stories.settings.themeId`)
  - OS dark/light follow

Renames: none.

Patterns adopted on a new surface: foundations doesn't cite any
patterns from `patterns/`. The reverse — patterns will eventually
cite foundations token slots — is a future-session integration
direction, not a session-1 change.

Followups resolved: this session resolves the
"`Storybook design-rules pattern setup`" followup's
**Foundations** prerequisite — Storybook's `Foundations/`
namespace now has a docs anchor (`docs/ui/foundations/`) to cite
when Storybook is scaffolded. The followup itself stays parked on
"component implementation begins"; this session doesn't close it.

Followups introduced: NativeWind runtime parity (above).

Wireframes updated:
`docs/ui/screens/app-settings/app-settings.html` — drop accent
picker, update theme dropdown placeholder labels.

Intentional repeated prose: none planned.

Exploration record: keep this file at integration; per the
explorations README, it remains as a frozen historical record of
this session's reasoning.
