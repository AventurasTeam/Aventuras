import { type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type DetailPaneProps = {
  /**
   * Small kind glyph for the kind-breadcrumb row (◇ thread,
   * ☺ character, ▢ item, etc.).
   */
  kindIcon: ReactNode

  /**
   * Kind label rendered alongside `kindIcon`. e.g. `"character"`,
   * `"location"`, `"thread"`, `"happening"`, `"lore"`.
   */
  kindName: string

  /**
   * Inline-editable name compound — consumer renders
   * `<InlineEditableName value=... onChange=... size="lg" />`.
   * Shell only positions the slot; it never sees edit state.
   */
  nameSlot: ReactNode

  /**
   * Optional badge cluster — recently-classified Tag,
   * non-default injection-mode chip, draft chip, etc. Consumer
   * composes (commonly one or two `<Tag>`s); shell positions
   * between `nameSlot` and `overflowMenu`.
   */
  badges?: ReactNode

  /**
   * ⋯ menu content (Set as lead, Export entity, View raw JSON,
   * Delete entity, etc.). Consumer renders the trigger + popover
   * (using `ImporterMenu` or a Popover-with-trigger pattern); the
   * shell only anchors the slot on the right of the name row.
   */
  overflowMenu: ReactNode

  /**
   * Tabs primitive **strip** — consumer renders a `<TabsList>` of
   * `<TabsTrigger>` children from `components/ui/tabs.tsx`.
   *
   * **Integration pattern.** The Tabs primitive's
   * `TabsList` / `TabsContent` read state from a shared `<Tabs>`
   * (Root) context via `useRootContext`, so the consumer wraps the
   * **whole DetailPane** in a single `<Tabs>` Root and splits the
   * strip across this `tabs` slot while the per-tab bodies render
   * inside `children` as `<TabsContent>` elements:
   *
   * ```tsx
   * <Tabs value={value} onValueChange={setValue}>
   *   <DetailPane
   *     tabs={
   *       <TabsList>
   *         <TabsTrigger value="overview">Overview</TabsTrigger>
   *         <TabsTrigger value="history">History</TabsTrigger>
   *       </TabsList>
   *     }
   *   >
   *     <TabsContent value="overview">…</TabsContent>
   *     <TabsContent value="history">…</TabsContent>
   *   </DetailPane>
   * </Tabs>
   * ```
   */
  tabs: ReactNode
  children: ReactNode

  /**
   * Optional `<SaveBar>` slot. Consumer mounts when its
   * save-session is dirty; shell pins to the bottom of the pane.
   */
  saveBar?: ReactNode

  className?: string
}

export function DetailPane({
  kindIcon,
  kindName,
  nameSlot,
  badges,
  overflowMenu,
  tabs,
  children,
  saveBar,
  className,
}: DetailPaneProps) {
  return (
    <View className={cn('flex-1 flex-col bg-bg-base', className)}>
      <View className="flex-col gap-1 px-row-x-md pb-row-y-sm pt-row-y-md">
        <View className="flex-row items-center gap-1">
          {kindIcon}
          <Text size="xs" variant="muted">
            {kindName}
          </Text>
        </View>

        <View className="flex-row items-center gap-2">
          <View className="min-w-0 flex-1">{nameSlot}</View>
          {badges != null ? (
            <View className="shrink-0 flex-row items-center gap-2">{badges}</View>
          ) : null}
          <View className="shrink-0">{overflowMenu}</View>
        </View>
      </View>

      <View className="h-px bg-border" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-none"
        contentContainerClassName="px-row-x-md"
      >
        {tabs}
      </ScrollView>

      <ScrollView className="min-h-0 flex-1" contentContainerClassName="px-row-x-md py-row-y-md">
        {children}
      </ScrollView>

      {saveBar}
    </View>
  )
}

export type { DetailPaneProps }
