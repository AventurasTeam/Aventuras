import { database } from '$lib/services/database'
import type { TimeTracker } from '$lib/types'
import type { StoryStore } from './types'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Time]', ...args)
  }
}

export class StoryTimeStore {
  private _timeTracker = $state<TimeTracker | null>(null)

  constructor(private ctx: StoryStore) {}

  get timeTracker(): TimeTracker {
    return this._timeTracker || { years: 0, days: 0, hours: 0, minutes: 0 }
  }

  load(timeTracker: TimeTracker | null): void {
    this._timeTracker = timeTracker
  }

  clear(): void {
    this._timeTracker = null
  }

  /**
   * Normalize time values, converting overflow/underflow between units.
   * Handles both positive overflow (60 min → 1 hour) and negative underflow (borrowing).
   * 60 minutes → 1 hour, 24 hours → 1 day, 365 days → 1 year
   */
  private normalizeTime(time: TimeTracker): TimeTracker {
    let { years, days, hours, minutes } = time

    // Handle negative minutes by borrowing from hours
    while (minutes < 0 && hours > 0) {
      hours -= 1
      minutes += 60
    }

    // Handle negative hours by borrowing from days
    while (hours < 0 && days > 0) {
      days -= 1
      hours += 24
    }

    // Handle negative days by borrowing from years
    while (days < 0 && years > 0) {
      years -= 1
      days += 365
    }

    // Clamp any remaining negatives to 0 (can't have negative time)
    years = Math.max(0, years)
    days = Math.max(0, days)
    hours = Math.max(0, hours)
    minutes = Math.max(0, minutes)

    // Normalize overflow: minutes to hours
    if (minutes >= 60) {
      hours += Math.floor(minutes / 60)
      minutes = minutes % 60
    }

    // Normalize overflow: hours to days
    if (hours >= 24) {
      days += Math.floor(hours / 24)
      hours = hours % 24
    }

    // Normalize overflow: days to years
    if (days >= 365) {
      years += Math.floor(days / 365)
      days = days % 365
    }

    return { years, days, hours, minutes }
  }

  // Set time tracker directly
  async setTimeTracker(time: TimeTracker): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    const normalized = this.normalizeTime(time)
    await database.saveTimeTracker(this.ctx.currentStory.id, normalized)
    this._timeTracker = normalized
    log('Time tracker set:', normalized)
  }

  // Update time tracker with partial values (adds to current time)
  async addTime(updates: Partial<TimeTracker>): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    const current = this.timeTracker
    const newTime: TimeTracker = {
      years: current.years + (updates.years ?? 0),
      days: current.days + (updates.days ?? 0),
      hours: current.hours + (updates.hours ?? 0),
      minutes: current.minutes + (updates.minutes ?? 0),
    }

    const normalized = this.normalizeTime(newTime)
    await database.saveTimeTracker(this.ctx.currentStory.id, normalized)
    this._timeTracker = normalized
    log('Time added:', updates, '→', normalized)
  }

  /**
   * Apply time progression from classifier result.
   * Adds a default amount based on the progression type.
   */
  async applyTimeProgression(progression: 'none' | 'minutes' | 'hours' | 'days'): Promise<void> {
    if (progression === 'none') return

    // Default increments for each progression type
    const increments: Record<string, Partial<TimeTracker>> = {
      minutes: { minutes: 15 }, // ~15 minutes for minor actions
      hours: { hours: 2 }, // ~2 hours for moderate time passage
      days: { days: 1 }, // 1 day for significant time jumps
    }

    const increment = increments[progression]
    if (increment) {
      await this.addTime(increment)
    }
  }

  /**
   * Restore or clear the story time tracker from a snapshot.
   * Undefined means "skip", null means "clear".
   */
  async restoreTimeTrackerSnapshot(snapshot: TimeTracker | null | undefined): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')
    if (snapshot === undefined) return

    if (snapshot === null) {
      await database.clearTimeTracker(this.ctx.currentStory.id)
      this._timeTracker = null
      log('Time tracker cleared from snapshot')
      return
    }

    const normalized = this.normalizeTime(snapshot)
    await database.saveTimeTracker(this.ctx.currentStory.id, normalized)
    this._timeTracker = normalized
    log('Time tracker restored from snapshot:', normalized)
  }
}
