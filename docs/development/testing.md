# Testing

Vitest (`vitest.config.ts`), covering targeted units under `src/lib/` — not a full-coverage suite. Run
with `npm test`.

**Rune modules cannot be imported by tests.** `vitest.config.ts` deliberately omits the SvelteKit plugin
to keep the suite fast and stable, so any `*.svelte.ts` file fails at import with `$state is not defined`.
Services reach the stores through `vi.mock('$lib/stores/…')`; logic that needs testing on its own is
extracted into a plain `.ts` module instead (`settingsMigrations.ts`, `advancedPanelView.ts`,
`stickiness.ts`, `recentTail.ts` are all this pattern). Those modules are production code with real
callers, not test scaffolding.

The default environment is `node`, with no DOM, and no test renders a component. A Svelte-level mistake —
a `bind:` to an undefined value, for instance — passes `check`, `lint` and the whole suite, and only
fails when the app runs.

A test whose code under test parses HTML with the DOM (`utils/narrationClean.ts`) opts in per file with
`// @vitest-environment jsdom` as its first line. `jsdom` is a devDependency only, and every other file
stays on `node`.

## Discovery provider tests

The discovery provider unit tests mock `corsFetch` with representative upstream payloads. They are the
CI contract for request construction, result mapping, and card downloads; they do not depend on remote
services remaining available or preserving their current catalog.

An opt-in smoke suite exercises public search and download paths against every registered discovery
provider:

```powershell
$env:AVENTURAS_LIVE_DISCOVERY='1'; npx vitest run src/lib/services/discovery/providers/providers.live.test.ts
```

It is skipped unless `AVENTURAS_LIVE_DISCOVERY=1` and must not be enabled in required CI. The suite is
intentionally comprehensive: failures from Cloudflare, volatile application protocols, upstream
catalog changes, or provider outages are useful signals during an explicit live run, but would make
required CI flaky.

## Fake provider

`scripts/fake-provider.mjs` stands in for a provider, so the running app can be driven into
failures by hand: rate limits, server errors, hangs, empty and malformed answers, cut streams. It
answers as an OpenAI-compatible chat API and as the OpenAI image API, with no dependencies, and logs
one line per request. What each request does is chosen by the model name it asks for, so every
service can be pointed at its own failure from one profile.

```bash
npm run fake-provider
```

It listens on `http://localhost:4010/v1`; `npm run fake-provider -- 4020` picks another port.

**Setup in the app**

1. Settings → API Connection: add a profile, provider _OpenAI Compatible_, base URL
   `http://localhost:4010/v1`, any API key. Make it the main narrative profile, model `ok`.
2. Settings → Generation → Agent Profiles: profiles on that API profile, all with **Structured Output
   on** — the fake builds structured answers from the request's JSON schema, which it cannot see when
   the schema travels inside the prompt. One on `ok` for every task; one on `ok-fill` for **Image
   Gen** and **BG Image generation analyzer**, so scenes are found and the background is judged
   changed; one whose model is set to the failure under test, to move a single task onto.
3. Settings → Images: a profile with provider _OpenAI_, the same base URL, model `img-ok`, and **any
   API key** — the OpenAI image provider requires one even with a custom URL, and without it every
   story's image settings stay on Text Only.

**Chat models.** Append `-slow` to any of them for a 4 s delay before the answer starts.

| Model                    | Behaviour                                                                         |
| ------------------------ | --------------------------------------------------------------------------------- |
| `ok`                     | a valid answer; structured output is built from the request's schema              |
| `ok-fill`                | as `ok`, with one item in every list and flags true                               |
| `partial`                | as `ok-fill`, plus one list element missing its required fields                   |
| `malformed`              | JSON that does not parse; a plain-text call gets `x`                              |
| `empty`                  | 200 with no content                                                               |
| `fail-400` … `fail-404`  | 400 context length, 401 bad key, 403 no access, 404 no such model                 |
| `fail-429`               | 429 on every request                                                              |
| `fail-429x2`             | 429 twice, then a valid answer                                                    |
| `fail-429-ra3`           | 429 once with `Retry-After: 3`, then a valid answer                               |
| `fail-429-ra900`         | 429 with `Retry-After: 900`, beyond the request timeout                           |
| `fail-500`, `fail-503`   | 500 or 503 on every request                                                       |
| `fail-500x1`             | 500 once, then a valid answer                                                     |
| `fail-502-html`          | 502 with an HTML page as the body                                                 |
| `fail-reset`             | the connection closed with no response                                            |
| `fail-hang`              | never answers                                                                     |
| `stream-connection-lost` | streaming only: some text, then the connection drops                              |
| `stream-cut-error`       | streaming only: some text, then an error event in the stream, as OpenRouter sends |

The narration is always _The dragon fell from the sky, and the valley was quiet again._, and every
scene's quote is _The dragon fell from the sky_, so images land in the text — including the part a
cut stream keeps.

**Image models:** `img-ok`, `img-fail-400` (content policy), `img-fail-401`, `img-fail-429`,
`img-fail-500`, `img-empty` (200 without an image), `img-hang`.
