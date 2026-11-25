const SAMPLE_RATE = 8000

/** One second of 16-bit mono PCM at the lowest non-zero amplitude, as a WAV file. */
export function buildSilentWav(): Uint8Array {
  const samples = SAMPLE_RATE
  const dataSize = samples * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, dataSize, true)
  // Alternating +1/-1 rather than zeros, so nothing treats the clip as empty.
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, i % 2 === 0 ? 1 : -1, true)
  return bytes
}

let url: string | null = null
let element: HTMLAudioElement | null = null

/**
 * Plays an inaudible loop so WebKit keeps the page's content process running while the app is
 * in the background. An `<audio>` element is required: WebKit interrupts a Web Audio context
 * when the app is hidden.
 */
export function startSilentAudio(): void {
  if (element) return
  url ??= URL.createObjectURL(new Blob([buildSilentWav() as BlobPart], { type: 'audio/wav' }))
  const audio = new Audio(url)
  audio.loop = true
  audio.setAttribute('playsinline', '')
  // Another app's audio, or a call, pauses the element; start it again.
  audio.addEventListener('pause', () => {
    if (element === audio) void audio.play().catch(() => {})
  })
  element = audio
  void audio.play().catch(() => {})
}

export function stopSilentAudio(): void {
  const audio = element
  element = null
  if (!audio) return
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
}
