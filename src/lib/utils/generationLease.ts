/**
 * A generation's claim on the branch it started against, held until its own writes have
 * settled, so a switch or a new generation cannot slip in while they land.
 *
 * Release has exactly one owner: the holder that acquired it. Stop abandons the request and
 * does not release.
 *
 * Carries the story as well as the branch: two stories' main branches are both `null`, so a
 * branch alone cannot tell a write meant for one from a write meant for the other.
 *
 * A leaf module rather than part of the rune store, so its ordering can be tested.
 */
export class GenerationLease {
  private finished = false

  constructor(
    readonly storyId: string,
    readonly branchId: string | null,
    private readonly onRelease: () => void,
  ) {}

  get isFinished(): boolean {
    return this.finished
  }

  /** Mark the generation settled and release. Idempotent. */
  finish(): void {
    if (this.finished) return
    this.finished = true
    this.onRelease()
  }
}
