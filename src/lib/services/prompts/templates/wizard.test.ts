import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'

// ===== Template references =====

const settingExpansion = PROMPT_TEMPLATES.find((t) => t.id === 'setting-expansion')!
const settingRefinement = PROMPT_TEMPLATES.find((t) => t.id === 'setting-refinement')!
const protagonistGeneration = PROMPT_TEMPLATES.find((t) => t.id === 'protagonist-generation')!
const characterElaboration = PROMPT_TEMPLATES.find((t) => t.id === 'character-elaboration')!
const characterRefinement = PROMPT_TEMPLATES.find((t) => t.id === 'character-refinement')!
const supportingCharacters = PROMPT_TEMPLATES.find((t) => t.id === 'supporting-characters')!
const openingGenAdventure = PROMPT_TEMPLATES.find((t) => t.id === 'opening-generation-adventure')!
const openingGenCreative = PROMPT_TEMPLATES.find((t) => t.id === 'opening-generation-creative')!
const openingRefAdventure = PROMPT_TEMPLATES.find((t) => t.id === 'opening-refinement-adventure')!
const openingRefCreative = PROMPT_TEMPLATES.find((t) => t.id === 'opening-refinement-creative')!
const characterCardImport = PROMPT_TEMPLATES.find((t) => t.id === 'character-card-import')!
const vaultCharacterImport = PROMPT_TEMPLATES.find((t) => t.id === 'vault-character-import')!

// ===== Shared base fixture shapes =====

const emptyLorebookEntries: never[] = []

const emptyCurrentSetting = {
  name: '',
  description: '',
  atmosphere: '',
  themes: [],
  potentialConflicts: [],
  keyLocations: [],
}

const emptyCurrentCharacter = {
  name: '',
  description: '',
  background: '',
  motivation: '',
  traits: [],
  appearance: '',
}

const emptyCharacterInput = {
  name: '',
  description: '',
  background: '',
  motivation: '',
  traits: [],
}

const emptyProtagonist = {
  name: '',
  description: '',
  motivation: '',
}

const emptyCurrentOpening = {
  title: '',
  scene: '',
  initialLocation: { name: '', description: '' },
}

// ===== setting-expansion =====

describe('setting-expansion template', () => {
  const base = {
    genreLabel: '',
    seed: '',
    lorebookEntries: emptyLorebookEntries,
    customInstruction: '',
  }

  describe('variable injection', () => {
    it('renders genreLabel in userContent', () => {
      const result = templateEngine.render(settingExpansion.userContent!, {
        ...base,
        genreLabel: 'fantasy',
      })
      expect(result).toContain('fantasy')
    })

    it('renders seed in userContent', () => {
      const result = templateEngine.render(settingExpansion.userContent!, {
        ...base,
        seed: 'A city built on the back of a sleeping giant',
      })
      expect(result).toContain('A city built on the back of a sleeping giant')
    })
  })

  describe('conditional suppression', () => {
    it('Established lore section absent when lorebookEntries empty', () => {
      const result = templateEngine.render(settingExpansion.userContent!, { ...base })
      expect(result).not.toContain('Established lore')
    })

    it('Established lore section present when lorebookEntries has items', () => {
      const result = templateEngine.render(settingExpansion.userContent!, {
        ...base,
        lorebookEntries: [{ name: 'The Keep', type: 'location', description: 'A dark fortress.' }],
      })
      expect(result).toContain('Established lore')
      expect(result).toContain('The Keep')
    })

    it('customInstruction block absent when empty', () => {
      const result = templateEngine.render(settingExpansion.content, { ...base })
      expect(result).not.toContain("AUTHOR'S GUIDANCE")
    })

    it('customInstruction block present when provided', () => {
      const result = templateEngine.render(settingExpansion.content, {
        ...base,
        customInstruction: 'Make it dark and gritty.',
      })
      expect(result).toContain("AUTHOR'S GUIDANCE")
      expect(result).toContain('Make it dark and gritty.')
    })
  })

  describe('array iteration', () => {
    it('renders multiple lorebook entries', () => {
      const result = templateEngine.render(settingExpansion.userContent!, {
        ...base,
        lorebookEntries: [
          { name: 'The Keep', type: 'location', description: 'A dark fortress.' },
          { name: 'Elder Drake', type: 'character', description: 'Ancient dragon.' },
        ],
      })
      expect(result).toContain('The Keep')
      expect(result).toContain('Elder Drake')
      expect(result).not.toContain('[object Object]')
    })

    it('renders hiddenInfo when present', () => {
      const result = templateEngine.render(settingExpansion.userContent!, {
        ...base,
        lorebookEntries: [
          {
            name: 'Vault',
            type: 'location',
            description: 'A sealed room.',
            hiddenInfo: 'Contains the crown.',
          },
        ],
      })
      expect(result).toContain('Hidden lore')
      expect(result).toContain('Contains the crown.')
    })
  })

  describe('no crash', () => {
    it('renders without crash on empty base', () => {
      const result = templateEngine.render(settingExpansion.userContent!, { ...base })
      expect(result).not.toBeNull()
      expect(result).not.toContain('{%')
      expect(result).not.toContain('{{')
    })
  })
})

