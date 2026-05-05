import { ScrollView, View } from 'react-native'

import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export default function EmptyStateDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View className="gap-2">
          <Heading level={2}>Title only</Heading>
          <View className="rounded-md border border-border bg-bg-base">
            <EmptyState title="No threads on this branch yet." />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Title + plain sub-text</Heading>
          <View className="rounded-md border border-border bg-bg-base">
            <EmptyState
              title="No history yet."
              subtext="Edits and rollbacks will appear here as they happen."
            />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Classifier-written kind (rich sub-text)</Heading>
          <Text size="sm" variant="muted">
            Sub-text accepts a ReactNode so the canonical <Text className="font-medium">+ New</Text>{' '}
            bold marker comes through cleanly.
          </Text>
          <View className="rounded-md border border-border bg-bg-base">
            <EmptyState
              title="No characters on this branch yet."
              subtext={
                <>
                  The classifier writes most rows automatically as the story progresses. You can
                  also add them manually with <Text className="font-medium">+ New</Text> below.
                </>
              }
            />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>User-authored kind</Heading>
          <View className="rounded-md border border-border bg-bg-base">
            <EmptyState
              title="No involvements yet."
              subtext={
                <>
                  Add one with <Text className="font-medium">+ Add involvement</Text> below.
                </>
              }
            />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>In a list-pane shell (fill + center)</Heading>
          <Text size="sm" variant="muted">
            Pass `flex-1` via className when the parent provides a definite height; EmptyState
            centers itself inside.
          </Text>
          <View className="h-80 flex-col rounded-md border border-border bg-bg-base">
            <View className="border-b border-border px-3 py-2">
              <Text size="sm" variant="muted">
                Toolbar (filter chips · search · sort)
              </Text>
            </View>
            <View className="flex-1">
              <EmptyState
                title="No threads on this branch yet."
                subtext={
                  <>
                    The classifier writes most rows automatically as the story progresses. You can
                    also add them manually with <Text className="font-medium">+ New</Text> below.
                  </>
                }
                className="flex-1"
              />
            </View>
            <View className="border-t border-border px-3 py-2">
              <Text size="sm" variant="muted">
                + New thread
              </Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
