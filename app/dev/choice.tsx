import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { DensityPicker } from '@/components/foundations/sections/density-picker'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Checkbox } from '@/components/ui/checkbox'
import { Heading } from '@/components/ui/heading'
import { Switch } from '@/components/ui/switch'
import { Text } from '@/components/ui/text'

export default function ChoiceDevRoute() {
  const [switchValue, setSwitchValue] = React.useState(false)
  const [checkboxValue, setCheckboxValue] = React.useState(false)
  const [groupSelections, setGroupSelections] = React.useState<Record<string, boolean>>({
    a: true,
    b: false,
    c: false,
  })
  const noop = () => {}

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <DensityPicker />
      <View className="gap-6 p-4">
        <View className="gap-2">
          <Heading level={2}>Switch — controlled</Heading>
          <View className="flex-row items-center gap-3">
            <Switch checked={switchValue} onCheckedChange={setSwitchValue} />
            <Text>{switchValue ? 'On' : 'Off'}</Text>
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Switch — states</Heading>
          <View className="flex-row items-center gap-3">
            <Switch checked={false} onCheckedChange={noop} />
            <Switch checked={true} onCheckedChange={noop} />
            <Switch checked={false} disabled onCheckedChange={noop} />
            <Switch checked={true} disabled onCheckedChange={noop} />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Checkbox — controlled</Heading>
          <View className="flex-row items-center gap-3">
            <Checkbox checked={checkboxValue} onCheckedChange={setCheckboxValue} />
            <Text>{checkboxValue ? 'Checked' : 'Unchecked'}</Text>
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Checkbox — states</Heading>
          <View className="flex-row items-center gap-3">
            <Checkbox checked={false} onCheckedChange={noop} />
            <Checkbox checked={true} onCheckedChange={noop} />
            <Checkbox checked={false} disabled onCheckedChange={noop} />
            <Checkbox checked={true} disabled onCheckedChange={noop} />
            <Checkbox checked={false} aria-invalid onCheckedChange={noop} />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Checkbox — multi-select group</Heading>
          {(['a', 'b', 'c'] as const).map((key) => (
            <View key={key} className="flex-row items-center gap-3">
              <Checkbox
                checked={groupSelections[key]}
                onCheckedChange={(checked) =>
                  setGroupSelections((prev) => ({ ...prev, [key]: checked }))
                }
              />
              <Text>Option {key.toUpperCase()}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  )
}
