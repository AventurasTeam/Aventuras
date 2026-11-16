type BottomJumper = { jumpToBottom: (sliceKey: number) => void }

/**
 * Routes Jump to bottom to the mounted reader, naming the slice key it lands on. On native, expo's
 * DOM proxy returns undefined for a method until the document registers its handle, so a call
 * before the first paint would throw; the boot lands at the bottom anyway.
 */
export function routeJumpToBottom(
  platform: string,
  surface: BottomJumper | null,
  document: BottomJumper | null,
  documentPainted: boolean,
  sliceKey: number,
): void {
  if (platform === 'web') surface?.jumpToBottom(sliceKey)
  else if (documentPainted) document?.jumpToBottom(sliceKey)
}
