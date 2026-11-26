import {
  PRODUCT_INSTALLER_FEED_URL,
  PRODUCT_RELEASE_REPO_SLUG
} from '../../../shared/product-identity'

/** Fork: UDA Orca's stable feed is its installer feed, else its release repository's latest release. */
export const PRODUCT_RELEASE_FEED = {
  provider: 'generic',
  url:
    PRODUCT_INSTALLER_FEED_URL ??
    `https://github.com/${PRODUCT_RELEASE_REPO_SLUG}/releases/latest/download`
} as const
