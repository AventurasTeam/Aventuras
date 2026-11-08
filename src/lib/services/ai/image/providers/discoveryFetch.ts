// Helpers for the GET requests that list a provider's models.

import type { Fetch } from '#lib/services/ai/sdk/providers/index.ts'
import { imageGetFetch } from './fetchAdapter'

/** The `Authorization` header for a key, or none when there is no key. */
export const bearerHeaders = (key: string): { Authorization: string } | undefined =>
  key ? { Authorization: `Bearer ${key}` } : undefined

/** `fetch` with the key as a Bearer header on every request; with no key, `fetch` itself. */
export const withBearerKey = (fetch: Fetch, key: string): Fetch =>
  key
    ? (input, init) => {
        const headers = new Headers(init?.headers)
        headers.set('Authorization', `Bearer ${key}`)
        return fetch(input, { ...init, headers })
      }
    : fetch

/** A GET whose reply may be one of `absentStatuses`, meaning the host has no such route: `undefined`. */
export async function imageGetFetchOptional(
  url: string,
  headers: Record<string, string> | undefined,
  {
    absentStatuses,
    ...options
  }: NonNullable<Parameters<typeof imageGetFetch>[2]> & {
    absentStatuses?: number[]
  },
): Promise<Response | undefined> {
  const response = await imageGetFetch(url, headers, {
    ...options,
    allowStatuses: absentStatuses,
  })
  if (response.ok) return response
  // The plugin keeps an unread body open on the Rust side.
  await response.body?.cancel()
  return undefined
}
