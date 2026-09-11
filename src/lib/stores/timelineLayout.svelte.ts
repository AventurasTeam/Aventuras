/**
 * TEMPORARY. Switches the reconcile dialog between its desktop and mobile layouts at runtime so
 * both can be compared on one dev run. Delete this together with the branches it drives in
 * `TimelineRepairModal.svelte` and the toggle in `TimelinePanel.svelte`.
 */
class TimelineLayout {
  mobile = $state(false)

  toggle() {
    this.mobile = !this.mobile
  }
}

export const timelineLayout = new TimelineLayout()
