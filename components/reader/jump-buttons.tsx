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
          onPress={onJumpToBottom}
          className="absolute bottom-12 right-4 rounded-full bg-bg-overlay shadow-md"
        />
      )}
    </>
  )
}

export type { JumpButtonsProps }
