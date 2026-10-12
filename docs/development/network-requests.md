# Network requests

**Rule.** Remote HTTP goes through Tauri's HTTP plugin, by way of one of the helpers below — never
the WebView's `fetch`. The WebView's `fetch` works in dev against an `https` host, then fails in an
Android release build or on iOS for a `http://` server, and wherever the server sends no CORS
headers. The reasoning and the data are in
[network-transport.md](../architecture/network-transport.md).

## Which helper

| Job                                                      | Use                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| An AI SDK provider                                       | `createTimeoutFetch` (`services/ai/sdk/providers/fetch.ts`); `registry.ts` injects it      |
| An image request to the configured server                | `imageFetch` (POST) or `imageGetFetch` (`services/ai/image/providers/fetchAdapter.ts`)     |
| An image URL a model returned                            | `fetchImageBase64` (`fetchAdapter.ts`)                                                     |
| A URL from a card or anywhere else the user did not type | `fetchPublicImageBase64`, which also checks each redirect hop against the public-host rule |
| Card discovery and Fandom                                | `corsFetch` (`services/discovery/utils.ts`)                                                |
| An SDK that takes no `fetch`                             | Patch its request method onto the plugin, as `comfy.ts` does with `fetchApi`               |
| A WebSocket                                              | `tauri-plugin-websocket` (`tauriWebSocket.ts`)                                             |

`createTimeoutFetch` reads the response as text before returning it, so it is for JSON and text
APIs only. Binary bodies (audio, images) need the plugin's `fetch` or an image helper.

## What the helpers do not do yet

- **An abort is not an `AbortError`.** Before the response the plugin rejects with a plain `Error`
  or a bare string, depending on timing, and a stream that is cut errors with a bare string. The
  messages are not spelled consistently (`Request cancelled`, `Request canceled`). Check
  `signal.aborted` first; do not rely on `error.name`, the message, or `isAbortError` alone.
- **The timeout stops at the response headers.** `llmTimeoutMs` and the image timeouts bound the
  time to the first response, not a stream that stalls afterwards.

## Rust side

The app's own reqwest (LAN sync, desktop updater) uses the OS trust store and the ring provider
installed in `src-tauri/src/lib.rs`. A new dependency or feature must not bring a second TLS
provider: `cargo tree -i aws-lc-rs` must find no package.
