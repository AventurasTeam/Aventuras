import { httpFetch, loggedFetch } from '#lib/services/http/index.ts'

interface CorsFetchOptions extends RequestInit {
  /** Writes the request and response to the debug log under this service. Off unless given. */
  debug?: { serviceId: string }
}

export async function corsFetch(url: string, options?: CorsFetchOptions): Promise<Response> {
  // Tauri's fetch implementation automatically bypasses CORS
  // We wrap it just in case we need to add global headers or error handling later
  const { debug, ...init } = options ?? {}
  const request = {
    ...init,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...init.headers,
    },
  }
  try {
    return debug
      ? await loggedFetch(url, request, { serviceId: debug.serviceId, signal: init.signal })
      : await httpFetch(url, request)
  } catch (error) {
    console.error('[Discovery] Fetch error:', error)
    throw error
  }
}

export const GENERIC_ICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2NjY2NjIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMiAxMmgyMCIvPjxwYXRoIGQ9Ik0xMiAyYTE1LjMgMTUuMyAwIDAgMSA0IDEwIDE1LjMgMTUuMyAwIDAgMS00IDEwIDE1LjMgMTUuMyAwIDAgMS00LTEwIDE1LjMgMTUuMyAwIDAgMSA0LTEweiIvPjwvc3ZnPg=='
