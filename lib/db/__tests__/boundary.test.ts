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
    it.each([
      ['flags a lib module', "import { oneLine } from '@/lib/text'\n", 1],
      ['flags a bare lib file', "import { normalizeTerm } from '@/lib/keyword-terms'\n", 1],
      [
        'flags a hook, which would carry the db in',
        "import { useTier } from '@/hooks/use-tier'\n",
        1,
      ],
      ['flags app code outside lib', "import { Colors } from '@/constants/theme'\n", 1],
      ['permits js-tiktoken', "import { Tiktoken } from 'js-tiktoken/lite'\n", 0],
    ])('%s', async (_name, source, hits) => {
      expect(await boundaryHits(source, 'lib/tokens/__leaf-fixture.ts')).toBe(hits)
    })
  })

  describe('lib/chapters takes no value import of a lib module or app code', () => {
    it.each([
      ['flags a value import', "import { storySettingsSchema } from '@/lib/db'\n", 1],
      [
        'flags the inline type spelling, which counts as a value import',
        "import { type StoryEntry } from '@/lib/db'\n",
        1,
      ],
      ['permits an import type declaration', "import type { StoryEntry } from '@/lib/db'\n", 0],
      [
        'permits lib/keyword-terms, which the leaf rule would not',
        "import { normalizeTerm } from '@/lib/keyword-terms'\n",
        0,
      ],
      [
        'flags another lib module, which would carry the db in',
        "import { chaptersStore } from '@/lib/stores'\n",
        1,
      ],
      [
        'flags a hook, which would carry the db in',
        "import { useChapterProgress } from '@/hooks/use-chapter-progress'\n",
        1,
      ],
      [
        'permits an import type declaration from another lib module',
        "import type { OpenStory } from '@/lib/stores'\n",
        0,
      ],
    ])('%s', async (_name, source, hits) => {
      expect(await boundaryHits(source, 'lib/chapters/__edge-fixture.ts')).toBe(hits)
    })
  })

  describe('lib/pipeline takes no value import of the lib/actions barrel', () => {
    it.each([
      ['lib/pipeline', 'lib/pipeline/__edge-fixture.ts'],
      ['the close agent', 'lib/pipeline/definitions/close-agent/__edge-fixture.ts'],
    ])('from %s', async (_name, filePath) => {
      expect(
        await boundaryHits("import { applyDeltaAction } from '@/lib/actions'\n", filePath),
      ).toBe(1)
      expect(
        await boundaryHits("import type { PipelineAction } from '@/lib/actions'\n", filePath),
      ).toBe(0)
      expect(
        await boundaryHits(
          "import { USER_EDITED_SINCE_PROSE } from '@/lib/actions/types'\n",
          filePath,
        ),
      ).toBe(0)
    })
  })
})
