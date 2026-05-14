import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

/**
 * DetailPane — master-detail right-pane shell for World + Plot.
 *
 * Owns:
 * - **Head layout** — kind-breadcrumb row on top (`kindIcon` +
 *   `kindName`), name row below (`nameSlot` left, `badges` middle,
 *   `overflowMenu` right). Horizontal separator below the head.
 * - **Tabs strip positioning** — immediately below the head
 *   separator. See the `tabs` prop for the chosen integration
 *   pattern.
 * - **Body scroll container** — `flex-1` + `<ScrollView>`. Consumer
 *   renders the per-kind body (forms, lists, etc.); shell owns the
 *   scroll surface so the head + tabs + saveBar stay pinned.
 * - **SaveBar position** — sticky at the bottom (rendered after the
 *   scrollable body inside the outer container). Consumer mounts
 *   the [`SaveBar`](../compounds/save-bar.tsx) compound when its
 *   save-session is dirty.
 *
 * Does NOT own:
 * - **Name editing logic** — `nameSlot` is consumer-rendered (via
 *   [`InlineEditableName`](../ui/inline-editable-name.tsx)); shell
 *   never sees edit state.
 * - **Tab composition / body content** — `tabs` and `children` are
 *   slots. Per-kind tab labels live in `tabs`; per-tab body content
 *   lives in `children`.
 * - **Save-session state** — consumer wires `dirtyFields` /
 *   `onSave` / `onDiscard`; shell only positions the slot.
 * - **Overflow menu trigger / popover state** — consumer-rendered
 *   (`ImporterMenu` or a Popover-with-trigger pattern).
 * - **Cross-tier collapse** — that's
 *   [`MasterDetailLayout`](../../docs/ui/foundations/mobile/collapse.md)
 *   territory.
 *
 * Spec: [`docs/explorations/2026-05-14-shells-design.md → DetailPane`](../../docs/explorations/2026-05-14-shells-design.md#shell-3--detailpane).
 */

type DetailPaneProps = {
  /**
   * Small kind glyph for the kind-breadcrumb row (◇ thread,
   * ☺ character, ▢ item, etc.). Consumer typically passes either
   * an [`Icon`](../ui/icon.tsx) or the shipped
   * [`EntityKindIcon`](../entity/entity-kind-icon.tsx) compound.
   */
  kindIcon: React.ReactNode

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
  nameSlot: React.ReactNode

  /**
   * Optional badge cluster — recently-classified Tag,
   * non-default injection-mode chip, draft chip, etc. Consumer
   * composes (commonly one or two `<Tag>`s); shell positions
   * between `nameSlot` and `overflowMenu`.
   */
  badges?: React.ReactNode

  /**
   * ⋯ menu content (Set as lead, Export entity, View raw JSON,
   * Delete entity, etc.). Consumer renders the trigger + popover
   * (using `ImporterMenu` or a Popover-with-trigger pattern); the
   * shell only anchors the slot on the right of the name row.
   */
  overflowMenu: React.ReactNode

  /**
   * Tabs primitive **strip** — consumer renders a `<TabsList>` of
   * `<TabsTrigger>` children from `components/ui/tabs.tsx`.
   *
   * **Integration pattern (approach 2).** The Tabs primitive's
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
   *
   * Approach 1 (entire `<Tabs>` system inside `children`) was
   * considered and rejected because the wireframe puts the strip
   * directly below the head separator, ahead of the scroll
   * container — a structural split the shell can only honor by
   * positioning the strip itself.
   */
  tabs: React.ReactNode

  /**
   * Selected tab body — typically one or more `<TabsContent>`
   * elements (see `tabs` JSDoc). Shell owns the scroll container;
   * consumer renders the per-kind body (forms, lists, etc.).
   */
  children: React.ReactNode

  /**
   * Optional `<SaveBar>` slot. Consumer mounts when its
   * save-session is dirty; shell pins to the bottom of the pane.
   */
  saveBar?: React.ReactNode

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
      {/* Head — kind-breadcrumb row on top, name row below. Padding
          on the head container (not the rows) so the separator
          stretches full-width without inset gutters. */}
      <View className="flex-col gap-1 px-row-x-md pb-row-y-sm pt-row-y-md">
        {/* Kind-breadcrumb row — small glyph + muted kind label.
            Items aligned to vertical center; small gap keeps icon
            and label visually paired. */}
        <View className="flex-row items-center gap-1">
          {kindIcon}
          <Text size="xs" variant="muted">
            {kindName}
          </Text>
        </View>

        {/* Name row — nameSlot takes the available width; badges
            (if any) sit between the name and the overflow menu;
            overflowMenu right-anchored. min-w-0 on nameSlot lets
            its inner Text truncate inside flex-1 instead of pushing
            the right cluster off-screen. */}
        <View className="flex-row items-center gap-2">
          <View className="min-w-0 flex-1">{nameSlot}</View>
          {badges != null ? (
            <View className="shrink-0 flex-row items-center gap-2">{badges}</View>
          ) : null}
          <View className="shrink-0">{overflowMenu}</View>
        </View>
      </View>

      {/* Head / strip separator — 1 px border, theme-token color. */}
      <View className="h-px bg-border" />

      {/* Tabs strip — sits below the head separator. TabsList in
          components/ui/tabs.tsx already carries its own bottom
          border, so no extra separator is needed between strip and
          body. Horizontal padding matches the head so the active-
          tab underline aligns with the entities above. Wrapped in
          a horizontal ScrollView so a long tab strip (e.g. World's
          8-tab character composition) stays inside the pane width
          and is reachable by swipe / scroll instead of escaping the
          right edge. Consumers wanting a Select substitute at narrow
          tiers (per patterns/tabs.md → Group C rule) pass a Select
          here instead of TabsList. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-none"
        contentContainerClassName="px-row-x-md"
      >
        {tabs}
      </ScrollView>

      {/* Body scroll container — owns vertical scroll so the head,
          tabs, and saveBar stay pinned. `min-h-0` lets ScrollView
          shrink inside the flex parent on web (otherwise content
          would push the saveBar off-screen). */}
      <ScrollView className="min-h-0 flex-1" contentContainerClassName="px-row-x-md py-row-y-md">
        {children}
      </ScrollView>

      {/* SaveBar slot — sticky bottom. SaveBar handles its own
          border-top and warning-tint styling, so the shell only
          provides positional anchoring. */}
      {saveBar}
    </View>
  )
}

export type { DetailPaneProps }
