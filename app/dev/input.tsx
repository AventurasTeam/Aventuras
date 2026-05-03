import { Eye, EyeOff, Search } from 'lucide-react-native'
import * as React from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { DensityPicker } from '@/components/foundations/sections/density-picker'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'

export default function InputDevRoute() {
  const [secure, setSecure] = React.useState(true)
  const [autoGrow, setAutoGrow] = React.useState(
    'Try typing — this textarea grows from rows=2 up to maxRows=6.\n',
  )

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <DensityPicker />
      <View className="gap-6 p-4">
        <View className="gap-2">
          <Heading level={2}>Input — sizes</Heading>
          <Input size="sm" placeholder="Small" />
          <Input size="md" placeholder="Medium (default)" />
          <Input size="lg" placeholder="Large" />
        </View>

        <View className="gap-2">
          <Heading level={2}>Input — states</Heading>
          <Input placeholder="Default" />
          <Input editable={false} value="Disabled" />
          <Input aria-invalid value="invalid@" placeholder="Error (aria-invalid)" />
        </View>

        <View className="gap-2">
          <Heading level={2}>Input — narrow numeric</Heading>
          <View className="flex-row items-center gap-2">
            <Text>Year:</Text>
            <Input keyboardType="numeric" defaultValue="2024" className="w-24" />
            <Text>Era day:</Text>
            <Input keyboardType="numeric" defaultValue="1" className="w-16" />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Input — adornments</Heading>
          <Input
            placeholder="Search…"
            leading={<Icon as={Search} size={16} className="text-fg-muted" />}
          />
          <Input
            placeholder="API key"
            secureTextEntry={secure}
            defaultValue="sk-or-v1-abcdef0123"
            trailing={
              <Pressable
                onPress={() => setSecure((s) => !s)}
                accessibilityLabel={secure ? 'Show value' : 'Hide value'}
              >
                <Icon as={secure ? EyeOff : Eye} size={16} className="text-fg-muted" />
              </Pressable>
            }
          />
          <Input
            placeholder="Search fields…"
            leading={<Icon as={Search} size={16} className="text-fg-muted" />}
            trailing={
              <Pressable accessibilityLabel="Search syntax help">
                <Text size="sm" variant="muted">
                  ?
                </Text>
              </Pressable>
            }
          />
        </View>

        <View className="gap-2">
          <Heading level={2}>Textarea — rows</Heading>
          <Textarea rows={3} placeholder="3 rows" />
          <Textarea rows={5} placeholder="5 rows" />
        </View>

        <View className="gap-2">
          <Heading level={2}>Textarea — auto-grow</Heading>
          <Textarea
            value={autoGrow}
            onChangeText={setAutoGrow}
            rows={2}
            maxRows={6}
            placeholder="rows=2, maxRows=6"
          />
          <Text size="sm" variant="muted">
            Web grows via field-sizing-content; native grows via onContentSizeChange. Both clamp at
            maxRows.
          </Text>
        </View>

        <View className="gap-2">
          <Heading level={2}>Textarea — states</Heading>
          <Textarea placeholder="Default" />
          <Textarea editable={false} value="Disabled" />
          <Textarea aria-invalid value="" placeholder="Error (aria-invalid)" />
        </View>
      </View>
    </ScrollView>
  )
}
