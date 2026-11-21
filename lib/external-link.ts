/**
 * Where an external `aventuras://` link lands. Deep links are post-v1, and a link that pushed or
 * swapped a route would skip the story-leave guard, so a release build ignores them: a cold launch
 * opens the story list, a running app stays put. A dev build keeps them for the device loop.
 */
export function externalLinkPath(
  path: string,
  { initial, dev }: { initial: boolean; dev: boolean },
): string | null {
  if (dev) return path
  return initial ? '/' : null
}
