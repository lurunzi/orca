import { isPluginInstallLinkArgument } from '../../../shared/plugins/catalog/plugin-install-link'
import { isPairingLinkArgument } from '../../../shared/remote-runtime/pairing/pairing-deep-link'
import { toOrcaDeepLink } from '../../../shared/product-identity'
import { parseSkillShareId } from '../../../shared/skill-share-link'

/** macOS open-url: claim only links Orca routes, so other schemes keep their default handling. */
export function isRoutedOrcaDeepLink(url: string): boolean {
  // UDA Orca registers uda-orca:// and still accepts hand-opened orca:// links.
  const link = toOrcaDeepLink(url)
  return (
    parseSkillShareId(link) !== null ||
    isPluginInstallLinkArgument(link) ||
    isPairingLinkArgument(link)
  )
}
