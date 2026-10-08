import { useEffect } from 'react'

import { railRowHref } from '@/components/reader/rail/rail-modules'
import type { RailData } from '@/components/reader/rail/use-rail-data'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { worldHref } from '@/components/world/world-selection'
import { t } from '@/lib/i18n'
import type { RailPeek } from '@/lib/reader-rail'

import { PeekContent } from './peek-content'
import type { PeekModel } from './peek-model'
import { usePeekView } from './use-peek-view'
import { useSetLead } from './use-set-lead'

export type PeekDrawerProps = {
  data: RailData
  /** The host's gate: rail shown expanded, reader focused. */
  visible: boolean
  peek: RailPeek | null
  storyId: string | null
  blocked: boolean
  blockedReason: string | undefined
  onClose: () => void
  /** The C6 route for the peeked row or one of its Overview tabs; the host closes, then routes. */
  onOpenInPanel: (href: string) => void
}

function peekName(model: PeekModel): string {
  return model.kind === 'entity' ? model.row.name : model.row.title
}

/** layout.md → Sheet: the desktop / tablet peek, a right Sheet over a scrim. */
export function PeekDrawer({
  data,
  visible,
  peek,
  storyId,
  blocked,
  blockedReason,
  onClose,
  onOpenInPanel,
}: PeekDrawerProps) {
  // Called here, above SheetContent's Portal, which drops custom contexts on native.
  const { model, entityContext, entryIndex } = usePeekView(peek, data)
  const { pending, setLead } = useSetLead(storyId)
  const gone = peek != null && model == null

  // A dead id left in the store would reopen the peek when an undo restores the row.
  useEffect(() => {
    if (gone) onClose()
  }, [gone, onClose])

  return (
    <Sheet
      open={visible && model != null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      ariaLabel={model == null ? '' : t('reader:peek.label', { name: peekName(model) })}
      // Land on the drawer, not its first button: a stray Enter or Space must not set the lead.
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        ;(event.currentTarget as HTMLElement | null)?.focus()
      }}
    >
      <SheetContent anchor="right" className="p-0" testID="peek-drawer">
        {model != null && peek != null ? (
          <PeekContent
            model={model}
            entityContext={entityContext}
            entryIndex={entryIndex}
            lead={{
              leadId: data.entityListSignals.leadId,
              blocked,
              blockedReason,
              pending,
              onSetLead: setLead,
            }}
            chrome={{ kind: 'close', onClose }}
            onOpenInPanel={() => onOpenInPanel(railRowHref(data.branchId, peek.category, peek.id))}
            onRegionPress={(tab) => {
              if (model.kind !== 'entity') return
              onOpenInPanel(
                worldHref(data.branchId, { category: model.row.kind, id: model.row.id, tab }),
              )
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
