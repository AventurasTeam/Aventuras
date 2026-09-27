import { useEffect, useState } from 'react'

/**
 * A route's selection link (`kind`, `id`, `tab` params). `arrive` runs once per link on a ready
 * commit; `atMount` is false for a link set later on a screen useSurfaceNavigate reused. Returns
 * the link until the panes it selects have mounted, so only those open on its tab.
 */
export function useRouteLink<Link>(
  link: Link | null,
  ready: boolean,
  arrive: (link: Link, atMount: boolean) => void,
): Link | null {
  const key = link == null ? null : JSON.stringify(link)
  const [seen, setSeen] = useState(key)
  const [atMount, setAtMount] = useState(true)
  const [unhandled, setUnhandled] = useState(link != null)
  const [pending, setPending] = useState(link != null)
  // Render-phase sync, the NumberInput idiom.
  if (key !== seen) {
    setSeen(key)
    setAtMount(false)
    setUnhandled(link != null)
    setPending(link != null)
  }
  useEffect(() => {
    if (link == null || !ready) return
    if (unhandled) {
      setUnhandled(false)
      arrive(link, atMount)
      // The mount link's panes mounted this commit; a followed link's mount on the next one.
      if (atMount) setPending(false)
    } else if (pending) setPending(false)
  }, [link, ready, unhandled, atMount, pending, arrive])
  return pending ? link : null
}
