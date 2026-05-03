# Density toggle — reinstatement

Reinstates the user-facing density toggle that
[`spacing.md → Density toggle`](../ui/foundations/spacing.md#density-toggle) (formerly cut, now reinstated)
explicitly cut at session 4 of the visual identity foundations
work. The original cut anticipated a "if mobile users ask for
compact density post-v1" signal; we've hit a different signal
pre-v1: tier-responsive sizing is forced on us by Phase 2 Group B
Select implementation (44pt iOS HIG minimum on phone, denser
desktop sizing wanted), and density-as-toggle is the cleaner
expression of that variation than ad-hoc `lg:` swaps in every
primitive.

This exploration locks the shape; integration walks back the cut
record and lands the token + settings + UI work as a single
mechanical PR per the original cut record's estimate.

## Three densities

Three named density values, applied universally across all tiers:

| Density       | h-control-md | List row py | Default tier       |
| ------------- | ------------ | ----------- | ------------------ |
| `compact`     | 40           | 6           | desktop            |
| `regular`     | 44           | 12          | phone, tablet      |
| `comfortable` | 48           | 16          | (user opt-in only) |

`regular` is the tap-friendly mobile default (meets iOS HIG 44pt
minimum). `compact` is the desktop default (mouse precision allows
denser). `comfortable` is a user opt-in for either tier — primary
audience: mobile users who want extra tap comfort, desktop users
with motor accessibility needs.

The toggle is **universal**: all three values are available on
every tier. Defaults differ per tier; user override applies the
chosen value regardless of tier. A phone user can choose `compact`
(explicitly opting below HIG minimum), and a desktop user can
choose `comfortable` (chunky on desktop but enabling for some
users) — both are deliberate user choices.

## Token vocabulary — hybrid

Two classes of density-aware tokens:

**Height-driven tokens** for fixed-height controls — Trigger,
Button, Input, anything where a guaranteed minimum height matters
for tap-target compliance:

```
--control-h-xs   compact 32   regular 36   comfortable 40
--control-h-sm   compact 36   regular 40   comfortable 44
--control-h-md   compact 40   regular 44   comfortable 48
--control-h-lg   compact 44   regular 48   comfortable 56
```

**Padding-driven tokens** for rows — Item, list rows, where
content varies and the row height emerges from content + padding:

```
--row-py-xs   compact 4    regular 8    comfortable 10
--row-py-sm   compact 6    regular 10   comfortable 12
--row-py-md   compact 6    regular 12   comfortable 16
--row-py-lg   compact 8    regular 16   comfortable 20
```

```
--row-px-xs   compact 6    regular 8    comfortable 10
--row-px-sm   compact 8    regular 10   comfortable 12
--row-px-md   compact 8    regular 12   comfortable 16
--row-px-lg   compact 12   regular 16   comfortable 20
```

Hybrid rationale (height-enforced controls vs. padding-driven
rows) lives in [`spacing.md → Component-internal sizing tokens — density-aware`](../ui/foundations/spacing.md#component-internal-sizing-tokens--density-aware)
as the canonical contract framing.

Tailwind utility shorthand exposed via `tailwind.config.js`:

```js
height: {
  'control-xs': 'var(--control-h-xs)',
  'control-sm': 'var(--control-h-sm)',
  'control-md': 'var(--control-h-md)',
  'control-lg': 'var(--control-h-lg)',
}
padding: {
  'row-y-xs': 'var(--row-py-xs)',  // applied via py-row-y-xs
  // ...
}
```

Primitives use `h-control-md` and `py-row-y-md` once; density
shifts swap the token's value, primitive className unchanged.

## Resolution mechanism

```
density = (settings.appearance.density === 'default')
  ? (tier === 'desktop' ? 'compact' : 'regular')
  : settings.appearance.density
```

`settings.appearance.density: 'default' | 'compact' | 'regular' | 'comfortable'`,
default `'default'`. The sentinel value `'default'` means "use the
per-tier rule above"; the three explicit values pin a specific
density regardless of tier. Storing the sentinel rather than the
resolved value lets us change tier-default rules later without
migrating user data — anyone who hadn't explicitly picked a
density picks up the new default automatically.

**Web (Storybook + Electron):** root element gets
`data-density="compact|regular|comfortable"` from a Provider
component sitting alongside `ThemeProvider`. CSS vars defined per
`[data-density="X"]` block in a generator output (sister to the
existing theme CSS generator). NativeWind compiles `h-control-md`
to `height: var(--control-h-md)`; the var resolves from the
nearest `[data-density]` ancestor.

**Native (Expo iOS / Android):** `useDensity()` hook reads from
the settings store and returns the resolved density string.
Primitives map to literal token values via a `densityTokens[density]`
lookup table — no CSS var resolution at runtime. NativeWind on
native compiles class strings statically per render.

The same primitive code works on both platforms; the resolution
mechanism differs because RN + NativeWind doesn't have a runtime
CSS-var swap mechanism the way the web does.

## Settings shape

Adds one field to `app_settings.appearance`:

```ts
appearance: {
  themeId: string
  accentOverride?: string
  density: 'default' | 'compact' | 'regular' | 'comfortable'  // NEW; default 'default'
  // ... existing fields
}
```

UI control surfaces in two places — Onboarding Step 1 and App
Settings → Appearance. Labels and subtitle copy live in
[`spacing.md → Density toggle`](../ui/foundations/spacing.md#density-toggle)
as canonical. The two-surface placement here is the design
choice: hitting the toggle early (onboarding) means users who
care about density don't have to dig through settings, while the
App Settings entry handles post-onboarding adjustment.

## Affected primitives

**Phase 2 Group B (already shipped, retrofit):**

- **Select Trigger** — `h-11 lg:h-10` → `h-control-md`
- **Select Item** — `py-3 lg:py-1.5` → `py-row-y-md`; `pl-3 pr-10
lg:pl-2 lg:pr-8` → `pl-row-x-md pr-row-x-md` plus indicator
  positioning adjustments
- **Select Trigger size="sm"** → `h-control-sm`

**Phase 1 (retrofit):**

- **Button** — `h-10 / h-12 / h-8` (md/lg/sm) → `h-control-md /
h-control-lg / h-control-sm`. Was 40 / 48 / 32 universally; now
  density-driven.

**Phase 2 future groups (ship correctly from day one):**

- Input, Textarea (Group C) — height tokens
- Switch, Checkbox, Radio (Group D) — height tokens for tap area
- Icon, Avatar (Group E) — likely density-agnostic (icon size
  scale is its own concern)
- Skeleton, Spinner (Group F) — density-agnostic

## Storybook coverage

Each primitive gets a **Density** story showing the three values
side by side. The existing ThemeMatrix story stays
density-agnostic (tested against the active density only) — adding
a 3 × 10 = 30-cell density × theme matrix is overkill and the
density variation is captured separately.

The Storybook toolbar gains a **Density** dropdown (alongside the
existing Theme dropdown) for global density swapping during
development. Implementation mirrors the Theme decorator pattern.

## Walk-back of spacing.md cut

`spacing.md → Density toggle — cut` becomes
`spacing.md → Density toggle — reinstated`. The cut rationale is
preserved as historical context (under a "## History" subsection
or similar), with a note explaining the signal that prompted
reinstatement.

## Adversarial pass

**Load-bearing assumption.** NativeWind's CSS-var-via-className
mechanism resolves `[data-density]` cascade correctly on web
(Storybook + Electron). If it doesn't, the web swap mechanism
breaks and we'd need an alternative (e.g., regenerate utility
classes per density mode, or use inline style). Risk: medium.
Mitigation: prototype before committing to the token shape; verify
in Storybook with a single primitive (Button) first.

**Edge case — settings hydration before density resolves.** On
first paint, settings haven't loaded from SQLite yet. What density
applies? Solution: ship a sensible static default (`regular`) in
the initial Provider state; once settings hydrate, swap to the
resolved value. Brief flash of regular-on-desktop is acceptable
(better than chunky on first render).

**Edge case — tier transition mid-session (RN-Web window resize,
fold/unfold).** When tier changes, density may change too (if
user has `tier-default`). Should this trigger a re-render of every
primitive using density tokens? Yes — `useDensity()` derives from
both tier and settings, so tier change re-derives density, hook
re-fires, primitives re-render. Re-render cost negligible.

**Edge case — Storybook ThemeMatrix interaction.** Per-row theme
scoping uses `dataSet={{ theme }}`. Adding density also requires
`dataSet={{ density }}`. If both are needed simultaneously,
`dataSet={{ theme, density }}`. Verify NativeWind handles
multi-attribute dataSet correctly. Risk: low (RN-Web's dataSet is
just data-\* forwarding).

**Read-site impact — components.md.** Augmentation precedents +
Storybook conventions both gain density-related notes. The Sizes
section indicative-shape entries gain a Density section.

**Read-site impact — spacing.md.** Cut record walked back;
density-aware token list added; padding token table updated to
reflect three-variant tokens.

**Read-site impact — themes.md.** Theme registry remains
density-agnostic; color tokens don't change with density. But the
CSS generator extends to emit density blocks. Worth a section
note: "Theme CSS scopes by `[data-theme]`; density CSS scopes by
`[data-density]`. Cascade is independent."

**Read-site impact — data-model.md.** `app_settings.appearance`
schema gains the `density` field. No migration needed for
existing rows (default `'default'`).

**Missing perspective — accessibility.** Comfortable density
(48px controls) helps users with motor difficulties. But also
text size matters; 16px (text-base) on regular and comfortable
helps readability for low-vision users. Worth pinning that the
density toggle isn't a substitute for proper a11y (font scaling,
contrast settings) — those are separate concerns. Add a note in
the App Settings → Appearance description.

**Missing perspective — i18n / RTL.** Padding tokens are
direction-agnostic on `py-`; horizontal `px-` tokens RTL-flip
naturally via NativeWind. No special handling needed.

**Verified vs. assumed.** Verified: spacing.md cut record exists
and explicitly preserves re-adding path. Assumed: NativeWind
handles `[data-density]` cascade correctly on web (needs
prototype); native lookup-table approach works for class-string
compilation. Will validate during implementation phase 1
(prototype with Button) before applying to all primitives.

## Implementation order

1. **Prototype with Button** (smallest scope) — verify the token
   resolution works on both web and native.
2. **Walk back spacing.md** + add density tokens to theme CSS
   generator + add `useDensity` hook + add settings field +
   Provider plumbing.
3. **Retrofit Button** to use `h-control-md` etc.
4. **Retrofit Select** (this phase's primitives) to drop `lg:`
   swaps and use density tokens.
5. **App Settings UI control** — render the density picker.
6. **Storybook density addon** — toolbar dropdown.
7. **Phase 2 Groups C, D, E, F** ship using the density tokens
   from day one.

## Cost estimate

Per spacing.md's "mechanical PR" estimate (4 lines):

- Schema field: 1 line in `app_settings.appearance` shape
- Token table: ~20 token entries × 3 density values + Tailwind
  config ramp shorthand
- CSS generator extension: ~30 lines (per-density block emission)
- Native hook + lookup table: ~15 lines
- Provider plumbing: ~10 lines on web (Provider + data-density
  application)
- App Settings UI control: ~30 lines (Select with cascade)
- spacing.md walk-back: ~50 lines (rewrite section)
- components.md notes: ~15 lines added
- Button retrofit: 4 className entries
- Select retrofit: 8 className entries
- Storybook decorator: ~30 lines

Total: ~200-300 LOC across ~12 files. Larger than the original
"one field, two-variant tokens, one UI control" estimate but
still mechanical — no design uncertainties remain after this
exploration.

## Density vocabulary alternatives considered

- `cozy / standard / spacious` — too vague, "cozy" reads
  positively but doesn't communicate "denser"
- `dense / default / spacious` — "default" doesn't survive when
  defaults differ per tier
- `compact / regular / comfortable` — chosen. Each word maps to a
  clear visual idea; matches the user's natural framing during
  the design conversation.

The alternative naming `mobile-density` for a mobile-only toggle
was rejected in favor of universal density, per the design
conversation: if the toggle is offered on phone, offering it
universally costs nothing extra and serves accessibility users on
desktop.
