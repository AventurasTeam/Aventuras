export type ReseedSummary = { tables: number; rows: number }

// Desktop/web reseeds through the Node driver (`pnpm db:seed`), which also
// owns migrations for a fresh file. Keeping the web bundle dataset-free is
// deliberate — only the native bundle pays for the seed rows.
export function reseedDevDatabase(): Promise<ReseedSummary> {
  return Promise.reject(new Error('On-device reseed is native-only — run `pnpm db:seed` instead.'))
}
