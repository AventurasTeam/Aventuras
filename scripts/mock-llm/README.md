# Mock LLM

A local OpenAI-compatible provider with a browser control panel, so a
pipeline turn costs milliseconds instead of minutes while you drive the
app by hand.

```sh
pnpm db:seed   # seeds prov_local at http://localhost:4319/v1
pnpm mock      # endpoint + control UI on :4319
pnpm desktop
```

Then open <http://127.0.0.1:4319/>.

`--port` (or `MOCK_LLM_PORT`) moves it; the app's endpoint is editable
under Settings → Providers if you do.

## What it is

The same idea as [`e2e/harness/mock-llm.ts`](../../e2e/harness/mock-llm.ts)
— a real HTTP endpoint the app reaches through its real transport — but
external, stateful and driven from a UI instead of from a spec.

It is coupled to the repo on purpose: it renders response shapes with the
app's own [`schemaToTypeScriptBlock`](../../lib/ai/prompt-schema.ts),
validates authored replies against the app's own zod schemas, and builds
trailing blocks from the app's own tag constants in
[`lib/piggyback/tags.ts`](../../lib/piggyback/tags.ts). Its tests round-trip
everything it emits through the app's real parsers, so it cannot serve
markup the app rejects.

## Lanes

The app talks to one URL, and a turn fans out into several calls. The mock
separates them by inspecting the request:

- `stream: true` → the **narrative** lane.
- anything else → a **structured** lane, identified by the TypeScript block
  the app injects into the prompt (or, on the `force-on` path, by the JSON
  Schema in `response_format`).

Shapes listed in [`shapes.ts`](./shapes.ts) get a named lane with live
schema validation. A shape that is _not_ listed still gets a lane, keyed by
a hash of its block and flagged `unregistered` in the UI — a new agent is
addressable straight away, and adding it to `shapes.ts` only upgrades it to
a friendly name and validation.

Per lane you get: a library of named responses, sequence cycling, a
mock/passthrough switch, response delay and jitter, failure injection, and
(narrative only) streaming speed.

## Failure injection

| Kind         | What the app sees                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http`       | The chosen status. 401/403 is non-retryable, 429 and 5xx are retryable — see [`classify-provider-error.ts`](../../lib/ai/transport/classify-provider-error.ts).                         |
| `malformed`  | A reply that cannot be repaired into a valid object, exercising the parse-retry path. On narrative it appends a truncated `<state>` block instead, exercising piggyback parse recovery. |
| `stream-cut` | The SSE stream opens, emits, then closes with no stop frame and no `[DONE]`.                                                                                                            |
| `hang`       | The socket opens and never finishes, until the client times out or cancels.                                                                                                             |

**Structured calls retry once.** `generateStructured` wraps the call in
`callWithRetry` with `maxProviderAttempts: 2`, so a failure budget of 1 on a
structured lane is swallowed before the app ever sees it. Use 2 or more.
Narrative has no such wrapper — one failure fails the run.

## Passthrough and recording

Set a lane to **passthrough** and pick an upstream to send just that agent
to a real provider while everything else stays instant. Upstreams are
configured with the _name_ of an environment variable, never a key:

```jsonc
// state.json → upstreams
{
  "id": "lmstudio",
  "label": "LM Studio",
  "baseURL": "http://localhost:1234/v1",
  "apiKeyEnv": "",
  "model": "qwen3-30b",
}
```

The key is read from `process.env` at call time. It is never written to
`state.json` and never crosses the control API.

Every passthrough reply lands in the request log with **Save reply as a
response** — the raw text is split back into prose, `<state>` and
`<suggestions>` using the app's own parsers and stored as a canned response.
Record once against a real model, replay forever.

## Entity placeholders

`IdBiMap` allocates `c1`, `c2`, `l1`… per run in prompt-encounter order, so
the same placeholder means a different entity every turn. Shipped defaults
therefore name none of them.

To write a reply that moves a specific entity: run the turn, open the
request in the log, and use **Open this lane with its placeholders** — the
roster the prompt actually sent is pinned above the editor.

## Piggyback

Only `seed/narrative` carries `taggedBlockReliable` in the dev seed, and
there is no capability editor in app settings, so `/v1/models` advertises
that exact id. If the narrative model resolves to anything else,
`resolvePiggybackFires` returns false and every turn quietly runs the
_fallback_ classifier instead. The log flags this on any per-turn classifier
call. `mock/no-tagged-block` is advertised for when you want that fallback
path on purpose.

## State

`state.json` (gitignored) holds lanes, responses and upstreams, and is
written back as you edit. Delete it to restore shipped defaults, or use
**Reset to defaults** in the header.
