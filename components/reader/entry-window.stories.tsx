import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { fn } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

import { EntryWindow } from './entry-window'

type DemoRow = { id: string; body: string }

function makeRows(from: number, count: number): DemoRow[] {
  return Array.from({ length: count }, (_, i) => {
    const n = from + i
    return {
      id: `row-${n}`,
      body: `Entry ${n} — ${'the story continues onward. '.repeat((n % 4) + 1)}`,
    }
  })
}

function renderDemoRow(row: DemoRow) {
  return (
    <View className="border-b border-border p-3">
      <Text size="sm">{row.body}</Text>
    </View>
  )
}

const meta: Meta<typeof EntryWindow> = {
  title: 'Compounds/Reader/EntryWindow',
  component: EntryWindow,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: () => (
    <View style={{ height: 480 }}>
      <EntryWindow
        rows={makeRows(1, 60)}
        renderRow={renderDemoRow}
        onNearTop={fn()}
        onNearBottomChange={fn()}
        onScrollPositionChange={fn()}
      />
    </View>
  ),
}

function PrependDemo() {
  const [rows, setRows] = useState(() => makeRows(100, 40))
  const prepend = () => {
    setRows((prev) => {
      const firstN = Number(prev[0]!.id.replace('row-', ''))
      return [...makeRows(firstN - 10, 10), ...prev]
    })
  }
  return (
    <View style={{ height: 480 }} className="gap-2">
      <Button variant="secondary" size="sm" onPress={prepend}>
        <Text>Prepend 10 older rows</Text>
      </Button>
      <View className="flex-1">
        <EntryWindow
          rows={rows}
          renderRow={renderDemoRow}
          onNearTop={fn()}
          onNearBottomChange={fn()}
          onScrollPositionChange={fn()}
        />
      </View>
    </View>
  )
}

// Exercises the scroll-anchoring path: prepending must not visually shift the
// rows currently in view.
export const PrependAnchoring: Story = { render: () => <PrependDemo /> }
