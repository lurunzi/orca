import { homedir } from 'node:os'
import { join } from 'node:path'
import { PRODUCT_IDENTITY } from './product-identity'

// Kept apart from product-identity.ts so renderer code can import the identity without node:os.

/** This app's user-level state directory (`~/.uda-orca`). */
export function orcaHomeDir(home: string = homedir()): string {
  return join(home, PRODUCT_IDENTITY.homeDirName)
}
