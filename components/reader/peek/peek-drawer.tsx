import { useEffect, useRef } from 'react'
import { Platform, type View } from 'react-native'

import { railRowHref } from '@/components/reader/rail/rail-modules'
import type { RailData } from '@/components/reader/rail/use-rail-data'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { worldHref } from '@/components/world/world-selection'
import { t } from '@/lib/i18n'
import type { RailPeek } from '@/lib/reader-rail'

import { PeekContent } from './peek-content'
import { isLeadActionDisabled, peekLeadOf, peekNameOf, type PeekLeadControl } from './peek-model'
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
  /** The host clears `peek`; also called when the peeked row stops resolving. */
  onClose: () => void
  /** The C6 route for the peeked row or one of its Overview tabs; the host closes, then routes. */
  onOpenInPanel: (href: string) => void
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
  const open = visible && model != null
  const control: PeekLeadControl = {
    leadId: data.entityListSignals.leadId,
    blocked,
    blockedReason,
    pending,
    onSetLead: setLead,
  }
  const leadAffordance = model == null ? undefined : peekLeadOf(model, control)
  const isLead = leadAffordance?.state === 'lead'
  const leadActionDisabled = isLeadActionDisabled(leadAffordance)
  const dialogRef = useRef<View>(null)
  // Radix returns focus only to a registered DialogTrigger, and this drawer opens from the
  // store: without these refs every close would drop the keyboard on <body>.
  const returnFocusTo = useRef<HTMLElement | null>(null)
  const routedAway = useRef(false)
  const routeOut = (href: string) => {
    routedAway.current = true
    onOpenInPanel(href)
  }

  // A dead id left in the store would reopen the peek when an undo restores the row.
  useEffect(() => {
    if (gone) onClose()
  }, [gone, onClose])

  // A disabled `Set as lead` loses its tab stop and the browser blurs it; a swap for the badge
  // sends Radix's focus to its unnamed wrapper. Either way focus must return to the dialog.
  useEffect(() => {
    if (Platform.OS !== 'web' || !open) return
    const dialog = dialogRef.current as unknown as HTMLElement | null
    if (dialog != null && !dialog.contains(document.activeElement)) dialog.focus()
  }, [open, isLead, leadActionDisabled])

  return (
    <Sheet
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      ariaLabel={model == null ? '' : t('reader:peek.label', { name: peekNameOf(model) })}
      // Land on the named dialog, not its first button: a stray Enter or Space must not set the
      // lead.
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        routedAway.current = false
        if (Platform.OS === 'web') returnFocusTo.current = document.activeElement as HTMLElement
        dialogRef.current?.focus()
      }}
      // Routing away focuses nothing: the reader under the new screen must not take it.
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        const target = returnFocusTo.current
        returnFocusTo.current = null
        if (routedAway.current) {
          routedAway.current = false
        } else if (target?.isConnected) {
          target.focus()
        }
      }}
    >
      <SheetContent
        ref={dialogRef}
        anchor="right"
        className="p-0"
        testID="peek-drawer"
        tabIndex={Platform.OS === 'web' ? -1 : undefined}
      >
        {model != null && peek != null ? (
          <PeekContent
            model={model}
            entityContext={entityContext}
            entryIndex={entryIndex}
            lead={control}
            chrome={{ kind: 'close', onClose }}
            onOpenInPanel={() => routeOut(railRowHref(data.branchId, peek.category, peek.id))}
            onRegionPress={(tab) => {
              if (model.kind !== 'entity') return
              routeOut(
                worldHref(data.branchId, { category: model.row.kind, id: model.row.id, tab }),
              )
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
