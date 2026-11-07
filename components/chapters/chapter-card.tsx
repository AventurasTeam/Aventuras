import { ChevronDown, ChevronRight } from 'lucide-react-native'
import type { ReactElement } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { Platform, Pressable, View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { OverflowMenu } from '@/components/compounds/overflow-menu'
import {
  destructiveEntry,
  type OverflowMenuEntry,
} from '@/components/compounds/overflow-menu-entry'
import { RowSaveBar } from '@/components/compounds/row-save-session-chrome'
import { TagInput } from '@/components/compounds/tag-input'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import type { RowSaveSession } from '@/hooks/use-row-save-session'
import { useTier } from '@/hooks/use-tier'
import type { ChapterDraft } from '@/lib/chapters'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import {
  chapterFieldLabel,
  chapterHeading,
  chapterIssueText,
  closedAtLabel,
  compactTokenLabel,
  entryRangeLabel,
  fullTokenLabel,
} from './chapter-copy'
import type { ChapterCardData } from './chapter-timeline-data'

export type ChapterCardProps = {
  data: ChapterCardData
  expanded: boolean
  /** The head's press, on both states; the route guards it. */
  onToggle: () => void
  /** The route's session; read only while expanded. */
  session: RowSaveSession<ChapterDraft> | null
  /** `isUserEditBlocked`: fields and Save disable with `blockedReason`. */
  blocked: boolean
  blockedReason?: string
  /** Route focus, for Cmd/Ctrl-S on the in-card bar. */
  hotkeysEnabled: boolean
  onJump: () => void
}

type Gate = { blocked: boolean; blockedReason?: string }

type TextFieldName = 'title' | 'theme' | 'summary'

const NO_ACTION = () => {}

function issueText(message: string | undefined): string | undefined {
  return message == null ? undefined : chapterIssueText(message)
}

/** The actions after `Jump to chapter →`, one list: inline at tablet and desktop, `⋯` on phone. */
function moreActions(latest: boolean): OverflowMenuEntry[] {
  return [
    {
      key: 'regenerate',
      label: t('chapters:actions.regenerate'),
      disabled: true,
      disabledReason: t('chapters:actions.regenerateLandsLater'),
      onPress: NO_ACTION,
    },
    ...(latest
      ? destructiveEntry('delete', t('chapters:actions.delete'), {
          onPress: NO_ACTION,
          disabledReason: t('chapters:actions.deleteLandsLater'),
        })
      : []),
  ]
}

/** A closed chapter's card: the head toggles the editor; the session and its guard are the route's. */
export function ChapterCard({
  data,
  expanded,
  onToggle,
  session,
  blocked,
  blockedReason,
  hotkeysEnabled,
  onJump,
}: ChapterCardProps): ReactElement {
  const isPhone = useTier() === 'phone'
  const padding = isPhone ? 'px-3' : 'px-5'
  return (
    <View
      testID={`chapter-card-${data.row.id}`}
      className="overflow-hidden rounded-md border border-border bg-bg-base"
    >
      <CardHead data={data} expanded={expanded} padding={padding} onToggle={onToggle} />
      {expanded && session != null ? (
        <>
          <View className={cn('gap-4 border-t border-border pb-4 pt-3', padding)}>
            <ReadOnlyFacts data={data} />
            <View className="gap-3">
              <TextField
                control={session.form.control}
                name="title"
                blocked={blocked}
                blockedReason={blockedReason}
              />
              <TextField
                control={session.form.control}
                name="theme"
                blocked={blocked}
                blockedReason={blockedReason}
              />
              <TextField
                control={session.form.control}
                name="summary"
                multiline
                blocked={blocked}
                blockedReason={blockedReason}
              />
              <KeywordsField
                control={session.form.control}
                blocked={blocked}
                blockedReason={blockedReason}
              />
            </View>
            <ActionRow latest={data.latest} isPhone={isPhone} onJump={onJump} />
          </View>
          {/* touch.md → Save bar on phone: there the route holds it at the surface's bottom edge. */}
          {isPhone ? null : (
            <RowSaveBar
              session={session}
              enabled={hotkeysEnabled}
              blocked={blocked}
              blockedReason={blockedReason}
            />
          )}
        </>
      ) : null}
    </View>
  )
}

function CardHead({
  data,
  expanded,
  padding,
  onToggle,
}: {
  data: ChapterCardData
  expanded: boolean
  padding: string
  onToggle: () => void
}) {
  const heading = chapterHeading(data.number, data.row.title)
  const meta = [data.timeLabel, compactTokenLabel(data.row.tokenCount), data.row.theme]
    .filter((part): part is string => part != null && part.trim() !== '')
    .join(' · ')
  return (
    <Pressable
      accessibilityRole="button"
      aria-expanded={expanded}
      aria-label={heading}
      onPress={onToggle}
      className={cn(
        'flex-row items-start gap-3 py-3 active:bg-tint-press',
        padding,
        Platform.select({
          web: 'cursor-pointer outline-none hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring',
        }),
      )}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text size="sm" numberOfLines={1} className="font-semibold">
          {heading}
        </Text>
        <Text size="xs" variant="muted">
          {meta}
        </Text>
      </View>
      <Icon as={expanded ? ChevronDown : ChevronRight} size="sm" className="mt-0.5 text-fg-muted" />
    </Pressable>
  )
}

function ReadOnlyFacts({ data }: { data: ChapterCardData }) {
  return (
    <View className="flex-row flex-wrap gap-x-4 gap-y-1">
      {data.timeLabel != null ? (
        <Text size="xs" variant="muted">
          {data.timeLabel}
        </Text>
      ) : null}
      <Text size="xs" variant="muted">
        {fullTokenLabel(data.row.tokenCount)}
      </Text>
      <Text size="xs" variant="muted">
        {closedAtLabel(data.row.closedAt)}
      </Text>
      {data.entryRange != null ? (
        <Text size="xs" variant="muted">
          {entryRangeLabel(data.entryRange)}
        </Text>
      ) : null}
    </View>
  )
}

function TextField({
  control,
  name,
  multiline = false,
  blocked,
  blockedReason,
}: Gate & { control: Control<ChapterDraft>; name: TextFieldName; multiline?: boolean }) {
  const label = chapterFieldLabel(name)
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const inputProps = {
          value: field.value,
          onChangeText: field.onChange,
          onBlur: field.onBlur,
          editable: !blocked,
          accessibilityHint: blocked ? blockedReason : undefined,
          'aria-label': label,
          'aria-invalid': fieldState.error != null,
        }
        return (
          <FormRow label={label} error={issueText(fieldState.error?.message)}>
            {multiline ? (
              <Textarea {...inputProps} rows={4} maxRows={6} />
            ) : (
              <Input {...inputProps} />
            )}
          </FormRow>
        )
      }}
    />
  )
}

