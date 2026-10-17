/** The error a response's first read rejects with. */
export function firstReadError(response: Response): Promise<unknown> {
  return response
    .body!.getReader()
    .read()
    .catch((e: unknown) => e)
}
