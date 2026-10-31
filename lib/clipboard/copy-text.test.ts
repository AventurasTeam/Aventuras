import { setStringAsync } from 'expo-clipboard'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

import { copyText } from './copy-text'

const platform = vi.hoisted(() => ({ OS: 'web', Version: 0 }))

// The unit project resolves react-native to RN Web; the native branch needs OS switched.
vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Platform: platform,
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('@/lib/diagnostics', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

const TEXT = 'I open the letter.\n\nThen I read it.'

describe('copyText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    platform.OS = 'web'
    platform.Version = 0
    vi.unstubAllGlobals()
  })

  it('writes the text verbatim and confirms', async () => {
    const write = vi.fn(async () => true)
    await copyText(TEXT, write)
    expect(write).toHaveBeenCalledWith(TEXT)
    expect(toast.info).toHaveBeenCalledWith(t('common:clipboard.copied'))
    expect(toast.error).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  // The web writer reports a missing Clipboard API as `false`; native writes fail only by throwing.
  it('reports a write that resolves false', async () => {
    await copyText(TEXT, async () => false)
    expect(toast.error).toHaveBeenCalledWith(t('common:clipboard.copyFailed'))
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('reports a write that throws', async () => {
    await copyText(TEXT, async () => {
      throw new Error('denied')
    })
    expect(toast.error).toHaveBeenCalledWith(t('common:clipboard.copyFailed'))
    expect(toast.info).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('app.clipboard_copy_failed', {
      error: 'denied',
    })
  })

  describe('default writer', () => {
    it('writes through the Clipboard API on web, not expo-clipboard', async () => {
      const writeText = vi.fn(async () => undefined)
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      await copyText(TEXT)
      expect(writeText).toHaveBeenCalledWith(TEXT)
      expect(setStringAsync).not.toHaveBeenCalled()
      expect(toast.info).toHaveBeenCalledWith(t('common:clipboard.copied'))
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('reports a web clipboard without the Clipboard API', async () => {
      vi.stubGlobal('navigator', {})
      await copyText(TEXT)
      expect(setStringAsync).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(t('common:clipboard.copyFailed'))
      expect(toast.info).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith('app.clipboard_unavailable')
    })

    it('writes through expo-clipboard on native', async () => {
      platform.OS = 'android'
      platform.Version = 32
      vi.mocked(setStringAsync).mockResolvedValue(true)
      await copyText(TEXT)
      expect(setStringAsync).toHaveBeenCalledWith(TEXT)
      expect(toast.info).toHaveBeenCalledWith(t('common:clipboard.copied'))
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('leaves the confirmation to Android 13 and later', async () => {
      platform.OS = 'android'
      platform.Version = 33
      vi.mocked(setStringAsync).mockResolvedValue(true)
      await copyText(TEXT)
      expect(setStringAsync).toHaveBeenCalledWith(TEXT)
      expect(toast.info).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('still reports a failed write on Android 13 and later', async () => {
      platform.OS = 'android'
      platform.Version = 33
      vi.mocked(setStringAsync).mockRejectedValue(new Error('binder'))
      await copyText(TEXT)
      expect(toast.error).toHaveBeenCalledWith(t('common:clipboard.copyFailed'))
      expect(toast.info).not.toHaveBeenCalled()
    })
  })
})
