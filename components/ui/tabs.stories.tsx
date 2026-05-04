import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Tabs> = {
  title: 'Patterns/Tabs',
  component: Tabs,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Tabs>

function ControlledTabs({
  initial,
  children,
}: {
  initial: string
  children: (value: string, set: (v: string) => void) => React.ReactNode
}) {
  const [value, setValue] = React.useState(initial)
  return <>{children(value, setValue)}</>
}

export const Basic: Story = {
  render: () => (
    <View style={{ width: 480 }}>
      <ControlledTabs initial="overview">
        {(value, setValue) => (
          <Tabs value={value} onValueChange={setValue}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <Text>Overview content.</Text>
            </TabsContent>
            <TabsContent value="identity">
              <Text>Identity content.</Text>
            </TabsContent>
            <TabsContent value="settings">
              <Text>Settings content.</Text>
            </TabsContent>
          </Tabs>
        )}
      </ControlledTabs>
    </View>
  ),
}

export const WithCounts: Story = {
  render: () => (
    <View style={{ width: 560 }}>
      <ControlledTabs initial="overview">
        {(value, setValue) => (
          <Tabs value={value} onValueChange={setValue}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="connections" count={3}>
                Connections
              </TabsTrigger>
              <TabsTrigger value="involvements" count={7}>
                Involvements
              </TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <Text>Overview content.</Text>
            </TabsContent>
            <TabsContent value="connections">
              <Text>Connections content (3 items).</Text>
            </TabsContent>
            <TabsContent value="involvements">
              <Text>Involvements content (7 items).</Text>
            </TabsContent>
            <TabsContent value="history">
              <Text>History delta log.</Text>
            </TabsContent>
          </Tabs>
        )}
      </ControlledTabs>
    </View>
  ),
}

export const DisabledTab: Story = {
  render: () => (
    <View style={{ width: 480 }}>
      <ControlledTabs initial="overview">
        {(value, setValue) => (
          <Tabs value={value} onValueChange={setValue}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="carrying" disabled count={0}>
                Carrying
              </TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <Text>Overview content.</Text>
            </TabsContent>
            <TabsContent value="settings">
              <Text>Settings content.</Text>
            </TabsContent>
          </Tabs>
        )}
      </ControlledTabs>
    </View>
  ),
}

// Realistic 8-tab character detail-pane simulation — verifies the
// strip handles full kind cardinality at desktop tier without
// substitution to Select (substitution is a consumer concern).
export const CharacterKitchenSink: Story = {
  render: () => (
    <View style={{ width: 720 }}>
      <ControlledTabs initial="overview">
        {(value, setValue) => (
          <Tabs value={value} onValueChange={setValue}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="carrying" count={7}>
                Carrying
              </TabsTrigger>
              <TabsTrigger value="connections" count={3}>
                Connections
              </TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="assets" count={2}>
                Assets
              </TabsTrigger>
              <TabsTrigger value="involvements" count={7}>
                Involvements
              </TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <Text>Overview tab body.</Text>
            </TabsContent>
          </Tabs>
        )}
      </ControlledTabs>
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-4"
          style={{ width: 480 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <ControlledTabs initial="identity">
            {(value, setValue) => (
              <Tabs value={value} onValueChange={setValue}>
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="identity">Identity</TabsTrigger>
                  <TabsTrigger value="connections" count={3}>
                    Connections
                  </TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </ControlledTabs>
        </View>
      ))}
    </View>
  ),
}
