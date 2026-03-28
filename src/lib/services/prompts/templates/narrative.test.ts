import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMockRef = vi.hoisted(() => ({ current: null as any }))

vi.mock('$lib/services/database', () => ({
  get database() {
    return dbMockRef.current
  },
}))

import { renderTemplate, createTemplateTestMock, testVariableInjection, testManifestCoverage } from '$test/helpers/templateTestHelper'
import { promptContext, promptContextMinimal } from '$test/fixtures/promptContext'
import { adventureManifest, creativeWritingManifest } from '$test/fixtures/templateManifests'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  dbMockRef.current = createTemplateTestMock()
})

// ---------------------------------------------------------------------------
// adventure
// ---------------------------------------------------------------------------

describe('adventure', () => {
  describe('variable injection', () => {
    testVariableInjection(adventureManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('Story Context present when genre set', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('# Story Context')
    })

    it('Story Context absent when all empty', async () => {
      const result = await renderTemplate('adventure', { ...promptContextMinimal, themes: '' })
      expect(result.system).not.toContain('# Story Context')
    })

    it('Known Characters section present when characters exist', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('[KNOWN CHARACTERS]')
    })

    it('Known Characters section absent when characters empty', async () => {
      const result = await renderTemplate('adventure', promptContextMinimal)
      expect(result.system).not.toContain('[KNOWN CHARACTERS]')
    })

    it('lorebook section present when lorebookEntries has items', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('(CANONICAL')
    })

    it('lorebook section absent when lorebookEntries empty', async () => {
      const result = await renderTemplate('adventure', promptContextMinimal)
      expect(result.system).not.toContain('(CANONICAL')
    })

    it('story_history present when chapters has items', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('<story_history>')
    })

    it('story_history absent when chapters and timelineFill empty', async () => {
      const result = await renderTemplate('adventure', promptContextMinimal)
      expect(result.system).not.toContain('<story_history>')
    })

    it('style_guidance present when styleReview.phrases has items', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('<style_guidance>')
    })

    it('style_guidance absent when styleReview not provided', async () => {
      const result = await renderTemplate('adventure', promptContextMinimal)
      expect(result.system).not.toContain('<style_guidance>')
    })

    it('VisualProse section present when visualProseMode true', async () => {
      const result = await renderTemplate('adventure', {
        ...promptContext,
        userSettings: { ...promptContext.userSettings, visualProseMode: true },
      })
      expect(result.system).toContain('<VisualProse>')
    })

    it('VisualProse section absent when visualProseMode false', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).not.toContain('<VisualProse>')
    })

    it('InlineImages section present when inlineImageMode true', async () => {
      const result = await renderTemplate('adventure', {
        ...promptContext,
        userSettings: {
          ...promptContext.userSettings,
          imageGeneration: { ...promptContext.userSettings.imageGeneration, inlineImageMode: true },
        },
      })
      expect(result.system).toContain('<InlineImages>')
    })

    it('InlineImages section absent when inlineImageMode false', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).not.toContain('<InlineImages>')
    })

    it('Recent Story section present when storyEntriesVisibleRaw.size > 1', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.user).toContain('## Recent Story:')
    })

    it('Recent Story section absent when storyEntriesVisibleRaw.size <= 1', async () => {
      const result = await renderTemplate('adventure', {
        ...promptContextMinimal,
        storyEntriesVisibleRaw: [{ type: 'user_action', content: 'I draw my sword.' }],
      })
      expect(result.user).not.toContain('## Recent Story:')
    })
  })

  describe('conditional branches', () => {
    it('second-person present renders "second person"', async () => {
      const result = await renderTemplate('adventure', {
        ...promptContext,
        pov: 'second',
        tense: 'present',
      })
      expect(result.user).toContain('second person')
    })

    it('third-person past renders "third person"', async () => {
      const result = await renderTemplate('adventure', {
        ...promptContext,
        pov: 'third',
        tense: 'past',
      })
      expect(result.user).toContain('third person')
    })

    it('second and third person produce distinct outputs', async () => {
      const second = await renderTemplate('adventure', { ...promptContext, pov: 'second', tense: 'present' })
      const third = await renderTemplate('adventure', { ...promptContext, pov: 'third', tense: 'past' })
      expect(second.user).not.toEqual(third.user)
    })

    it('third-person system content refers to protagonist by name', async () => {
      const result = await renderTemplate('adventure', { ...promptContext, pov: 'third', tense: 'present' })
      expect(result.system).toContain('Refer to the protagonist as "Kael"')
    })
  })

  describe('array iteration', () => {
    it('renders all character names with nested visual descriptors', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('Aria')
      expect(result.system).toContain('Marcus')
      expect(result.system).toContain('Silver pendant')
      expect(result.system).toContain('Angular features, bronze skin')
    })

    it('renders inventory items with quantity and equipped markers', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('Iron Sword')
      expect(result.system).toContain('[equipped]')
      expect(result.system).toContain('Health Potion')
      expect(result.system).toContain('×3')
    })

    it('renders lorebook entries grouped by type', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('The Shadow Guild')
      expect(result.system).toContain('Elder Dragon')
    })

    it('renders chapter metadata (characters, locations, tone)', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('Kael, Aria')
      expect(result.system).toContain('Thornwood, River Crossing')
      expect(result.system).toContain('Tense')
    })

    it('renders story entries in user content with NARRATIVE labels', async () => {
      const result = await renderTemplate('adventure', promptContext)
      // Entries before the last user_action are shown in Recent Story;
      // entry0 is narration so it gets [NARRATIVE], the last action (entry1)
      // is shown under Current Action without a label prefix.
      expect(result.user).toContain('[NARRATIVE]')
      expect(result.user).toContain('The torches flickered')
      expect(result.user).toContain('I draw my sword')
    })
  })

  describe('filter behavior', () => {
    it('| join renders traits as comma-separated', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('brave, perceptive')
    })

    it('| where filters lorebook entries by type', async () => {
      const result = await renderTemplate('adventure', promptContext)
      expect(result.system).toContain('Factions:')
    })
  })

  describe('edge cases', () => {
    it('renders content with only required vars present', async () => {
      const result = await renderTemplate('adventure', {
        protagonistName: 'Hero',
        pov: 'second',
        tense: 'present',
      })
      expect(result.system.length).toBeGreaterThan(0)
    })

    it('renders userContent with minimal vars present', async () => {
      const result = await renderTemplate('adventure', {
        protagonistName: 'Hero',
        pov: 'second',
        tense: 'present',
        storyEntriesVisibleRaw: [],
      })
      expect(result.user.length).toBeGreaterThan(0)
    })

    it('agenticRetrievalContext absent from template (old variable)', async () => {
      const result = await renderTemplate('adventure', {
        ...promptContextMinimal,
        agenticRetrievalContext: 'STALE_STRING',
      })
      expect(result.system).not.toContain('STALE_STRING')
    })
  })
})

