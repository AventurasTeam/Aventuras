import { describe, expect, it } from 'vitest'

import type { StoryEntry } from '@/lib/db'

import { closeHereEntryIds } from './close-here-entries'

function row(id: string, kind: StoryEntry['kind'], chapterId: string | null = null) {
  return { id, kind, chapterId }
}

describe('closeHereEntryIds', () => {
  it('keeps the open region replies, the newest included', () => {
    expect(
      closeHereEntryIds([
        row('opening', 'opening'),
        row('closed_action', 'user_action', 'chap_1'),
        row('closed_reply', 'ai_reply', 'chap_1'),
        row('action', 'user_action'),
        row('reply', 'ai_reply'),
        row('failure', 'system'),
        row('head', 'ai_reply'),
      ]),
    ).toEqual({ reply: true, head: true })
  })

  it('is empty when the slice holds no open reply', () => {
    expect(
      closeHereEntryIds([row('opening', 'opening'), row('closed_reply', 'ai_reply', 'chap_1')]),
    ).toEqual({})
    expect(closeHereEntryIds([])).toEqual({})
  })
})
