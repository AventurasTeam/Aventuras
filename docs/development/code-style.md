# Code style

How new and edited code reads. Which idiom each layer uses is in [modern-code.md](modern-code.md);
comments are in [comments.md](comments.md).

## Match the surrounding code

Match its naming, file layout, and how much it explains itself. Where matching it would mean a
dated idiom, [modern-code.md](modern-code.md) wins.

## Svelte

- Svelte 5 runes only (`$state`, `$derived`, `$props`), no legacy store syntax in new code.
- Logic that needs a test goes in a plain `.ts` module: a `*.svelte.ts` module cannot be imported
  by a test ([testing.md](testing.md)).

## Imports

- Import from `src/lib` as `#lib/…` with the real extension: `#lib/services/database.ts`,
  `#lib/stores/settings.svelte.ts`, `#lib/components/ui/button/index.ts`. Omitting it does not
  resolve, and there is no `$lib`. `local/lib-import-exists` enforces this where `check` cannot;
  what TypeScript lets through is in
  [overview.md → Importing `src/lib`](../architecture/overview.md#importing-srclib).
- Import a service through its `index.ts`, not its internals.

## Defaults

Never write `?? <default>` for a value that has a default in `ai/core/defaults.ts`. The settings
store merges every block over its defaults on load, so the key is always present, and a fallback
at the call site is a second copy of the number that nothing keeps in step
([ai-services.md](../architecture/ai-services.md#agent-profiles-and-service-resolution)).
