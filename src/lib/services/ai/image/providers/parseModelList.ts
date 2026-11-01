import * as z from 'zod'

const modelList = z.union([
  z.array(z.unknown()),
  z.object({ data: z.array(z.unknown()) }).transform((body) => body.data),
])

/**
 * The entries of a `/models` reply, bare or under `data`, that match `entry`. The rest are skipped.
 * A reply that is no list at all throws, naming `what`.
 */
export function parseModelList<T extends z.ZodType>(
  body: unknown,
  entry: T,
  what: string,
): z.output<T>[] {
  const list = modelList.safeParse(body)
  if (!list.success) throw new Error(`${what} did not return a model list`)

  return list.data.flatMap((item) => {
    const parsed = entry.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}
