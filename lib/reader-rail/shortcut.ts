// reader-composer.md → Open state: Cmd/Ctrl+\. `code` holds the physical key on layouts that
// type another character there; `key` covers layouts that type `\` elsewhere. AltGr reports as
// Ctrl+Alt, so `!altKey` keeps an AltGr-typed backslash as text.
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
