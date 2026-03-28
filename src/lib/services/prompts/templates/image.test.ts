import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import { promptContext, promptContextMinimal } from '../../../../test/fixtures/promptContext'

// ===== Template lookups =====

const imagePromptAnalysisTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'image-prompt-analysis')!
const imagePromptAnalysisReferenceTemplate = PROMPT_TEMPLATES.find(
  (t) => t.id === 'image-prompt-analysis-reference',
)!
const imagePortraitGenerationTemplate = PROMPT_TEMPLATES.find(
  (t) => t.id === 'image-portrait-generation',
)!
const backgroundImagePromptAnalysisTemplate = PROMPT_TEMPLATES.find(
  (t) => t.id === 'background-image-prompt-analysis',
)!

// ===== image-prompt-analysis =====

describe('image-prompt-analysis template', () => {
  it('renders character names from sceneCharacters filtered by presentCharacterNames', () => {
    // classificationResult.scene.presentCharacterNames = 'Kael,Aria'
    // characters = [Aria (portrait), Marcus (no portrait)]
    // Only Aria matches presentCharacterNames
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      ...promptContext,
    })
    expect(result).toContain('**Aria**:')
    expect(result).not.toContain('**Marcus**:')
  })

  it('renders visual descriptor values for Aria', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      ...promptContext,
    })
    expect(result).toContain('Silver, waist-length, braided')
    expect(result).toContain('Teal, sharp gaze')
  })

  it('renders maxImages from userSettings', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      ...promptContext,
    })
    // userSettings.imageGeneration.maxImages = 3
    expect(result).toContain('up to 3')
  })

  it('does not contain [object Object] in rendered content', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      ...promptContext,
    })
    expect(result).not.toContain('[object Object]')
  })

  it('does not contain {{ characterDescriptors }} literal', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      ...promptContext,
    })
    expect(result).not.toContain('{{ characterDescriptors }}')
  })

  it('renders without crash when characters is empty', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      ...promptContextMinimal,
    })
    expect(result).not.toBeNull()
    expect(result).not.toContain('**Aria**:')
  })

  it('does not render lorebookContext in userContent', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    // render may return null due to escaped Liquid syntax in template — null means no content
    expect(result ?? '').not.toContain('lorebookContext')
  })
})

// ===== image-prompt-analysis-reference =====

describe('image-prompt-analysis-reference template', () => {
  it('renders character descriptors via for-loop', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      ...promptContext,
    })
    expect(result).toContain('**Aria**:')
  })

  it('filters characters with portraits correctly — Aria appears in With Portraits section', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      ...promptContext,
    })
    // Aria has portrait, Marcus does not (and Marcus is filtered out by presentCharacterNames)
    const withPortraitsIdx = result!.indexOf('Characters With Portraits')
    const withoutPortraitsIdx = result!.indexOf('Characters Without Portraits')
    const ariaInWith = result!.indexOf('Aria', withPortraitsIdx)
    expect(ariaInWith).toBeGreaterThan(withPortraitsIdx)
    expect(ariaInWith).toBeLessThan(withoutPortraitsIdx)
  })

  it('does not contain {{ charactersWithPortraits }} literal', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      ...promptContext,
    })
    expect(result).not.toContain('{{ charactersWithPortraits }}')
  })

  it('does not contain {{ charactersWithoutPortraits }} literal', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      ...promptContext,
    })
    expect(result).not.toContain('{{ charactersWithoutPortraits }}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      ...promptContext,
    })
    expect(result).not.toContain('[object Object]')
  })

  it('shows None in Without Portraits section when all sceneCharacters have portraits', () => {
    // Aria is the only scene character (filtered by presentCharacterNames) and has a portrait
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      ...promptContext,
    })
    const withoutPortraitsIdx = result!.indexOf('Characters Without Portraits')
    const noneIdx = result!.indexOf('None', withoutPortraitsIdx)
    expect(noneIdx).toBeGreaterThan(withoutPortraitsIdx)
  })

  it('does not render lorebookContext in userContent', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.userContent!, {
      ...promptContext,
    })
    // render may return null due to escaped Liquid syntax in template — null means no content
    expect(result ?? '').not.toContain('lorebookContext')
  })
})

