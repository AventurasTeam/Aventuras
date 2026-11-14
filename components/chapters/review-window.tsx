import { TriangleAlert } from 'lucide-react-native'
import type { ReactElement } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { DeltaLogRow, type Delta, type DeltaOp } from '@/components/compounds/delta-log-row'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { ContextScrollView } from '@/components/ui/scroll-component'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
import { useTier } from '@/hooks/use-tier'
import type { CloseReview, CloseReviewChange, CloseReviewNotApplied } from '@/lib/history'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { toolLabel } from './review-tool-label'

export type ReviewWindowState =
  | { status: 'loading' }
  | { status: 'failed'; onRetry: () => void }
  | { status: 'ready'; review: CloseReview }

export type EntryLink = { label: string; onPress: () => void }

export type ReviewWindowProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `Review — Chapter <N>: <title>`, built by the host. */
  title: string
  state: ReviewWindowState
  /** A row's press, or undefined for an unpressable row. */
  pressOf: (row: CloseReviewChange | CloseReviewNotApplied) => (() => void) | undefined
  /** A Changes row's entry link, or undefined when its entry isn't on the branch. */
  entryLinkOf: (row: CloseReviewChange) => EntryLink | undefined
}
type RowCallbacks = Pick<ReviewWindowProps, 'pressOf' | 'entryLinkOf'> & { isPhone: boolean }

/**
 * chapter-timeline.md → Review window: read-only, a Dialog above phone and a tall Sheet on phone,
 * the list scrolling between a pinned head and foot. Props in: the host resolves every read.
 */
export function ReviewWindow({
  open,
  onOpenChange,
  title,
  state,
  pressOf,
  entryLinkOf,
}: ReviewWindowProps): ReactElement {
  const isPhone = useTier() === 'phone'
  const list = (
    <ContextScrollView
      testID="review-window-list"
      keyboardShouldPersistTaps="handled"
      className={isPhone ? 'flex-1' : 'shrink'}
      contentContainerClassName="gap-4"
    >
      <ReviewBody state={state} pressOf={pressOf} entryLinkOf={entryLinkOf} isPhone={isPhone} />
    </ContextScrollView>
  )
  const done = (
    <Button variant="primary" onPress={() => onOpenChange(false)}>
      <Text>{t('chapters:review.done')}</Text>
    </Button>
  )
  if (isPhone) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} ariaLabel={title}>
        <SheetContent size="tall" className="gap-4">
          <Heading level={2}>{title}</Heading>
          {list}
          {done}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable={false} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle role="heading" aria-level="2">
            {title}
          </DialogTitle>
        </DialogHeader>
        {list}
        <DialogFooter>{done}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReviewBody({ state, ...rows }: RowCallbacks & { state: ReviewWindowState }): ReactElement {
  switch (state.status) {
    case 'loading':
      return (
        <View className="flex-row items-center gap-2 py-4">
          <Spinner size="sm" />
          <Text size="sm" variant="muted">
            {t('chapters:review.loading')}
          </Text>
        </View>
      )
    case 'failed':
      return (
        <View className="items-start gap-3 py-4">
          <Text size="sm">{t('chapters:review.failed')}</Text>
          <Button variant="secondary" size="sm" onPress={state.onRetry}>
            <Text>{t('chapters:review.retry')}</Text>
          </Button>
        </View>
      )
    case 'ready':
      return <ReviewSections review={state.review} {...rows} />
  }
}

function isEmptyReview(review: CloseReview): boolean {
  return (
    review.stopped.length === 0 &&
    !review.noToolCalls &&
    review.notApplied.length === 0 &&
    review.changes.length === 0
  )
}

function ReviewSections({
  review,
  pressOf,
  entryLinkOf,
  isPhone,
}: RowCallbacks & { review: CloseReview }): ReactElement {
  if (isEmptyReview(review)) {
    return (
      <Text size="sm" variant="muted" className="py-4">
        {t('chapters:review.empty')}
      </Text>
    )
  }
  return (
    <>
      <StoppedEarly stopped={review.stopped} noToolCalls={review.noToolCalls} />
      <NotApplied rows={review.notApplied} pressOf={pressOf} />
      {review.changes.map((group) => (
        <View key={group.area} className="gap-1">
          <Heading level={3} size="xs" variant="muted" className="uppercase tracking-wide">
            {t(`chapters:review.area.${group.area}`)}
          </Heading>
          {group.rows.map((row) => (
            <DeltaLogRow
              key={row.key}
              delta={rowDelta(row.key, row.op, row.target, row.fieldLabel, row.summary)}
              onPress={pressOf(row)}
              showMeta={false}
              summaryLines={null}
              footer={<RowFooter text={row.why} link={entryLinkOf(row)} isPhone={isPhone} />}
            />
          ))}
        </View>
      ))}
    </>
  )
}

