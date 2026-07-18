import { ArrowDown } from 'lucide-react-native'

import { IconAction } from '@/components/ui/icon-action'
import { t } from '@/lib/i18n'

type JumpButtonsProps = {
  showJumpToBottom: boolean
  onJumpToBottom: () => void
}

export function JumpButtons({ showJumpToBottom, onJumpToBottom }: JumpButtonsProps) {
  return (
    <>
      {showJumpToBottom && (
        <IconAction
          icon={ArrowDown}
          label={t('reader:jumpToBottom')}
          size="lg"
          onPress={onJumpToBottom}
          className="absolute bottom-3 right-6 rounded-md border border-border bg-bg-overlay shadow-lg"
        />
      )}
    </>
  )
}

export type { JumpButtonsProps }
