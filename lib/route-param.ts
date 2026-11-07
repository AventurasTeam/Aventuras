/** What expo-router hands a route for one param: a string, a string[] when repeated, or nothing. */
export type RouteParam = string | string[] | undefined

/** One non-empty value, or nothing: a repeated or empty param names no row. */
export function singleParam(value: RouteParam): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}
