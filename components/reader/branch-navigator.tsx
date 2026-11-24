import type { TriggerRef } from '@rn-primitives/popover'
import { Check, Circle, Pencil, Trash2, X } from 'lucide-react-native'
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type Ref,
  type SetStateAction,
} from 'react'
import { Platform, Pressable, View, type ViewStyle } from 'react-native'
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler'

import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  ContextScrollView,
  ScrollComponentContext,
  type ScrollComponent,
} from '@/components/ui/scroll-component'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useHeldUntilDismissed, type HeldUntilDismissed } from '@/hooks/use-held-until-dismissed'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { BranchChip, BranchNavigatorAnchor } from './branch-chip'
import { BranchRenameInput } from './branch-rename-input'

export type BranchNavigatorRow = { id: string; name: string }

export type BranchNavigatorHandle = { open: () => void; close: () => void }

export type BranchNavigatorProps = {
  /** In `created_at` order; the view puts the current branch first. */
  rows: readonly BranchNavigatorRow[]
  currentBranchId: string
  /** The trigger's view: the chip above one branch, the anchor otherwise. */
  chip: { count: number; currentName: string | null }
  paused: boolean
  /** Never called for the current row; on phone, after the Sheet's exit. */
  onSwitch: (branchId: string) => void
  onRename: (branchId: string, name: string) => Promise<unknown>
  /** Renders `×` on every row but the current one. */
  onDelete?: (branchId: string) => void
  onOpenChange?: (open: boolean) => void
  ref?: Ref<BranchNavigatorHandle>
}

type Arm = { root: string; row: string; list: ViewStyle }

// A list needs a bound to scroll: 320 on the Popover, which shrinks it in a short window; the
// Sheet's list takes what its detent leaves over.
const POPOVER_ARM: Arm = {
  root: 'min-h-0 shrink gap-2 p-3',
  row: 'min-h-control-md',
  list: { maxHeight: 320, flexShrink: 1 },
}
// rn-primitives' Popover content claims the touch responder, which stalls a plain ScrollView on
// Android; gesture-handler's doesn't use the responder system.
const POPOVER_SCROLL = GestureScrollView as ScrollComponent
const SHEET_ARM: Arm = { root: 'flex-1 gap-2', row: 'min-h-control-lg', list: { flex: 1 } }

type SetRenaming = Dispatch<SetStateAction<string | null>>

/** Popover on desktop and tablet, a short bottom Sheet on phone; the handle opens either arm. */
export function BranchNavigator(props: BranchNavigatorProps): ReactElement {
  const isPhone = useTier() === 'phone'
  const afterDismiss = useHeldUntilDismissed(isPhone)
  return isPhone ? <SheetArm {...props} afterDismiss={afterDismiss} /> : <PopoverArm {...props} />
}

/** The chip shows above one branch, once the current branch's name is known. */
function shownChip({ count, currentName }: BranchNavigatorProps['chip']) {
  return count > 1 && currentName != null ? { count, currentName } : null
}

function currentFirst(
  rows: readonly BranchNavigatorRow[],
  currentBranchId: string,
): readonly BranchNavigatorRow[] {
  const current = rows.find((row) => row.id === currentBranchId)
  return current == null ? rows : [current, ...rows.filter((row) => row.id !== currentBranchId)]
}

// TriggerRef.close() calls onOpenChange on a closed popover too; only a change is reported.
function useReportedOpen(onOpenChange: BranchNavigatorProps['onOpenChange']) {
  const [open, setOpen] = useState(false)
  const change = (next: boolean) => {
    if (next === open) return
    setOpen(next)
    onOpenChange?.(next)
  }
  // A tier flip swaps the arms, and the open one unmounts without closing.
  const committed = useRef({ open, onOpenChange })
  useEffect(() => {
    committed.current = { open, onOpenChange }
  })
  useEffect(
    () => () => {
      if (committed.current.open) committed.current.onOpenChange?.(false)
    },
    [],
  )
  return [open, change] as const
}

