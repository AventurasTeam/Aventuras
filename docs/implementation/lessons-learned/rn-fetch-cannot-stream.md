# React Native's global `fetch` cannot stream — SSE needs `expo/fetch`

`react-native/Libraries/Network/fetch.js` is one line of substance:
`require('whatwg-fetch')`. That polyfill is XHR-backed and declares
**no `body` getter at all**, so `response.body` is `undefined` on
native while it is a `ReadableStream` on web and Electron. Every
server-sent-events call therefore reaches a stream consumer with
nothing to read.

Through the AI SDK the failure arrives heavily disguised. Its
event-source handler checks `response.body == null` and throws
`EmptyResponseBodyError`; `postToApi` catches anything the handler
throws and rethrows it as an `APICallError` whose own message is
`Failed to process successful response`, with the real fault demoted
to `cause` and `statusCode` set to the response's **200**. Three
consequences worth recognising on sight:

- The log names the envelope, not the fault. Code that reduces an
  error to `.message` reports a sentence with no diagnostic content.
- A 200 status routes the failure into whatever branch handles
  "successful-looking response", so it can be classified retryable
  and re-issue a request the server already answered in full.
- XHR resolves only once the whole response has arrived, so the
  error fires the instant generation completes. It reads as a
  post-generation bug when it is really a transport that never
  streamed at all.

## Fix

`lib/ai/transport/platform-fetch.ts` plus its `.native.ts` sibling.
Native routes through `expo/fetch`, whose `FetchResponse` exposes a
real `body` stream. `expo/fetch` is part of core `expo`, so it needs
no config plugin and no dev-client rebuild — unlike a third-party
native module, see
[native-module RN libs need a dev-client rebuild](./native-dep-expo-link.md).

Two traps sit in the swap itself:

1. `expo/fetch` takes `(url, init)`, never a `Request`. Its
   `FetchRequestLike` needs a real `body` property and a whatwg
   `Request` has none, so handing it one sends an **empty body** with
   no error anywhere. Pass the body explicitly, and pass it
   unserialized so a non-text body is not round-tripped through
   `.text()`.
2. `FetchResponse.clone()` throws `Not implemented`. Any wrapper that
   clones a response — the HTTP-capture wrapper did — breaks every
   native call, not only the streaming ones.

## How to apply

Probe for the capability, do not branch on the platform. Whether a
response can be cloned is a property of the object you were handed,
not of the bundle you are in, so `try { response.clone() } catch {
return null }` both reads truer and stays testable from the `unit`
project, which resolves the web variant of a `.native.ts` pair.

When capture and consumption compete for one body: rebuild rather
than clone where the body is finite (read the text, hand back a fresh
`Response`), and give the stream up to its real consumer where it is
not. Teeing works too, but it puts a synthetic response in the hot
path of every call on the platform hardest to test.

Guard the emptiness check as `!= null`, not `!== null`. The whatwg
body is `undefined`, so a strict comparison declares a stream present
and sends an unreadable response down the streaming path.

Finally, never log an AI SDK error as `.message`. Flatten the `cause`
chain (`describeProviderError` in `lib/ai/transport/`) or the most
common provider faults — empty body, schema mismatch — all render as
the same contentless sentence.

Related: [Metro's native resolution ignores browser-targeted builds](./metro-native-ignores-browser-builds.md)
— same shape of surprise, where a dependency works on web and breaks
every Android bundle.
