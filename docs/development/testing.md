# Testing

Vitest (`vitest.config.ts`), covering targeted units under `src/lib/` — not a full-coverage suite. Run
with `npm test`.

**Rune modules cannot be imported by tests.** `vitest.config.ts` deliberately omits the SvelteKit plugin
to keep the suite fast and stable, so any `*.svelte.ts` file fails at import with `$state is not defined`.
Services reach the stores through `vi.mock('$lib/stores/…')`; logic that needs testing on its own is
extracted into a plain `.ts` module instead (`settingsMigrations.ts`, `advancedPanelView.ts`,
`stickiness.ts`, `recentTail.ts` are all this pattern). Those modules are production code with real
callers, not test scaffolding.

There is also no DOM environment (`environment: 'node'`), so components are not rendered by any test. A
Svelte-level mistake — a `bind:` to an undefined value, for instance — passes `check`, `lint` and the
whole suite, and only fails when the app runs.

## Discovery provider tests

The discovery provider unit tests mock `corsFetch` with representative upstream payloads. They are the
CI contract for request construction, result mapping, and card downloads; they do not depend on remote
services remaining available or preserving their current catalog.

An opt-in smoke suite exercises public search and download paths against Character Tavern, Chub,
MLPChag, QuillGen, and Wyvern:

```powershell
$env:AVENTURAS_LIVE_DISCOVERY='1'; npx vitest run src/lib/services/discovery/providers/providers.live.test.ts
```

It is skipped unless `AVENTURAS_LIVE_DISCOVERY=1` and must not be enabled in required CI. JannyAI is
excluded because token discovery and card downloads can be challenged by Cloudflare. Backyard,
Pygmalion, and RisuRealm use volatile application protocols whose availability is not a stable health
signal for this repository. Their deterministic provider tests still cover the complete request,
mapping, and download contracts.