// ===== setting-refinement =====

describe('setting-refinement template', () => {
  const base = {
    genreLabel: '',
    currentSetting: emptyCurrentSetting,
    lorebookEntries: emptyLorebookEntries,
    customInstruction: '',
  }

  describe('variable injection', () => {
    it('renders currentSetting.name', () => {
      const result = templateEngine.render(settingRefinement.userContent!, {
        ...base,
        currentSetting: { ...emptyCurrentSetting, name: 'The Shattered Isles' },
      })
      expect(result).toContain('The Shattered Isles')
    })

    it('renders currentSetting.atmosphere when present', () => {
      const result = templateEngine.render(settingRefinement.userContent!, {
        ...base,
        currentSetting: { ...emptyCurrentSetting, atmosphere: 'Brooding and oppressive' },
      })
      expect(result).toContain('Brooding and oppressive')
    })

    it('renders themes joined with comma', () => {
      const result = templateEngine.render(settingRefinement.userContent!, {
        ...base,
        currentSetting: {
          ...emptyCurrentSetting,
          themes: ['survival', 'betrayal', 'redemption'],
        },
      })
      expect(result).toContain('survival, betrayal, redemption')
      expect(result).not.toContain('[object Object]')
    })
  })

  describe('conditional suppression', () => {
    it('lorebook section absent when empty', () => {
      const result = templateEngine.render(settingRefinement.userContent!, { ...base })
      expect(result).not.toContain('Established lore')
    })

    it('lorebook section present when populated', () => {
      const result = templateEngine.render(settingRefinement.userContent!, {
        ...base,
        lorebookEntries: [{ name: 'Iron Pact', type: 'faction', description: 'A trade alliance.' }],
      })
      expect(result).toContain('Established lore')
      expect(result).toContain('Iron Pact')
    })

    it('customInstruction absent when empty', () => {
      const result = templateEngine.render(settingRefinement.content, { ...base })
      expect(result).not.toContain("AUTHOR'S GUIDANCE")
    })

    it('customInstruction present when provided', () => {
      const result = templateEngine.render(settingRefinement.content, {
        ...base,
        customInstruction: 'Emphasize the cold climate.',
      })
      expect(result).toContain("AUTHOR'S GUIDANCE")
      expect(result).toContain('Emphasize the cold climate.')
    })
  })

  describe('array iteration', () => {
    it('renders keyLocations via for loop', () => {
      const result = templateEngine.render(settingRefinement.userContent!, {
        ...base,
        currentSetting: {
          ...emptyCurrentSetting,
          keyLocations: [
            { name: 'The Market', description: 'A bustling trade hub.' },
            { name: 'The Citadel', description: 'Where the council meets.' },
          ],
        },
      })
      expect(result).toContain('The Market')
      expect(result).toContain('The Citadel')
      expect(result).toContain('A bustling trade hub.')
      expect(result).not.toContain('[object Object]')
    })
  })

  describe('no crash', () => {
    it('renders without crash on empty base', () => {
      const result = templateEngine.render(settingRefinement.userContent!, { ...base })
      expect(result).not.toBeNull()
      expect(result).not.toContain('{%')
    })
  })
})

