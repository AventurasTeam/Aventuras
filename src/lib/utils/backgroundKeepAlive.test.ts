import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const invoke = vi.fn()
class FakeChannel {
  onmessage: (m: unknown) => void = () => {}
}
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: FakeChannel }))

vi.mock('#lib/utils/silentAudio.ts', () => ({
  startSilentAudio: vi.fn(),
  stopSilentAudio: vi.fn(),
}))

const isAndroid = vi.fn()
const isIos = vi.fn()
vi.mock('#lib/utils/platform.ts', () => ({ isAndroid, isIos }))

const {
  startBackgroundKeepAlive,
  stopBackgroundKeepAlive,
  supportsBackgroundGeneration,
  holdBackgroundKeepAlive,
  retainBackgroundKeepAlive,
  afterBackgroundKeepAlive,
} = await import('./backgroundKeepAlive')

const bridge = { startGenerationService: vi.fn(), stopGenerationService: vi.fn() }

beforeEach(() => {
  invoke.mockResolvedValue(undefined)
  vi.stubGlobal('window', { AndroidBridge: bridge })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function onPlatform(android: boolean, ios: boolean) {
  isAndroid.mockReturnValue(android)
  isIos.mockReturnValue(ios)
}

describe('backgroundKeepAlive', () => {
  it('drives the Android bridge on Android', async () => {
    onPlatform(true, false)
    await startBackgroundKeepAlive(() => {})
    await stopBackgroundKeepAlive()
    expect(bridge.startGenerationService).toHaveBeenCalledOnce()
    expect(bridge.stopGenerationService).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('invokes the generation plugin on iOS and forwards expiry', async () => {
    onPlatform(false, true)
    const onExpire = vi.fn()
    await startBackgroundKeepAlive(onExpire, true)
    const [command, args] = invoke.mock.calls[0]
    expect(command).toBe('plugin:generation|start')
    expect(args.notifyOnExpire).toBe(true)
    args.onExpire.onmessage({ reason: 'expired' })
    expect(onExpire).toHaveBeenCalledOnce()

    await stopBackgroundKeepAlive()
    expect(invoke).toHaveBeenLastCalledWith('plugin:generation|stop', { outcome: 'done' })
  })

  it('does nothing elsewhere', async () => {
    onPlatform(false, false)
    await startBackgroundKeepAlive(() => {})
    await stopBackgroundKeepAlive()
    expect(invoke).not.toHaveBeenCalled()
    expect(supportsBackgroundGeneration()).toBe(false)
  })

  it('swallows a failed start so the generation still runs', async () => {
    onPlatform(false, true)
    invoke.mockRejectedValueOnce(new Error('not permitted'))
    await expect(startBackgroundKeepAlive(() => {})).resolves.toBeUndefined()
  })
})

describe('holdBackgroundKeepAlive', () => {
  const calls = () => invoke.mock.calls.map((c) => c[0])

  it('stops only after the turn and every retained tail have released', async () => {
    onPlatform(false, true)
    const releaseTurn = await holdBackgroundKeepAlive(() => {})
    const releaseTranslation = retainBackgroundKeepAlive()
    const releaseTasks = retainBackgroundKeepAlive()

    releaseTurn()
    releaseTranslation()
    expect(calls()).toEqual(['plugin:generation|start'])

    releaseTasks()
    expect(calls()).toEqual(['plugin:generation|start', 'plugin:generation|stop'])
  })

  it('ignores a second release of the same hold', async () => {
    onPlatform(false, true)
    const releaseTurn = await holdBackgroundKeepAlive(() => {})
    const releaseTail = retainBackgroundKeepAlive()
    releaseTail()
    releaseTail()
    expect(calls()).toEqual(['plugin:generation|start'])
    releaseTurn()
    expect(calls()).toEqual(['plugin:generation|start', 'plugin:generation|stop'])
  })

  it('restarts the Android service for every turn and stops it when that turn ends', async () => {
    onPlatform(true, false)
    const releaseFirst = await holdBackgroundKeepAlive(() => {})
    const releaseSecond = await holdBackgroundKeepAlive(() => {})
    expect(bridge.startGenerationService).toHaveBeenCalledTimes(2)
    releaseFirst()
    releaseFirst()
    releaseSecond()
    expect(bridge.stopGenerationService).toHaveBeenCalledTimes(2)
    retainBackgroundKeepAlive()()
    expect(bridge.stopGenerationService).toHaveBeenCalledTimes(2)
  })

  it('retains nothing when no keep-alive runs', () => {
    onPlatform(false, true)
    retainBackgroundKeepAlive()()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not let a release from before an expiry end the next run', async () => {
    onPlatform(false, true)
    const onExpire = vi.fn()
    const staleRelease = await holdBackgroundKeepAlive(onExpire)
    invoke.mock.calls[0][1].onExpire.onmessage({ reason: 'expired' })
    expect(onExpire).toHaveBeenCalledOnce()

    const releaseNext = await holdBackgroundKeepAlive(() => {})
    staleRelease()
    expect(calls().filter((c) => c === 'plugin:generation|stop')).toHaveLength(0)
    releaseNext()
    expect(calls().filter((c) => c === 'plugin:generation|stop')).toHaveLength(1)
  })

  it('tells every turn that holds the keep-alive when it expires', async () => {
    onPlatform(false, true)
    const first = vi.fn()
    const second = vi.fn()
    const released = vi.fn()
    await holdBackgroundKeepAlive(first)
    await holdBackgroundKeepAlive(second, true)
    const releaseThird = await holdBackgroundKeepAlive(released)
    releaseThird()
    expect(invoke).toHaveBeenCalledWith('plugin:generation|update', {
      stage: 'preparing',
      notifyOnExpire: true,
    })
    invoke.mock.calls[0][1].onExpire.onmessage({ reason: 'expired' })
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(released).not.toHaveBeenCalled()
  })

  it('ends the task with the worst outcome of everything that held it', async () => {
    onPlatform(false, true)
    const releaseTurn = await holdBackgroundKeepAlive(() => {})
    const releaseTail = retainBackgroundKeepAlive()
    releaseTurn('failed')
    releaseTail('done')
    expect(invoke).toHaveBeenLastCalledWith('plugin:generation|stop', { outcome: 'failed' })
  })

  it('ends a clean run as done', async () => {
    onPlatform(false, true)
    const release = await holdBackgroundKeepAlive(() => {})
    release()
    expect(invoke).toHaveBeenLastCalledWith('plugin:generation|stop', { outcome: 'done' })
  })

  it('runs idle callbacks after the last release and before the stop', async () => {
    onPlatform(false, true)
    const order: string[] = []
    invoke.mockImplementation(async (command: string) => {
      order.push(command.split('|')[1])
    })
    const releaseTurn = await holdBackgroundKeepAlive(() => {})
    const releaseTail = retainBackgroundKeepAlive()
    afterBackgroundKeepAlive(async () => {
      order.push('callback')
    })

    releaseTurn()
    expect(order).toEqual(['start'])
    releaseTail()
    await vi.waitFor(() => expect(order).toEqual(['start', 'callback', 'stop']))
    invoke.mockReset()
  })

  it('runs an idle callback at once when nothing holds the keep-alive', () => {
    const callback = vi.fn()
    afterBackgroundKeepAlive(callback)
    expect(callback).toHaveBeenCalledOnce()
  })
})