/** Not folded: the work is partial. The no-tool note sits here without a stopped heading. */
function StoppedEarly({
  stopped,
  noToolCalls,
}: Pick<CloseReview, 'stopped' | 'noToolCalls'>): ReactElement | null {
  if (stopped.length === 0 && !noToolCalls) return null
  return (
    <View className="relative gap-1 overflow-hidden rounded-md border border-warning px-3 py-2">
      <View
        aria-hidden
        style={POINTER_EVENTS_NONE}
        className="absolute inset-0 bg-warning opacity-[.12]"
      />
      {stopped.length > 0 ? (
        <View className="flex-row items-center gap-1.5">
          <Icon as={TriangleAlert} size="sm" className="text-warning" />
          <Heading level={3} size="sm">
            {t('chapters:review.stoppedEarly')}
          </Heading>
        </View>
      ) : null}
      {stopped.map((line) => (
        <Text key={`${line.task}:${line.part}:${line.reason}`} size="sm">
          {line.text}
        </Text>
      ))}
      {noToolCalls ? <Text size="sm">{t('chapters:review.noToolCalls')}</Text> : null}
    </View>
  )
}

function NotApplied({
  rows,
  pressOf,
}: {
  rows: CloseReview['notApplied']
  pressOf: ReviewWindowProps['pressOf']
}): ReactElement | null {
  if (rows.length === 0) return null
  return (
    <Accordion type="single" collapsible defaultValue="">
      <AccordionItem value="not-applied" className="rounded-md border border-border px-3">
        <AccordionTrigger>
          <Text>{t('chapters:review.notApplied', { count: rows.length })}</Text>
        </AccordionTrigger>
        <AccordionContent className="gap-1">
          {rows.map((row) => (
            <DeltaLogRow
              key={row.key}
              delta={rowDelta(
                row.key,
                row.op,
                row.target ?? { table: '', name: toolLabel(row.tool) },
                row.fieldLabel,
                row.summary,
              )}
              onPress={pressOf(row)}
              showMeta={false}
              summaryLines={null}
              footer={<RowFooter text={row.reasonText} />}
            />
          ))}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function RowFooter({
  text,
  link,
  isPhone = false,
}: {
  text: string
  link?: EntryLink
  isPhone?: boolean
}): ReactElement {
  return (
    <View className="flex-row flex-wrap items-center gap-x-2">
      {text === '' ? null : (
        <Text size="sm" variant="muted" className="shrink">
          {text}
        </Text>
      )}
      {link == null ? null : (
        <Pressable
          accessibilityRole="link"
          onPress={link.onPress}
          {...webEnterProps(link.onPress)}
          className={cn(
            'rounded-sm',
            // touch.md → Touch-target floor.
            isPhone && 'min-h-touch justify-center',
            Platform.select({
              web: 'cursor-pointer outline-none hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-focus-ring',
            }),
          )}
        >
          <Text size="sm" className="underline">
            {link.label}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

// The row's name carries no entry: the footer's link names it (delta-log-row.md → Click behavior).
function rowDelta(
  key: string,
  op: DeltaOp,
  target: { table: string; name: string },
  fieldLabel: string | null,
  summary: string,
): Delta {
  return {
    id: key,
    op,
    source: 'chapter_close',
    targetTable: target.table,
    targetDisplayName: target.name,
    fieldPath: fieldLabel,
    summary,
    entryId: null,
    createdAtRelative: '',
    actionId: '',
  }
}

// RN-Web's PressResponder presses a role=link element on click only, never on Enter.
// Cast: RN's Pressable types omit onKeyDown.
function webEnterProps(onPress: () => void): object | undefined {
  if (Platform.OS !== 'web') return undefined
  return {
    onKeyDown: (event: { key: string; preventDefault(): void }) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      onPress()
    },
  }
}
