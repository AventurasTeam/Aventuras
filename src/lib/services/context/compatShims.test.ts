import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shimContext } from '../../../test/contextFixtures'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.resetModules()
})

describe('computeShims', () => {
  describe('tieredContextBlock (SHIM-01)', () => {
    it('contains [CURRENT LOCATION] section header', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'tieredContextBlock', 'adventure')
      expect(result.tieredContextBlock).toContain('[CURRENT LOCATION]')
    })

    it('contains fixture location name', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'tieredContextBlock', 'adventure')
      expect(result.tieredContextBlock).toContain('The Crossroads Inn')
    })

    it('contains [KNOWN CHARACTERS] section header', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'tieredContextBlock', 'adventure')
      expect(result.tieredContextBlock).toContain('[KNOWN CHARACTERS]')
    })

    it('contains fixture character name', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'tieredContextBlock', 'adventure')
      expect(result.tieredContextBlock).toContain('Aria')
    })
  })

  describe('chapterSummaries (SHIM-02)', () => {
    it('contains <story_history> wrapper tag', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'chapterSummaries', 'adventure')
      expect(result.chapterSummaries).toContain('<story_history>')
    })

    it('contains fixture chapter title', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'chapterSummaries', 'adventure')
      expect(result.chapterSummaries).toContain('The Beginning')
    })
  })

  describe('styleGuidance (SHIM-03)', () => {
    it('contains <style_guidance> wrapper tag', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'styleGuidance', 'adventure')
      expect(result.styleGuidance).toContain('<style_guidance>')
    })

    it('contains phrase from fixture styleReview', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'styleGuidance', 'adventure')
      expect(result.styleGuidance).toContain("Show don't tell")
    })

    it('returns empty string when styleReview.phrases is empty', async () => {
      const { computeShims } = await import('./compatShims')
      const emptyStyleContext = {
        styleReview: { phrases: [], tone: 'neutral', pacing: 'moderate' },
      }
      const result = computeShims(emptyStyleContext, 'styleGuidance', 'adventure')
      expect(result.styleGuidance).toBe('')
    })
  })

  describe('lorebookContext (SHIM-04)', () => {
    it('contains fixture lorebook entry name', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'lorebookContext', 'adventure')
      expect(result.lorebookContext).toContain('The Shadow Guild')
    })
  })

  describe('recentContext (SHIM-05)', () => {
    it('memory template: contains narration entry', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'recentContext', 'retrieval-decision')
      expect(result.recentContext).toContain('The torches flickered.')
    })

    it('memory template: does NOT contain user_action entry', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'recentContext', 'retrieval-decision')
      expect(result.recentContext).not.toContain('I draw my sword.')
    })

    it('action-choices template: contains narration entry', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'recentContext', 'action-choices')
      expect(result.recentContext).toContain('The torches flickered.')
    })

    it('action-choices template: contains user_action entry', async () => {
      const { computeShims } = await import('./compatShims')
      const result = computeShims(shimContext, 'recentContext', 'action-choices')
      expect(result.recentContext).toContain('I draw my sword.')
    })
  })
})
