import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { BackHandler, Platform, Pressable, ScrollView, View } from 'react-native'

import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { DiagnosticsSettingsPanel } from '@/components/compounds/diagnostics-settings-panel'
import { MasterDetailLayout } from '@/components/shells/master-detail-layout'
import { ScreenShell } from '@/components/shells/screen-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { setDebugLevelEnabled, setDiagnosticsEnabled } from '@/lib/actions'
import { db } from '@/lib/db'
import { t } from '@/lib/i18n'
import { domain } from '@/lib/stores'
import { cn } from '@/lib/utils'

type SettingsTabId =
  | 'providers'
  | 'profiles'
  | 'memory'
  | 'translation'
  | 'composer'
  | 'appearance'
  | 'language'
  | 'data'
  | 'about'
  | 'diagnostics'

const SETTINGS_RAIL_WIDTH = 240

export default function SettingsRoute() {
  const router = useRouter()
  const isPhone = useTier() === 'phone'
  const [selectedTab, setSelectedTab] = useState<SettingsTabId | null>(null)

  const enabled = domain.useAppSettings((s) => s.diagnostics.enabled)
  const debugEnabled = domain.useAppSettings((s) => s.diagnostics.debug_level_enabled)

  // Desktop/tablet always shows a detail pane, so fall back to the default tab;
  // phone is list-first, so no tab is "open" until one is tapped.
  const activeTab: SettingsTabId | null = selectedTab ?? (isPhone ? null : 'diagnostics')

  // Android hardware back pops the open tab back to the list before exiting the
  // route (mirrors the top-bar Return). Focus-scoped so it doesn't swallow back
  // on a screen pushed over Settings (e.g. the Diagnostics Hub).
  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        if (isPhone && selectedTab != null) {
          setSelectedTab(null)
          return true
        }
        return false
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack)
      return () => sub.remove()
    }, [isPhone, selectedTab]),
  )

  const sections: { id: string; header: string; tabs: { id: SettingsTabId; label: string }[] }[] = [
    {
      id: 'generation',
      header: t('settings:sections.generation'),
      tabs: [
        { id: 'providers', label: t('settings:tabs.providers') },
        { id: 'profiles', label: t('settings:tabs.profiles') },
      ],
    },
    {
      id: 'storyDefaults',
      header: t('settings:sections.storyDefaults'),
      tabs: [
        { id: 'memory', label: t('settings:tabs.memory') },
        { id: 'translation', label: t('settings:tabs.translation') },
        { id: 'composer', label: t('settings:tabs.composer') },
      ],
    },
    {
      id: 'app',
      header: t('settings:sections.app'),
      tabs: [
        { id: 'appearance', label: t('settings:tabs.appearance') },
        { id: 'language', label: t('settings:tabs.language') },
        { id: 'data', label: t('settings:tabs.data') },
        { id: 'about', label: t('settings:tabs.about') },
        { id: 'diagnostics', label: t('settings:tabs.diagnostics') },
      ],
    },
  ]

  const rail = (
    <ScrollView
      accessibilityRole="tablist"
      className="flex-1"
      contentContainerClassName="gap-3 p-3"
    >
      {sections.map((section) => (
        <View key={section.id} className="gap-1">
          <Text variant="muted" size="xs" className="px-row-x-md uppercase">
            {section.header}
          </Text>
          {section.tabs.map((tab) => {
            const selected = tab.id === activeTab
            return (
              <Pressable
                key={tab.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setSelectedTab(tab.id)}
                className={cn(
                  'rounded-md px-row-x-md py-row-y-md',
                  selected ? 'bg-tint-press' : Platform.select({ web: 'hover:bg-tint-hover' }),
                )}
              >
                <Text className={selected ? 'font-medium text-fg-primary' : 'text-fg-secondary'}>
                  {tab.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ))}
    </ScrollView>
  )

  const detail = (
    <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">
      {activeTab === 'diagnostics' ? (
        <DiagnosticsSettingsPanel
          enabled={enabled}
          debugEnabled={debugEnabled}
          onToggleEnabled={(next) => void setDiagnosticsEnabled(next, { db })}
          onToggleDebug={(next) => void setDebugLevelEnabled(next, { db })}
        />
      ) : activeTab != null ? (
        <EmptyState title={t('settings:comingSoon')} />
      ) : null}
    </ScrollView>
  )

  // Stack-aware: on phone, the first Return pops the open tab back to the
  // list; once on the list (or on desktop) it exits the surface.
  const onBack = () => {
    if (isPhone && selectedTab != null) setSelectedTab(null)
    else router.back()
  }

  return (
    <ScreenShell
      variant="app"
      title={<Text className="font-semibold">{t('settings:title')}</Text>}
      onBack={onBack}
      actions={<AppActionsMenu />}
    >
      <MasterDetailLayout
        isRowSelected={selectedTab != null}
        listPaneWidth={SETTINGS_RAIL_WIDTH}
        listPane={rail}
        detailPane={detail}
      />
    </ScreenShell>
  )
}