// ===== protagonist-generation =====

describe('protagonist-generation template', () => {
  const base = {
    genreLabel: '',
    settingName: '',
    settingDescription: '',
    settingAtmosphere: '',
    settingThemesText: '',
    pov: 'third',
  }

  describe('variable injection', () => {
    it('renders settingName', () => {
      const result = templateEngine.render(protagonistGeneration.userContent!, {
        ...base,
        settingName: 'The Ashen Coast',
      })
      expect(result).toContain('The Ashen Coast')
    })

    it('renders settingDescription', () => {
      const result = templateEngine.render(protagonistGeneration.userContent!, {
        ...base,
        settingDescription: 'A bleak shoreline haunted by old wars.',
      })
      expect(result).toContain('A bleak shoreline haunted by old wars.')
    })
  })

  describe('POV branches', () => {
    it('renders first-person text when pov is first', () => {
      const result = templateEngine.render(protagonistGeneration.userContent!, {
        ...base,
        pov: 'first',
      })
      expect(result).toContain('First person')
      expect(result).toContain('I/me/my')
    })

    it('renders second-person text when pov is second', () => {
      const result = templateEngine.render(protagonistGeneration.userContent!, {
        ...base,
        pov: 'second',
      })
      expect(result).toContain('Second person')
      expect(result).toContain('You/your')
    })

    it('renders third-person text when pov is third', () => {
      const result = templateEngine.render(protagonistGeneration.userContent!, {
        ...base,
        pov: 'third',
      })
      expect(result).toContain('Third person')
      expect(result).toContain('he/she/they')
    })
  })

  describe('conditional suppression', () => {
    it('atmosphere section absent when empty', () => {
      const result = templateEngine.render(protagonistGeneration.userContent!, { ...base })
      expect(result).not.toContain('ATMOSPHERE:')
    })

    it('atmosphere section present when provided', () => {
      const result = templateEngine.render(protagonistGeneration.userContent!, {
        ...base,
        settingAtmosphere: 'Dark and foreboding',
      })
      expect(result).toContain('ATMOSPHERE:')
      expect(result).toContain('Dark and foreboding')
    })
  })

  describe('no crash', () => {
    it('renders without crash on empty base', () => {
      const result = templateEngine.render(protagonistGeneration.userContent!, { ...base })
      expect(result).not.toBeNull()
      expect(result).not.toContain('{%')
    })
  })
})

// ===== character-elaboration =====

