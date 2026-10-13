# shadcn-svelte

`src/lib/components/ui/` started as shadcn-svelte output. The repo no longer carries the
generator's `components.json`, and the components are maintained by hand on bits-ui. The rules
are in [ui-components.md](ui-components.md); this is the evidence behind them and what it would
take to bring the generator back.

Investigated 2026-10-12 against shadcn-svelte 1.7.0 (released 2026-09-16). The CLI source was read
at `huntabyte/shadcn-svelte` `main`, commit `7c99619b` (2026-10-05). All file paths below are under
`packages/cli/src/`.

## The config could not run

The removed `components.json` still had its Tailwind 3 setup, with only the aliases moved from
`$lib` to `#lib`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "tailwind": { "config": "tailwind.config.ts", "css": "src/app.css", "baseColor": "slate", … },
  "aliases": { "utils": "#lib/utils/cn", "ui": "#lib/components/ui", … },
  "registry": "https://tw3.shadcn-svelte.com/registry/default"
}
```

On Tailwind 4 with Svelte 5 the CLI builds the registry URL from that file, and the result 404s:

1. `utils/preconditions.ts` `checkDependencies` rewrites a `next.shadcn-svelte.com` registry on
   Tailwind 4. It only rewrites a `style` into a `tw3` URL on Tailwind 3. Here neither applies, so
   the `tw3` URL is used as written.
2. `utils/config/utils.ts` `resolveConfig` warns that `default` is not a preset style and
   substitutes `DEFAULT_PRESET_CONFIG.style`. That is the first entry of `PRESET_STYLES`: `nova`.
3. `utils/registry/index.ts` `getRegistryUrl` appends `/styles/<style>`.

| URL (fetched 2026-10-12)                                                  | Status |
| ------------------------------------------------------------------------- | ------ |
| `https://tw3.shadcn-svelte.com/registry/default/styles/nova/index.json`   | 404    |
| `https://tw3.shadcn-svelte.com/registry/default/index.json`               | 200    |
| `https://shadcn-svelte.com/registry/styles/vega/index.json`               | 200    |
| `https://shadcn-svelte.com/registry/styles/nova/index.json`               | 200    |
| `https://shadcn-svelte.com/registry/styles/new-york/index.json`           | 404    |

The `tw3` registry is still up. A Tailwind 4 project just can't reach it, because the URL the CLI
builds doesn't exist there.

The rest of the file was also stale. `$schema` named the React shadcn/ui schema, and
`tailwind.config` named a `tailwind.config.ts` the repo doesn't have. `rsc`, `tsx`,
`cssVariables` and `prefix` are not in the Svelte CLI's schema (`utils/config/schema.ts`). Its zod
objects aren't strict, so it ignored them silently.

## Fixing the config would not have been enough

A config pointed at `https://shadcn-svelte.com/registry` would fetch. What it generates still
fails this repo's checks:

- **Imports don't lint.** Registry files carry placeholders such as `"$UTILS$.js"`, and
  `utils/transformers/transform-imports.ts` swaps in the alias text, which gives
  `#lib/utils/cn.js` and `#lib/components/ui/button/index.js`. `local/lib-import-exists` requires
  the real `.ts` file ([overview.md](../architecture/overview.md#importing-srclib)), and the rule
  has no fixer.
- **Imports don't typecheck.** Current registry components import
  `{ cn, type WithElementRef } from "$UTILS$.js"`. `kbd` and `button` in the `vega` style both do.
  `src/lib/utils/cn.ts` exports only `cn`. The registry's own `utils` item would replace it with
  `export { cn } from "cn"`, the four type helpers, and a new `cn@^0.3.0` dependency. bits-ui 2
  already exports the same four helpers.
- **Some items edit `src/app.css`.** Items that declare `cssVars` (`sidebar`, `chart`) write into
  the Tailwind CSS file. This repo's file is laid out by hand and imports 26 theme files from
  `src/themes/`.

Alias resolution is not a problem. `utils/resolve-imports.ts` resolves `#`-prefixed aliases
through `package.json` `imports`, so `#lib/*` → `./src/lib/*` works without tsconfig `paths`.

## The output no longer matches the components

- **The components predate Tailwind 4.** Every generated folder in `components/ui/` was added
  between 2026-01-21 and 2026-02-07, across 10 commits, from the Tailwind 3 registry. None of the
  101 `.svelte` files there has a `data-slot` attribute, which every current registry primitive
  that renders an element carries.
- **Some components are hand-written.** `autocomplete`, `empty-state`, `responsive-modal`,
  `filter-button.svelte` and `icon-row.svelte` have no registry counterpart.
- **The current registry has no "default" style.** It offers only presets: `nova`, `vega`, `maia`,
  `lyra`, `mira`, `luma`, `sera`, `rhea`. `vega` is the closest to the Tailwind 3 look.
- **Animation classes are dead on both sides.** Current components use `tw-animate-css` classes
  (the `vega` dialog has `data-open:animate-in`, `fade-in-0`). The repo removed `tw-animate-css`
  in `37f95448` because its import had been dead since January. The existing components' classes
  are already no-ops, and new ones would be too.

## Refreshing the UI from the current registry

`shadcn-svelte init` writes a new `components.json`, and `add --all --overwrite` regenerates every
registry component. That replaces each file outright:

- Local edits since January are lost, with no merge.
- The props, exports and markup differ from the Tailwind 3 snapshots in places, and about 90 files
  import from `components/ui/`. `check` catches type breaks. Markup and behaviour changes only
  show up when the app runs, because the test environment has no DOM
  ([testing.md](testing.md)).
- New components use tokens and opacity forms the 26 themes may not define (`--sidebar-*`,
  `--chart-*`, `ring-ring/50`). Each theme needs a look.

The lower-risk route is to generate into a scratch SvelteKit project, diff each component against
`components/ui/`, and port changes one at a time.

## Bringing the generator back

1. Write a `components.json` with the `https://shadcn-svelte.com/schema.json` schema, the
   `https://shadcn-svelte.com/registry` registry, a preset `style`, `tailwind.css: src/app.css` and
   the `#lib` aliases. Leave out `tailwind.config`.
2. Re-export `WithElementRef`, `WithoutChild`, `WithoutChildren` and `WithoutChildrenOrChild` from
   bits-ui in `src/lib/utils/cn.ts`.
3. Give `local/lib-import-exists` a fixer that rewrites `.js` to `.ts` when that file exists, so
   `lint:fix` cleans up generated imports.
4. Run `add`, then review any change it makes to `src/app.css`.
