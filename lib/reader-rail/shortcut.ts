// reader-composer.md → Open state. `code` covers layouts typing another character on that key,
// `key` those typing `\` elsewhere. `!altKey`: Windows AltGr reports Ctrl+Alt, so it stays text.
export function matchesRailToggleShortcut(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key' | 'code'>,
): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    (event.code === 'Backslash' || event.key === '\\')
  )
}
