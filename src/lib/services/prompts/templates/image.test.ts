import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'

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

// ===== Shared test data =====

const sceneCharacters = [
  {
    name: 'Elena',
    description: 'A skilled warrior',
    visualDescriptors: {
      face: 'Angular features, bronze skin',
      hair: 'Silver, waist-length, braided',
      eyes: 'Teal, sharp gaze',
      build: 'Tall, athletic',
      clothing: 'Dark leather armor',
      accessories: 'Silver pendant',
      distinguishing: 'Scar across left cheek',
    },
    portrait: 'data:image/png;base64,abc',
    traits: ['brave', 'determined'],
    relationship: 'ally',
    status: 'active',
  },
  {
    name: 'Marcus',
    description: 'An old mercenary',
    visualDescriptors: { face: 'Weathered, grey stubble', build: 'Stocky' },
    portrait: null,
    traits: [],
    relationship: 'companion',
    status: 'active',
  },
]

// ===== image-prompt-analysis =====

describe('image-prompt-analysis template', () => {
  it('renders character names from sceneCharacters array', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    expect(result).toContain('**Elena**:')
    expect(result).toContain('**Marcus**:')
  })

  it('renders visual descriptor values for Elena', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    expect(result).toContain('Silver, waist-length, braided')
    expect(result).toContain('Teal, sharp gaze')
  })

  it('renders partial descriptors for characters with fewer fields', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    expect(result).toContain('Weathered, grey stubble')
    expect(result).toContain('Stocky')
  })

  it('does not contain [object Object] in rendered content', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    expect(result).not.toContain('[object Object]')
  })

  it('does not contain {{ characterDescriptors }} literal', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    expect(result).not.toContain('{{ characterDescriptors }}')
  })

  it('renders without crash when sceneCharacters is empty', () => {
    const result = templateEngine.render(imagePromptAnalysisTemplate.content, {
      sceneCharacters: [],
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    expect(result).not.toBeNull()
    expect(result).not.toContain('**Elena**:')
    expect(result).not.toContain('**Marcus**:')
  })
})

// ===== image-prompt-analysis-reference =====

describe('image-prompt-analysis-reference template', () => {
  it('renders character descriptors via for-loop', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    expect(result).toContain('**Elena**:')
  })

  it('filters characters with portraits correctly — Elena appears in With Portraits section', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    // Elena has portrait, Marcus does not
    // With Portraits section comes before Without Portraits section
    const withPortraitsIdx = result!.indexOf('Characters With Portraits')
    const withoutPortraitsIdx = result!.indexOf('Characters Without Portraits')
    const elenaInWith = result!.indexOf('Elena', withPortraitsIdx)
    expect(elenaInWith).toBeGreaterThan(withPortraitsIdx)
    expect(elenaInWith).toBeLessThan(withoutPortraitsIdx)
  })

  it('filters characters without portraits correctly — Marcus appears in Without Portraits section', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    const withoutPortraitsIdx = result!.indexOf('Characters Without Portraits')
    const marcusIdx = result!.indexOf('Marcus', withoutPortraitsIdx)
    expect(marcusIdx).toBeGreaterThan(withoutPortraitsIdx)
  })

  it('does not contain {{ charactersWithPortraits }} literal', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    expect(result).not.toContain('{{ charactersWithPortraits }}')
  })

  it('does not contain {{ charactersWithoutPortraits }} literal', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    expect(result).not.toContain('{{ charactersWithoutPortraits }}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      sceneCharacters,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    expect(result).not.toContain('[object Object]')
  })

  it('shows None in Without Portraits section when all characters have portraits', () => {
    const allWithPortraits = sceneCharacters.map((c) => ({
      ...c,
      portrait: 'data:image/png;base64,xyz',
    }))
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      sceneCharacters: allWithPortraits,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    const withoutPortraitsIdx = result!.indexOf('Characters Without Portraits')
    const noneIdx = result!.indexOf('None', withoutPortraitsIdx)
    expect(noneIdx).toBeGreaterThan(withoutPortraitsIdx)
  })

  it('shows None in With Portraits section when no characters have portraits', () => {
    const noneWithPortraits = sceneCharacters.map((c) => ({ ...c, portrait: null }))
    const result = templateEngine.render(imagePromptAnalysisReferenceTemplate.content, {
      sceneCharacters: noneWithPortraits,
      maxImages: 3,
      imageStylePrompt: 'Anime style',
    })
    const withPortraitsIdx = result!.indexOf('Characters With Portraits')
    const withoutPortraitsIdx = result!.indexOf('Characters Without Portraits')
    const noneInWith = result!.indexOf('None', withPortraitsIdx)
    expect(noneInWith).toBeGreaterThan(withPortraitsIdx)
    expect(noneInWith).toBeLessThan(withoutPortraitsIdx)
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
  const narrationEntries = [
    { type: 'narration', content: 'The sun set over the mountains.' },
    { type: 'narration', content: 'Rain pattered against the window.' },
    { type: 'narration', content: 'The castle gates opened slowly.' },
  ]
  const lastNarrationIndex = 2

  it('renders current message from last narrationEntries entry', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      narrationEntries,
      lastNarrationIndex,
    })
    expect(result).toContain('The castle gates opened slowly.')
  })

  it('renders previous message from second-to-last narrationEntries entry', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      narrationEntries,
      lastNarrationIndex,
    })
    expect(result).toContain('Rain pattered against the window.')
  })

  it('contains section labels ##Previous Message: and ##Current Message:', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      narrationEntries,
      lastNarrationIndex,
    })
    expect(result).toContain('##Previous Message:')
    expect(result).toContain('##Current Message:')
  })

  it('does not contain {{ previousResponse }} literal', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      narrationEntries,
      lastNarrationIndex,
    })
    expect(result).not.toContain('{{ previousResponse }}')
  })

  it('does not contain {{ currentResponse }} literal', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      narrationEntries,
      lastNarrationIndex,
    })
    expect(result).not.toContain('{{ currentResponse }}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      narrationEntries,
      lastNarrationIndex,
    })
    expect(result).not.toContain('[object Object]')
  })

  it('edge case: single entry — previous message section is empty, current shows entry content', () => {
    const singleEntry = [{ type: 'narration', content: 'The adventure begins.' }]
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      narrationEntries: singleEntry,
      lastNarrationIndex: 0,
    })
    expect(result).toContain('The adventure begins.')
    // prevIdx would be -1, so the previous section should be empty (condition prevIdx >= 0 is false)
    expect(result).not.toContain('The adventure begins.\n\n##Current Message:')
    // Current message should have the content
    const currentIdx = result!.indexOf('##Current Message:')
    expect(result!.indexOf('The adventure begins.', currentIdx)).toBeGreaterThan(currentIdx)
  })

  it('edge case: two entries — both sections populated correctly', () => {
    const twoEntries = [
      { type: 'narration', content: 'First message content.' },
      { type: 'narration', content: 'Second message content.' },
    ]
    const result = templateEngine.render(backgroundImagePromptAnalysisTemplate.userContent!, {
      narrationEntries: twoEntries,
      lastNarrationIndex: 1,
    })
    expect(result).toContain('First message content.')
    expect(result).toContain('Second message content.')
    const prevIdx = result!.indexOf('##Previous Message:')
    const currIdx = result!.indexOf('##Current Message:')
    expect(result!.indexOf('First message content.', prevIdx)).toBeGreaterThan(prevIdx)
    expect(result!.indexOf('Second message content.', currIdx)).toBeGreaterThan(currIdx)
  })
})
