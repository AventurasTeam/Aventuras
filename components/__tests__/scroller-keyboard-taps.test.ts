import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })

async function messages(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: 'components/__scroller-fixture.tsx' })
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message)
}

const flagsTaps = async (code: string) =>
  (await messages(code)).some((m) => m.includes('keyboardShouldPersistTaps'))

describe('scroller keyboardShouldPersistTaps lint', () => {
  it.each([
    '<ScrollView />',
    '<SectionList sections={[]} />',
    '<BottomSheetScrollView />',
    '<GHScrollView />',
    '<Animated.ScrollView />',
  ])('flags %s without the prop', async (element) => {
    expect(await flagsTaps(`export const X = () => ${element}\n`)).toBe(true)
  })

  it('accepts an explicit value, or a spread that may carry one', async () => {
    expect(
      await flagsTaps(
        'export const X = () => <ScrollView keyboardShouldPersistTaps="handled" />\n',
      ),
    ).toBe(false)
    expect(await flagsTaps('export const X = (p: object) => <ScrollView {...p} />\n')).toBe(false)
  })

  it("looks only at the scroller's own props, not JSX nested inside them", async () => {
    expect(
      await flagsTaps(
        'export const X = () => <FlatList data={[]} renderItem={({ item }) => <Row {...item} />} />\n',
      ),
    ).toBe(true)
    expect(
      await flagsTaps(
        'export const X = () => <ScrollView refreshControl={<Row keyboardShouldPersistTaps="handled" />} />\n',
      ),
    ).toBe(true)
  })

  it('leaves the wildcard-import ban in force beside it', async () => {
    expect(await messages("import * as React from 'react'\nexport const x = React\n")).toEqual([
      expect.stringContaining('Wildcard imports are banned'),
    ])
  })
})
