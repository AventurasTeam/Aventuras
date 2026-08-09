import { describe, it, expect } from 'vitest'
import {
  prepareTTSSegments,
  resolveDialogueVoice,
  resolveTTSSanitizeOptions,
  stripExcludedCharacters,
  supportsDialogueVoice,
} from './ttsText'

const textSettings = {
  excludedCharacters: '*, #, _, ~',
  removeHtmlTags: false,
  removeAllHtmlContent: false,
  htmlTagsToRemoveContent: 'span, div',
}

describe('resolveTTSSanitizeOptions', () => {
  it('honours the user setting for a markdown story', () => {
    expect(resolveTTSSanitizeOptions(textSettings, false).removeTags).toBe(false)
    expect(
      resolveTTSSanitizeOptions({ ...textSettings, removeHtmlTags: true }, false).removeTags,
    ).toBe(true)
  })

  it('forces tag removal for Visual Prose, whatever the setting says', () => {
    // The stored content there is generated HTML including a <style> block; leaving
    // it to a toggle that defaults to false means markup gets read aloud, and its
    // attribute quotes get read as dialogue.
    expect(resolveTTSSanitizeOptions(textSettings, true).removeTags).toBe(true)
  })
})

describe('stripExcludedCharacters', () => {
  it('removes the listed characters', () => {
    expect(stripExcludedCharacters('a*b#c', '*, #')).toBe('abc')
  })

  it('is a no-op for an empty list', () => {
    expect(stripExcludedCharacters('a*b', '')).toBe('a*b')
  })

  it('escapes regex metacharacters in the list', () => {
    expect(stripExcludedCharacters('a-b]c', '-, ]')).toBe('abc')
  })
})

describe('supportsDialogueVoice / resolveDialogueVoice', () => {
  const base = { provider: 'openai', dialogueVoiceEnabled: true, dialogueVoice: 'nova' }

  it('rejects Google, where a voice is a language code', () => {
    expect(supportsDialogueVoice('google')).toBe(false)
    expect(resolveDialogueVoice({ ...base, provider: 'google' })).toBeUndefined()
  })

  it('returns the voice when enabled and set', () => {
    expect(resolveDialogueVoice(base)).toBe('nova')
  })

  it('falls back to one voice when disabled or unset', () => {
    expect(resolveDialogueVoice({ ...base, dialogueVoiceEnabled: false })).toBeUndefined()
    expect(resolveDialogueVoice({ ...base, dialogueVoice: '' })).toBeUndefined()
  })
})

describe('prepareTTSSegments', () => {
  const options = { narratorVoice: 'alloy', excludedCharacters: '*, #, _, ~' }

  it('keeps a single voice when no dialogue voice is configured', () => {
    expect(prepareTTSSegments('She said "run" and left.', options)).toEqual([
      { text: 'She said "run" and left.', voice: 'alloy' },
    ])
  })

  it('assigns the dialogue voice to quoted speech only', () => {
    expect(
      prepareTTSSegments('She said "run" and left.', { ...options, dialogueVoice: 'nova' }),
    ).toEqual([
      { text: 'She said', voice: 'alloy' },
      { text: '"run"', voice: 'nova' },
      { text: 'and left.', voice: 'alloy' },
    ])
  })

  it('strips excluded characters after splitting, so excluding a quote still works', () => {
    // This is the ordering the whole feature turns on: run the character filter
    // first and the quotes are gone before anything can split on them, collapsing
    // playback to one voice with no visible error.
    const segments = prepareTTSSegments('She said "run" now.', {
      narratorVoice: 'alloy',
      dialogueVoice: 'nova',
      excludedCharacters: '"',
    })

    expect(segments).toEqual([
      { text: 'She said', voice: 'alloy' },
      { text: 'run', voice: 'nova' },
      { text: 'now.', voice: 'alloy' },
    ])
  })

  it('drops whitespace-only segments rather than paying a request to say nothing', () => {
    const segments = prepareTTSSegments('"One." "Two."', {
      ...options,
      dialogueVoice: 'nova',
    })
    expect(segments).toEqual([
      { text: '"One."', voice: 'nova' },
      { text: '"Two."', voice: 'nova' },
    ])
  })

  it('returns nothing for text that is entirely excluded', () => {
    expect(prepareTTSSegments('***', options)).toEqual([])
    expect(prepareTTSSegments('', options)).toEqual([])
  })
})
