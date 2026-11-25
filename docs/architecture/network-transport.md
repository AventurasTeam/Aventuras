# Network transport

Why remote HTTP goes through Tauri's HTTP plugin rather than the WebView's `fetch`, and what that
costs. The rules for writing a request are in
[network-requests.md](../development/network-requests.md).

## The decision

Remote HTTP from the WebView goes through `@tauri-apps/plugin-http`: its `fetch` runs the request
in Rust with reqwest and hands the response back over IPC. The WebView's own `window.fetch` is not
used for remote hosts. One exception remains: the OpenAI-compatible TTS requests in `TTSService.ts`
(the voice list and the speech POST) still call the WebView's `fetch`.

The endpoints are whatever the user configures: hosted APIs, and LLM, image and TTS servers on the
LAN, often plain `http://` to a bare IP address. The WebView's `fetch` would break a share of them:

- **CORS** is decided by each server, and the origin it has to allow differs by platform. This is
  the deciding reason: the app cannot fix it, only the user's server configuration can.
- **Android release builds** block cleartext (`usesCleartextTraffic` is `false` outside the debug
  build type, `src-tauri/gen/android/app/build.gradle.kts`).
- **ATS** on iOS and macOS blocks plaintext from WKWebView. The `NSAllowsLocalNetworking` exception
  (`src-tauri/Info.ios.plist`, iOS only) covers `.local` and unqualified host names, not IP
  addresses.

The last two are platform policy the app could relax; CORS is not. A CSP is not a factor: the app
ships `csp: null`.

Native sockets are outside both policies: ATS governs URLSession and WebKit, and Android's
cleartext flag governs the platform HTTP stacks and the WebView. reqwest uses neither.

Tauri's v2 docs state no preference between the two. A maintainer comment from the v1 era (tauri
discussion #8433) recommends the WebView's `fetch` by default and the plugin when CORS forces it. For an app
that talks to endpoints the user chooses, that exception is the common case.

## How the two differ