// ===== image-portrait-generation =====

describe('image-portrait-generation template', () => {
  const visualDescriptors = {
    face: 'Angular features, bronze skin',
    hair: 'Silver, waist-length',
    eyes: 'Teal, sharp',
    build: 'Tall, athletic',
  }

  it('renders individual descriptor fields', () => {
    const result = templateEngine.render(imagePortraitGenerationTemplate.content, {
      visualDescriptors,
      imageStylePrompt: 'Anime style',
    })
    expect(result).toContain('Angular features, bronze skin')
    expect(result).toContain('Silver, waist-length')
  })

  it('omits missing fields gracefully — no undefined for clothing/accessories/distinguishing', () => {
    const result = templateEngine.render(imagePortraitGenerationTemplate.content, {
      visualDescriptors,
      imageStylePrompt: 'Anime style',
    })
    expect(result).not.toContain('undefined')
    // Missing optional fields should not produce empty label entries
    expect(result).not.toMatch(/Clothing:\s*\./)
    expect(result).not.toMatch(/Accessories:\s*\./)
  })

  it('contains standing pose instructions', () => {
    const result = templateEngine.render(imagePortraitGenerationTemplate.content, {
      visualDescriptors,
      imageStylePrompt: 'Anime style',
    })
    expect(result).toContain('Standing in a relaxed natural pose')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(imagePortraitGenerationTemplate.content, {
      visualDescriptors,
      imageStylePrompt: 'Anime style',
    })
    expect(result).not.toContain('[object Object]')
  })

  it('renders without crash when visualDescriptors is empty object', () => {
    const result = templateEngine.render(imagePortraitGenerationTemplate.content, {
      visualDescriptors: {},
      imageStylePrompt: 'Anime style',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('Standing in a relaxed natural pose')
  })
})

// ===== background-image-prompt-analysis =====

describe('background-image-prompt-analysis template', () => {
  it('renders narration content from storyEntriesVisible', () => {
    // Template filters storyEntriesVisible by type == 'narration'
    // Fixture has 2 narration entries and 1 user_action entry
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    // last_narration = storyEntry3 (gate creaked)
    expect(result).toContain(
      'The gate creaked open, revealing a vast underground chamber lit by phosphorescent moss.',
    )
  })

  it('renders ##Current Message: section when multiple narrations exist', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    // With 2 narration entries, second_to_last_index = 0 >= 0, so Current Message section appears
    expect(result).toContain('##Current Message:')
  })

  it('contains section labels ##Previous Message: and ##Current Message:', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('##Previous Message:')
    expect(result).toContain('##Current Message:')
  })

  it('does not contain {{ previousResponse }} literal', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('{{ previousResponse }}')
  })

  it('does not contain {{ currentResponse }} literal', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('{{ currentResponse }}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('[object Object]')
  })

  it('edge case: single narration entry — only one section shows content', () => {
    const singleNarrationCtx = {
      ...promptContextMinimal,
      storyEntriesVisible: [
        { id: 's1', type: 'narration', content: 'The adventure begins.', timeStart: '' },
      ],
    }
    const result = templateEngine.render(
      backgroundImagePromptAnalysisTemplate.userContent!,
      singleNarrationCtx,
    )
    expect(result).toContain('The adventure begins.')
  })

  it('edge case: two narration entries — Previous Message shows last narration', () => {
    const twoNarrationCtx = {
      ...promptContextMinimal,
      storyEntriesVisible: [
        { id: 's1', type: 'narration', content: 'First message content.', timeStart: '' },
        { id: 's2', type: 'narration', content: 'Second message content.', timeStart: '' },
      ],
    }
    const result = templateEngine.render(
      backgroundImagePromptAnalysisTemplate.userContent!,
      twoNarrationCtx,
    )
    // last_narration is the second entry
    expect(result).toContain('Second message content.')
    expect(result).toContain('##Previous Message:')
  })
})
