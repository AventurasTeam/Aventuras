import { Channel, invoke } from '@tauri-apps/api/core'
import { isAndroid, isIos } from '#lib/utils/platform.ts'
import { startSilentAudio, stopSilentAudio } from '#lib/utils/silentAudio.ts'

// Native start, stop and update calls run in the order issued; the first runs at once.
let nativeTail: Promise<unknown> | null = null
function inOrder<T>(call: () => Promise<T>): Promise<T> {
  const run = nativeTail ? nativeTail.then(call) : call()
  const settled = run.then(
    () => {},
    () => {},
  )
  nativeTail = settled
  void settled.then(() => {
    if (nativeTail === settled) nativeTail = null
  })
  return run
}

const TITLE = 'Generating story…'
const SUBTITLE = 'AI generation is running.'

/** Whether this platform can keep a generation running while the app is backgrounded. */
export function supportsBackgroundGeneration(): boolean {
  return isAndroid() || isIos()
}

/**
 * Keeps the process alive until `stopBackgroundKeepAlive`. `onExpire` fires if the OS ends the
 * allowance first, which only iOS does. `notifyOnExpire` lets the native side post the
 * "interrupted" notice itself, since JS may already be suspended.
 */
async function startBackgroundKeepAlive(
  onExpire: () => void,
  notifyOnExpire = false,
): Promise<void> {
  try {
    if (isAndroid()) {
      window.AndroidBridge?.startGenerationService()
    } else if (isIos()) {
      // Before the native call: the loop has to be playing before the app is hidden.
      startSilentAudio()
      const channel = new Channel<unknown>()
      channel.onmessage = () => {
        stopSilentAudio()
        onExpire()
      }
      await inOrder(async () =>
        invoke('plugin:generation|start', {
          title: TITLE,
          subtitle: SUBTITLE,
          onExpire: channel,
          notifyOnExpire,
        }),
      )
    }
  } catch (e) {
    stopSilentAudio()
    console.warn('[backgroundKeepAlive] Failed to start:', e)
  }
}

async function stopBackgroundKeepAlive(outcome: KeepAliveOutcome = 'done'): Promise<void> {
  try {
    if (isAndroid()) {
      window.AndroidBridge?.stopGenerationService()
    } else if (isIos()) {
      stopSilentAudio()
      await inOrder(async () => invoke('plugin:generation|stop', { outcome }))
    }
  } catch (e) {
    console.warn('[backgroundKeepAlive] Failed to stop:', e)
  }
}

/** How the work ended; the Dynamic Island shows it as the task's last message. */
export type KeepAliveOutcome = 'done' | 'failed' | 'stopped'

export type KeepAliveStage = 'preparing' | 'writing' | 'world' | 'finishing'

/** Tells the iOS task which part of the pipeline is running, for its text and progress. */
export function setKeepAliveStage(stage: KeepAliveStage, notifyOnExpire?: boolean): void {
  if (!isIos() || holds === 0) return
  inOrder(async () => invoke('plugin:generation|update', { stage, notifyOnExpire })).catch(() => {})
}

const OUTCOME_RANK: Record<KeepAliveOutcome, number> = { done: 0, stopped: 1, failed: 2 }
let worstOutcome: KeepAliveOutcome = 'done'

// Work that outlives the turn (translation, chapter and lore tasks) is started un-awaited, so
// the allowance has to last until the last of it settles, not until the narration does.
let holds = 0
let epoch = 0
let idleCallback: (() => Promise<void> | void) | null = null

type Release = (outcome?: KeepAliveOutcome) => void

// Each turn's own expiry handler: the native side holds only the first turn's channel, so an
// expiry has to reach every turn still holding the keep-alive.
const expiryHandlers = new Set<() => void>()

function releaser(onExpire?: () => void): Release {
  const mine = epoch
  let released = false
  return (outcome = 'done') => {
    if (released || mine !== epoch) return
    released = true
    if (onExpire) expiryHandlers.delete(onExpire)
    if (OUTCOME_RANK[outcome] > OUTCOME_RANK[worstOutcome]) worstOutcome = outcome
    if (--holds === 0) {
      const idleEpoch = ++epoch
      const final = worstOutcome
      worstOutcome = 'done'
      const callback = idleCallback
      idleCallback = null
      void (async () => {
        if (callback) {
          try {
            await callback()
          } catch (e) {
            console.warn('[backgroundKeepAlive] idle callback failed:', e)
          }
        }
        // A turn that started meanwhile owns the task now.
        if (holds !== 0 || epoch !== idleEpoch) return
        await stopBackgroundKeepAlive(final)
      })()
    }
  }
}

/**
 * Runs `callback` once nothing holds the keep-alive any more, before it is stopped; at once when
 * nothing holds it now. A later call replaces a queued one, so overlapping turns notify once.
 * Dropped if the OS ends the keep-alive first.
 */
export function afterBackgroundKeepAlive(callback: () => Promise<void> | void): void {
  if (holds === 0) void callback()
  else idleCallback = callback
}

/**
 * Starts the keep-alive, or joins it if one is running. Call the result once the work is done.
 * Android keeps one service per turn, restarted by each turn so its wake lock is renewed; only
 * iOS shares one keep-alive across overlapping holders.
 */
export async function holdBackgroundKeepAlive(
  onExpire: () => void,
  notifyOnExpire = false,
): Promise<Release> {
  if (isAndroid()) {
    await startBackgroundKeepAlive(onExpire)
    let released = false
    return () => {
      if (released) return
      released = true
      void stopBackgroundKeepAlive()
    }
  }
  holds++
  expiryHandlers.add(onExpire)
  const release = releaser(onExpire)
  if (holds === 1) {
    await startBackgroundKeepAlive(() => {
      holds = 0
      epoch++
      worstOutcome = 'done'
      idleCallback = null
      const handlers = [...expiryHandlers]
      expiryHandlers.clear()
      for (const handler of handlers) handler()
    }, notifyOnExpire)
  } else {
    // The joining turn queues its own notice if it completes.
    idleCallback = null
    setKeepAliveStage('preparing', notifyOnExpire)
  }
  return release
}

/** Joins a running keep-alive for work that outlives its caller; does nothing when none runs. */
export function retainBackgroundKeepAlive(): Release {
  if (holds === 0) return () => {}
  holds++
  return releaser()
}
