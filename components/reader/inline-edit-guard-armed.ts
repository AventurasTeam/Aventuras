/**
 * Whether a leave asks the editor first (reader-composer.md → Inline edit session): web, a reported
 * dirty draft; native, any open editor (a dirty report may still be crossing the bridge). Never
 * while held: the press already asked, and an armed guard would block the switch's stack reset.
 */
export function inlineEditGuardArmed(input: {
  platform: 'web' | 'native'
  /** The reader's `editSession`: null when no editor is open. */
  session: { dirty: boolean } | null
  held: boolean
}): boolean {
  if (input.held || input.session == null) return false
  return input.platform === 'web' ? input.session.dirty : true
}
