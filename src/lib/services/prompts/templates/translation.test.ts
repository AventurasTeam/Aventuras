// src/lib/services/prompts/templates/translation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Hoisted database mock (must be before any $lib imports) ----
const dbMockRef = vi.hoisted(() => ({ current: null as any }))

vi.mock('$lib/services/database', () => ({
  get database() {
    return dbMockRef.current
  },
}))

// ---- Imports (after mocks) ----
import {
  renderTemplate,
  createTemplateTestMock,
  testVariableInjection,
  testManifestCoverage,
} from '$test/helpers/templateTestHelper'
import { promptContext } from '$test/fixtures/promptContext'
import {
  translateNarrationManifest,
  translateInputManifest,
  translateUIManifest,
  translateSuggestionsManifest,
  translateActionChoicesManifest,
} from '$test/fixtures/templateManifests'

beforeEach(() => {
  dbMockRef.current = createTemplateTestMock()
})

// ---------------------------------------------------------------------------
// translate-narration
// ---------------------------------------------------------------------------

describe('translate-narration', () => {
  describe('variable injection', () => {
    testVariableInjection(translateNarrationManifest, promptContext)
  })

  describe('edge cases', () => {
    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('translate-narration', promptContext)
      expect(result.system).not.toContain('[object Object]')
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// translate-input
// ---------------------------------------------------------------------------

describe('translate-input', () => {
  describe('variable injection', () => {
    testVariableInjection(translateInputManifest, promptContext)
  })

  describe('edge cases', () => {
    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('translate-input', promptContext)
      expect(result.system).not.toContain('[object Object]')
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// translate-ui
// ---------------------------------------------------------------------------

describe('translate-ui', () => {
  describe('variable injection', () => {
    testVariableInjection(translateUIManifest, promptContext)
  })

  describe('filter behavior', () => {
    it('| json filter produces valid JSON in user content', async () => {
      const result = await renderTemplate('translate-ui', promptContext)
      const jsonStart = result.user.indexOf('[')
      const jsonEnd = result.user.lastIndexOf(']')
      expect(jsonStart).toBeGreaterThan(-1)
      const jsonFragment = result.user.slice(jsonStart, jsonEnd + 1)
      expect(() => JSON.parse(jsonFragment)).not.toThrow()
    })
  })

  describe('edge cases', () => {
    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('translate-ui', promptContext)
      expect(result.system).not.toContain('[object Object]')
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// translate-suggestions
// ---------------------------------------------------------------------------

describe('translate-suggestions', () => {
  describe('variable injection', () => {
    testVariableInjection(translateSuggestionsManifest, promptContext)
  })

  describe('filter behavior', () => {
    it('| json filter produces valid JSON in user content', async () => {
      const result = await renderTemplate('translate-suggestions', promptContext)
      const jsonStart = result.user.indexOf('[')
      const jsonEnd = result.user.lastIndexOf(']')
      expect(jsonStart).toBeGreaterThan(-1)
      const jsonFragment = result.user.slice(jsonStart, jsonEnd + 1)
      expect(() => JSON.parse(jsonFragment)).not.toThrow()
    })
  })

  describe('edge cases', () => {
    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('translate-suggestions', promptContext)
      expect(result.system).not.toContain('[object Object]')
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// translate-action-choices
// ---------------------------------------------------------------------------

describe('translate-action-choices', () => {
  describe('variable injection', () => {
    testVariableInjection(translateActionChoicesManifest, promptContext)
  })

  describe('filter behavior', () => {
    it('| json filter produces valid JSON in user content', async () => {
      const result = await renderTemplate('translate-action-choices', promptContext)
      const jsonStart = result.user.indexOf('[')
      const jsonEnd = result.user.lastIndexOf(']')
      expect(jsonStart).toBeGreaterThan(-1)
      const jsonFragment = result.user.slice(jsonStart, jsonEnd + 1)
      expect(() => JSON.parse(jsonFragment)).not.toThrow()
    })
  })

  describe('edge cases', () => {
    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('translate-action-choices', promptContext)
      expect(result.system).not.toContain('[object Object]')
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// manifest coverage
// ---------------------------------------------------------------------------

describe('manifest coverage', () => {
  testManifestCoverage(translateNarrationManifest)
  testManifestCoverage(translateInputManifest)
  testManifestCoverage(translateUIManifest)
  testManifestCoverage(translateSuggestionsManifest)
  testManifestCoverage(translateActionChoicesManifest)
})
