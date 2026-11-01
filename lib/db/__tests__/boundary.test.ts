import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

describe('lib/* public-API boundary', () => {
  it('flags a deep import of lib/db internals from outside the module', async () => {
    const eslint = new ESLint({ cwd: process.cwd() })
    const [result] = await eslint.lintText("import { stories } from '@/lib/db/schema'\n", {
      filePath: 'components/__deep-import-fixture.tsx',
    })
    expect(result.messages.map((m) => m.ruleId)).toContain('boundaries/dependencies')
  })

  it('permits barrel imports of new table row types, JSON types, and schemas via @/lib/db', async () => {
    const eslint = new ESLint({ cwd: process.cwd() })
    const [result] = await eslint.lintText(
      "import { storySettingsSchema } from '@/lib/db'\nimport type { Entity, EntityState } from '@/lib/db'\n",
      { filePath: 'components/__barrel-import-fixture.tsx' },
    )
    expect(result.messages.map((m) => m.ruleId)).not.toContain('boundaries/dependencies')
  })
})

describe('lib module edges', () => {
  const eslint = new ESLint({ cwd: process.cwd() })

  async function boundaryHits(source: string, filePath: string): Promise<number> {
    const [result] = await eslint.lintText(source, { filePath })
    return result.messages.filter((m) => m.ruleId === 'boundaries/dependencies').length
  }

  describe('lib/tokens is a leaf', () => {
    const fixture = 'lib/tokens/__leaf-fixture.ts'

    it('flags a lib module', async () => {
      expect(await boundaryHits("import { oneLine } from '@/lib/text'\n", fixture)).toBe(1)
    })

    it('flags a bare lib file', async () => {
      expect(
        await boundaryHits("import { normalizeTerm } from '@/lib/keyword-terms'\n", fixture),
      ).toBe(1)
    })

    it('permits js-tiktoken', async () => {
      expect(await boundaryHits("import { Tiktoken } from 'js-tiktoken/lite'\n", fixture)).toBe(0)
    })
  })

  describe('lib/chapters takes no value import of lib/db', () => {
    const fixture = 'lib/chapters/__edge-fixture.ts'

    it('flags a value import', async () => {
      expect(await boundaryHits("import { storySettingsSchema } from '@/lib/db'\n", fixture)).toBe(
        1,
      )
    })

    it('flags the inline type spelling, which counts as a value import', async () => {
      expect(await boundaryHits("import { type StoryEntry } from '@/lib/db'\n", fixture)).toBe(1)
    })

    it('permits an import type declaration', async () => {
      expect(await boundaryHits("import type { StoryEntry } from '@/lib/db'\n", fixture)).toBe(0)
    })

    it('permits lib/keyword-terms, which the leaf rule would not', async () => {
      expect(
        await boundaryHits("import { normalizeTerm } from '@/lib/keyword-terms'\n", fixture),
      ).toBe(0)
    })
  })
})
