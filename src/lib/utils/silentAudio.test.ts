import { describe, it, expect } from 'vitest'
import { buildSilentWav } from './silentAudio'

describe('buildSilentWav', () => {
  it('is a well-formed one-second mono 16-bit WAV', () => {
    const wav = buildSilentWav()
    const view = new DataView(wav.buffer)
    const tag = (at: number) => String.fromCharCode(...wav.slice(at, at + 4))
    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(tag(36)).toBe('data')
    expect(view.getUint32(40, true)).toBe(wav.length - 44)
    expect(view.getUint32(24, true)).toBe(8000)
    expect(wav.length).toBe(44 + 8000 * 2)
  })

  it('has no zero samples', () => {
    const wav = buildSilentWav()
    const view = new DataView(wav.buffer)
    for (let i = 0; i < 8000; i++) expect(view.getInt16(44 + i * 2, true)).not.toBe(0)
  })
})
