import { beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

import { copySystemText } from './copy-system-text'

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

const TEXT = 'I open the letter.\n\nThen I read it.'

describe('copySystemText', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes the text verbatim and confirms', async () => {
    const write = vi.fn(async () => true)
    await copySystemText(TEXT, write)
    expect(write).toHaveBeenCalledWith(TEXT)
    expect(toast.info).toHaveBeenCalledWith(t('reader:systemEntry.copied'))
    expect(toast.error).not.toHaveBeenCalled()
  })

  // expo-clipboard's native write reports a failure as `false`, not a throw.
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
  })
})