describe('character-elaboration template', () => {
  const base = {
    genreLabel: '',
    characterInput: emptyCharacterInput,
    settingContext: '',
    toneInstruction: '',
    settingInstruction: '',
    customInstruction: '',
  }

  describe('variable injection', () => {
    it('renders characterInput.name when provided', () => {
      const result = templateEngine.render(characterElaboration.userContent!, {
        ...base,
        characterInput: { ...emptyCharacterInput, name: 'Mira Ashvale' },
      })
      expect(result).toContain('Mira Ashvale')
    })

    it('renders fallback when characterInput.name is empty', () => {
      const result = templateEngine.render(characterElaboration.userContent!, { ...base })
      expect(result).toContain('(suggest one)')
    })

    it('renders characterInput.description when provided', () => {
      const result = templateEngine.render(characterElaboration.userContent!, {
        ...base,
        characterInput: { ...emptyCharacterInput, description: 'A quiet herbalist.' },
      })
      expect(result).toContain('A quiet herbalist.')
    })
  })

  describe('conditional suppression', () => {
    it('description line absent when empty', () => {
      const result = templateEngine.render(characterElaboration.userContent!, { ...base })
      expect(result).not.toContain('DESCRIPTION:')
    })

    it('background line absent when empty', () => {
      const result = templateEngine.render(characterElaboration.userContent!, { ...base })
      expect(result).not.toContain('BACKGROUND:')
    })

    it('traits line absent when empty array', () => {
      const result = templateEngine.render(characterElaboration.userContent!, { ...base })
      expect(result).not.toContain('TRAITS:')
    })

    it('toneInstruction absent from content when empty', () => {
      const result = templateEngine.render(characterElaboration.content, { ...base })
      // toneInstruction is a raw conditional — just check it doesn't appear as a blank line artifact
      expect(result).not.toContain('undefined')
    })

    it('customInstruction absent from content when empty', () => {
      const result = templateEngine.render(characterElaboration.content, { ...base })
      expect(result).not.toContain("AUTHOR'S GUIDANCE")
    })

    it('customInstruction present when provided', () => {
      const result = templateEngine.render(characterElaboration.content, {
        ...base,
        customInstruction: 'Give the character a tragic backstory.',
      })
      expect(result).toContain("AUTHOR'S GUIDANCE")
      expect(result).toContain('Give the character a tragic backstory.')
    })
  })

  describe('array iteration', () => {
    it('renders traits joined with comma', () => {
      const result = templateEngine.render(characterElaboration.userContent!, {
        ...base,
        characterInput: {
          ...emptyCharacterInput,
          traits: ['stubborn', 'clever', 'kind'],
        },
      })
      expect(result).toContain('stubborn, clever, kind')
      expect(result).not.toContain('[object Object]')
    })
  })

  describe('no crash', () => {
    it('renders without crash on empty base', () => {
      const result = templateEngine.render(characterElaboration.userContent!, { ...base })
      expect(result).not.toBeNull()
      expect(result).not.toContain('{%')
    })
  })
})

// ===== character-refinement =====

describe('character-refinement template', () => {
  const base = {
    genreLabel: '',
    currentCharacter: emptyCurrentCharacter,
    settingContext: '',
    toneInstruction: '',
    settingInstruction: '',
    customInstruction: '',
  }

  describe('variable injection', () => {
    it('renders currentCharacter.name', () => {
      const result = templateEngine.render(characterRefinement.userContent!, {
        ...base,
        currentCharacter: { ...emptyCurrentCharacter, name: 'Captain Reeves' },
      })
      expect(result).toContain('Captain Reeves')
    })

    it('renders currentCharacter.traits joined', () => {
      const result = templateEngine.render(characterRefinement.userContent!, {
        ...base,
        currentCharacter: {
          ...emptyCurrentCharacter,
          name: 'Test',
          traits: ['brave', 'impulsive', 'loyal'],
        },
      })
      expect(result).toContain('brave, impulsive, loyal')
      expect(result).not.toContain('[object Object]')
    })
  })

  describe('conditional suppression', () => {
    it('background absent when empty', () => {
      const result = templateEngine.render(characterRefinement.userContent!, { ...base })
      expect(result).not.toContain('BACKGROUND:')
    })

    it('background present when provided', () => {
      const result = templateEngine.render(characterRefinement.userContent!, {
        ...base,
        currentCharacter: { ...emptyCurrentCharacter, background: 'A soldier turned merchant.' },
      })
      expect(result).toContain('BACKGROUND:')
      expect(result).toContain('A soldier turned merchant.')
    })

    it('appearance absent when empty', () => {
      const result = templateEngine.render(characterRefinement.userContent!, { ...base })
      expect(result).not.toContain('APPEARANCE:')
    })

    it('customInstruction absent from content when empty', () => {
      const result = templateEngine.render(characterRefinement.content, { ...base })
      expect(result).not.toContain("AUTHOR'S GUIDANCE")
    })
  })

  describe('no crash', () => {
    it('renders without crash on empty base', () => {
      const result = templateEngine.render(characterRefinement.userContent!, { ...base })
      expect(result).not.toBeNull()
      expect(result).not.toContain('{%')
    })
  })
})

