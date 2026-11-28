# Network requests

**Rule.** Remote HTTP goes through Tauri's HTTP plugin, by way of one of the helpers below — never
the WebView's `fetch`. The WebView's `fetch` works in dev against an `https` host, then fails in an
Android release build or on iOS for a `http://` server, and wherever the server sends no CORS
headers. The reasoning and the data are in
[network-transport.md](../architecture/network-transport.md).

## Which helper

| Job                                                      | Use                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| An AI SDK provider                                       | `createTimeoutFetch` (`services/ai/sdk/providers/fetch.ts`); `registry.ts` injects it                  |
| An SDK image model                                       | `createSdkFetch` (`sdkFetch.ts`); a poll, `createPollSdkFetch`, which logs it as one entry             |
| Image model discovery or a GET to the configured server  | `imageGetFetch` (`services/ai/image/providers/fetchAdapter.ts`)                                        |
| A URL from a card or anywhere else the user did not type | `fetchPublicImageBase64`, which also checks each redirect hop against the public-host rule             |
| Card discovery, Fandom and other plain GETs              | `corsFetch` (`services/discovery/utils.ts`); it logs nothing unless passed `debug`                     |
| Any other request of the app's own                       | `loggedFetch` (`services/http/`), which the helpers above are built on (`corsFetch` only with `debug`) |

`httpFetch` (`services/http/httpFetch.ts`) is the only way into the plugin, and an ESLint rule
rejects any other import of its `fetch`: it drops the webview `Origin` that local servers reject.
Call it directly only for a request that should not be logged, as `updater.ts` and the model-health
ping do.

`createTimeoutFetch` buffers only a JSON success, to patch its usage; errors and streams go back to
the SDK unread. Read every logged body with `readLoggedBody`, which never throws.

## Aborts and timeouts

- **A timeout makes an abort an `AbortError`.** `loggedFetch` given a `timeoutMs` wraps the request
  in a request guard, which maps a caller's abort to an `AbortError` and its own timeout to a
  `RequestTimeoutError`. Without one, the plugin rejects with
  a plain `Error` or a bare string, depending on timing, and a stream that is cut errors with a
  bare string ([network-transport.md](../architecture/network-transport.md#how-the-two-differ)).
  There, check `signal.aborted` first; do not rely on `error.name` or the message.
- **The header timer stops at the headers; the idle timer bounds the body.** A non-streaming
  completion sends its headers early and its body when generation finishes, so for it the idle
  timer is the whole generation's deadline: the LLM timeout setting.

## Rust side

The app's own reqwest (LAN sync, desktop updater) uses the OS trust store and the ring provider
installed in `src-tauri/src/lib.rs`. A new dependency or feature must not bring a second TLS
provider: `cargo tree -i aws-lc-rs` must find no package.
