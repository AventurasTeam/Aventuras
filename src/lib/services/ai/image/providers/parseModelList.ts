import * as z from 'zod'

const modelList = z.union([
  z.array(z.unknown()),
  z.object({ data: z.array(z.unknown()) }).transform((body) => body.data),
])

/**
 * The entries of a `/models` reply, bare or under `data`, that match `entry`. The rest are skipped.
 * A reply that is no list, or whose entries are all unreadable, throws, naming `what`.
 */
export function parseModelList<T extends z.ZodType>(
  body: unknown,
  entry: T,
  what: string,
): z.output<T>[] {
  const list = modelList.safeParse(body)
  if (!list.success) throw new Error(`${what} did not return a model list`)

  const entries = list.data.flatMap((item) => {
    const parsed = entry.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
  // An unreadable catalogue must not read as an empty one.
  if (list.data.length > 0 && entries.length === 0) {
    throw new Error(`${what} returned no readable entries`)
  }
  return entries
}