// ===== supporting-characters =====

describe('supporting-characters template', () => {
  const base = {
    genreLabel: '',
    settingName: '',
    settingDescription: '',
    count: 3,
    protagonist: emptyProtagonist,
  }

  describe('variable injection', () => {
    it('renders protagonist.name', () => {
      const result = templateEngine.render(supportingCharacters.userContent!, {
        ...base,
        protagonist: { ...emptyProtagonist, name: 'Kael' },
      })
      expect(result).toContain('Kael')
    })

    it('renders protagonist.description', () => {
      const result = templateEngine.render(supportingCharacters.userContent!, {
        ...base,
        protagonist: { ...emptyProtagonist, description: 'A reluctant farm boy turned hero.' },
      })
      expect(result).toContain('A reluctant farm boy turned hero.')
    })

    it('renders protagonist.motivation when provided', () => {
      const result = templateEngine.render(supportingCharacters.userContent!, {
        ...base,
        protagonist: { ...emptyProtagonist, motivation: 'Avenge his fallen village.' },
      })
      expect(result).toContain('MOTIVATION:')
      expect(result).toContain('Avenge his fallen village.')
    })

    it('renders settingName', () => {
      const result = templateEngine.render(supportingCharacters.userContent!, {
        ...base,
        settingName: 'The Dustfields',
      })
      expect(result).toContain('The Dustfields')
    })
  })

  describe('conditional suppression', () => {
    it('motivation absent when empty', () => {
      const result = templateEngine.render(supportingCharacters.userContent!, { ...base })
      expect(result).not.toContain('MOTIVATION:')
    })
  })

  describe('no crash', () => {
    it('renders without crash on empty base', () => {
      const result = templateEngine.render(supportingCharacters.userContent!, { ...base })
      expect(result).not.toBeNull()
      expect(result).not.toContain('{%')
    })
  })
})

// ===== opening-generation-adventure =====

