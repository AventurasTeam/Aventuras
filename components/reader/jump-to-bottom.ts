type BottomJumper = { jumpToBottom: () => void }

/**
 * Routes Jump to bottom to the mounted reader. On native, expo's DOM proxy returns undefined for a
 * method until the document registers its handle, so a call before the first paint would throw;
 * the boot lands at the bottom anyway.
 */
export function routeJumpToBottom(
  platform: string,
  surface: BottomJumper | null,
  document: BottomJumper | null,
  documentPainted: boolean,
): void {
  if (platform === 'web') surface?.jumpToBottom()
  else if (documentPainted) document?.jumpToBottom()
}
