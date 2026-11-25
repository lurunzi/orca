import { PRODUCT_RELEASE_REPO_SLUG } from '../../../shared/product-identity'

/** Fork: UDA Orca's stable feed is its own release repository's latest release. */
export const PRODUCT_RELEASE_FEED = {
  provider: 'generic',
  url: `https://github.com/${PRODUCT_RELEASE_REPO_SLUG}/releases/latest/download`
} as const