describe('opening-generation-adventure template', () => {
  const base = {
    genreLabel: '',
    title: '',
    settingName: '',
    settingDescription: '',
    atmosphere: '',
    protagonistName: '',
    protagonistDescription: '',
    supportingCharacters: [],
    pov: 'third',
    openingGuidance: '',
    lorebookEntries: emptyLorebookEntries,
    tenseInstruction: '',
    tone: '',
  }

  describe('static content present', () => {
    it('outputFormat JSON schema is in content', () => {
      const result = templateEngine.render(openingGenAdventure.content, { ...base })
      expect(result).toContain('"scene"')
      expect(result).toContain('"title"')
      expect(result).toContain('"initialLocation"')
    })

    it('opening instruction text present in userContent', () => {
      const result = templateEngine.render(openingGenAdventure.userContent!, {
        ...base,
        protagonistName: 'Kael',
      })
      expect(result).toContain('Describe the environment and situation')
      expect(result).toContain('Do NOT write anything')
    })
  })

  describe('conditional suppression', () => {
    it('atmosphere absent when empty', () => {
      const result = templateEngine.render(openingGenAdventure.userContent!, { ...base })
      expect(result).not.toContain('ATMOSPHERE:')
    })

    it('atmosphere present when provided', () => {
      const result = templateEngine.render(openingGenAdventure.userContent!, {
        ...base,
        atmosphere: 'Tense and claustrophobic',
      })
      expect(result).toContain('ATMOSPHERE:')
      expect(result).toContain('Tense and claustrophobic')
    })

    it('NPCs section absent when supportingCharacters empty', () => {
      const result = templateEngine.render(openingGenAdventure.userContent!, { ...base })
      expect(result).not.toContain('NPCs WHO MAY APPEAR')
    })

    it('lorebook absent when empty', () => {
      const result = templateEngine.render(openingGenAdventure.userContent!, { ...base })
      expect(result).not.toContain('Established lore')
    })

    it('guidance section absent when empty', () => {
      const result = templateEngine.render(openingGenAdventure.userContent!, { ...base })
      expect(result).not.toContain("AUTHOR'S GUIDANCE FOR OPENING")
    })

    it('guidance section present when provided', () => {
      const result = templateEngine.render(openingGenAdventure.userContent!, {
        ...base,
        openingGuidance: 'Start with a chase scene.',
      })
      expect(result).toContain("AUTHOR'S GUIDANCE FOR OPENING")
      expect(result).toContain('Start with a chase scene.')
    })
  })

  describe('array iteration', () => {
    it('renders supportingCharacters via for loop', () => {
      const result = templateEngine.render(openingGenAdventure.userContent!, {
        ...base,
        supportingCharacters: [
          { name: 'Aldric', role: 'mentor', description: 'A grizzled swordmaster.' },
          { name: 'Sable', role: 'antagonist', description: 'A cunning spy.' },
        ],
      })
      expect(result).toContain('NPCs WHO MAY APPEAR')
      expect(result).toContain('Aldric')
      expect(result).toContain('Sable')
      expect(result).toContain('mentor')
      expect(result).toContain('antagonist')
      expect(result).not.toContain('[object Object]')
    })

    it('renders lorebook entries via for loop', () => {
      const result = templateEngine.render(openingGenAdventure.userContent!, {
        ...base,
        lorebookEntries: [
          { name: 'The Sunken Keep', type: 'location', description: 'A flooded fortress.' },
        ],
      })
      expect(result).toContain('Established lore')
      expect(result).toContain('The Sunken Keep')
    })
  })

  describe('no crash', () => {
    it('renders without crash on empty base', () => {
      const result = templateEngine.render(openingGenAdventure.userContent!, { ...base })
      expect(result).not.toBeNull()
      expect(result).not.toContain('{%')
      expect(result).not.toContain('{{')
    })
  })
})

// ===== opening-generation-creative =====

describe('opening-generation-creative template', () => {
  const base = {
    genreLabel: '',
    title: '',
    settingName: '',
    settingDescription: '',
    atmosphere: '',
    protagonistName: '',
    protagonistDescription: '',
    supportingCharacters: [],
    pov: 'third',
    openingGuidance: '',
    lorebookEntries: emptyLorebookEntries,
    tenseInstruction: '',
    tone: '',
  }

  describe('POV branches in content', () => {
    it('outputFormat contains first-person for pov=first', () => {
      const result = templateEngine.render(openingGenCreative.content, {
        ...base,
        pov: 'first',
      })
      expect(result).toContain('first-person')
    })

    it('outputFormat contains second-person for pov=second', () => {
      const result = templateEngine.render(openingGenCreative.content, {
        ...base,
        pov: 'second',
      })
      expect(result).toContain('second-person')
    })

    it('outputFormat contains third-person for pov=third', () => {
      const result = templateEngine.render(openingGenCreative.content, {
        ...base,
        pov: 'third',
      })
      expect(result).toContain('third-person')
    })

    it('protagonist section uses I/me/my for pov=first', () => {
      const result = templateEngine.render(openingGenCreative.content, {
        ...base,
        pov: 'first',
      })
      expect(result).toContain('I/me/my')
    })

    it('protagonist section uses you/your for pov=second', () => {
      const result = templateEngine.render(openingGenCreative.content, {
        ...base,
        pov: 'second',
      })
      expect(result).toContain('you/your')
    })
  })

  describe('static content present', () => {
    it('outputFormat JSON schema is in content', () => {
      const result = templateEngine.render(openingGenCreative.content, { ...base })
      expect(result).toContain('"scene"')
      expect(result).toContain('"title"')
      expect(result).toContain('"initialLocation"')
    })
  })

  describe('conditional suppression', () => {
    it('lorebook absent when empty', () => {
      const result = templateEngine.render(openingGenCreative.userContent!, { ...base })
      expect(result).not.toContain('Established lore')
    })

    it('NPCs section absent when supportingCharacters empty', () => {
      const result = templateEngine.render(openingGenCreative.userContent!, { ...base })
      expect(result).not.toContain('NPCs WHO MAY APPEAR')
    })
  })

  describe('array iteration', () => {
    it('renders supportingCharacters via for loop', () => {
      const result = templateEngine.render(openingGenCreative.userContent!, {
        ...base,
        supportingCharacters: [{ name: 'Vera', role: 'ally', description: 'A street-wise thief.' }],
      })
      expect(result).toContain('NPCs WHO MAY APPEAR')
      expect(result).toContain('Vera')
      expect(result).toContain('ally')
      expect(result).not.toContain('[object Object]')
    })
  })

  describe('no crash', () => {
    it('renders without crash on empty base', () => {
      const result = templateEngine.render(openingGenCreative.userContent!, { ...base })
      expect(result).not.toBeNull()
      expect(result).not.toContain('{%')
    })
  })
})

