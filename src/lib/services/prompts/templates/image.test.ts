import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMockRef = vi.hoisted(() => ({ current: null as any }))

vi.mock('$lib/services/database', () => ({
  get database() {
    return dbMockRef.current
  },
}))

import {
  renderTemplate,
  createTemplateTestMock,
  testVariableInjection,
  testManifestCoverage,
} from '$test/helpers/templateTestHelper'
import { promptContext, promptContextMinimal } from '$test/fixtures/promptContext'
import {
  imagePromptAnalysisManifest,
  imagePromptAnalysisReferenceManifest,
  imagePortraitGenerationManifest,
  backgroundImagePromptAnalysisManifest,
} from '$test/fixtures/templateManifests'

beforeEach(() => {
  dbMockRef.current = createTemplateTestMock()
})

// ---------------------------------------------------------------------------
// image-prompt-analysis
// ---------------------------------------------------------------------------

describe('image-prompt-analysis', () => {
  describe('variable injection', () => {
    testVariableInjection(imagePromptAnalysisManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('renders character descriptors only for scene characters (filtered by presentCharacterNames)', async () => {
      const result = await renderTemplate('image-prompt-analysis', promptContext)
      expect(result.system).toContain('**Aria**:')
      expect(result.system).not.toContain('**Marcus**:')
    })

    it('renders no characters when characters array empty', async () => {
      const result = await renderTemplate('image-prompt-analysis', promptContextMinimal)
      expect(result.system).not.toContain('**Aria**:')
    })

    it('renders translation result when present', async () => {
      const result = await renderTemplate('image-prompt-analysis', promptContext)
      expect(result.user).toContain('French')
      expect(result.user).toContain("La porte s'est ouverte lentement")
    })
  })

  describe('array iteration', () => {
    it('renders visual descriptor nested fields', async () => {
      const result = await renderTemplate('image-prompt-analysis', promptContext)
      expect(result.system).toContain('Silver, waist-length, braided')
      expect(result.system).toContain('Teal, sharp gaze')
      expect(result.system).toContain('Angular features, bronze skin')
    })

    it('renders story entries in user content', async () => {
      const result = await renderTemplate('image-prompt-analysis', promptContext)
      expect(result.user).toContain('[ACTION]')
      expect(result.user).toContain('[NARRATIVE]')
    })
  })

  describe('filter behavior', () => {
    it('| contains filters characters by presentCharacterNames', async () => {
      const result = await renderTemplate('image-prompt-analysis', {
        ...promptContext,
        classificationResult: {
          ...promptContext.classificationResult,
          scene: { presentCharacterNames: ['Marcus'] },
        },
      })
      expect(result.system).not.toContain('**Aria**:')
      expect(result.system).toContain('**Marcus**:')
    })
  })

  describe('edge cases', () => {
    it('does not contain {{ characterDescriptors }} literal', async () => {
      const result = await renderTemplate('image-prompt-analysis', promptContext)
      expect(result.system).not.toContain('{{ characterDescriptors }}')
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('image-prompt-analysis', promptContext)
      expect(result.system).not.toContain('[object Object]')
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// image-prompt-analysis-reference
// ---------------------------------------------------------------------------

describe('image-prompt-analysis-reference', () => {
  describe('variable injection', () => {
    testVariableInjection(imagePromptAnalysisReferenceManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('Aria appears in With Portraits section (has portrait data)', async () => {
      const result = await renderTemplate('image-prompt-analysis-reference', promptContext)
      const withPortraitsIdx = result.system.indexOf('Characters With Portraits')
      const withoutPortraitsIdx = result.system.indexOf('Characters Without Portraits')
      const ariaInWith = result.system.indexOf('Aria', withPortraitsIdx)
      expect(ariaInWith).toBeGreaterThan(withPortraitsIdx)
      expect(ariaInWith).toBeLessThan(withoutPortraitsIdx)
    })

    it('shows None in Without Portraits when all scene characters have portraits', async () => {
      const result = await renderTemplate('image-prompt-analysis-reference', promptContext)
      const withoutPortraitsIdx = result.system.indexOf('Characters Without Portraits')
      const noneIdx = result.system.indexOf('None', withoutPortraitsIdx)
      expect(noneIdx).toBeGreaterThan(withoutPortraitsIdx)
    })

    it('renders translation result when present', async () => {
      const result = await renderTemplate('image-prompt-analysis-reference', promptContext)
      expect(result.user).toContain('French')
    })
  })

  describe('array iteration', () => {
    it('renders visual descriptor nested fields for scene characters', async () => {
      const result = await renderTemplate('image-prompt-analysis-reference', promptContext)
      expect(result.system).toContain('Silver, waist-length, braided')
    })
  })

  describe('edge cases', () => {
    it('does not contain old literal references', async () => {
      const result = await renderTemplate('image-prompt-analysis-reference', promptContext)
      expect(result.system).not.toContain('{{ charactersWithPortraits }}')
      expect(result.system).not.toContain('{{ charactersWithoutPortraits }}')
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('image-prompt-analysis-reference', promptContext)
      expect(result.system).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// image-portrait-generation
// ---------------------------------------------------------------------------

describe('image-portrait-generation', () => {
  describe('variable injection', () => {
    testVariableInjection(imagePortraitGenerationManifest, {})
  })

  describe('conditional sections', () => {
    it('omits missing descriptor fields gracefully', async () => {
      const result = await renderTemplate('image-portrait-generation', {
        visualDescriptors: { face: 'Angular features' },
        imageStylePrompt: 'Anime style',
      })
      expect(result.system).not.toContain('undefined')
      expect(result.system).not.toMatch(/Clothing:\s*\./)
    })

    it('renders all 7 descriptor fields when all present', async () => {
      const result = await renderTemplate('image-portrait-generation', {
        visualDescriptors: {
          face: 'Angular',
          hair: 'Silver',
          eyes: 'Teal',
          build: 'Tall',
          clothing: 'Leather',
          accessories: 'Pendant',
          distinguishing: 'Scar',
        },
        imageStylePrompt: 'Anime',
      })
      expect(result.system).toContain('Angular')
      expect(result.system).toContain('Silver')
      expect(result.system).toContain('Teal')
      expect(result.system).toContain('Tall')
      expect(result.system).toContain('Leather')
      expect(result.system).toContain('Pendant')
      expect(result.system).toContain('Scar')
    })
  })

  describe('edge cases', () => {
    it('renders with empty visualDescriptors object', async () => {
      const result = await renderTemplate('image-portrait-generation', {
        visualDescriptors: {},
        imageStylePrompt: 'Anime',
      })
      expect(result.system).toContain('Standing in a relaxed natural pose')
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('image-portrait-generation', {
        visualDescriptors: promptContext.characters[0].visualDescriptors,
        imageStylePrompt: 'Test',
      })
      expect(result.system).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// background-image-prompt-analysis
// ---------------------------------------------------------------------------

describe('background-image-prompt-analysis', () => {
  describe('variable injection', () => {
    testVariableInjection(backgroundImagePromptAnalysisManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('renders both Previous and Current Message sections with 2+ narrations', async () => {
      const result = await renderTemplate('background-image-prompt-analysis', promptContext)
      expect(result.user).toContain('##Previous Message:')
      expect(result.user).toContain('##Current Message:')
    })

    it('single narration entry — only Previous Message section', async () => {
      const result = await renderTemplate('background-image-prompt-analysis', {
        ...promptContextMinimal,
        storyEntriesVisible: [{ id: 's1', type: 'narration', content: 'The adventure begins.' }],
      })
      expect(result.user).toContain('The adventure begins.')
    })
  })

  describe('filter behavior', () => {
    it('| where filters to narration entries only (user_action excluded)', async () => {
      const result = await renderTemplate('background-image-prompt-analysis', promptContext)
      expect(result.user).not.toContain('I draw my sword')
    })
  })

  describe('edge cases', () => {
    it('does not contain old literal references', async () => {
      const result = await renderTemplate('background-image-prompt-analysis', promptContext)
      expect(result.user).not.toContain('{{ previousResponse }}')
      expect(result.user).not.toContain('{{ currentResponse }}')
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('background-image-prompt-analysis', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// Static style templates (no variables)
// ---------------------------------------------------------------------------

describe('static image style templates', () => {
  for (const templateId of [
    'image-style-photorealistic',
    'image-style-semi-realistic',
    'image-style-soft-anime',
  ]) {
    it(`${templateId} renders without error`, async () => {
      const result = await renderTemplate(templateId, {})
      expect(result.system.length).toBeGreaterThan(0)
    })
  }
})

// ---------------------------------------------------------------------------
// manifest coverage
// ---------------------------------------------------------------------------

describe('manifest coverage', () => {
  testManifestCoverage(imagePromptAnalysisManifest)
  testManifestCoverage(imagePromptAnalysisReferenceManifest)
  testManifestCoverage(imagePortraitGenerationManifest)
  testManifestCoverage(backgroundImagePromptAnalysisManifest)
})
