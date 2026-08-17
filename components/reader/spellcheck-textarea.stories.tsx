import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import type { Lint } from 'harper.js'
import { useState } from 'react'
import { View } from 'react-native'
import { expect } from 'storybook/test'

import { SpellcheckTextarea } from './spellcheck-textarea'

// Real Lint instances only exist inside harper's WASM linter; stories fake the
// three methods the component reads.
function fakeLint(start: number, end: number, message: string, replacement?: string): Lint {
  return {
    span: () => ({ start, end }),
    message: () => message,
    suggestions: () => (replacement != null ? [{ get_replacement_text: () => replacement }] : []),
  } as unknown as Lint
}

const SAMPLE_TEXT = 'The quick brwn fox jumps over teh lazy dog, wagging it’s tail.'

const SAMPLE_LINTS: Lint[] = [
  fakeLint(10, 14, 'Possible spelling mistake.', 'brown'),
  fakeLint(30, 33, 'Possible spelling mistake.', 'the'),
  fakeLint(53, 57, 'Use the possessive “its” here.', 'its'),
]

const meta: Meta<typeof SpellcheckTextarea> = {
  title: 'Compounds/Reader/SpellcheckTextarea',
  component: SpellcheckTextarea,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof meta>

function EditableDemo({ lints }: { lints: Lint[] }) {
  const [value, setValue] = useState(SAMPLE_TEXT)
  return (
    <View className="max-w-xl">
      <SpellcheckTextarea value={value} onChangeText={setValue} lints={lints} />
    </View>
  )
}

export const WithLints: Story = { render: () => <EditableDemo lints={SAMPLE_LINTS} /> }

export const Clean: Story = { render: () => <EditableDemo lints={[]} /> }

// The underline overlay duplicates the whole draft on top of the input, so it
// must exist only when it has an underline to draw. Native holds the no-lint
// state permanently (harper can't run on Hermes), and there the duplicate showed
// through as doubled glyphs.
function countMirrorsOf(canvasElement: HTMLElement, text: string): number {
  return Array.from(canvasElement.querySelectorAll('span')).filter(
    (el) => el.children.length === 0 && (el.textContent ?? '').includes(text),
  ).length
}

export const CleanDraftRendersNoOverlay: Story = {
  render: () => <EditableDemo lints={[]} />,
  play: ({ canvasElement }) => {
    const textarea = canvasElement.querySelector('textarea')
    expect(textarea?.value).toBe(SAMPLE_TEXT)
    expect(countMirrorsOf(canvasElement, 'quick')).toBe(0)
  },
}

export const LintedDraftRendersOverlay: Story = {
  render: () => <EditableDemo lints={SAMPLE_LINTS} />,
  play: ({ canvasElement }) => {
    // 'brwn' is a lint span, so the overlay must carry it as its own node.
    expect(countMirrorsOf(canvasElement, 'brwn')).toBeGreaterThan(0)
  },
}
