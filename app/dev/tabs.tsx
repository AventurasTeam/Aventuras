import * as React from 'react'
import { ScrollView, View } from 'react-native'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Text } from '@/components/ui/text'

export default function TabsDevRoute() {
  const [basic, setBasic] = React.useState('overview')
  const [counts, setCounts] = React.useState('overview')
  const [withDisabled, setWithDisabled] = React.useState('overview')
  const [kitchen, setKitchen] = React.useState('overview')

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Basic strip</Heading>
          <View className="mt-3">
            <Tabs value={basic} onValueChange={setBasic}>
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
          </View>
        </View>

        <View>
          <Heading level={3}>With counts</Heading>
          <View className="mt-3">
            <Tabs value={counts} onValueChange={setCounts}>
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
            </Tabs>
          </View>
        </View>

        <View>
          <Heading level={3}>Disabled tab</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            The Carrying tab is disabled (location/item/faction kinds). Click should not switch.
          </Text>
          <View className="mt-3">
            <Tabs value={withDisabled} onValueChange={setWithDisabled}>
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="carrying" disabled count={0}>
                  Carrying
                </TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
            </Tabs>
          </View>
        </View>

        <View>
          <Heading level={3}>Character kitchen-sink (8 tabs)</Heading>
          <View className="mt-3">
            <Tabs value={kitchen} onValueChange={setKitchen}>
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
            </Tabs>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
