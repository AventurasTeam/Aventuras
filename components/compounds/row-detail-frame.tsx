import { useState, type ReactNode } from 'react'
import { Controller, type FieldPathByValue, type FieldValues } from 'react-hook-form'
import { View } from 'react-native'

import { DetailPane } from '@/components/shells/detail-pane'
import { InlineEditableName } from '@/components/ui/inline-editable-name'
import { Tabs } from '@/components/ui/tabs'
import { Tag } from '@/components/ui/tag'
import type { RowSaveSession } from '@/hooks/use-row-save-session'
import { saveAvtsFile, type AvtsFile } from '@/lib/avts'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

import { DetailTabs } from './detail-tabs'
import { JSONViewer } from './json-viewer'
import { OverflowMenu } from './overflow-menu'
import type { OverflowMenuEntry } from './overflow-menu-entry'
import { RowLeaveDialog, RowSaveBar } from './row-save-session-chrome'

export type RowDetailMenuActions = { onViewJson: () => void; onExport: () => void }

/** The committed row the head acts on; null in create mode. */
export type RowDetailCommitted = {
  id: string
  /** The JSON viewer's title. */
  name: string
  /** The JSON viewer's data. */
  json: unknown
  exportFile: () => AvtsFile
}

export type RowDetailFrameProps<Draft extends FieldValues, Tab extends string> = {
  session: RowSaveSession<Draft>
  /** The draft's string field the inline name edits. */
  nameField: FieldPathByValue<Draft, string>
  /** The committed name; a save landing mid-edit is what InlineEditableName's Escape restores. */
  savedName: string
  namePlaceholder: string
  nameTestID?: string
  /** The badge's label when the row is recently classified; no badge when absent. */
  recentlyClassifiedLabel?: string
  menuLabel: string
  /** Every `⋯` entry in order; the frame supplies the JSON and export handlers. */
  menuEntries: (actions: RowDetailMenuActions) => OverflowMenuEntry[]
  tab: Tab
  onTabChange: (tab: Tab) => void
  tabs: readonly { value: Tab; label: string; count?: number }[]
  tabSelectLabel: string
  committed: RowDetailCommitted | null
  blocked: boolean
  blockedReason?: string
  hotkeysEnabled: boolean
  /** One `TabsContent` per tab. */
  children: ReactNode
}

async function exportRow(committed: RowDetailCommitted): Promise<void> {
  try {
    // Inside the try: a serializer throw toasts the same as a rejected hand-off.
    await saveAvtsFile(committed.exportFile())
  } catch (error) {
    logger.error('app.row_export_failed', {
      id: committed.id,
      error: error instanceof Error ? error.message : String(error),
    })
    toast.error(t('common:avts.exportFailed'))
  }
}

/** world.md → Detail head structure (name, badge, `⋯`), plus the pane's tabs and save chrome. */
export function RowDetailFrame<Draft extends FieldValues, Tab extends string>({
  session,
  nameField,
  savedName,
  namePlaceholder,
  nameTestID,
  recentlyClassifiedLabel,
  menuLabel,
  menuEntries,
  tab,
  onTabChange,
  tabs,
  tabSelectLabel,
  committed,
  blocked,
  blockedReason,
  hotkeysEnabled,
  children,
}: RowDetailFrameProps<Draft, Tab>): ReactNode {
  const rowId = committed?.id ?? null
  const [jsonOpen, setJsonOpen] = useState(false)
  // Reset in render, not an effect: no commit pairs an open viewer with the next row.
  const [jsonRowId, setJsonRowId] = useState(rowId)
  if (rowId !== jsonRowId) {
    setJsonRowId(rowId)
    setJsonOpen(false)
  }
  const changeTab = (value: string) => onTabChange(value as Tab)
  const name = (
    <Controller
      control={session.form.control}
      name={nameField}
      render={({ field }) => (
        <InlineEditableName
          value={field.value}
          onChange={field.onChange}
          savedValue={savedName}
          placeholder={namePlaceholder}
          size="lg"
          disabled={blocked}
          disabledReason={blockedReason}
        />
      )}
    />
  )
  return (
    <View className="flex-1">
      <Tabs value={tab} onValueChange={changeTab} className="flex-1 gap-0">
        <DetailPane
          nameSlot={nameTestID == null ? name : <View testID={nameTestID}>{name}</View>}
          badges={
            recentlyClassifiedLabel != null ? (
              <Tag tone="recently-classified">{recentlyClassifiedLabel}</Tag>
            ) : undefined
          }
          overflowMenu={
            <OverflowMenu
              label={menuLabel}
              entries={menuEntries({
                onViewJson: () => setJsonOpen(true),
                onExport: () => {
                  if (committed != null) void exportRow(committed)
                },
              })}
              disabled={committed == null}
            />
          }
          tabs={
            <DetailTabs
              tabs={tabs}
              value={tab}
              onValueChange={changeTab}
              selectLabel={tabSelectLabel}
            />
          }
          saveBar={
            <RowSaveBar
              session={session}
              enabled={hotkeysEnabled}
              blocked={blocked}
              blockedReason={blockedReason}
            />
          }
        >
          {children}
        </DetailPane>
      </Tabs>
      <RowLeaveDialog session={session} blocked={blocked} blockedReason={blockedReason} />
      {committed != null ? (
        <JSONViewer
          open={jsonOpen}
          onOpenChange={setJsonOpen}
          name={committed.name}
          data={committed.json}
        />
      ) : null}
    </View>
  )
}
