// Helpers for the GET requests that list a provider's models.

import { imageGetFetch } from './fetchAdapter'

/** The `Authorization` header for a key, or none when there is no key. */
export const bearerHeaders = (key: string): { Authorization: string } | undefined =>
  key ? { Authorization: `Bearer ${key}` } : undefined

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
