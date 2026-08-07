import { describe, expect, it } from 'vitest'

import { NARRATIVE_KINDS, promptProse } from './parse'

const withState = 'The knight drew his sword.\n<state><summary>A duel</summary></state>'
const withSuggestions =
  'The rain falls.\n<suggestions><item category="cat1">go north</item></suggestions>'

describe('promptProse', () => {
  it('strips a trailing state block from an ai_reply', () => {
    expect(promptProse({ kind: 'ai_reply', content: withState })).toBe('The knight drew his sword.')
  })

  it('strips a trailing suggestions block from an ai_reply', () => {
    expect(promptProse({ kind: 'ai_reply', content: withSuggestions })).toBe('The rain falls.')
  })

  it('strips both blocks from an opening', () => {
    const raw = `Dawn over the keep.\n${withState.split('\n')[1]}\n${withSuggestions.split('\n')[1]}`
    expect(promptProse({ kind: 'opening', content: raw })).toBe('Dawn over the keep.')
  })

  it('leaves narrative without a block untouched', () => {
    expect(promptProse({ kind: 'ai_reply', content: 'Just prose.' })).toBe('Just prose.')
  })

  // The cut is by tag position anywhere in the string, so a blanket strip would
  // truncate a user who happens to type the tag — losing their own words from
  // both the prompt buffer and Layer-A's same-name haystack.
  it('leaves a user_action that types a block tag intact', () => {
    const typed = 'I check the <state> of the door and then leave.'
    expect(promptProse({ kind: 'user_action', content: typed })).toBe(typed)
  })

  it('leaves a system entry intact', () => {
    const raw = `failure detail <state>x</state>`
    expect(promptProse({ kind: 'system', content: raw })).toBe(raw)
  })

  it('treats exactly the model-authored kinds as narrative', () => {
    expect([...NARRATIVE_KINDS].toSorted()).toEqual(['ai_reply', 'opening'])
  })
})
