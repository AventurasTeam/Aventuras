# A stale typed-routes file fails a local typecheck CI passes

`pnpm typecheck` can fail locally on code nobody touched, with an error
such as `Type '"/dev/chapter-close"' is not assignable to type ... Href`
in `app/dev/index.tsx`, while CI passes on the same commit.

## Why

`app.json` turns on `typedRoutes`, so expo-router writes the app's route
list into `.expo/types/router.d.ts` whenever the dev server runs. The
file is gitignored and nothing else refreshes it. A checkout that last
ran the dev server before a route landed keeps a list without that route,
and every link to it stops typechecking. CI's fresh checkout has no file
at all, so `Href` falls back to a plain string there and the same code
passes.

## How to apply

When typecheck fails on a route path in a file you didn't change,
compare the date of `.expo/types/router.d.ts` with the commit that
added the route. Regenerate the file by starting the dev server once
(`pnpm desktop`, or `pnpm start`), or move the stale file aside, which
leaves the local typecheck where CI's is. Don't change the route code
to satisfy it.

Seen in the 2026-11-07 triage pass, on a slot whose file predated
`/dev/chapter-close`.