Measured on `tauri-plugin-http` 2.8.2; the app now runs 2.9.0 with the features in
[What the app runs](#what-the-app-runs).

|                 | `plugin-http`                                                                                                                                                                                                                 | WebView `fetch`                                                                                                                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CORS            | Not enforced. `Origin` is sent unless the caller drops it, which `unsafe-headers` allows and `httpFetch` does (see [What the server sees](#what-the-server-sees))                                                                    | The server must allow `http://tauri.localhost` (Windows, Android) or `tauri://localhost` (macOS, iOS, Linux). Anthropic also needs `anthropic-dangerous-direct-browser-access`; LM Studio has CORS off by default; stock Ollama allows `tauri://*` but not `http://tauri.localhost` |
| Plain `http://` | Unaffected                                                                                                                                                                                                                    | Blocked in Android release builds, and by ATS on iOS and macOS except for local host names; mixed content if `useHttpsScheme` is on                                                                                                                                                 |
| Allowed hosts   | Capability URL scopes (ours are `http(s)://*`)                                                                                                                                                                                | CSP `connect-src` (ours is `csp: null`)                                                                                                                                                                                                                                             |
| Headers         | Forbidden list dropped (`Origin`, `Referer`, `Cookie`, `Host`, `Accept-Encoding`, `sec-*`, `proxy-*`, …) unless `unsafe-headers`, which lifts all of it; `User-Agent` can be set and defaults to `tauri-plugin-http/<version>` | Browser forbidden list; Chromium drops `User-Agent`                                                                                                                                                                                                                                 |
| Cookies         | With the `cookies` feature, its own jar, shared by every host and persisted to `.cookies` in the app cache directory; without it, none                                                                                                            | The WebView's jar                                                                                                                                                                                                                                                                   |
| HTTP cache      | None                                                                                                                                                                                                                          | Native                                                                                                                                                                                                                                                                              |
| Proxy           | OS proxy on Windows and macOS (`system-proxy`), or a per-request `proxy` option                                                                                                                                               | OS proxy and PAC                                                                                                                                                                                                                                                                    |
| Streaming       | `ReadableStream`, pull-based, one IPC round trip per reqwest chunk, raw bytes (since 2.4.0)                                                                                                                                   | Native, no IPC                                                                                                                                                                                                                                                                      |
| Abort           | Cancels the Rust request, including mid-stream (since 2.5.5), but never rejects with an `AbortError`                                                                                                                          | Standard `AbortError`                                                                                                                                                                                                                                                               |
| Connections     | A new reqwest `Client` per request: no keep-alive, no HTTP/2 reuse (upstream #3024, open)                                                                                                                                     | Pooled                                                                                                                                                                                                                                                                              |
| Request body    | Buffered, then sent as a JSON number array (`Array.from(new Uint8Array(buf))`), several times its size in the WebView heap                                                                                                    | Native                                                                                                                                                                                                                                                                              |
| TLS roots       | Bundled webpki roots; the OS store is added with `rustls-tls-native-roots`                                                                                                                                                                                        | OS store                                                                                                                                                                                                                                                                            |
| Compression     | With the `gzip`/`brotli`/`zstd` features, negotiated and decoded in Rust; without them, none                                                                                                                                                     | Native                                                                                                                                                                                                                                                                              |
| DevTools        | Only the IPC calls show                                                                                                                                                                                                       | Real Network tab                                                                                                                                                                                                                                                                    |

On abort, what the caller sees depends on when the signal fires:

- before the plugin's first IPC call, or between it and the send: `new Error('Request cancelled')`;
- while waiting for the response headers, the usual case: the bare string `'Request canceled'`
  (one "l"), the Rust error serialized over IPC;
- after the headers: the body stream errors with the bare string `'Request cancelled'`.

The wrapper reads the signal from `init` only; a `signal` on a `Request` passed as `input` is
ignored. It also deletes the plugin's own options (`maxRedirections`, `connectTimeout`, `proxy`,
`danger`) from the `init` object it is given.

## What the server sees

- No `Origin` is sent unless the caller sets one. The plugin would otherwise send the webview
  origin (`http://tauri.localhost` on Windows and Android, `tauri://localhost` elsewhere, the
  dev-server URL in dev), which local servers reject. `httpFetch` sets `Origin: ''`, which the
  plugin drops under `unsafe-headers`. A caller's `Origin` and `Referer` are sent as set.
- `unsafe-headers` lifts the plugin's whole forbidden-header filter, not just `Origin`. `Host`,
  `Cookie`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Sec-*` and `Proxy-*` reach
  reqwest exactly as callers set them. Every caller is app code, so nothing sets these today. If
  untrusted input ever feeds request headers, `httpFetch` is where to filter them.
- `User-Agent` is `tauri-plugin-http/<version>` unless the caller sets one.
- No cookies: the `cookies` feature is off.
- Certificates are checked against the bundled webpki roots and, on Windows and Linux, the OS trust
  store. macOS, Android and iOS use the bundled roots only. The OS roots are only added as extra
  anchors, so a CA the OS distrusts or revokes is still accepted if the bundled set has it;
  plugin-http 3's platform verifier replaces this.
- `Accept-Encoding: gzip, br, zstd` is sent and responses are decoded in Rust before the WebView
  sees them.

Servers that check `Origin` themselves would reject the webview origin, so sending none matters:

- **Ollama** answers 403 to any request whose `Origin` is not on its allow-list
  (`envconfig/config.go`, `AllowedOrigins()`, enforced by gin-contrib/cors). The default list covers
  `tauri://*` and `http://localhost:*` but not `http://tauri.localhost`.
- **ComfyUI** without `--enable-cors-header` answers 403 when it listens on loopback and the
  `Origin` host differs from the `Host` header (`origin_only_middleware` in `server.py`).

Stock Ollama and ComfyUI on loopback work without `OLLAMA_ORIGINS` or `--enable-cors-header`,
because the helpers send no `Origin`.

## What the app runs

- `tauri-plugin-http` 2.9.0, crate and npm package, with default features off and `rustls-tls`
  (webpki roots, ring), `http2`, `charset`, `system-proxy`, `gzip`, `brotli`, `zstd` and
  `unsafe-headers` on; Windows and Linux add `rustls-tls-native-roots`. Not enabled: `cookies`,
  `dangerous-settings`. It pulls reqwest 0.12. The four `http:allow-fetch*`
  permissions in `src-tauri/capabilities/default.json` allow `http(s)://*` on any port, and
  `scopeRedirects` is off, which adds nothing under that scope.
- The app's own reqwest 0.13, shared with `tauri-plugin-updater`, serves LAN sync
  (`src-tauri/src/sync/commands.rs`) and the desktop updater. It uses the OS trust store and the
  process-wide ring provider installed in `src-tauri/src/lib.rs`; the note on `reqwest` in
  `src-tauri/Cargo.toml` explains why it has no provider of its own.

The plugin's npm package and crate must move together. A mismatch fails with invalid-argument
errors (upstream #2546); an open hang report (#2706) is suspected to be the same cause.

## The app's transport and the debug log

`loggedFetch` (`services/http/`) is the transport the app's own requests share: the request's
debug entry, the request guard (header and idle timeouts, abort mapping) and the response's entry.
The header timer stops when the headers arrive; every body after that, a buffered JSON completion
included, is bounded only by the idle timer. A non-streaming completion sends its headers early and
its body when generation finishes, so for it the idle timer is the whole generation's deadline: the
LLM timeout setting. The helpers are listed in
[network-requests.md](../development/network-requests.md).

Debug logging writes the whole response. The generic dispatcher (`services/http/debugLog.ts`)
writes status and body for JSON and text, status, type and size for binary (or untyped) bodies, and
the status and error body for a failure. A multipart request body is logged field by field: strings
as sent (long base64 scrubbed), a file as its name, type and size, a repeated key as an array.

Bodies are read with `readLoggedBody`, which never throws: a body that fails partway is logged with
its status, the reason, and the text that did arrive (`received`). The entry's error says how far
it got: `(headers received, no body yet)` or `(N bytes received)`. The poll transport
(`createPollSdkFetch`) reads the same way, keeping the partial text as the entry's `body`.

The AI SDK transports are the same dispatcher with Gemini safety metadata and stream aggregation
(`sdk/providers/debugLog.ts`, `streamLog.ts`). A stream is parsed as SSE and summarized as the one
body it would have been without streaming, by format: Anthropic Messages, OpenAI Responses, Chat
Completions (and its many compatible providers) and Gemini; any other format is the list of its
payloads, and a body with no SSE events is logged as text. `stream` records the format, the number
of events and whether the format's final event arrived; a stream cut off before it is logged with
what had arrived, `complete: false` and the last payload as `lastEvent` (`logSummary` in
`streamLog.ts` picks the error). Every read is of
a clone, taken only while debug mode is on. A reply the caller will cancel (a redirect under
`followRedirects: false`, an `allowStatuses` status) is logged by status alone, because a live clone
would keep the plugin's body open on the Rust side.

The log viewer's readable view (`debug.readableView`) renders escaped newlines as line breaks and
expands a string value that holds JSON (a structured-output reply's text) into the value it holds;
an entry with such a string gets a "JSON text" badge either way. An entry over the display limit is
trimmed value by value, with `… N more items` / `N more keys` / `… [N more chars]` markers, so the text stays valid
JSON; the readable view is for reading, not parsing. Export and the store hold the raw entries.

Entries are written to `stores/debugLog.ts`, a plain module with no runes or Tauri imports, so
transports and their tests need no store mock. `debug.svelte.ts` wraps it for reactivity and the
pop-out window.

## Not adopted

- **The WebView's `fetch`**, for the reasons above. Relaxing ATS and Android's cleartext policy
  would not change that: CORS still decides, and a second transport brings back failures that show
  up on one platform only.
- **A custom Rust streaming command** (a shared client and an IPC `Channel`). It would buy pooling,
  push-based streaming and OS roots, but we would own an HTTP stack and reimplement `fetch` for the
  AI SDK.
- **A custom URI scheme as a proxy.** A scheme handler responds with the whole body at once, so it
  cannot stream.
- **A localhost proxy server.** It opens a port that any local process can use.
- **Disabling web security in WebView2.** Windows only.
- **`tauri-plugin-cors-fetch`.** It patches the global `fetch` on top of the HTTP plugin, so it
  inherits every cost above and changes `fetch` for third-party code too. Small, single maintainer.
- **Connection reuse.** Upstream #3024 is open, and the setup cost is small next to generation time.
