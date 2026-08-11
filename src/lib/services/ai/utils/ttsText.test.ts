import { describe, it, expect } from 'vitest'
import {
  prepareTTSSegments,
  resolveDialogueVoice,
  resolveTTSSanitizeOptions,
  stripExcludedCharacters,
  supportsDialogueVoice,
} from './ttsText'
import { buildChunks } from './TTSService'

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

  it('treats a hyphen between two characters as a literal, not a range', () => {
    // `escapeRegex` leaves `-` alone, so `[\*-~]` was a range over printable ASCII
    // and erased the whole entry — silently, since playback simply found nothing to
    // say. The list order is the only thing that used to make this safe.
    expect(stripExcludedCharacters('The captain said hello, 42 times.', '*, -, ~')).toBe(
      'The captain said hello, 42 times.',
    )
    expect(stripExcludedCharacters('a-b', '*, -, ~')).toBe('ab')
    expect(stripExcludedCharacters('Hello World 123', 'a,-,z')).toBe('Hello World 123')
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

  it('never emits a punctuation-only segment', () => {
    // Reported bug: the full stop belonging to the sentence sits outside the closing
    // quote, so it became a narrator segment holding just ".". The provider rejects
    // that input, and after its retries the failure takes down playback of the whole
    // entry — not just the fragment.
    const segments = prepareTTSSegments(
      '"i am a man of my word. no torture." i say "But, letting you go, has never been an option". "this.. \'Anchor\'.. why is the.."',
      { ...options, dialogueVoice: 'nova' },
    )

    expect(segments).toEqual([
      { text: '"i am a man of my word. no torture."', voice: 'nova' },
      { text: 'i say', voice: 'alloy' },
      { text: '"But, letting you go, has never been an option".', voice: 'nova' },
      { text: '"this.. \'Anchor\'.. why is the.."', voice: 'nova' },
    ])
    expect(segments.every((s) => /[\p{L}\p{N}]/u.test(s.text))).toBe(true)
  })

  it('drops punctuation with nothing before it to attach to', () => {
    expect(prepareTTSSegments('... "Who?"', { ...options, dialogueVoice: 'nova' })).toEqual([
      { text: '"Who?"', voice: 'nova' },
    ])
  })

  it('returns nothing for text that is entirely excluded', () => {
    expect(prepareTTSSegments('***', options)).toEqual([])
    expect(prepareTTSSegments('', options)).toEqual([])
  })
})

describe('buildChunks', () => {
  it('keeps the segment voice on every chunk a long quote is split into', () => {
    // A speech longer than the provider's limit is split into several requests; each
    // one has to carry the dialogue voice, or a long line switches back to the
    // narrator part-way through.
    const longQuote = `"${'She spoke at length about the ruins. '.repeat(20)}"`
    const segments = prepareTTSSegments(`He waited. ${longQuote} Then silence.`, {
      narratorVoice: 'alloy',
      dialogueVoice: 'nova',
      excludedCharacters: '',
    })

    const chunks = buildChunks(segments, 100)

    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.filter((c) => c.voice === 'nova').length).toBeGreaterThan(3)
    expect(new Set(chunks.map((c) => c.voice))).toEqual(new Set(['alloy', 'nova']))
  })

  it('drops a chunk with nothing pronounceable in it', () => {
    expect(buildChunks([{ text: '...', voice: 'alloy' }], 100)).toEqual([])
  })
})