// ===== opening-refinement-adventure =====

describe('opening-refinement-adventure template', () => {
  const base = {
    genreLabel: '',
    title: '',
    settingName: '',
    settingDescription: '',
    atmosphere: '',
    protagonistName: '',
    protagonistDescription: '',
    supportingCharacters: [],
    pov: 'third',
    openingGuidance: '',
    lorebookEntries: emptyLorebookEntries,
    currentOpening: emptyCurrentOpening,
    tenseInstruction: '',
    tone: '',
  }

  describe('variable injection', () => {
    it('renders currentOpening.title', () => {
      const result = templateEngine.render(openingRefAdventure.userContent!, {
        ...base,
        currentOpening: { ...emptyCurrentOpening, title: 'The Iron Gate' },
      })
      expect(result).toContain('The Iron Gate')
    })

    it('renders currentOpening.scene', () => {
      const result = templateEngine.render(openingRefAdventure.userContent!, {
        ...base,
        currentOpening: {
          ...emptyCurrentOpening,
          scene: 'Rain hammered the cobblestones.',
        },
      })
      expect(result).toContain('Rain hammered the cobblestones.')
    })

    it('renders currentOpening.initialLocation.name', () => {
      const result = templateEngine.render(openingRefAdventure.userContent!, {
        ...base,
        currentOpening: {
          ...emptyCurrentOpening,
          initialLocation: { name: 'The Dockside', description: '' },
        },
      })
      expect(result).toContain('The Dockside')
    })
  })

  describe('static content present', () => {
    it('outputFormat JSON schema is in content', () => {
      const result = templateEngine.render(openingRefAdventure.content, { ...base })
      expect(result).toContain('"scene"')
      expect(result).toContain('"title"')
      expect(result).toContain('"initialLocation"')
    })

    it('adventure instruction text present', () => {
      const result = templateEngine.render(openingRefAdventure.userContent!, {
        ...base,
        protagonistName: 'Kael',
      })
      expect(result).toContain('Describe the environment and situation')
    })
  })

  describe('conditional suppression', () => {
    it('lorebook absent when empty', () => {
      const result = templateEngine.render(openingRefAdventure.userContent!, { ...base })
      expect(result).not.toContain('Established lore')
    })

    it('NPCs section absent when supportingCharacters empty', () => {
      const result = templateEngine.render(openingRefAdventure.userContent!, { ...base })
      expect(result).not.toContain('NPCs WHO MAY APPEAR')
    })
  })

  describe('array iteration', () => {
    it('renders supportingCharacters', () => {
      const result = templateEngine.render(openingRefAdventure.userContent!, {
        ...base,
        supportingCharacters: [{ name: 'Brin', role: 'ally', description: 'A halfling scout.' }],
      })
      expect(result).toContain('Brin')
      expect(result).not.toContain('[object Object]')
    })
  })

  describe('no crash', () => {
    it('renders without crash on empty base', () => {
      const result = templateEngine.render(openingRefAdventure.userContent!, { ...base })
      expect(result).not.toBeNull()
      expect(result).not.toContain('{%')
    })
  })
})

