import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { DensityPicker } from '@/components/foundations/sections/density-picker'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'

export default function LoadingDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <DensityPicker />
      <View className="gap-6 p-4">
        <View className="gap-2">
          <Heading level={2}>Spinner — sizes</Heading>
          <Text size="sm" variant="muted">
            sm/md/lg matches Icon&apos;s scale (16/20/24).
          </Text>
          <View className="flex-row items-end gap-6">
            <View className="items-center gap-1">
              <Spinner size="sm" />
              <Text variant="muted" size="sm">
                sm
              </Text>
            </View>
            <View className="items-center gap-1">
              <Spinner size="md" />
              <Text variant="muted" size="sm">
                md
              </Text>
            </View>
            <View className="items-center gap-1">
              <Spinner size="lg" />
              <Text variant="muted" size="sm">
                lg
              </Text>
            </View>
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Spinner — color slots</Heading>
          <View className="flex-row items-center gap-6">
            <Spinner colorSlot="--fg-primary" />
            <Spinner colorSlot="--fg-muted" />
            <Spinner colorSlot="--accent" />
            <Spinner colorSlot="--danger" />
            <Spinner colorSlot="--success" />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Spinner — inside Button</Heading>
          <Text size="sm" variant="muted">
            Button retrofit: ActivityIndicator workaround replaced with Spinner.
          </Text>
          <View className="flex-row flex-wrap gap-3">
            <Button loading variant="primary">
              <Text>Primary</Text>
            </Button>
            <Button loading variant="secondary">
              <Text>Secondary</Text>
            </Button>
            <Button loading variant="ghost">
              <Text>Ghost</Text>
            </Button>
            <Button loading variant="destructive">
              <Text>Destructive</Text>
            </Button>
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Skeleton — entity row</Heading>
          <Text size="sm" variant="muted">
            Avatar + two text lines, the canonical list-row hydration shape.
          </Text>
          <View className="gap-3">
            {[0, 1, 2].map((i) => (
              <View key={i} className="flex-row items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <View className="flex-1 gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </View>
              </View>
            ))}
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Skeleton — paragraph</Heading>
          <View className="gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Skeleton — block shapes</Heading>
          <View className="gap-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