function PopoverArm({ chip, onOpenChange, ref, ...content }: BranchNavigatorProps) {
  const trigger = useRef<TriggerRef>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [open, reportOpen] = useReportedOpen(onOpenChange)
  const change = (next: boolean) => {
    if (!next) setRenamingId(null)
    reportOpen(next)
  }
  const close = () => trigger.current?.close()
  const closeThen = (run: () => void) => {
    close()
    run()
  }
  const shown = shownChip(chip)

  // Radix returns focus to its trigger; a navigator the handle opened returns it to what opened
  // it, and the hidden anchor takes none. Neither after an outside press or focus, which has put
  // focus where the user wanted it.
  const opener = useRef<HTMLElement | null>(null)
  const interactedOutside = useRef(false)
  const returnFocus = (event: Event) => {
    const target = opener.current
    opener.current = null
    const outside = interactedOutside.current
    interactedOutside.current = false
    if (outside) return
    if (target != null && target.isConnected) {
      event.preventDefault()
      target.focus()
    } else if (shown == null) {
      event.preventDefault()
    }
  }

  useImperativeHandle(ref, () => ({
    open: () => {
      if (Platform.OS === 'web') {
        const active = document.activeElement
        opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      }
      trigger.current?.open()
    },
    close,
  }))

  return (
    <Popover
      ariaLabel={t('reader:branches.title', { count: content.rows.length })}
      onOpenChange={change}
      onCloseAutoFocus={returnFocus}
    >
      <PopoverTrigger ref={trigger} asChild>
        {shown != null ? (
          <BranchChip count={shown.count} currentName={shown.currentName} expanded={open} />
        ) : (
          <BranchNavigatorAnchor />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[360px] p-0"
        // Radix hears Esc first, on the document; while a row renames, Esc is the input's cancel.
        onEscapeKeyDown={(event) => {
          if (renamingId != null) event.preventDefault()
        }}
        onInteractOutside={() => {
          interactedOutside.current = true
        }}
      >
        <ScrollComponentContext.Provider value={POPOVER_SCROLL}>
          <NavigatorBody
            {...content}
            arm={POPOVER_ARM}
            renamingId={renamingId}
            setRenamingId={setRenamingId}
            close={close}
            closeThen={closeThen}
            onClose={close}
          />
        </ScrollComponentContext.Provider>
      </PopoverContent>
    </Popover>
  )
}

function SheetArm({
  chip,
  onOpenChange,
  ref,
  afterDismiss,
  ...content
}: BranchNavigatorProps & { afterDismiss: HeldUntilDismissed }) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [open, reportOpen] = useReportedOpen(onOpenChange)
  // layout.md → Stacking: the Sheet dismisses before the reader it leads to takes over.
  const change = (next: boolean) => {
    if (next) afterDismiss.clear()
    else setRenamingId(null)
    reportOpen(next)
  }
  const close = () => change(false)
  const closeThen = (run: () => void) => {
    afterDismiss.hold(run)
    change(false)
  }
  const shown = shownChip(chip)

  useImperativeHandle(ref, () => ({ open: () => change(true), close }))

  return (
    <Sheet
      open={open}
      onOpenChange={change}
      ariaLabel={t('reader:branches.title', { count: content.rows.length })}
    >
      {shown != null ? (
        <SheetTrigger asChild>
          <BranchChip count={shown.count} currentName={shown.currentName} expanded={open} />
        </SheetTrigger>
      ) : null}
      <SheetContent size="short" onDismissed={afterDismiss.runHeld}>
        <NavigatorBody
          {...content}
          arm={SHEET_ARM}
          renamingId={renamingId}
          setRenamingId={setRenamingId}
          close={close}
          closeThen={closeThen}
        />
      </SheetContent>
    </Sheet>
  )
}

type NavigatorBodyProps = Pick<
  BranchNavigatorProps,
  'rows' | 'currentBranchId' | 'paused' | 'onSwitch' | 'onRename' | 'onDelete'
> & {
  arm: Arm
  renamingId: string | null
  setRenamingId: SetRenaming
  close: () => void
  /** Closes the overlay, then runs `run`: at once on the Popover, after its exit on the Sheet. */
  closeThen: (run: () => void) => void
  /** The Popover's close affordance; the Sheet closes by its handle, a backdrop tap or back. */
  onClose?: () => void
}

function NavigatorBody({
  rows,
  currentBranchId,
  paused,
  onSwitch,
  onRename,
  onDelete,
  arm,
  renamingId,
  setRenamingId,
  close,
  closeThen,
  onClose,
}: NavigatorBodyProps) {
  const press = (id: string) => {
    if (id === currentBranchId) close()
    else closeThen(() => onSwitch(id))
  }
  return (
    <View className={arm.root}>
      <View className="flex-row items-center justify-between gap-2 pl-row-x-md">
        <Text size="sm" numberOfLines={1} className="font-medium">
          {t('reader:branches.title', { count: rows.length })}
        </Text>
        {onClose != null ? (
          <IconAction icon={X} size="sm" label={t('reader:branches.close')} onPress={onClose} />
        ) : null}
      </View>
      {paused ? (
        <View role="status" className="rounded-sm bg-bg-sunken px-row-x-md py-row-y-sm">
          <Text size="xs" variant="secondary">
            {t('reader:branches.paused')}
          </Text>
        </View>
      ) : null}
      <ContextScrollView
        testID="branch-navigator-list"
        keyboardShouldPersistTaps="handled"
        style={arm.list}
      >
        {currentFirst(rows, currentBranchId).map((row) => (
          <NavigatorRow
            key={row.id}
            row={row}
            current={row.id === currentBranchId}
            paused={paused}
            renaming={row.id === renamingId}
            className={arm.row}
            onPress={() => press(row.id)}
            onStartRename={() => setRenamingId(row.id)}
            onRename={(name) => onRename(row.id, name)}
            onRenameDone={() => setRenamingId((id) => (id === row.id ? null : id))}
            onDelete={onDelete != null ? () => onDelete(row.id) : undefined}
          />
        ))}
      </ContextScrollView>
    </View>
  )
}

type NavigatorRowProps = {
  row: BranchNavigatorRow
  current: boolean
  paused: boolean
  renaming: boolean
  className: string
  onPress: () => void
  onStartRename: () => void
  onRename: (name: string) => Promise<unknown>
  onRenameDone: () => void
  onDelete?: () => void
}

function NavigatorRow({
  row,
  current,
  paused,
  renaming,
  className,
  onPress,
  onStartRename,
  onRename,
  onRenameDone,
  onDelete,
}: NavigatorRowProps) {
  if (renaming) {
    // Not the row's pressable: no key or press inside the input can switch branches.
    return (
      <View
        testID="branch-navigator-row"
        className={cn('flex-row items-center gap-2 px-row-x-md', className)}
      >
        <BranchMarker current={current} />
        <View className="min-w-0 flex-1">
          <BranchRenameInput name={row.name} onSave={onRename} onDone={onRenameDone} />
        </View>
      </View>
    )
  }
  return (
    <View
      testID="branch-navigator-row"
      // Web only: on native a `group` class turns this View into a Pressable that takes the taps.
      className={cn(
        'flex-row items-center gap-1 pr-1',
        className,
        Platform.select({ web: 'group' }),
      )}
    >
      <Pressable
        accessibilityRole="button"
        disabled={paused}
        onPress={onPress}
        className={cn(
          'min-w-0 flex-1 flex-row items-center gap-2 self-stretch rounded-sm px-row-x-md',
          paused
            ? 'opacity-50'
            : cn(
                'active:bg-tint-press',
                Platform.select({
                  web: 'cursor-pointer outline-none hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-focus-ring',
                }),
              ),
        )}
      >
        <BranchMarker current={current} />
        <Text
          size="sm"
          numberOfLines={1}
          className={cn('min-w-0 flex-1', current && 'font-medium')}
        >
          {row.name}
        </Text>
      </Pressable>
      <IconAction
        icon={Pencil}
        size="sm"
        label={t('reader:branches.rename', { name: row.name })}
        onPress={onStartRename}
      />
      {onDelete != null && !current ? (
        <IconAction
          icon={Trash2}
          size="sm"
          variant="destructive"
          label={t('reader:branches.delete', { name: row.name })}
          onPress={onDelete}
        />
      ) : null}
    </View>
  )
}

function BranchMarker({ current }: { current: boolean }) {
  return current ? (
    <View role="img" aria-label={t('reader:branches.current')} className="w-4 items-center">
      <Icon as={Check} size="sm" />
    </View>
  ) : (
    <View aria-hidden className="w-4 items-center">
      <Icon as={Circle} size="sm" className="text-fg-muted" />
    </View>
  )
}