// ---------------------------------------------------------------------------
// creative-writing
// ---------------------------------------------------------------------------

describe('creative-writing', () => {
  describe('variable injection', () => {
    testVariableInjection(creativeWritingManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('Story Context present when genre set', async () => {
      const result = await renderTemplate('creative-writing', promptContext)
      expect(result.system).toContain('# Story Context')
    })

    it('Story Context absent when all empty', async () => {
      const result = await renderTemplate('creative-writing', { ...promptContextMinimal, themes: '' })
      expect(result.system).not.toContain('# Story Context')
    })

    it('lorebook section present when lorebookEntries has items', async () => {
      const result = await renderTemplate('creative-writing', promptContext)
      expect(result.system).toContain('(CANONICAL')
    })

    it('lorebook section absent when empty', async () => {
      const result = await renderTemplate('creative-writing', promptContextMinimal)
      expect(result.system).not.toContain('(CANONICAL')
    })
  })

  describe('conditional branches', () => {
    it('first-person present renders correct style instruction', async () => {
      const result = await renderTemplate('creative-writing', {
        ...promptContext,
        pov: 'first',
        tense: 'present',
      })
      expect(result.system).toContain('PRESENT TENSE, FIRST PERSON')
    })

    it('third-person past renders correct style instruction', async () => {
      const result = await renderTemplate('creative-writing', {
        ...promptContext,
        pov: 'third',
        tense: 'past',
      })
      expect(result.system).toContain('PAST TENSE, THIRD PERSON')
    })

    it('all 6 pov/tense combos produce distinct system output', async () => {
      const combos = [
        { pov: 'first', tense: 'present' },
        { pov: 'first', tense: 'past' },
        { pov: 'second', tense: 'present' },
        { pov: 'second', tense: 'past' },
        { pov: 'third', tense: 'present' },
        { pov: 'third', tense: 'past' },
      ]
      const results = await Promise.all(
        combos.map(({ pov, tense }) =>
          renderTemplate('creative-writing', { ...promptContext, pov, tense }),
        ),
      )
      const systemOutputs = results.map((r) => r.system)
      const unique = new Set(systemOutputs)
      expect(unique.size).toBe(6)
    })
  })

  describe('array iteration', () => {
    it('renders all character names', async () => {
      const result = await renderTemplate('creative-writing', promptContext)
      expect(result.system).toContain('Aria')
      expect(result.system).toContain('Marcus')
    })
  })

  describe('edge cases', () => {
    it('renders with only required vars', async () => {
      const result = await renderTemplate('creative-writing', {
        protagonistName: 'Hero',
        pov: 'second',
        tense: 'present',
      })
      expect(result.system.length).toBeGreaterThan(0)
    })

    it('agenticRetrievalContext absent from template (old variable)', async () => {
      const result = await renderTemplate('creative-writing', {
        ...promptContextMinimal,
        agenticRetrievalContext: 'STALE_STRING',
      })
      expect(result.system).not.toContain('STALE_STRING')
    })
  })
})

// ---------------------------------------------------------------------------
// manifest coverage
// ---------------------------------------------------------------------------

describe('manifest coverage', () => {
  testManifestCoverage(adventureManifest)
  testManifestCoverage(creativeWritingManifest)
})
