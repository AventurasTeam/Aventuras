import { setStringAsync } from 'expo-clipboard'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

import { copySystemText } from './copy-system-text'

const platform = vi.hoisted(() => ({ OS: 'web' }))

// The unit project resolves react-native to RN Web; the native branch needs OS switched.
vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Platform: platform,
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('@/lib/diagnostics', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

const TEXT = 'I open the letter.\n\nThen I read it.'

describe('copySystemText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    platform.OS = 'web'
    vi.unstubAllGlobals()
  })

  it('writes the text verbatim and confirms', async () => {
    const write = vi.fn(async () => true)
    await copySystemText(TEXT, write)
    expect(write).toHaveBeenCalledWith(TEXT)
    expect(toast.info).toHaveBeenCalledWith(t('reader:systemEntry.copied'))
    expect(toast.error).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  // The web writer reports a missing Clipboard API as `false`; native writes fail only by throwing.
  it('reports a write that resolves false', async () => {
    await copySystemText(TEXT, async () => false)
    expect(toast.error).toHaveBeenCalledWith(t('reader:systemEntry.copyFailed'))
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('reports a write that throws', async () => {
    await copySystemText(TEXT, async () => {
      throw new Error('denied')
    })
    expect(toast.error).toHaveBeenCalledWith(t('reader:systemEntry.copyFailed'))
    expect(toast.info).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('reader.system_text_copy_failed', {
      error: 'denied',
    })
  })

  describe('default writer', () => {
    it('writes through the Clipboard API on web, not expo-clipboard', async () => {
      const writeText = vi.fn(async () => undefined)
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      await copySystemText(TEXT)
      expect(writeText).toHaveBeenCalledWith(TEXT)
      expect(setStringAsync).not.toHaveBeenCalled()
      expect(toast.info).toHaveBeenCalledWith(t('reader:systemEntry.copied'))
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('reports a web clipboard without the Clipboard API', async () => {
      vi.stubGlobal('navigator', {})
      await copySystemText(TEXT)
      expect(setStringAsync).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(t('reader:systemEntry.copyFailed'))
      expect(toast.info).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith('reader.clipboard_unavailable')
    })

    it('writes through expo-clipboard on native', async () => {
      platform.OS = 'android'
      vi.mocked(setStringAsync).mockResolvedValue(true)
      await copySystemText(TEXT)
      expect(setStringAsync).toHaveBeenCalledWith(TEXT)
      expect(toast.info).toHaveBeenCalledWith(t('reader:systemEntry.copied'))
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
