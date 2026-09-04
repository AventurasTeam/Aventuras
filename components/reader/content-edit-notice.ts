import type { EntryKind } from '@/components/compounds/entry-card'

export type ContentEditNotice = 'scene-here' | 'scene-frozen'

export type ContentEditNoticeKey =
  | 'reader:entryCard.editNoticeSceneHere'
  | 'reader:entryCard.editNoticeFrozen'
  | 'reader:entryCard.editNoticeFrozenNoBranch'

/**
 * Which divergence notice a row's content editor carries, or null when it carries
 * none (entry-card.md → Divergence notices).
 *
 * The axis is whether the branch's live scene is reachable from this row, not the
 * row's position. The head turn's `user_action` qualifies without being the tail:
 * its scene fields are inherited rather than authored, so the tail reply's editor
 * is the control for it, and `Save & regenerate` sits on it for the reply half.
 * A row with no metadata gets neither copy — there is no scene state to diverge from.
 */
export function resolveContentEditNotice(args: {
  hasMetadata: boolean
  sceneEditable: boolean
  hasSaveAndRegen: boolean
}): ContentEditNotice | null {
  if (!args.hasMetadata) return null
  return args.sceneEditable || args.hasSaveAndRegen ? 'scene-here' : 'scene-frozen'
}

/**
 * A `user_action` drops the branch clause: that kind carries no branch action, and
 * naming a control the card does not have is the failure the notice exists to prevent.
 */
export function contentEditNoticeKey(
  notice: ContentEditNotice,
  kind: EntryKind,
): ContentEditNoticeKey {
  if (notice === 'scene-here') return 'reader:entryCard.editNoticeSceneHere'
  return kind === 'user_action'
    ? 'reader:entryCard.editNoticeFrozenNoBranch'
    : 'reader:entryCard.editNoticeFrozen'
}
