import { expoDb } from './client.native'

// Raw DDL seam (see exec.ts): expoDb.execSync runs statements outside the atomic
// ops batch, wrapped async to share the web signature.
export async function execRaw(sql: string): Promise<void> {
  expoDb.execSync(sql)
}
