# UI components

`src/lib/components/ui/` began as shadcn-svelte output and is maintained by hand on bits-ui. The
repo has no `components.json`, and the shadcn-svelte generator is not used.

## Rules

- **Write a new primitive on bits-ui**, by hand, next to the existing ones in `components/ui/`.
- **Do not run `shadcn-svelte init` or `add` in this repo.** The generator's Tailwind 3 registry
  can't be reached from a Tailwind 4 project, and current registry output fails `check` and
  `lint` here and doesn't match the existing components.
- **To take something from the current registry**, generate it in a scratch SvelteKit project,
  diff it against `components/ui/`, and port the changes by hand.
- **Markup**: the native element over a `div` with ARIA, and a bits-ui component where one exists
  for the job ([modern-code.md](modern-code.md#per-layer)).
- **Run the app.** No test renders a component, so a markup or behaviour change only shows up when
  the app runs ([testing.md](testing.md)).

What the generator does with this repo's config, how its output fails here, and what bringing it
back would take: [shadcn-svelte.md](shadcn-svelte.md).
