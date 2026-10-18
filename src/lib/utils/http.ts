import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'

type HttpInit = NonNullable<Parameters<typeof tauriHttpFetch>[1]>

// With `unsafe-headers` the plugin drops an empty `Origin`; local servers reject the webview origin.
export async function httpFetch(input: string | URL, init: HttpInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('origin')) headers.set('origin', '')
  return tauriHttpFetch(input, { ...init, headers })
}
