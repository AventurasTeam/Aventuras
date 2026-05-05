import { CalendarClock, GitBranch, Pencil, RotateCw, Trash2 } from 'lucide-react-native'
import { ScrollView, View } from 'react-native'

import { DensityPicker } from '@/components/foundations/sections/density-picker'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { IconAction } from '@/components/ui/icon-action'
import { Text } from '@/components/ui/text'

export default function IconActionDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <DensityPicker />
      <View className="flex-col gap-6 p-4">
        <View className="gap-2">
          <Heading level={2}>Variants</Heading>
          <Text size="sm" variant="muted">
            Default vs destructive. Hover the trash icon to see the color shift to danger.
          </Text>
          <View className="flex-row items-center gap-3">
            <IconAction icon={Pencil} label="Edit" />
            <IconAction icon={Trash2} label="Delete" variant="destructive" />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Sizes</Heading>
          <Text size="sm" variant="muted">
            sm · 22-28 px, md · 24-32 px (default), lg · 28-36 px. Density-aware.
          </Text>
          <View className="flex-row items-center gap-3">
            <IconAction icon={Pencil} label="Edit (sm)" size="sm" />
            <IconAction icon={Pencil} label="Edit (md)" size="md" />
            <IconAction icon={Pencil} label="Edit (lg)" size="lg" />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>In-row context</Heading>
          <Text size="sm" variant="muted">
            Default: receded `fg-secondary` color. Row hover (web) brightens to `fg-primary` via
            group-hover. Self-hover adds `bg-tint-hover` and shifts destructive to danger. On
            native, sits at receded color.
          </Text>
          <View className="group flex-row items-center justify-between gap-3 rounded-md border border-border bg-bg-base px-4 py-3">
            <Text>Entry: a brave choice was made…</Text>
            <View className="flex-row items-center gap-1">
              <IconAction icon={Pencil} label="Edit entry" />
              <IconAction icon={RotateCw} label="Regenerate entry" />
              <IconAction icon={GitBranch} label="Branch from entry" />
              <IconAction icon={CalendarClock} label="Flip era from entry" />
              <IconAction icon={Trash2} label="Delete entry" variant="destructive" />
            </View>
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>States</Heading>
          <Text size="sm" variant="muted">
            Disabled uses `text-fg-muted` color (not opacity), keeping it distinguishable from
            enabled-receded on touch where hover is absent. `disabledReason` adds `cursor-help` +
            browser tooltip on web.
          </Text>
          <View className="flex-col gap-3">
            <View className="group flex-row items-center gap-3">
              <Text size="sm" variant="muted" className="w-56">
                Idle (hover row → brightens)
              </Text>
              <IconAction icon={Pencil} label="Edit" />
            </View>
            <View className="group flex-row items-center gap-3">
              <Text size="sm" variant="muted" className="w-56">
                Disabled with reason (web tooltip)
              </Text>
              <IconAction
                icon={GitBranch}
                label="Branch from entry"
                disabled
                disabledReason="Generation in progress — branching available once complete"
              />
            </View>
            <View className="group flex-row items-center gap-3">
              <Text size="sm" variant="muted" className="w-56">
                Disabled, no reason
              </Text>
              <IconAction icon={Trash2} label="Delete" variant="destructive" disabled />
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