function KeywordsField({
  control,
  blocked,
  blockedReason,
}: Gate & { control: Control<ChapterDraft> }) {
  const label = chapterFieldLabel('keywords')
  return (
    <Controller
      control={control}
      name="keywords"
      render={({ field, fieldState }) => (
        <FormRow label={label} error={issueText(fieldState.error?.message)}>
          <TagInput
            value={field.value}
            onChange={field.onChange}
            label={label}
            placeholder={t('chapters:fields.keywordsPlaceholder')}
            disabled={blocked}
            disabledReason={blockedReason}
            aria-invalid={fieldState.error != null}
          />
        </FormRow>
      )}
    />
  )
}

function ActionRow({
  latest,
  isPhone,
  onJump,
}: {
  latest: boolean
  isPhone: boolean
  onJump: () => void
}) {
  const more = moreActions(latest)
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onPress={onJump}
        className={isPhone ? 'flex-1' : undefined}
      >
        <Text>{t('chapters:actions.jump')}</Text>
      </Button>
      {isPhone ? (
        <OverflowMenu label={t('chapters:card.moreActions')} entries={more} />
      ) : (
        more.map((entry) => (
          // Native has no tooltip, so a disabled action's reason shows under it, as the popover's.
          // The wireframe's `.danger` sits at the row's far end; this View is the flex item.
          <View
            key={entry.key}
            className={cn('items-start gap-0.5', entry.destructive && 'ml-auto')}
          >
            <Button
              variant={entry.destructive ? 'destructive' : 'secondary'}
              size="sm"
              disabled={entry.disabled}
              disabledReason={entry.disabledReason}
              onPress={entry.onPress}
            >
              <Text>{entry.label}</Text>
            </Button>
            {entry.disabled === true && entry.disabledReason != null && Platform.OS !== 'web' ? (
              <Text size="xs" variant="muted">
                {entry.disabledReason}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </View>
  )
}
