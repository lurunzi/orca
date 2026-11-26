import { PRODUCT_INSTALLER_FEED_URL } from '../../../shared/product-identity'
import type { UpdateCheckVariant } from '../lifecycle/updater-types'
import { UpdaterReleaseFeed } from './updater-release-feed'

/** UDA Orca: one generic feed serves the current latest*.yml, so no GitHub release tag is resolved and no perf build exists. */
export abstract class UpdaterInstallerFeed extends UpdaterReleaseFeed {
  protected override async pinDefaultReleaseFeed(
    variant: UpdateCheckVariant = 'default'
  ): Promise<'ready' | 'not-available'> {
    if (!PRODUCT_INSTALLER_FEED_URL) {
      return super.pinDefaultReleaseFeed(variant)
    }
    if (variant === 'perf') {
      return 'not-available'
    }
    this.getAutoUpdater().setFeedURL({ provider: 'generic', url: PRODUCT_INSTALLER_FEED_URL })
    return 'ready'
  }
}
