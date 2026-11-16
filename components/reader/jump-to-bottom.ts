type BottomJumper = { jumpToBottom: (sliceKey: number) => void }

/**
 * Routes Jump to bottom to the mounted reader, naming the slice key it lands on. Native: expo's
 * DOM proxy's method is undefined until the document registers its handle; boot lands at bottom.
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
