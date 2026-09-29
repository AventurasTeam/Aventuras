import { describe, expect, it } from 'vitest'
import { ComfyApi } from '@saintno/comfyui-sdk'
import { COMFY_API_FETCH_MEMBERS } from './comfy'

describe('ComfyApi fetch patch', () => {
  it.each(COMFY_API_FETCH_MEMBERS)('the SDK still defines %s', (member) => {
    expect(typeof (ComfyApi.prototype as unknown as Record<string, unknown>)[member]).toBe(
      'function',
    )
  })
})
