import { ArrowDown, ArrowUp } from 'lucide-react-native'

import { IconAction } from '@/components/ui/icon-action'
import { t } from '@/lib/i18n'

type JumpButtonsProps = {
  showJumpToTop: boolean
  showJumpToBottom: boolean
  onJumpToTop: () => void
  onJumpToBottom: () => void
}

export function JumpButtons({
  showJumpToTop,
  showJumpToBottom,
  onJumpToTop,
  onJumpToBottom,
}: JumpButtonsProps) {
  return (
    <>
      {showJumpToTop && (
        <IconAction
          icon={ArrowUp}
          label={t('reader:jumpToTop')}
          onPress={onJumpToTop}
          className="absolute bottom-24 right-4 rounded-full bg-bg-overlay shadow-md"
        />
      )}
      {showJumpToBottom && (
        <IconAction
          icon={ArrowDown}
          label={t('reader:jumpToBottom')}
          onPress={onJumpToBottom}
          className="absolute bottom-12 right-4 rounded-full bg-bg-overlay shadow-md"
        />
      )}
    </>
  )
}

export type { JumpButtonsProps }
