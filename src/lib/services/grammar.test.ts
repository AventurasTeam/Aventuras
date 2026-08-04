import { describe, it, expect } from 'vitest'
import { grammarService } from './grammar'

describe('GrammarService', () => {
  it('toggles enabled state correctly', () => {
    grammarService.setEnabled(false)
    expect(grammarService.isEnabled()).toBe(false)
    grammarService.setEnabled(true)
    expect(grammarService.isEnabled()).toBe(true)
  })

  it('applies suggestion replacements to text correctly', async () => {
    const text = 'The quick brwn fox'
    const issue = {
      message: 'Spelling error',
      problemText: 'brwn',
      start: 10,
      end: 14,
      suggestions: ['brown'],
      kind: 'Spelling',
    }

    const res = await grammarService.applySuggestion(text, issue, 0)
    expect(res).toBe('The quick brown fox')
  })
})
