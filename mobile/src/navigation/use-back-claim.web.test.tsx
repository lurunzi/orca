import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPageBackConsumers } from '../mobile-web-shell/bridge/page-back-consumers'

// Built in `beforeEach` rather than at `vi.hoisted`, which runs before this file's own imports:
// the real stack is what the hook is measured against, and a fake answering its edges would be a
// second copy of the rule.
const page = vi.hoisted(() => ({
  claims: [] as boolean[],
  unclaimed: vi.fn(),
  consumers: null as ReturnType<
    typeof import('../mobile-web-shell/bridge/page-back-consumers').createPageBackConsumers
  > | null
}))

vi.mock('../transport/client-context.web', () => ({
  usePageBridgeClient: () => ({ claimBack: (claim: () => boolean) => stack().claim(claim) })
}))

import { useBackClaim } from './use-back-claim.web'

function stack(): NonNullable<typeof page.consumers> {
  if (page.consumers === null) {
    throw new Error('the page back stack was not built for this case')
  }
  return page.consumers
}

function Screen({ claim }: { claim: (() => boolean) | null }): null {
  useBackClaim(claim)
  return null
}

function render(claim: (() => boolean) | null): ReactTestRenderer {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(createElement(Screen, { claim }))
  })
  return tree
}

beforeEach(() => {
  page.claims.length = 0
  page.unclaimed.mockClear()
  page.consumers = createPageBackConsumers({
    onClaimedChange: (claimed) => page.claims.push(claimed),
    onUnclaimed: page.unclaimed
  })
})

/**
 * The page half of the seam every sheet takes. There is no hardware key inside a WebView:
 * react-native-web answers `BackHandler.addEventListener` with a console warning and an inert
 * subscription, so the page claims the shell's key over the bridge instead.
 */
describe('a page screen claiming the device Back key from the shell', () => {
  it('claims nothing while the caller has nothing to do with the key', () => {
    render(null)
    expect(page.claims).toEqual([])
  })

  it('claims while the caller holds it, and lets go when it stops', () => {
    const tree = render(() => true)
    expect(page.claims).toEqual([true])
    act(() => {
      tree.update(createElement(Screen, { claim: null }))
    })
    expect(page.claims).toEqual([true, false])
  })

  it('lets go when the screen unmounts, which is a sheet taken off the page', () => {
    const tree = render(() => true)
    act(() => tree.unmount())
    expect(page.claims).toEqual([true, false])
  })

  it('claims once across a rebuilt handler, and the newest one is what answers', () => {
    const first = vi.fn(() => true)
    const second = vi.fn(() => true)
    const tree = render(first)
    act(() => {
      tree.update(createElement(Screen, { claim: second }))
    })
    // One edge, so the shell heard one claim: a caller that rebuilds its handler every render must
    // not post a frame per render.
    expect(page.claims).toEqual([true])
    stack().press()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('hands a press on, which is what lets the one beneath it answer', () => {
    const under = vi.fn(() => true)
    const over = vi.fn(() => false)
    render(under)
    const tree = render(over)
    stack().press()
    expect(over).toHaveBeenCalledTimes(1)
    expect(under).toHaveBeenCalledTimes(1)
    expect(page.unclaimed).not.toHaveBeenCalled()
    act(() => tree.unmount())
  })
})
