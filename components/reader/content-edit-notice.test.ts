import { describe, expect, it } from 'vitest'

import { contentEditNoticeKey, resolveContentEditNotice } from './content-edit-notice'

const args = (over: Partial<Parameters<typeof resolveContentEditNotice>[0]> = {}) => ({
  hasMetadata: true,
  sceneEditable: false,
  hasSaveAndRegen: false,
  ...over,
})

describe('resolveContentEditNotice', () => {
  it('nudges on a row whose scene is editable', () => {
    expect(resolveContentEditNotice(args({ sceneEditable: true }))).toBe('scene-here')
  })

  it('nudges on the head turn, which is not itself the tail', () => {
    expect(resolveContentEditNotice(args({ hasSaveAndRegen: true }))).toBe('scene-here')
  })

  it('warns on an earlier row, where the scene is frozen', () => {
    expect(resolveContentEditNotice(args())).toBe('scene-frozen')
  })

  it('renders nothing where there is no scene state to diverge from', () => {
    expect(resolveContentEditNotice(args({ hasMetadata: false }))).toBeNull()
    expect(resolveContentEditNotice(args({ hasMetadata: false, sceneEditable: true }))).toBeNull()
  })
})

describe('contentEditNoticeKey', () => {
  it('drops the branch clause on a user_action, which has no branch action', () => {
    expect(contentEditNoticeKey('scene-frozen', 'user_action')).toBe(
      'reader:entryCard.editNoticeFrozenNoBranch',
    )
  })

  it('keeps the branch clause on kinds whose action cluster carries one', () => {
    expect(contentEditNoticeKey('scene-frozen', 'ai_reply')).toBe(
      'reader:entryCard.editNoticeFrozen',
    )
    expect(contentEditNoticeKey('scene-frozen', 'opening')).toBe(
      'reader:entryCard.editNoticeFrozen',
    )
  })

  it('uses one nudge for every kind — the remedy is the same wherever it applies', () => {
    expect(contentEditNoticeKey('scene-here', 'user_action')).toBe(
      'reader:entryCard.editNoticeSceneHere',
    )
    expect(contentEditNoticeKey('scene-here', 'ai_reply')).toBe(
      'reader:entryCard.editNoticeSceneHere',
    )
  })
})
