/**
 * A generation's claim on the branch it started against.
 *
 * Two moments are distinct and both matter. *Drained* is when the generation's own writes
 * have settled; a rewind must not begin before it, or it races the writes it exists to
 * reverse. *Finished* is when the deferred rewind has run too, and only then is the claim
 * given up — so a switch or a new generation cannot slip in between.
 *
 * Release has exactly one owner: the holder that acquired it. Stop registers a rewind here
 * and waits for it, rather than releasing, which is what keeps the two from racing.
 *
 * A leaf module rather than part of the rune store, so its ordering can be tested.
 */
export class GenerationLease {
  private deferredRestore: (() => Promise<void>) | null = null
  private restoreSettled: ((result: { error?: unknown }) => void) | null = null
  private finished = false

  constructor(
    readonly branchId: string | null,
    private readonly onRelease: () => void,
  ) {}

  get isFinished(): boolean {
    return this.finished
  }

  /**
   * Register work to run once the generation has drained, and get back a promise that
   * settles when it has. The holder runs it; the caller only waits.
   *
   * Returns null if the generation has already finished, in which case there is nothing
   * left to wait for and the caller should act directly.
   */
  deferRestore(restore: () => Promise<void>): Promise<void> | null {
    if (this.finished) return null
    this.deferredRestore = restore
    return new Promise<void>((resolve, reject) => {
      this.restoreSettled = ({ error }) => (error ? reject(error) : resolve())
    })
  }

  /**
   * Mark the generation drained, run any deferred rewind, then release.
   *
   * Idempotent, and releases even when the rewind throws: a leaked lease would leave branch
   * switching dead for the session with no generation left to explain it.
   */
  async finish(): Promise<void> {
    if (this.finished) return
    this.finished = true

    const restore = this.deferredRestore
    this.deferredRestore = null

    try {
      if (restore) {
        try {
          await restore()
          this.restoreSettled?.({})
        } catch (error) {
          this.restoreSettled?.({ error })
        }
      }
    } finally {
      this.restoreSettled = null
      this.onRelease()
    }
  }
}