// ===== opening-refinement-creative =====

describe('opening-refinement-creative template', () => {
  const base = {
    genreLabel: '',
    title: '',
    settingName: '',
    settingDescription: '',
    atmosphere: '',
    protagonistName: '',
    protagonistDescription: '',
    supportingCharacters: [],
    pov: 'third',
    openingGuidance: '',
    lorebookEntries: emptyLorebookEntries,
    currentOpening: emptyCurrentOpening,
    tenseInstruction: '',
    tone: '',
  }

  describe('variable injection', () => {
    it('renders currentOpening.title', () => {
      const result = templateEngine.render(openingRefCreative.userContent!, {
        ...base,
        currentOpening: { ...emptyCurrentOpening, title: 'Dust and Embers' },
      })
      expect(result).toContain('Dust and Embers')
    })

    it('renders currentOpening.scene', () => {
      const result = templateEngine.render(openingRefCreative.userContent!, {
        ...base,
        currentOpening: {
          ...emptyCurrentOpening,
          scene: 'She stood at the edge of the world.',
        },
      })
      expect(result).toContain('She stood at the edge of the world.')
    })
  })

  describe('POV branches in content', () => {
    it('outputFormat contains first-person for pov=first', () => {
      const result = templateEngine.render(openingRefCreative.content, {
        ...base,
        pov: 'first',
      })
      expect(result).toContain('first-person')
    })

    it('protagonist section uses I/me/my for pov=first', () => {
      const result = templateEngine.render(openingRefCreative.content, {
        ...base,
        pov: 'first',
      })
      expect(result).toContain('I/me/my')
    })

    it('protagonist section for third pov warns against second person', () => {
      const result = templateEngine.render(openingRefCreative.content, {
        ...base,
        pov: 'third',
      })
      expect(result).toContain('NEVER use second person')
    })
  })

  describe('conditional suppression', () => {
    it('lorebook absent when empty', () => {
      const result = templateEngine.render(openingRefCreative.userContent!, { ...base })
      expect(result).not.toContain('Established lore')
    })
  })

  describe('array iteration', () => {
    it('renders supportingCharacters', () => {
      const result = templateEngine.render(openingRefCreative.userContent!, {
        ...base,
        supportingCharacters: [
          { name: 'Mira', role: 'love interest', description: 'A wandering poet.' },
        ],
      })
      expect(result).toContain('Mira')
      expect(result).toContain('love interest')
      expect(result).not.toContain('[object Object]')
    })
  })

  describe('no crash', () => {
    it('renders without crash on empty base', () => {
      const result = templateEngine.render(openingRefCreative.userContent!, { ...base })
      expect(result).not.toBeNull()
      expect(result).not.toContain('{%')
    })
  })
})

// ===== character-card-import (excluded — no conversion needed) =====

describe('character-card-import template', () => {
  it('renders without crash using basic fixture', () => {
    const result = templateEngine.render(characterCardImport.content, {})
    expect(result).not.toBeNull()
  })

  it('userContent renders without crash', () => {
    const result = templateEngine.render(characterCardImport.userContent!, {
      genre: 'fantasy',
      title: 'Dragon Card',
      cardContent: 'You are {{char}}, a fierce dragon.',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('Dragon Card')
  })
})

// ===== vault-character-import (excluded — no conversion needed) =====

describe('vault-character-import template', () => {
  it('renders without crash using basic fixture', () => {
    const result = templateEngine.render(vaultCharacterImport.content, {})
    expect(result).not.toBeNull()
  })

  it('userContent renders without crash', () => {
    const result = templateEngine.render(vaultCharacterImport.userContent!, {
      cardContent: 'Character data here.',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('Character data here.')
  })
})
