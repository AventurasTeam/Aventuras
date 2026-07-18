import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import type { Lint } from 'harper.js'
import { useState } from 'react'
import { View } from 'react-native'

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
