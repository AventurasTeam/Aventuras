# Components

Where things live in `components/`. The full rule and worked
examples are in
[`docs/ui/components.md → Directory layout`](../docs/ui/components.md#directory-layout)
— this file is the short version for when you're about to create
a new file and want to know where it goes.

## Folders

- **`ui/`** — primitives. Building blocks that do one thing
  (Button, Input, Switch, AlertDialog, Select, Tabs). They may
  have inner pieces — a dialog has a title, content, an action
  button — but you reach for the primitive as one unit.

- **`compounds/`** — compounds. Two or more primitives stitched
  together where each piece carries its own meaning. SwitchRow
  is a label, a description, and a toggle: three peers, not one
  black box. Anything reusable across screens lives here, even
  if it's Aventuras-specific (ListRow, Toolbar, SaveBar).

- **`<domain>/`** — domain compounds. Same shape as `compounds/`
  but tied to one slice of the data model. Folder name matches
  the domain (`entity/`, `reader/`, `story/`). KindIcon belongs
  to `entity/`; an EntryCard would belong to `reader/`.

- **`shells/`** — layout shells. The big-picture wrappers that
  define a whole screen (MasterDetailLayout, ScreenShell,
  ListPane, DetailPane).

- **`foundations/`** — Storybook-only documentation surfaces
  (the foundations explorer). Not real components a user sees.

Hooks-only utilities (like `useNavGuard`) go in
[`../hooks/`](../hooks/), not here.

## Picking a folder

Ask in order:

1. **Does it do one thing as a single unit?** Even if it's built
   from smaller pieces inside, if you reach for it as one
   component → `ui/`.
2. **Is it a peer composition** (two or more primitives, each
   peer matters on its own) → it's a compound. Continue.
3. **Is it tied to one slice of the data model** (entities,
   stories, reader, etc.)? Yes, exactly one → `<domain>/`.
   Otherwise → `compounds/`.
4. **Does it shape an entire screen** (header + body + footer,
   master/detail split, list-pane wrapper)? → `shells/`.

## Storybook titles

- `ui/` → `Primitives/<Name>`
- `compounds/` → `Compounds/<Name>`
- `<domain>/` → `Compounds/<Domain>/<Name>`
- `shells/` → `Shells/<Name>`
- `foundations/` → `Foundations/<Name>`

## When you're unsure

The live build queue (what's shipped, what's queued, what still
needs design) is in
[`docs/ui/component-inventory.md`](../docs/ui/component-inventory.md).
The full rule with edge cases and worked examples is in
[`docs/ui/components.md → Directory layout`](../docs/ui/components.md#directory-layout).
