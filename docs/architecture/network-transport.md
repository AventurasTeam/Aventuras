# Network transport

Why remote HTTP goes through Tauri's HTTP plugin rather than the WebView's `fetch`, and what that
costs. The rules for writing a request are in
[network-requests.md](../development/network-requests.md).

## The decision

Remote HTTP from the WebView goes through `@tauri-apps/plugin-http`: its `fetch` runs the request
in Rust with reqwest and hands the response back over IPC. The WebView's own `window.fetch` is not
used for remote hosts.

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

As of `tauri-plugin-http` 2.8.2.

|                 | `plugin-http`                                                                                                                                                                                                                 | WebView `fetch`                                                                                                                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CORS            | Not enforced, but `Origin` is still sent, and a server that checks it itself still rejects the request (see [What the server sees](#what-the-server-sees))                                                                    | The server must allow `http://tauri.localhost` (Windows, Android) or `tauri://localhost` (macOS, iOS, Linux). Anthropic also needs `anthropic-dangerous-direct-browser-access`; LM Studio has CORS off by default; stock Ollama allows `tauri://*` but not `http://tauri.localhost` |
| Plain `http://` | Unaffected                                                                                                                                                                                                                    | Blocked in Android release builds, and by ATS on iOS and macOS except for local host names; mixed content if `useHttpsScheme` is on                                                                                                                                                 |
| Allowed hosts   | Capability URL scopes (ours are `http(s)://*`)                                                                                                                                                                                | CSP `connect-src` (ours is `csp: null`)                                                                                                                                                                                                                                             |
| Headers         | Forbidden list dropped (`Origin`, `Referer`, `Cookie`, `Host`, `Accept-Encoding`, `sec-*`, `proxy-*`, …) unless `unsafe-headers`; `Origin` always sent; `User-Agent` can be set and defaults to `tauri-plugin-http/<version>` | Browser forbidden list; Chromium drops `User-Agent`                                                                                                                                                                                                                                 |
| Cookies         | Its own jar, shared by every host and persisted to `.cookies` in the app cache directory; `set-cookie` is readable                                                                                                            | The WebView's jar                                                                                                                                                                                                                                                                   |
| HTTP cache      | None                                                                                                                                                                                                                          | Native                                                                                                                                                                                                                                                                              |
| Proxy           | OS proxy on Windows and macOS (`system-proxy`), or a per-request `proxy` option                                                                                                                                               | OS proxy and PAC                                                                                                                                                                                                                                                                    |
| Streaming       | `ReadableStream`, pull-based, one IPC round trip per reqwest chunk, raw bytes (since 2.4.0)                                                                                                                                   | Native, no IPC                                                                                                                                                                                                                                                                      |
| Abort           | Cancels the Rust request, including mid-stream (since 2.5.5), but never rejects with an `AbortError`                                                                                                                          | Standard `AbortError`                                                                                                                                                                                                                                                               |
| Connections     | A new reqwest `Client` per request: no keep-alive, no HTTP/2 reuse (upstream #3024, open)                                                                                                                                     | Pooled                                                                                                                                                                                                                                                                              |
| Request body    | Buffered, then sent as a JSON number array (`Array.from(new Uint8Array(buf))`), several times its size in the WebView heap                                                                                                    | Native                                                                                                                                                                                                                                                                              |
| TLS roots       | Bundled webpki roots, not the OS store                                                                                                                                                                                        | OS store                                                                                                                                                                                                                                                                            |
| Compression     | `gzip`/`brotli`/`zstd` features are off, so responses arrive uncompressed                                                                                                                                                     | Native                                                                                                                                                                                                                                                                              |
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

- Every request carries `Origin` set to the webview origin: `http://tauri.localhost` on Windows and
  Android, `tauri://localhost` elsewhere, the dev-server URL in dev. It cannot be dropped, or set by
  the caller, without the `unsafe-headers` feature. A caller's `Referer` is dropped the same way.
- `User-Agent` is `tauri-plugin-http/<version>` unless the caller sets one.
- Cookies set by an earlier response are sent back, including ones from a previous run.
- Certificates are checked against bundled webpki roots, so a home CA or a corporate
  TLS-inspection certificate that the OS trusts is rejected.
- No `Accept-Encoding` is sent and responses arrive uncompressed.

Servers that check `Origin` themselves reject the plugin as they would the WebView:

- **Ollama** answers 403 to any request whose `Origin` is not on its allow-list
  (`envconfig/config.go`, `AllowedOrigins()`, enforced by gin-contrib/cors). The default list covers
  `tauri://*` and `http://localhost:*` but not `http://tauri.localhost`, so stock Ollama rejects
  Windows and Android until the user sets `OLLAMA_ORIGINS=http://tauri.localhost`.
- **ComfyUI** without `--enable-cors-header` answers 403 when it listens on loopback and the
  `Origin` host differs from the `Host` header (`origin_only_middleware` in `server.py`). The image
  settings tell the user to start it with that flag.

## What the app runs

- `tauri-plugin-http` 2.8.2, crate and npm package, with default features: `rustls-tls` (webpki
  roots, ring), `http2`, `charset`, `system-proxy` and `cookies`. Not enabled: `unsafe-headers`,
  `dangerous-settings`, decompression. It pulls reqwest 0.12. The four `http:allow-fetch*`
  permissions in `src-tauri/capabilities/default.json` allow `http(s)://*` on any port, and
  `scopeRedirects` is off, which adds nothing under that scope.
- `tauri-plugin-websocket` for the ComfyUI socket. It uses `tokio-tungstenite` with webpki roots.
- The app's own reqwest 0.13, shared with `tauri-plugin-updater`, serves LAN sync
  (`src-tauri/src/sync/commands.rs`) and the desktop updater. It uses the OS trust store and the
  process-wide ring provider installed in `src-tauri/src/lib.rs`; the note on `reqwest` in
  `src-tauri/Cargo.toml` explains why it has no provider of its own.

The plugin's npm package and crate must move together. A mismatch fails with invalid-argument
errors (upstream #2546); an open hang report (#2706) is suspected to be the same cause.

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
