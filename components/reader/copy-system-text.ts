import { setStringAsync } from 'expo-clipboard'
import { Platform } from 'react-native'

import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

type ClipboardWrite = (text: string) => Promise<boolean>

// Not expo-clipboard's web build: its execCommand fallback reports success without checking.
async function writeClipboard(text: string): Promise<boolean> {
  if (Platform.OS !== 'web') return setStringAsync(text)
  if (typeof navigator === 'undefined' || navigator.clipboard == null) {
    logger.warn('reader.clipboard_unavailable')
    return false
  }
  await navigator.clipboard.writeText(text)
  return true
}

// Android 13 (API 33) confirms every copy itself; a toast on top would double it.
function osConfirmsCopy(): boolean {
  return Platform.OS === 'android' && Platform.Version >= 33
}

/** A system entry's copy request: writes the clipboard and toasts whether it took. */
export async function copySystemText(
  text: string,
  write: ClipboardWrite = writeClipboard,
): Promise<void> {
  let written: boolean
  try {
    written = await write(text)
  } catch (error: unknown) {
    logger.error('reader.system_text_copy_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    written = false
  }
  if (!written) toast.error(t('reader:systemEntry.copyFailed'))
  else if (!osConfirmsCopy()) toast.info(t('reader:systemEntry.copied'))
}
